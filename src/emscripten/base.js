'use strict';

module.exports = function(Module = {}) {
  const TOTAL_MEMORY = Module.TOTAL_MEMORY;
  const PAGE_SIZE = 4096;
  const runDependencyTracking = {};
  const __ATPRERUN__ = [];
  const __ATINIT__ = [];
  const __ATMAIN__ = [];
  const __ATEXIT__ = [];
  const __ATPOSTRUN__ = [];

  const ERRNO_CODES = require('./error');
  const ERRNO_MESSAGES = require('./message');
  const Browser = require('./browser')(Module, assert);
  const ExitStatus = require('./helpers/ExitStatus');
  const i64Math = require('./helpers/i64math')(Module);

  Module.TTY = require('./system/TTY')(Module);
  Module.TTY.utf8 = new UTF8Processor;
  Module.PATH = require('./system/PATH')(Module);
  Module.SOCKFS = require('./system/SOCKFS')(Module);

  Module.preRun = [];
  Module.postRun = [];
  Module.preloadedImages = {};
  Module.preloadedAudios = {};

  Module.ALLOC_NORMAL = 0;
  Module.ALLOC_STACK = 1;
  Module.ALLOC_STATIC = 2;
  Module.ALLOC_DYNAMIC = 3;
  Module.ALLOC_NONE = 4;
  Module.ABORT = false;

  Module.buffer = new ArrayBuffer(TOTAL_MEMORY);
  Module.HEAP8 = new Int8Array(Module.buffer);
  Module.HEAP16 = new Int16Array(Module.buffer);
  Module.HEAP32 = new Int32Array(Module.buffer);
  Module.HEAPU8 = new Uint8Array(Module.buffer);
  Module.HEAPU16 = new Uint16Array(Module.buffer);
  Module.HEAPU32 = new Uint32Array(Module.buffer);
  Module.HEAPF32 = new Float32Array(Module.buffer);
  Module.HEAPF64 = new Float64Array(Module.buffer);
  Module.HEAP32[0] = 255;

  Module.stackTrace = require('./helpers/stackTrace')(Module);
  Module.allocate = require('./helpers/allocate')(Module, assert);

  if (!Module.print) Module.print = (x) => console.log(x);
  if (!Module.printErr) Module.printErr = (x) => console.error(x);

  const resource = require('./helpers/resource')(Module, assert);
  Module.cwrap = resource.cwrap;
  Module.ccall = resource.ccall;
  Module.read = require('./helpers/read');
  const heap = require('./helpers/heap')(Module);
  Module.setValue = heap.setValue;
  Module.getValue = heap.getValue;

  // Module.NODEFS = require('./system/NODEFS');
  let runtimeInitialized = false;
  let runDependencyWatcher = null;
  let runDependencies = 0;
  let dependenciesFulfilled = null;
  let preloadStartTime = null;

  let FS;
  let ___setErrNo;
  let _stdin;
  let _stdout;
  let _stderr;

  const EXCEPTIONS = require('./system/EXCEPTIONS')(Module, (ptr) => {
    try {
      return Module._free(ptr);
    } catch (e) {
      //
    }
  });

  const LOCALE = {
    curr: 0,
    check: locale => {
      if (locale) locale = Module.Pointer_stringify(locale);
      return locale === 'C' || locale === 'POSIX' || !locale;
    }
  };

  Module.getFS = function getFS(___setErrNo_, _stdin_, _stdout_, _stderr_) {
    ___setErrNo = ___setErrNo_;
    _stdin = _stdin_;
    _stdout = _stdout_;
    _stderr = _stderr_;

    // (Module, Browser, _stdin, _stdout, _stderr, ___setErrNo)
    FS = require('./system/FS')(Module, Browser, _stdin, _stdout, _stderr, assert, ___setErrNo);

    Module.FS_createFolder = FS.createFolder;
    Module.FS_createPath = FS.createPath;
    Module.FS_createDataFile = FS.createDataFile;
    Module.FS_createPreloadedFile = FS.createPreloadedFile;
    Module.FS_createLazyFile = FS.createLazyFile;
    Module.FS_createLink = FS.createLink;
    Module.FS_createDevice = FS.createDevice;
    Module.FS_unlink = FS.unlink;

    return (Module.FS = FS);
  };

  Module.getSDL = function(...args) {
    // (Browser, _SDL_LockSurface, _SDL_GetTicks);
    return (Module.SDL = require('./system/SDL')(...args));
  };

  Module.addOnPreRun = function addOnPreRun(cb) {
    __ATPRERUN__.unshift(cb);
  };

  Module.addOnInit = function addOnInit(cb) {
    __ATINIT__.unshift(cb);
  };

  Module.addOnPreMain = function addOnPreMain(cb) {
    __ATMAIN__.unshift(cb);
  };

  Module.addOnExit = function addOnExit(cb) {
    __ATEXIT__.unshift(cb);
  };

  Module.addOnPostRun = function addOnPostRun(cb) {
    __ATPOSTRUN__.unshift(cb);
  };

  Module.readBinary = function readBinary(filename) {
    return Module.read(filename, true);
  };

  Module.addRunDependency = function addRunDependency(id) {
    runDependencies++;
    if (Module.monitorRunDependencies) {
      Module.monitorRunDependencies(runDependencies);
    }

    if (id) {
      runDependencyTracking[id] = 1;
      if (runDependencyWatcher === null && typeof setInterval !== 'undefined') {
        runDependencyWatcher = setInterval(() => {
          if (Module.ABORT) {
            clearInterval(runDependencyWatcher);
            runDependencyWatcher = null;
            return;
          }

          let shown = false;
          for (const dep in runDependencyTracking) {
            if (!shown) {
              shown = true;
              Module.printErr('still waiting on run dependencies:');
            }

            Module.printErr('dependency: ' + dep);
          }

          if (shown) {
            Module.printErr('(end of list)');
          }
        }, 1e4);
      }
    } else {
      Module.printErr('warning: run dependency added without ID');
    }
  };

  Module.removeRunDependency = function removeRunDependency(id) {
    runDependencies--;
    if (Module.monitorRunDependencies) {
      Module.monitorRunDependencies(runDependencies);
    }

    if (id) {
      delete runDependencyTracking[id];
    } else {
      Module.printErr('warning: run dependency removed without ID');
    }

    if (runDependencies === 0) {
      if (runDependencyWatcher !== null) {
        clearInterval(runDependencyWatcher);
        runDependencyWatcher = null;
      }

      if (dependenciesFulfilled) {
        const callback = dependenciesFulfilled;
        dependenciesFulfilled = null;
        callback();
      }
    }
  };

  Module.run = function run(args) {
    args = args || Module.arguments;

    if (preloadStartTime === null) preloadStartTime = Date.now();
    if (runDependencies > 0) {
      return;
    }

    preRun();
    if (runDependencies > 0) return;
    if (Module.calledRun) return;

    function doRun() {
      if (Module.calledRun) return;
      Module.calledRun = true;
      if (Module.ABORT) return;
      ensureInitRuntime();
      preMain();

      if (Module.onRuntimeInitialized) Module.onRuntimeInitialized();
      if (Module._main && Module.shouldRunNow) Module.callMain(args);
      postRun();
    }

    if (Module.setStatus) {
      Module.setStatus('Running...');
      setTimeout(() => {
        setTimeout(() => Module.setStatus(''), 1);

        doRun();
      }, 1);
    } else {
      doRun();
    }
  };

  dependenciesFulfilled = function runCaller() {
    if (!Module.calledRun && Module.shouldRunNow) Module.run();
    if (!Module.calledRun) dependenciesFulfilled = runCaller;
  };

  function globalEval(x) {
    eval.call(null, x);
  }

  Module.load = function load(f) {
    globalEval(Module.read(f));
  };

  Module.abort = function abort(text) {
    if (text) {
      Module.print(text);
      Module.printErr(text);
    }

    Module.ABORT = true;

    const extra = '\nIf this abort() is unexpected, build with -s ASSERTIONS=1 ' +
      'which can give more information.';

    throw new Error(`abort() at ${Module.stackTrace()} ${extra}`);
  };

  Module.Pointer_stringify = function Pointer_stringify(ptr, length) {
    if (length === 0 || !ptr) return '';
    let hasUtf = 0;
    let t;
    let i = 0;
    while (1) {
      t = Module.HEAPU8[ptr + i >> 0];
      hasUtf |= t;
      if (t === 0 && !length) break;
      i++;
      if (length && i === length) break;
    }

    if (!length) length = i;

    let ret = '';
    if (hasUtf < 128) {
      const MAX_CHUNK = 1024;
      let curr;
      while (length > 0) {
        curr = String.fromCharCode.apply(String,
          Module.HEAPU8.subarray(ptr, ptr + Math.min(length, MAX_CHUNK)));
        ret = ret ? ret + curr : curr;
        ptr += MAX_CHUNK;
        length -= MAX_CHUNK;
      }
      return ret;
    }

    return Module.UTF8ToString(ptr);
  };

  Module.AsciiToString = function AsciiToString(ptr) {
    let str = '';
    while (1) {
      const ch = Module.HEAP8[ptr++ >> 0];
      if (!ch) return str;
      str += String.fromCharCode(ch);
    }
  };

  Module.stringToAscii = function stringToAscii(str, outPtr) {
    return Module.writeAsciiToMemory(str, outPtr, false);
  };

  Module.UTF8ArrayToString = function UTF8ArrayToString(u8Array, idx) {
    let u0;
    let u1;
    let u2;
    let u3;
    let u4;
    let u5;
    let str = '';
    while (1) {
      u0 = u8Array[idx++];
      if (!u0) return str;
      if (!(u0 & 128)) {
        str += String.fromCharCode(u0);
        continue;
      }
      u1 = u8Array[idx++] & 63;
      if ((u0 & 224) === 192) {
        str += String.fromCharCode((u0 & 31) << 6 | u1);
        continue;
      }
      u2 = u8Array[idx++] & 63;
      if ((u0 & 240) === 224) {
        u0 = (u0 & 15) << 12 | u1 << 6 | u2;
      } else {
        u3 = u8Array[idx++] & 63;
        if ((u0 & 248) === 240) {
          u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | u3;
        } else {
          u4 = u8Array[idx++] & 63;
          if ((u0 & 252) === 248) {
            u0 = (u0 & 3) << 24 | u1 << 18 | u2 << 12 | u3 << 6 | u4;
          } else {
            u5 = u8Array[idx++] & 63;
            u0 = (u0 & 1) << 30 | u1 << 24 | u2 << 18 | u3 << 12 | u4 << 6 | u5;
          }
        }
      }
      if (u0 < 65536) {
        str += String.fromCharCode(u0);
      } else {
        const ch = u0 - 65536;
        str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
      }
    }
  };

  Module.UTF8ToString = function UTF8ToString(ptr) {
    return Module.UTF8ArrayToString(Module.HEAPU8, ptr);
  };

  Module.stringToUTF8Array = function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
    if (!(maxBytesToWrite > 0)) return 0;
    const startIdx = outIdx;
    const endIdx = outIdx + maxBytesToWrite - 1;
    for (let i = 0; i < str.length; ++i) {
      let u = str.charCodeAt(i);
      if (u >= 55296 && u <= 57343) u = 65536 + ((u & 1023) << 10) | str.charCodeAt(++i) & 1023;
      if (u <= 127) {
        if (outIdx >= endIdx) break;
        outU8Array[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) break;
        outU8Array[outIdx++] = 192 | u >> 6;
        outU8Array[outIdx++] = 128 | u & 63;
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) break;
        outU8Array[outIdx++] = 224 | u >> 12;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      } else if (u <= 2097151) {
        if (outIdx + 3 >= endIdx) break;
        outU8Array[outIdx++] = 240 | u >> 18;
        outU8Array[outIdx++] = 128 | u >> 12 & 63;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      } else if (u <= 67108863) {
        if (outIdx + 4 >= endIdx) break;
        outU8Array[outIdx++] = 248 | u >> 24;
        outU8Array[outIdx++] = 128 | u >> 18 & 63;
        outU8Array[outIdx++] = 128 | u >> 12 & 63;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      } else {
        if (outIdx + 5 >= endIdx) break;
        outU8Array[outIdx++] = 252 | u >> 30;
        outU8Array[outIdx++] = 128 | u >> 24 & 63;
        outU8Array[outIdx++] = 128 | u >> 18 & 63;
        outU8Array[outIdx++] = 128 | u >> 12 & 63;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      }
    }
    outU8Array[outIdx] = 0;
    return outIdx - startIdx;
  };

  Module.stringToUTF8 = function stringToUTF8(str, outPtr, maxBytesToWrite) {
    return Module.stringToUTF8Array(str, Module.HEAPU8, outPtr, maxBytesToWrite);
  };

  Module.lengthBytesUTF8 = function lengthBytesUTF8(str) {
    let len = 0;
    for (let i = 0; i < str.length; ++i) {
      let u = str.charCodeAt(i);
      if (u >= 55296 && u <= 57343) u = 65536 + ((u & 1023) << 10) | str.charCodeAt(++i) & 1023;
      if (u <= 127) {
        ++len;
      } else if (u <= 2047) {
        len += 2;
      } else if (u <= 65535) {
        len += 3;
      } else if (u <= 2097151) {
        len += 4;
      } else if (u <= 67108863) {
        len += 5;
      } else {
        len += 6;
      }
    }
    return len;
  };

  Module.UTF16ToString = function UTF16ToString(ptr) {
    let i = 0;
    let str = '';
    while (1) {
      const codeUnit = Module.HEAP16[ptr + i * 2 >> 1];
      if (codeUnit === 0) return str;
      ++i;
      str += String.fromCharCode(codeUnit);
    }
  };

  Module.stringToUTF16 = function stringToUTF16(str, outPtr, maxBytesToWrite) {
    if (maxBytesToWrite === undefined) {
      maxBytesToWrite = 2147483647;
    }
    if (maxBytesToWrite < 2) return 0;
    maxBytesToWrite -= 2;
    const startPtr = outPtr;
    const numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
    for (let i = 0; i < numCharsToWrite; ++i) {
      const codeUnit = str.charCodeAt(i);
      Module.HEAP16[outPtr >> 1] = codeUnit;
      outPtr += 2;
    }
    Module.HEAP16[outPtr >> 1] = 0;
    return outPtr - startPtr;
  };

  Module.lengthBytesUTF16 = function lengthBytesUTF16(str) {
    return str.length * 2;
  };

  Module.UTF32ToString = function UTF32ToString(ptr) {
    let i = 0;
    let str = '';
    while (1) {
      const utf32 = Module.HEAP32[ptr + i * 4 >> 2];
      if (utf32 === 0) return str;
      ++i;
      if (utf32 >= 65536) {
        const ch = utf32 - 65536;
        str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
      } else {
        str += String.fromCharCode(utf32);
      }
    }
  };

  Module.stringToUTF32 = function stringToUTF32(str, outPtr, maxBytesToWrite) {
    if (maxBytesToWrite === undefined) {
      maxBytesToWrite = 2147483647;
    }

    if (maxBytesToWrite < 4) return 0;

    const startPtr = outPtr;
    const endPtr = startPtr + maxBytesToWrite - 4;
    for (let i = 0; i < str.length; ++i) {
      let codeUnit = str.charCodeAt(i);
      if (codeUnit >= 55296 && codeUnit <= 57343) {
        const trailSurrogate = str.charCodeAt(++i);
        codeUnit = 65536 + ((codeUnit & 1023) << 10) | trailSurrogate & 1023;
      }
      Module.HEAP32[outPtr >> 2] = codeUnit;
      outPtr += 4;
      if (outPtr + 4 > endPtr) break;
    }
    Module.HEAP32[outPtr >> 2] = 0;
    return outPtr - startPtr;
  };

  Module.lengthBytesUTF32 = function lengthBytesUTF32(str) {
    let len = 0;
    for (let i = 0; i < str.length; ++i) {
      const codeUnit = str.charCodeAt(i);
      if (codeUnit >= 55296 && codeUnit <= 57343) ++i;
      len += 4;
    }
    return len;
  };

  Module.intArrayFromString = function intArrayFromString(stringy, dontAddNull, length) {
    const len = length > 0 ? length : Module.lengthBytesUTF8(stringy) + 1;
    const u8array = new Array(len);
    const numBytesWritten = Module.stringToUTF8Array(stringy, u8array, 0, u8array.length);
    if (dontAddNull) u8array.length = numBytesWritten;
    return u8array;
  };

  Module.intArrayToString = function intArrayToString(array) {
    const ret = [];
    for (let i = 0; i < array.length; i++) {
      let chr = array[i];
      if (chr > 255) {
        chr &= 255;
      }
      ret.push(String.fromCharCode(chr));
    }
    return ret.join('');
  };


  Module.writeStringToMemory = function writeStringToMemory(string, buffer, dontAddNull) {
    const array = Module.intArrayFromString(string, dontAddNull);
    let i = 0;
    while (i < array.length) {
      const chr = array[i];
      Module.HEAP8[buffer + i >> 0] = chr;
      i = i + 1;
    }
  };

  Module.writeArrayToMemory = function writeArrayToMemory(array, buffer) {
    for (let i = 0; i < array.length; i++) {
      Module.HEAP8[buffer++ >> 0] = array[i];
    }
  };

  Module.writeAsciiToMemory = function writeAsciiToMemory(str, buffer, dontAddNull) {
    for (let i = 0; i < str.length; ++i) {
      Module.HEAP8[buffer++ >> 0] = str.charCodeAt(i);
    }
    if (!dontAddNull) Module.HEAP8[buffer >> 0] = 0;
  };

  Module.requestFullScreen = function Module_requestFullScreen(lockPointer, resizeCanvas) {
    Browser.requestFullScreen(lockPointer, resizeCanvas);
  };

  Module.requestAnimationFrame = function Module_requestAnimationFrame(func) {
    Browser.requestAnimationFrame(func);
  };

  Module.setCanvasSize = function Module_setCanvasSize(width, height, noUpdates) {
    Browser.setCanvasSize(width, height, noUpdates);
  };

  Module.pauseMainLoop = function Module_pauseMainLoop() {
    Browser.mainLoop.pause();
  };

  Module.resumeMainLoop = function Module_resumeMainLoop() {
    Browser.mainLoop.resume();
  };

  Module.getUserMedia = function Module_getUserMedia() {
    Browser.getUserMedia();
  };

  if (Module.preInit) {
    if (typeof Module.preInit === 'function') Module.preInit = [Module.preInit];
    while (Module.preInit.length > 0) {
      Module.preInit.pop()();
    }
  }

  const Math_abs = Math.abs;
  const Math_cos = Math.cos;
  const Math_sin = Math.sin;
  const Math_tan = Math.tan;
  const Math_acos = Math.acos;
  const Math_asin = Math.asin;
  const Math_atan = Math.atan;
  const Math_atan2 = Math.atan2;
  const Math_exp = Math.exp;
  const Math_log = Math.log;
  const Math_sqrt = Math.sqrt;
  const Math_ceil = Math.ceil;
  const Math_floor = Math.floor;
  const Math_pow = Math.pow;
  const Math_imul = Math.imul;
  const Math_fround = Math.fround;
  const Math_min = Math.min;

  const _fabs = Math_abs;
  const _log = Math_log;
  const _logf = Math_log;
  const _sin = Math_sin;
  const _ceilf = Math_ceil;
  const _exp = Math_exp;
  const _llvm_pow_f32 = Math_pow;
  const _llvm_pow_f64 = Math_pow;
  const _floor = Math_floor;
  const _cos = Math_cos;
  const _ceil = Math_ceil;
  const _fabsf = Math_abs;
  const _tan = Math_tan;
  const _sqrt = Math_sqrt;
  const _atan2 = Math_atan2;
  const _floorf = Math_floor;
  const _sqrtf = Math_sqrt;
  const _cosf = Math_cos;
  const _sinf = Math_sin;

  const _ = {
    Math_abs, Math_cos, Math_sin, Math_tan, Math_acos, Math_asin, Math_atan, Math_atan2, Math_exp,
    Math_log, Math_sqrt, Math_ceil, Math_floor, Math_pow, Math_imul, Math_fround, Math_min,
    _fabs, _log, _sin, _ceilf, _exp, _llvm_pow_f32, _llvm_pow_f64, _floor, _cos, _ceil, _fabsf,
    _tan, _logf, _sqrt, _atan2, _mmap, _floorf, _sqrtf, _munmap, _msync,

    _exp2, _exp2f, _fmod, _fmodl, _round, _roundf, _log10, _log10f, _cosf, _sinf,

    Browser, EXCEPTIONS, ExitStatus, assert, reSign, unSign, enlargeMemory, alignMemoryPage,
    preRun, postRun, preMain, ensureInitRuntime, exitRuntime, asmPrintInt, asmPrintFloat,
    __ATPRERUN__, __ATINIT__, __ATMAIN__, __ATEXIT__, __ATPOSTRUN__,
    ___resumeException, ___ctype_b_loc, ___ctype_toupper_loc, ___ctype_tolower_loc, __exit, _exit,

    ___cxa_throw,
    ___cxa_guard_release,
    ___cxa_allocate_exception, ___cxa_guard_acquire, ___cxa_pure_virtual,
    ___cxa_begin_catch, ___cxa_call_unexpected, ___cxa_guard_abort, ___gxx_personality_v0,
    __ZSt18uncaught_exceptionv, __ZSt9terminatev, __ZNSt9exceptionD2Ev,

    __formatString, __reallyNegative, __isLeapYear,
    __arraySum, __addDays, _calloc, _close, _fsync, _fileno, _fclose, _pthread_mutex_lock, _mkport,
    _send, _pwrite, _write, _fwrite, _fprintf, _printf, _open, _fopen, _fputc, _fputs, _puts, _recv,
    _pread, _read, _fread, _vprintf, _vfprintf, _pthread_cond_broadcast, _pthread_mutex_unlock,
    _emscripten_memcpy_big, _fflush, _newlocale, _catclose, _ungetc, _uselocale, _ftell, _ftello,
    _strerror_r, _strerror, _strftime, _strftime_l, _abort, _pthread_once, _pthread_cond_wait,
    _fgetc, _getc, _pthread_setspecific, _freelocale, _malloc, _catgets, _catopen, _lseek,
    _fseek, _fseeko, _putchar, _pthread_key_create, _time, _sysconf,
    _copysign, _copysignl, _llvm_eh_typeid_for, _difftime,
    _emscripten_set_main_loop_timing: Browser._emscripten_set_main_loop_timing, _pthread_getspecific,
    _emscripten_set_main_loop: Browser._emscripten_set_main_loop
  };

  Module._ = _;

  function callRuntimeCallbacks(callbacks) {
    while (callbacks.length > 0) {
      const callback = callbacks.shift();
      if (typeof callback === 'function') {
        callback();
        continue;
      }
      const func = callback.func;
      if (typeof func === 'number') {
        if (callback.arg === undefined) {
          Module.Runtime.dynCall('v', func);
        } else {
          Module.Runtime.dynCall('vi', func, [callback.arg]);
        }
      } else {
        func(callback.arg === undefined ? null : callback.arg);
      }
    }
  }

  function preRun() {
    if (Module.preRun) {
      if (typeof Module.preRun === 'function') Module.preRun = [Module.preRun];
      while (Module.preRun.length) {
        Module.addOnPreRun(Module.preRun.shift());
      }
    }
    callRuntimeCallbacks(__ATPRERUN__);
  }

  function ensureInitRuntime() {
    if (runtimeInitialized) return;
    runtimeInitialized = true;
    callRuntimeCallbacks(__ATINIT__);
  }

  function preMain() {
    callRuntimeCallbacks(__ATMAIN__);
  }

  function exitRuntime() {
    callRuntimeCallbacks(__ATEXIT__);
  }

  function postRun() {
    if (Module.postRun) {
      if (typeof Module.postRun === 'function') Module.postRun = [Module.postRun];
      while (Module.postRun.length) {
        Module.addOnPostRun(Module.postRun.shift());
      }
    }
    callRuntimeCallbacks(__ATPOSTRUN__);
  }

  function unSign(value, bits, ignore) {
    if (value >= 0) {
      return value;
    }
    return bits <= 32 ? 2 * Math.abs(1 << bits - 1) + value : Math.pow(2, bits) + value;
  }

  function reSign(value, bits, ignore) {
    if (value <= 0) {
      return value;
    }

    const half = bits <= 32 ? Math.abs(1 << bits - 1) : Math.pow(2, bits - 1);
    if (value >= half && (bits <= 32 || value > half)) {
      value = -2 * half + value;
    }

    return value;
  }

  function assert(condition, text) {
    if (!condition) {
      Module.abort(`Assertion failed: ${text}`);
    }
  }

  function _exp2(x) {
    return Math.pow(2, x);
  }

  function _exp2f(...args) {
    return _exp2(...args);
  }

  function _fmod(x, y) {
    return x % y;
  }

  function _fmodl(...args) {
    return _fmod(...args);
  }

  function _round(x) {
    return x < 0 ? -Math.round(-x) : Math.round(x);
  }

  function _roundf(...args) {
    return _round(...args);
  }

  function _log10(x) {
    return Math.log(x) / Math.LN10;
  }

  function _log10f(...args) {
    return _log10(...args);
  }

  function _mmap(start, num, prot, flags, fd, offset) {
    // const MAP_PRIVATE = 2;
    let ptr;
    let allocated = false;
    if (!_mmap.mappings) _mmap.mappings = {};
    if (fd === -1) {
      ptr = _malloc(num);
      if (!ptr) return -1;
      Module._memset(ptr, 0, num);
      allocated = true;
    } else {
      const info = FS.getStream(fd);
      if (!info) return -1;
      try {
        const res = FS.mmap(info, Module.HEAPU8, start, num, offset, prot, flags);
        ptr = res.ptr;
        allocated = res.allocated;
      } catch (e) {
        FS.handleFSError(e);
        return -1;
      }
    }

    _mmap.mappings[ptr] = {
      malloc: ptr,
      num,
      allocated,
      fd,
      flags
    };
    return ptr;
  }

  function _msync(addr, len, flags) {
    const info = _mmap.mappings[addr];
    if (!info) return 0;
    if (len === info.num) {
      const buffer = new Uint8Array(Module.HEAPU8.buffer, addr, len);
      return FS.msync(FS.getStream(info.fd), buffer, 0, len, info.flags);
    }

    return 0;
  }

  function _munmap(start, num) {
    if (!_mmap.mappings) _mmap.mappings = {};

    const info = _mmap.mappings[start];
    if (!info) return 0;
    if (num === info.num) {
      _msync(start, num);
      FS.munmap(FS.getStream(info.fd));
      _mmap.mappings[start] = null;
      if (info.allocated) {
        Module._free(info.malloc);
      }
    }

    return 0;
  }

  function _calloc(n, s) {
    const ret = Module._malloc(n * s);
    Module._memset(ret, 0, n * s);
    return ret;
  }

  function __formatString(format, varargs) {
    let textIndex = format;
    let argIndex = 0;

    function getNextArg(type) {
      let ret;
      if (type === 'double') {
        ret = (Module.HEAP32[Module.asmLibraryArg.tempDoublePtr >> 2] = Module.HEAP32[varargs + argIndex >> 2],
          Module.HEAP32[Module.asmLibraryArg.tempDoublePtr + 4 >> 2] = Module.HEAP32[varargs + (argIndex + 4) >> 2],
          +Module.HEAPF64[Module.asmLibraryArg.tempDoublePtr >> 3]);
      } else if (type === 'i64') {
        ret = [Module.HEAP32[varargs + argIndex >> 2], Module.HEAP32[varargs + (argIndex + 4) >> 2]];
      } else {
        type = 'i32';
        ret = Module.HEAP32[varargs + argIndex >> 2];
      }
      argIndex += Module.Runtime.getNativeFieldSize(type);
      return ret;
    }
    let ret = [];
    let curr;
    let next;
    while (1) {
      const startTextIndex = textIndex;
      curr = Module.HEAP8[textIndex >> 0];
      if (curr === 0) break;
      next = Module.HEAP8[textIndex + 1 >> 0];
      if (curr === 37) {
        let flagAlwaysSigned = false;
        let flagLeftAlign = false;
        let flagAlternative = false;
        let flagZeroPad = false;
        let flagPadSign = false;
        flagsLoop: while (1) {
          switch (next) {
            case 43:
              flagAlwaysSigned = true;
              break;
            case 45:
              flagLeftAlign = true;
              break;
            case 35:
              flagAlternative = true;
              break;
            case 48:
              if (flagZeroPad) {
                break flagsLoop;
              }
              flagZeroPad = true;
              break;
            case 32:
              flagPadSign = true;
              break;
            default:
              break flagsLoop;
          }
          textIndex++;
          next = Module.HEAP8[textIndex + 1 >> 0];
        }
        let width = 0;
        if (next === 42) {
          width = getNextArg('i32');
          textIndex++;
          next = Module.HEAP8[textIndex + 1 >> 0];
        } else {
          while (next >= 48 && next <= 57) {
            width = width * 10 + (next - 48);
            textIndex++;
            next = Module.HEAP8[textIndex + 1 >> 0];
          }
        }
        let precisionSet = false;
        let precision = -1;
        if (next === 46) {
          precision = 0;
          precisionSet = true;
          textIndex++;
          next = Module.HEAP8[textIndex + 1 >> 0];
          if (next === 42) {
            precision = getNextArg('i32');
            textIndex++;
          } else {
            while (1) {
              const precisionChr = Module.HEAP8[textIndex + 1 >> 0];
              if (precisionChr < 48 || precisionChr > 57) break;
              precision = precision * 10 + (precisionChr - 48);
              textIndex++;
            }
          }
          next = Module.HEAP8[textIndex + 1 >> 0];
        }
        if (precision < 0) {
          precision = 6;
          precisionSet = false;
        }
        let argSize;
        let nextNext;
        switch (String.fromCharCode(next)) {
          case 'h':
            nextNext = Module.HEAP8[textIndex + 2 >> 0];
            if (nextNext === 104) {
              textIndex++;
              argSize = 1;
            } else {
              argSize = 2;
            }
            break;
          case 'l':
            nextNext = Module.HEAP8[textIndex + 2 >> 0];
            if (nextNext === 108) {
              textIndex++;
              argSize = 8;
            } else {
              argSize = 4;
            }
            break;
          case 'L':
          case 'q':
          case 'j':
            argSize = 8;
            break;
          case 'z':
          case 't':
          case 'I':
            argSize = 4;
            break;
          default:
            argSize = null;
        }
        if (argSize) textIndex++;
        next = Module.HEAP8[textIndex + 1 >> 0];
        switch (String.fromCharCode(next)) {
          case 'd':
          case 'i':
          case 'u':
          case 'o':
          case 'x':
          case 'X':
          case 'p':
            {
              const signed = next === 100 || next === 105;
              argSize = argSize || 4;
              let currArg = getNextArg(`i${argSize * 8}`);
              const origArg = currArg;
              let argText;
              if (argSize === 8) {
                currArg = Module.Runtime.makeBigInt(currArg[0], currArg[1], next === 117);
              }
              if (argSize <= 4) {
                const limit = Math.pow(256, argSize) - 1;
                currArg = (signed ? reSign : unSign)(currArg & limit, argSize * 8);
              }
              const currAbsArg = Math.abs(currArg);
              let prefix = '';
              if (next === 100 || next === 105) {
                if (argSize === 8 && i64Math) {
                  argText = i64Math.stringify(origArg[0], origArg[1], null);
                } else {
                  argText = reSign(currArg, 8 * argSize, 1).toString(10);
                }
              } else if (next === 117) {
                if (argSize === 8 && i64Math) {
                  argText = i64Math.stringify(origArg[0], origArg[1], true);
                } else {
                  argText = unSign(currArg, 8 * argSize, 1).toString(10);
                }
                currArg = Math.abs(currArg);
              } else if (next === 111) {
                argText = (flagAlternative ? '0' : '') + currAbsArg.toString(8);
              } else if (next === 120 || next === 88) {
                prefix = flagAlternative && currArg !== 0 ? '0x' : '';
                if (argSize === 8 && i64Math) {
                  if (origArg[1]) {
                    argText = (origArg[1] >>> 0).toString(16);
                    let lower = (origArg[0] >>> 0).toString(16);
                    while (lower.length < 8) lower = `0${lower}`;
                    argText += lower;
                  } else {
                    argText = (origArg[0] >>> 0).toString(16);
                  }
                } else if (currArg < 0) {
                  currArg = -currArg;
                  argText = (currAbsArg - 1).toString(16);
                  const buffer = [];
                  for (let i = 0; i < argText.length; i++) {
                    buffer.push((15 - parseInt(argText[i], 16)).toString(16));
                  }
                  argText = buffer.join('');
                  while (argText.length < argSize * 2) argText = `f${argText}`;
                } else {
                  argText = currAbsArg.toString(16);
                }
                if (next === 88) {
                  prefix = prefix.toUpperCase();
                  argText = argText.toUpperCase();
                }
              } else if (next === 112) {
                if (currAbsArg === 0) {
                  argText = '(nil)';
                } else {
                  prefix = '0x';
                  argText = currAbsArg.toString(16);
                }
              }
              if (precisionSet) {
                while (argText.length < precision) {
                  argText = `0${argText}`;
                }
              }
              if (currArg >= 0) {
                if (flagAlwaysSigned) {
                  prefix = `+${prefix}`;
                } else if (flagPadSign) {
                  prefix = ` ${prefix}`;
                }
              }
              if (argText.charAt(0) === '-') {
                prefix = `-${prefix}`;
                argText = argText.substr(1);
              }
              while (prefix.length + argText.length < width) {
                if (flagLeftAlign) {
                  argText += ' ';
                } else {
                  if (flagZeroPad) {
                    argText = `0${argText}`;
                  } else {
                    prefix = ` ${prefix}`;
                  }
                }
              }
              argText = prefix + argText;
              argText.split('').forEach(chr => ret.push(chr.charCodeAt(0)));
              break;
            }
          case 'f':
          case 'F':
          case 'e':
          case 'E':
          case 'g':
          case 'G':
            {
              const currArg = getNextArg('double');
              let argText;
              if (isNaN(currArg)) {
                argText = 'nan';
                flagZeroPad = false;
              } else if (!isFinite(currArg)) {
                argText = `${currArg < 0 ? '-' : ''}inf`;
                flagZeroPad = false;
              } else {
                let isGeneral = false;
                let effectivePrecision = Math.min(precision, 20);
                if (next === 103 || next === 71) {
                  isGeneral = true;
                  precision = precision || 1;
                  const exponent = parseInt(currArg
                      .toExponential(effectivePrecision).split('e')[1], 10);
                  if (precision > exponent && exponent >= -4) {
                    next = (next === 103 ? 'f' : 'F').charCodeAt(0);
                    precision -= exponent + 1;
                  } else {
                    next = (next === 103 ? 'e' : 'E').charCodeAt(0);
                    precision--;
                  }
                  effectivePrecision = Math.min(precision, 20);
                }
                if (next === 101 || next === 69) {
                  argText = currArg.toExponential(effectivePrecision);
                  if (/[eE][-+]\d$/.test(argText)) {
                    argText = `${argText.slice(0, -1)}0${argText.slice(-1)}`;
                  }
                } else if (next === 102 || next === 70) {
                  argText = currArg.toFixed(effectivePrecision);
                  if (currArg === 0 && __reallyNegative(currArg)) {
                    argText = `-${argText}`;
                  }
                }
                const parts = argText.split('e');
                if (isGeneral && !flagAlternative) {
                  while (parts[0].length > 1
                    && parts[0].indexOf('.') !== -1 && (parts[0].slice(-1) === '0'
                    || parts[0].slice(-1) === '.')) {
                    parts[0] = parts[0].slice(0, -1);
                  }
                } else {
                  if (flagAlternative && argText.indexOf('.') === -1) parts[0] += '.';
                  while (precision > effectivePrecision++) parts[0] += '0';
                }
                argText = parts[0] + (parts.length > 1 ? `e${parts[1]}` : '');
                if (next === 69) argText = argText.toUpperCase();
                if (currArg >= 0) {
                  if (flagAlwaysSigned) {
                    argText = `+${argText}`;
                  } else if (flagPadSign) {
                    argText = ` ${argText}`;
                  }
                }
              }
              while (argText.length < width) {
                if (flagLeftAlign) {
                  argText += ' ';
                } else {
                  if (flagZeroPad && (argText[0] === '-' || argText[0] === '+')) {
                    argText = `${argText[0]}0${argText.slice(1)}`;
                  } else {
                    argText = (flagZeroPad ? '0' : ' ') + argText;
                  }
                }
              }
              if (next < 97) {
                argText = argText.toUpperCase();
                argText.split('').forEach(chr => ret.push(chr.charCodeAt(0)));
              }
              break;
            }
          case 's':
            {
              let arg = getNextArg('i8*');
              let argLength = arg ? Module._strlen(arg) : '(null)'.length;
              if (precisionSet) argLength = Math.min(argLength, precision);
              if (!flagLeftAlign) {
                while (argLength < width--) {
                  ret.push(32);
                }
              }
              if (arg) {
                for (let i = 0; i < argLength; i++) {
                  ret.push(Module.HEAPU8[arg++ >> 0]);
                }
              } else {
                ret = ret.concat(Module.intArrayFromString('(null)'.substr(0, argLength), true));
              }
              if (flagLeftAlign) {
                while (argLength < width--) {
                  ret.push(32);
                }
              }
              break;
            }
          case 'c':
            {
              if (flagLeftAlign) ret.push(getNextArg('i8'));
              while (--width > 0) {
                ret.push(32);
              }
              if (!flagLeftAlign) ret.push(getNextArg('i8'));
              break;
            }
          case 'n':
            {
              const ptr = getNextArg('i32*');
              Module.HEAP32[ptr >> 2] = ret.length;
              break;
            }
          case '%':
            {
              ret.push(curr);
              break;
            }
          default:
            {
              for (let i = startTextIndex; i < textIndex + 2; i++) {
                ret.push(Module.HEAP8[i >> 0]);
              }
            }
        }
        textIndex += 2;
      } else {
        ret.push(curr);
        textIndex += 1;
      }
    }
    return ret;
  }

  function __reallyNegative(x) {
    return x < 0 || x === 0 && 1 / x === -Infinity;
  }

  function _copysign(a, b) {
    return __reallyNegative(a) === __reallyNegative(b) ? a : -a;
  }

  function _copysignl(...args) {
    return _copysign(...args);
  }

  function ___resumeException(ptr) {
    if (!EXCEPTIONS.last) {
      EXCEPTIONS.last = ptr;
    }

    EXCEPTIONS.clearRef(EXCEPTIONS.deAdjust(ptr));
    throw ptr + ' - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.';
  }

  function ___cxa_throw(ptr, type, destructor) {
    EXCEPTIONS.infos[ptr] = {
      ptr,
      adjusted: ptr,
      type,
      destructor,
      refcount: 0
    };
    EXCEPTIONS.last = ptr;

    if (!('uncaught_exception' in __ZSt18uncaught_exceptionv)) {
      __ZSt18uncaught_exceptionv.uncaught_exception = 1;
    } else {
      __ZSt18uncaught_exceptionv.uncaught_exception++;
    }

    throw new Error(`${ptr} - Exception catching is disabled, this exception cannot be caught.
      Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.`);
  }

  function ___cxa_call_unexpected(exception) {
    Module.printErr('Unexpected exception thrown, this is not properly supported - aborting');
    Module.ABORT = true;
    throw exception;
  }

  function ___cxa_pure_virtual() {
    Module.ABORT = true;
    throw 'Pure virtual function called!';
  }

  function ___cxa_guard_abort() {
    //
  }

  function ___gxx_personality_v0() {
    //
  }

  function __ZSt18uncaught_exceptionv() {
    return !!__ZSt18uncaught_exceptionv.uncaught_exception;
  }

  function __exit(status) {
    Module.exit(status);
  }

  function _exit(status) {
    __exit(status);
  }

  function __ZSt9terminatev() {
    _exit(-1234);
  }

  function __ZNSt9exceptionD2Ev() {
    //
  }

  function _difftime(time1, time0) {
    return time1 - time0;
  }

  function _llvm_eh_typeid_for(type) {
    return type;
  }

  function _fflush(stream) {}

  function _close(fildes) {
    const stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    try {
      FS.close(stream);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fsync(fildes) {
    const stream = FS.getStream(fildes);
    if (stream) {
      return 0;
    }
    ___setErrNo(ERRNO_CODES.EBADF);

    return -1;
  }

  function _fileno(stream) {
    stream = FS.getStreamFromPtr(stream);
    if (!stream) return -1;
    return stream.fd;
  }

  function _fclose(stream) {
    const fd = _fileno(stream);
    _fsync(fd);
    return _close(fd);
  }

  function _pthread_mutex_lock() {}

  function _mkport() {
    throw 'TODO';
  }

  function _send(fd, buf, len, flags) {
    const sock = Module.SOCKFS.getSocket(fd);
    if (!sock) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    return _write(fd, buf, len);
  }

  function _pwrite(fildes, buf, nbyte, offset) {
    const stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    try {
      const slab = Module.HEAP8;
      return FS.write(stream, slab, buf, nbyte, offset);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _write(fildes, buf, nbyte) {
    const stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    try {
      const slab = Module.HEAP8;
      return FS.write(stream, slab, buf, nbyte);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fwrite(ptr, size, nitems, stream) {
    const bytesToWrite = nitems * size;
    if (bytesToWrite === 0) return 0;
    const fd = _fileno(stream);
    const bytesWritten = _write(fd, ptr, bytesToWrite);
    if (bytesWritten === -1) {
      const streamObj = FS.getStreamFromPtr(stream);
      if (streamObj) streamObj.error = true;
      return 0;
    }
    return bytesWritten / size | 0;
  }

  function _fprintf(stream, format, varargs) {
    const result = __formatString(format, varargs);
    const stack = Module.Runtime.stackSave();
    const ret = _fwrite(Module.allocate(result,
      'i8', Module.ALLOC_STACK), 1, result.length, stream);
    Module.Runtime.stackRestore(stack);
    return ret;
  }

  function _printf(format, varargs) {
    const stdout = Module.HEAP32[_stdout >> 2];
    return _fprintf(stdout, format, varargs);
  }

  function _open(path, oflag, varargs) {
    const mode = Module.HEAP32[varargs >> 2];
    path = Module.Pointer_stringify(path);
    try {
      const stream = FS.open(path, oflag, mode);
      return stream.fd;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fopen(filename, mode) {
    let flags;
    mode = Module.Pointer_stringify(mode);
    if (mode[0] === 'r') {
      if (mode.indexOf('+') !== -1) {
        flags = 2;
      } else {
        flags = 0;
      }
    } else if (mode[0] === 'w') {
      if (mode.indexOf('+') !== -1) {
        flags = 2;
      } else {
        flags = 1;
      }
      flags |= 64;
      flags |= 512;
    } else if (mode[0] === 'a') {
      if (mode.indexOf('+') !== -1) {
        flags = 2;
      } else {
        flags = 1;
      }
      flags |= 64;
      flags |= 1024;
    } else {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return 0;
    }
    const fd = _open(filename, flags, Module.allocate([511, 0, 0, 0], 'i32', Module.ALLOC_STACK));
    return fd === -1 ? 0 : FS.getPtrForStream(FS.getStream(fd));
  }

  function _fputc(c, stream) {
    const chr = unSign(c & 255);
    Module.HEAP8[_fputc.ret >> 0] = chr;
    const fd = _fileno(stream);
    const ret = _write(fd, _fputc.ret, 1);
    if (ret === -1) {
      const streamObj = FS.getStreamFromPtr(stream);
      if (streamObj) streamObj.error = true;
      return -1;
    }
    return chr;
  }

  function _fputs(s, stream) {
    const fd = _fileno(stream);
    return _write(fd, s, Module._strlen(s));
  }

  function _puts(s) {
    const stdout = Module.HEAP32[_stdout >> 2];
    const ret = _fputs(s, stdout);
    if (ret < 0) {
      return ret;
    }
    const newlineRet = _fputc(10, stdout);
    return newlineRet < 0 ? -1 : ret + 1;
  }

  function _recv(fd, buf, len, flags) {
    const sock = Module.SOCKFS.getSocket(fd);
    if (!sock) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    return _read(fd, buf, len);
  }

  function _pread(fildes, buf, nbyte, offset) {
    const stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    try {
      const slab = Module.HEAP8;
      return FS.read(stream, slab, buf, nbyte, offset);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _read(fildes, buf, nbyte) {
    const stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    try {
      const slab = Module.HEAP8;
      return FS.read(stream, slab, buf, nbyte);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fread(ptr, size, nitems, stream) {
    let bytesToRead = nitems * size;
    if (bytesToRead === 0) {
      return 0;
    }

    let bytesRead = 0;
    const streamObj = FS.getStreamFromPtr(stream);
    if (!streamObj) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return 0;
    }

    while (streamObj.ungotten.length && bytesToRead > 0) {
      Module.HEAP8[ptr++ >> 0] = streamObj.ungotten.pop();
      bytesToRead--;
      bytesRead++;
    }

    const err = _read(streamObj.fd, ptr, bytesToRead);
    if (err === -1) {
      if (streamObj) streamObj.error = true;
      return 0;
    }
    bytesRead += err;

    if (bytesRead < bytesToRead) streamObj.eof = true;
    return bytesRead / size | 0;
  }

  function _vprintf(format, va_arg) {
    return _printf(format, Module.HEAP32[va_arg >> 2]);
  }

  function _pthread_cond_broadcast() {
    return 0;
  }

  function _vfprintf(s, f, va_arg) {
    return _fprintf(s, f, Module.HEAP32[va_arg >> 2]);
  }

  function _pthread_mutex_unlock() {}

  function _emscripten_memcpy_big(dest, src, num) {
    Module.HEAPU8.set(Module.HEAPU8.subarray(src, src + num), dest);
    return dest;
  }

  function _newlocale(mask, locale, base) {
    if (!LOCALE.check(locale)) {
      ___setErrNo(ERRNO_CODES.ENOENT);
      return 0;
    }

    if (!base) base = _calloc(1, 4);
    return base;
  }

  function _catclose(catd) {
    return 0;
  }

  function ___cxa_guard_release() {}

  function _ungetc(c, stream) {
    stream = FS.getStreamFromPtr(stream);
    if (!stream) {
      return -1;
    }

    if (c === -1) {
      return c;
    }

    c = unSign(c & 255);
    stream.ungotten.push(c);
    stream.eof = false;
    return c;
  }

  function _uselocale(locale) {
    const old = LOCALE.curr;
    if (locale) LOCALE.curr = locale;
    return old;
  }

  function _ftell(stream) {
    stream = FS.getStreamFromPtr(stream);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    if (FS.isChrdev(stream.node.mode)) {
      ___setErrNo(ERRNO_CODES.ESPIPE);
      return -1;
    }

    return stream.position;
  }

  function _ftello(...args) {
    return _ftell(...args);
  }

  function _strerror_r(errnum, strerrbuf, buflen) {
    if (errnum in ERRNO_MESSAGES) {
      if (ERRNO_MESSAGES[errnum].length > buflen - 1) {
        return ___setErrNo(ERRNO_CODES.ERANGE);
      }
      const msg = ERRNO_MESSAGES[errnum];
      Module.writeAsciiToMemory(msg, strerrbuf);
      return 0;
    }
    return ___setErrNo(ERRNO_CODES.EINVAL);
  }

  function _strerror(errnum) {
    if (!_strerror.buffer) _strerror.buffer = _malloc(256);
    _strerror_r(errnum, _strerror.buffer, 256);
    return _strerror.buffer;
  }

  function __isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function __arraySum(array, index) {
    let sum = 0;
    for (let i = 0; i <= index; sum += array[i++]);
    return sum;
  }

  const __MONTH_DAYS_LEAP = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const __MONTH_DAYS_REGULAR = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  function __addDays(date, days) {
    const newDate = new Date(date.getTime());
    while (days > 0) {
      const leap = __isLeapYear(newDate.getFullYear());
      const currentMonth = newDate.getMonth();
      const daysInCurrentMonth = (leap ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR)[currentMonth];
      if (days > daysInCurrentMonth - newDate.getDate()) {
        days -= daysInCurrentMonth - newDate.getDate() + 1;
        newDate.setDate(1);
        if (currentMonth < 11) {
          newDate.setMonth(currentMonth + 1);
        } else {
          newDate.setMonth(0);
          newDate.setFullYear(newDate.getFullYear() + 1);
        }
      } else {
        newDate.setDate(newDate.getDate() + days);
        return newDate;
      }
    }
    return newDate;
  }

  function _strftime(s, maxsize, format, tm) {
    const tm_zone = Module.HEAP32[tm + 40 >> 2];
    const date = {
      tm_sec: Module.HEAP32[tm >> 2],
      tm_min: Module.HEAP32[tm + 4 >> 2],
      tm_hour: Module.HEAP32[tm + 8 >> 2],
      tm_mday: Module.HEAP32[tm + 12 >> 2],
      tm_mon: Module.HEAP32[tm + 16 >> 2],
      tm_year: Module.HEAP32[tm + 20 >> 2],
      tm_wday: Module.HEAP32[tm + 24 >> 2],
      tm_yday: Module.HEAP32[tm + 28 >> 2],
      tm_isdst: Module.HEAP32[tm + 32 >> 2],
      tm_gmtoff: Module.HEAP32[tm + 36 >> 2],
      tm_zone: tm_zone ? Module.Pointer_stringify(tm_zone) : ''
    };
    let pattern = Module.Pointer_stringify(format);
    const EXPANSION_RULES_1 = {
      '%c': '%a %b %d %H:%M:%S %Y',
      '%D': '%m/%d/%y',
      '%F': '%Y-%m-%d',
      '%h': '%b',
      '%r': '%I:%M:%S %p',
      '%R': '%H:%M',
      '%T': '%H:%M:%S',
      '%x': '%m/%d/%y',
      '%X': '%H:%M:%S'
    };
    for (const rule in EXPANSION_RULES_1) {
      pattern = pattern.replace(new RegExp(rule, 'g'), EXPANSION_RULES_1[rule]);
    }
    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = [
      'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
      'October', 'November', 'December'
    ];

    function leadingSomething(value, digits, character) {
      let str = typeof value === 'number' ? value.toString() : value || '';
      while (str.length < digits) {
        str = character[0] + str;
      }
      return str;
    }

    function leadingNulls(value, digits) {
      return leadingSomething(value, digits, '0');
    }

    function compareByDay(date1, date2) {
      function sgn(value) {
        return value < 0 ? -1 : value > 0 ? 1 : 0;
      }
      let compare;
      if ((compare = sgn(date1.getFullYear() - date2.getFullYear())) === 0) {
        if ((compare = sgn(date1.getMonth() - date2.getMonth())) === 0) {
          compare = sgn(date1.getDate() - date2.getDate());
        }
      }
      return compare;
    }

    function getFirstWeekStartDate(janFourth) {
      switch (janFourth.getDay()) {
        case 0:
          return new Date(janFourth.getFullYear() - 1, 11, 29);
        case 1:
          return janFourth;
        case 2:
          return new Date(janFourth.getFullYear(), 0, 3);
        case 3:
          return new Date(janFourth.getFullYear(), 0, 2);
        case 4:
          return new Date(janFourth.getFullYear(), 0, 1);
        case 5:
          return new Date(janFourth.getFullYear() - 1, 11, 31);
        case 6:
          return new Date(janFourth.getFullYear() - 1, 11, 30);
      }
    }

    function getWeekBasedYear(_date) {
      const thisDate = __addDays(new Date(_date.tm_year + 1900, 0, 1), _date.tm_yday);
      const janFourthThisYear = new Date(thisDate.getFullYear(), 0, 4);
      const janFourthNextYear = new Date(thisDate.getFullYear() + 1, 0, 4);
      const firstWeekStartThisYear = getFirstWeekStartDate(janFourthThisYear);
      const firstWeekStartNextYear = getFirstWeekStartDate(janFourthNextYear);
      if (compareByDay(firstWeekStartThisYear, thisDate) <= 0) {
        if (compareByDay(firstWeekStartNextYear, thisDate) <= 0) {
          return thisDate.getFullYear() + 1;
        }
        return thisDate.getFullYear();
      }
      return thisDate.getFullYear() - 1;
    }

    const EXPANSION_RULES_2 = {
      '%a': _date => WEEKDAYS[_date.tm_wday].substring(0, 3),
      '%A': _date => WEEKDAYS[_date.tm_wday],
      '%b': _date => MONTHS[_date.tm_mon].substring(0, 3),
      '%B': _date => MONTHS[_date.tm_mon],
      '%C': _date => {
        const year = _date.tm_year + 1900;
        return leadingNulls(year / 100 | 0, 2);
      },
      '%d': _date => leadingNulls(_date.tm_mday, 2),
      '%e': _date => leadingSomething(_date.tm_mday, 2, ' '),
      '%g': _date => getWeekBasedYear(_date).toString().substring(2),
      '%G': _date => getWeekBasedYear(_date),
      '%H': _date => leadingNulls(_date.tm_hour, 2),
      '%I': _date => leadingNulls(_date.tm_hour < 13 ? _date.tm_hour : _date.tm_hour - 12, 2),
      '%j': _date => leadingNulls(_date.tm_mday + __arraySum(__isLeapYear(_date.tm_year + 1900)
        ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, _date.tm_mon - 1), 3),
      '%m': _date => leadingNulls(_date.tm_mon + 1, 2),
      '%M': _date => leadingNulls(_date.tm_min, 2),
      '%n': () => '\n',
      '%p': _date => {
        if (_date.tm_hour > 0 && _date.tm_hour < 13) {
          return 'AM';
        }
        return 'PM';
      },
      '%S': _date => leadingNulls(_date.tm_sec, 2),
      '%t': () => '\t',
      '%u': _date => {
        const day = new _date(_date.tm_year + 1900, _date.tm_mon + 1, _date.tm_mday, 0, 0, 0, 0);
        return day.getDay() || 7;
      },
      '%U': _date => {
        const janFirst = new Date(_date.tm_year + 1900, 0, 1);
        const firstSunday = janFirst.getDay() === 0
          ? janFirst : __addDays(janFirst, 7 - janFirst.getDay());
        const endDate = new Date(_date.tm_year + 1900, _date.tm_mon, _date.tm_mday);
        if (compareByDay(firstSunday, endDate) < 0) {
          const februaryFirstUntilEndMonth = __arraySum(__isLeapYear(endDate.getFullYear())
            ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, endDate.getMonth() - 1) - 31;
          const firstSundayUntilEndJanuary = 31 - firstSunday.getDate();
          const days = firstSundayUntilEndJanuary + februaryFirstUntilEndMonth + endDate.getDate();
          return leadingNulls(Math.ceil(days / 7), 2);
        }
        return compareByDay(firstSunday, janFirst) === 0 ? '01' : '00';
      },
      '%V': _date => {
        const janFourthThisYear = new Date(_date.tm_year + 1900, 0, 4);
        const janFourthNextYear = new Date(_date.tm_year + 1901, 0, 4);
        const firstWeekStartThisYear = getFirstWeekStartDate(janFourthThisYear);
        const firstWeekStartNextYear = getFirstWeekStartDate(janFourthNextYear);
        const endDate = __addDays(new Date(_date.tm_year + 1900, 0, 1), _date.tm_yday);
        if (compareByDay(endDate, firstWeekStartThisYear) < 0) {
          return '53';
        }
        if (compareByDay(firstWeekStartNextYear, endDate) <= 0) {
          return '01';
        }
        let daysDifference;
        if (firstWeekStartThisYear.getFullYear() < _date.tm_year + 1900) {
          daysDifference = _date.tm_yday + 32 - firstWeekStartThisYear.getDate();
        } else {
          daysDifference = _date.tm_yday + 1 - firstWeekStartThisYear.getDate();
        }
        return leadingNulls(Math.ceil(daysDifference / 7), 2);
      },
      '%w': _date => {
        const day = new Date(_date.tm_year + 1900, _date.tm_mon + 1, _date.tm_mday, 0, 0, 0, 0);
        return day.getDay();
      },
      '%W': _date => {
        const janFirst = new Date(_date.tm_year, 0, 1);
        const firstMonday = janFirst.getDay() === 1
          ? janFirst : __addDays(janFirst, janFirst.getDay() === 0 ? 1 : 7 - janFirst.getDay() + 1);
        const endDate = new Date(_date.tm_year + 1900, _date.tm_mon, _date.tm_mday);
        if (compareByDay(firstMonday, endDate) < 0) {
          const februaryFirstUntilEndMonth = __arraySum(__isLeapYear(endDate.getFullYear())
            ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, endDate.getMonth() - 1) - 31;
          const firstMondayUntilEndJanuary = 31 - firstMonday.getDate();
          const days = firstMondayUntilEndJanuary + februaryFirstUntilEndMonth + endDate.getDate();
          return leadingNulls(Math.ceil(days / 7), 2);
        }
        return compareByDay(firstMonday, janFirst) === 0 ? '01' : '00';
      },
      '%y': _date => (_date.tm_year + 1900).toString().substring(2),
      '%Y': _date => _date.tm_year + 1900,
      '%z': _date => {
        let off = _date.tm_gmtoff;
        const ahead = off >= 0;
        off = Math.abs(off) / 60;
        off = off / 60 * 100 + off % 60;
        return (ahead ? '+' : '-') + String(`0000${off}`).slice(-4);
      },
      '%Z': _date => _date.tm_zone,
      '%%': () => '%'
    };

    for (const rule in EXPANSION_RULES_2) {
      if (pattern.indexOf(rule) >= 0) {
        pattern = pattern.replace(new RegExp(rule, 'g'), EXPANSION_RULES_2[rule](date));
      }
    }

    const bytes = Module.intArrayFromString(pattern, false);
    if (bytes.length > maxsize) {
      return 0;
    }
    Module.writeArrayToMemory(bytes, s);
    return bytes.length - 1;
  }

  function _strftime_l(s, maxsize, format, tm) {
    return _strftime(s, maxsize, format, tm);
  }

  function _abort() {
    Module.abort();
  }

  function _pthread_once(ptr, func) {
    if (!_pthread_once.seen) _pthread_once.seen = {};
    if (ptr in _pthread_once.seen) return;
    Module.Runtime.dynCall('v', func);
    _pthread_once.seen[ptr] = 1;
  }

  function _pthread_cond_wait() {
    return 0;
  }

  const PTHREAD_SPECIFIC = {};

  function _pthread_getspecific(key) {
    return PTHREAD_SPECIFIC[key] || 0;
  }

  function _fgetc(stream) {
    const streamObj = FS.getStreamFromPtr(stream);
    if (!streamObj) return -1;
    if (streamObj.eof || streamObj.error) return -1;
    const ret = _fread(_fgetc.ret, 1, 1, stream);
    if (ret === 0) {
      return -1;
    } else if (ret === -1) {
      streamObj.error = true;
      return -1;
    }
    return Module.HEAPU8[_fgetc.ret >> 0];
  }

  function _getc(...args) {
    return _fgetc(...args);
  }

  function _pthread_setspecific(key, value) {
    if (!(key in PTHREAD_SPECIFIC)) {
      return ERRNO_CODES.EINVAL;
    }
    PTHREAD_SPECIFIC[key] = value;
    return 0;
  }

  function ___ctype_b_loc() {
    const me = ___ctype_b_loc;
    if (!me.ret) {
      const values = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 8195, 8194, 8194, 8194, 8194, 2, 2, 2, 2, 2, 2, 2, 2,
        2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 24577, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 49156,
        49156, 49156, 49156, 49156, 49156, 49156, 49156, 55304, 55304, 55304, 55304, 55304, 55304,
        55304, 55304, 55304, 55304, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 54536, 54536,
        54536, 54536, 54536, 54536, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440,
        50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 49156, 49156,
        49156, 49156, 49156, 49156, 54792, 54792, 54792, 54792, 54792, 54792, 50696, 50696, 50696,
        50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696,
        50696, 50696, 50696, 50696, 49156, 49156, 49156, 49156, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      ];
      const i16size = 2;
      const arr = Module._malloc(values.length * i16size);
      for (let i = 0; i < values.length; i++) {
        Module.HEAP16[arr + i * i16size >> 1] = values[i];
      }
      me.ret = Module.allocate([arr + 128 * i16size], 'i16*', Module.ALLOC_NORMAL);
    }
    return me.ret;
  }

  function _freelocale(locale) {
    Module._free(locale);
  }

  function _malloc(bytes) {
    const ptr = Module.Runtime.dynamicAlloc(bytes + 8);
    return ptr + 8 & 4294967288;
  }

  function ___cxa_allocate_exception(size) {
    return _malloc(size);
  }

  function _catgets(catd, set_id, msg_id, s) {
    return s;
  }

  function _catopen(name, oflag) {
    return -1;
  }

  function ___ctype_toupper_loc() {
    const me = ___ctype_toupper_loc;
    if (!me.ret) {
      const values = [
        128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146,
        147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165,
        166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184,
        185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203,
        204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222,
        223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241,
        242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, -1, 0, 1, 2, 3, 4, 5, 6, 7,
        8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
        32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
        55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77,
        78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 65, 66, 67, 68,
        69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 123,
        124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142,
        143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161,
        162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180,
        181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199,
        200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218,
        219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237,
        238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255
      ];
      const i32size = 4;
      const arr = Module._malloc(values.length * i32size);
      for (let i = 0; i < values.length; i++) {
        Module.HEAP32[arr + i * i32size >> 2] = values[i];
      }
      me.ret = Module.allocate([arr + 128 * i32size], 'i32*', Module.ALLOC_NORMAL);
    }
    return me.ret;
  }

  function ___cxa_guard_acquire(variable) {
    if (!Module.HEAP8[variable >> 0]) {
      Module.HEAP8[variable >> 0] = 1;
      return 1;
    }
    return 0;
  }

  function ___ctype_tolower_loc() {
    const me = ___ctype_tolower_loc;
    if (!me.ret) {
      const values = [
        128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146,
        147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165,
        166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184,
        185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203,
        204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222,
        223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241,
        242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, -1, 0, 1, 2, 3, 4, 5, 6, 7,
        8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
        32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
        55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107,
        108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 91, 92, 93, 94, 95,
        96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114,
        115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133,
        134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152,
        153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171,
        172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190,
        191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209,
        210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228,
        229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247,
        248, 249, 250, 251, 252, 253, 254, 255
      ];
      const i32size = 4;
      const arr = Module._malloc(values.length * i32size);
      for (let i = 0; i < values.length; i++) {
        Module.HEAP32[arr + i * i32size >> 2] = values[i];
      }
      me.ret = Module.allocate([arr + 128 * i32size], 'i32*', Module.ALLOC_NORMAL);
    }
    return me.ret;
  }

  function ___cxa_begin_catch(ptr) {
    __ZSt18uncaught_exceptionv.uncaught_exception--;
    EXCEPTIONS.caught.push(ptr);
    EXCEPTIONS.addRef(EXCEPTIONS.deAdjust(ptr));
    return ptr;
  }

  function _lseek(fildes, offset, whence) {
    const stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    try {
      return FS.llseek(stream, offset, whence);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fseek(stream, offset, whence) {
    const fd = _fileno(stream);
    const ret = _lseek(fd, offset, whence);
    if (ret === -1) {
      return -1;
    }
    stream = FS.getStreamFromPtr(stream);
    stream.eof = false;
    return 0;
  }

  function _fseeko(...args) {
    return _fseek(...args);
  }

  function _putchar(c) {
    return _fputc(c, Module.HEAP32[_stdout >> 2]);
  }

  let PTHREAD_SPECIFIC_NEXT_KEY = 1;

  function _pthread_key_create(key, destructor) {
    if (key === 0) {
      return ERRNO_CODES.EINVAL;
    }

    Module.HEAP32[key >> 2] = PTHREAD_SPECIFIC_NEXT_KEY;
    PTHREAD_SPECIFIC[PTHREAD_SPECIFIC_NEXT_KEY] = 0;
    PTHREAD_SPECIFIC_NEXT_KEY++;
    return 0;
  }

  function _time(ptr) {
    const ret = Date.now() / 1e3 | 0;
    if (ptr) {
      Module.HEAP32[ptr >> 2] = ret;
    }

    return ret;
  }

  if (!Math.imul || Math.imul(4294967295, 5) !== -5) {
    Math.imul = function imul(a, b) {
      const ah = a >>> 16;
      const al = a & 65535;
      const bh = b >>> 16;
      const bl = b & 65535;
      return al * bl + (ah * bl + al * bh << 16) | 0;
    };
  }

  function _sysconf(name) {
    switch (name) {
      case 30:
        return PAGE_SIZE;
      case 132: case 133: case 12: case 137: case 138: case 15: case 235: case 16:
      case 17: case 18: case 19: case 20: case 149: case 13: case 10: case 236:
      case 153: case 9: case 21: case 22: case 159: case 154: case 14: case 77:
      case 78: case 139: case 80: case 81: case 79: case 82: case 68: case 67:
      case 164: case 11: case 29: case 47: case 48: case 95: case 52: case 51:
      case 46:
        return 200809;
      case 27: case 246: case 127: case 128: case 23: case 24: case 160: case 161:
      case 181: case 182: case 242: case 183: case 184: case 243: case 244:
      case 245: case 165: case 178: case 179: case 49: case 50: case 168:
      case 169: case 175: case 170: case 171: case 172: case 97: case 76: case 32:
      case 173: case 35:
        return -1;
      case 176: case 177: case 7: case 155: case 8: case 157: case 125: case 126:
      case 92: case 93: case 129: case 130: case 131: case 94: case 91:
        return 1;
      case 74: case 60: case 69: case 70: case 4:
        return 1024;
      case 31: case 42: case 72:
        return 32;
      case 87: case 26: case 33:
        return 2147483647;
      case 34: case 1:
        return 47839;
      case 38: case 36:
        return 99;
      case 43: case 37:
        return 2048;
      case 0:
        return 2097152;
      case 3:
        return 65536;
      case 28:
        return 32768;
      case 44:
        return 32767;
      case 75:
        return 16384;
      case 39:
        return 1e3;
      case 89:
        return 700;
      case 71:
        return 256;
      case 40:
        return 255;
      case 2:
        return 100;
      case 180:
        return 64;
      case 25:
        return 20;
      case 5:
        return 16;
      case 6:
        return 6;
      case 73:
        return 4;
      case 84:
        {
          if (typeof navigator === 'object') return navigator.hardwareConcurrency || 1;
          return 1;
        }
    }
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  }

  function alignMemoryPage(x) {
    return x + 4095 & -4096;
  }

  function enlargeMemory() {
    Module.abort('Cannot enlarge memory arrays. Either (1) compile with -s TOTAL_MEMORY=X with X higher than the current value ' + TOTAL_MEMORY + ', (2) compile with ALLOW_MEMORY_GROWTH which adjusts the size at runtime but prevents some optimizations, or (3) set Module.TOTAL_MEMORY before the program runs.');
  }

  function UTF8Processor() {
    const buffer = [];
    let needed = 0;
    this.processCChar = function(code) {
      code = code & 255;
      if (buffer.length === 0) {
        if ((code & 128) === 0) {
          return String.fromCharCode(code);
        }

        buffer.push(code);
        if ((code & 224) === 192) {
          needed = 1;
        } else if ((code & 240) === 224) {
          needed = 2;
        } else {
          needed = 3;
        }

        return '';
      }

      if (needed) {
        buffer.push(code);
        needed--;
        if (needed > 0) return '';
      }

      const c1 = buffer[0];
      const c2 = buffer[1];
      const c3 = buffer[2];
      const c4 = buffer[3];
      let ret;
      if (buffer.length === 2) {
        ret = String.fromCharCode((c1 & 31) << 6 | c2 & 63);
      } else if (buffer.length === 3) {
        ret = String.fromCharCode((c1 & 15) << 12 | (c2 & 63) << 6 | c3 & 63);
      } else {
        const codePoint = (c1 & 7) << 18 | (c2 & 63) << 12 | (c3 & 63) << 6 | c4 & 63;
        ret = String.fromCharCode(((codePoint - 65536) / 1024 | 0) + 55296, (codePoint - 65536) % 1024 + 56320);
      }

      buffer.length = 0;
      return ret;
    };

    this.processJSString = function processJSString(string) {
      string = unescape(encodeURIComponent(string));
      const ret = [];
      for (let i = 0; i < string.length; i++) {
        ret.push(string.charCodeAt(i));
      }

      return ret;
    };
  }

  function asmPrintInt(x, y) {
    Module.print('int ' + x + ',' + y);
  }

  function asmPrintFloat(x, y) {
    Module.print('float ' + x + ',' + y);
  }

  return Module;
};
