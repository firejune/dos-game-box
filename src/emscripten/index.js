'use strict';

module.exports = function(CONFIG = {}) {
  const STATIC_BASE = CONFIG.STATIC_BASE || 8;
  const TOTAL_STACK = CONFIG.TOTAL_STACK || 5242880;

  let TOTAL_MEMORY = CONFIG.TOTAL_MEMORY || 50331648;
  let STATICTOP = CONFIG.STATICTOP || STATIC_BASE + 6944;
  let STACK_BASE = 0;
  let STACKTOP = 0;
  let STACK_MAX = 0;
  let DYNAMIC_BASE = 0;
  let DYNAMICTOP = 0;

  let tempRet0;
  let initialStackTop;
  let memoryInitializer = null;
  let totalMemory = 64 * 1024;
  let ___errno_state = 0;

  while (totalMemory < TOTAL_MEMORY || totalMemory < 2 * TOTAL_STACK) {
    if (totalMemory < 16 * 1024 * 1024) {
      totalMemory *= 2;
    } else {
      totalMemory += 16 * 1024 * 1024;
    }
  }

  if (totalMemory !== TOTAL_MEMORY) {
    Module.printErr(`increasing TOTAL_MEMORY to ${totalMemory} to be compliant with the asm.js spec`);
    TOTAL_MEMORY = totalMemory;
  }

  const Module = require('./base')({ TOTAL_MEMORY, print: CONFIG.print, printErr: CONFIG.printErr });

  const {
    TTY, SOCKFS, ALLOC_NORMAL, ALLOC_STATIC, ALLOC_DYNAMIC, ALLOC_NONE, buffer, HEAP32, HEAPU8,
    allocate, abort, Pointer_stringify, intArrayFromString, stackTrace
  } = Module;

  const {
    ExitStatus, assert, enlargeMemory, alignMemoryPage, ensureInitRuntime, exitRuntime,
    __ATINIT__, __ATMAIN__, __ATEXIT__, _fputc, _fgetc, _fputs, _puts, _strerror
  } = Module._;

  // STARTING INIT

  const Runtime = {
    setTempRet0: value => (tempRet0 = value),
    getTempRet0: () => tempRet0,
    stackSave: () => STACKTOP,
    stackRestore: stackTop => (STACKTOP = stackTop),
    getNativeTypeSize: type => {
      switch (type) {
        case 'i1':
        case 'i8':
          return 1;
        case 'i16':
          return 2;
        case 'i32':
          return 4;
        case 'i64':
          return 8;
        case 'float':
          return 4;
        case 'double':
          return 8;
        default:
          if (type[type.length - 1] === '*') {
            return Runtime.QUANTUM_SIZE;
          } else if (type[0] === 'i') {
            const bits = parseInt(type.substr(1), 10);
            assert(bits % 8 === 0);
            return bits / 8;
          }
          return 0;
      }
    },

    getNativeFieldSize: type => Math.max(Runtime.getNativeTypeSize(type), Runtime.QUANTUM_SIZE),
    STACK_ALIGN: 16,
    getAlignSize: (type, size, vararg) => {
      if (!vararg && (type === 'i64' || type === 'double')) return 8;
      if (!type) return Math.min(size, 8);
      return Math.min(size || (type ? Runtime.getNativeFieldSize(type) : 0), Runtime.QUANTUM_SIZE);
    },

    dynCall: (sig, ptr, args) => {
      if (args && args.length) {
        if (!args.splice) args = Array.prototype.slice.call(args);
        args.splice(0, 0, ptr);
        return Module[`dynCall_${sig}`](...args);
      }
      return Module[`dynCall_${sig}`](ptr);
    },

    functionPointers: [],
    addFunction: func => {
      for (let i = 0; i < Runtime.functionPointers.length; i++) {
        if (!Runtime.functionPointers[i]) {
          Runtime.functionPointers[i] = func;
          return 2 * (1 + i);
        }
      }
      throw new Error('Finished up all reserved function pointers. ' +
        'Use a higher value for RESERVED_FUNCTION_POINTERS.');
    },

    removeFunction: index => {
      Runtime.functionPointers[(index - 2) / 2] = null;
    },

    getAsmConst: (code, numArgs) => {
      if (!Runtime.asmConstCache) Runtime.asmConstCache = {};
      const func = Runtime.asmConstCache[code];
      if (func) return func;
      const args = [];
      for (let i = 0; i < numArgs; i++) {
        args.push(String.fromCharCode(36) + i);
      }
      let source = Module.Pointer_stringify(code);
      if (source[0] === '"') {
        if (source.indexOf('"', 1) === source.length - 1) {
          source = source.substr(1, source.length - 2);
        } else {
          Module.abort(`invalid EM_ASM input |${source}|. Please use
            EM_ASM(..code..) (no quotes) or EM_ASM({ ..code($0).. }, input) (to input values)`);
        }
      }

      let evalled;
      try {
        evalled = eval(`(function(Module, FS) {
          return function(${args.join(',')}) {
           ${source}
          };
        })`)(Module, typeof FS !== 'undefined' ? FS : null);
      } catch (e) {
        Module.printErr(
          `error in executing inline EM_ASM code: ${e} on: \n\n${source} \n\nwith args |${args}
          | (make sure to use the right one out of EM_ASM, EM_ASM_ARGS, etc.)`
        );
        throw e;
      }
      return (Runtime.asmConstCache[code] = evalled);
    },

    warnOnce: (text) => {
      if (!Runtime.warnOnce.shown) Runtime.warnOnce.shown = {};
      if (!Runtime.warnOnce.shown[text]) {
        Runtime.warnOnce.shown[text] = 1;
        Module.printErr(text);
      }
    },

    funcWrappers: {},
    getFuncWrapper: (func, sig) => {
      assert(sig);
      if (!Runtime.funcWrappers[sig]) {
        Runtime.funcWrappers[sig] = {};
      }
      const sigCache = Runtime.funcWrappers[sig];
      if (!sigCache[func]) {
        sigCache[func] = function dynCall_wrapper() {
          return Runtime.dynCall(sig, func, arguments);
        };
      }
      return sigCache[func];
    },

    getCompilerSetting: name => {
      throw new Error('You must build with -s RETAIN_COMPILER_SETTINGS=1 for ' +
        'Runtime.getCompilerSetting or emscripten_get_compiler_setting to work');
    },

    stackAlloc: size => {
      const ret = STACKTOP;
      STACKTOP = STACKTOP + size | 0;
      STACKTOP = STACKTOP + 15 & -16;
      return ret;
    },

    staticAlloc: size => {
      const ret = STATICTOP;
      STATICTOP = STATICTOP + size | 0;
      STATICTOP = STATICTOP + 15 & -16;
      return ret;
    },

    dynamicAlloc: size => {
      const ret = DYNAMICTOP;
      DYNAMICTOP = DYNAMICTOP + size | 0;
      DYNAMICTOP = DYNAMICTOP + 15 & -16;
      if (DYNAMICTOP >= TOTAL_MEMORY) enlargeMemory();
      return ret;
    },

    alignMemory: (size, quantum) => {
      // Don't Change
      const ret = size = Math.ceil(size / (quantum || 16)) * (quantum || 16);
      return ret;
    },

    makeBigInt: (low, high, unsigned) => {
      const ret = unsigned
        ? +(low >>> 0) + +(high >>> 0) * +4294967296
        : +(low >>> 0) + +(high | 0) * +4294967296;
      return ret;
    },

    GLOBAL_BASE: 8,
    QUANTUM_SIZE: 4,
    __dummy__: 0
  };

  Module.Runtime = Runtime;

  // DIFF_1_START
  if (typeof CONFIG.getSTackTop === 'function') {
    STATICTOP = CONFIG.getSTackTop(Runtime);
  }

  /* global initializers */
  __ATINIT__.push(...CONFIG.ATINIT);

  /* memory initializer */
  CONFIG.allocate(allocate, ALLOC_NONE, Runtime);
  // DIFF_1_END

  const tempDoublePtr = Runtime.alignMemory(allocate(12, 'i8', ALLOC_STATIC), 8);

  function _atexit(func, arg) {
    __ATEXIT__.unshift({
      func,
      arg
    });
  }

  function ___cxa_is_number_type(type) {
    return true;
  }

  function ___cxa_does_inherit(definiteType, possibilityType, possibility) {
    if (possibility === 0) return false;
    if (possibilityType === 0 || possibilityType === definiteType) return true;
    let possibility_type_info;
    if (___cxa_is_number_type(possibilityType)) {
      possibility_type_info = possibilityType;
    } else {
      const possibility_type_infoAddr = HEAP32[possibilityType >> 2] - 8;
      possibility_type_info = HEAP32[possibility_type_infoAddr >> 2];
    }
    switch (possibility_type_info) {
      case 0:
        const definite_type_infoAddr = HEAP32[definiteType >> 2] - 8;
        const definite_type_info = HEAP32[definite_type_infoAddr >> 2];
        if (definite_type_info === 0) {
          const defPointerBaseAddr = definiteType + 8;
          const defPointerBaseType = HEAP32[defPointerBaseAddr >> 2];
          const possPointerBaseAddr = possibilityType + 8;
          const possPointerBaseType = HEAP32[possPointerBaseAddr >> 2];
          return ___cxa_does_inherit(defPointerBaseType, possPointerBaseType, possibility);
        }
        return false;

      case 1:
        return false;

      case 2:
        const parentTypeAddr = possibilityType + 8;
        const parentType = HEAP32[parentTypeAddr >> 2];
        return ___cxa_does_inherit(definiteType, parentType, possibility);

      default:
        return false;
    }
  }

  let ___cxa_last_thrown_exception = 0;
  function ___resumeException(ptr) {
    if (!___cxa_last_thrown_exception) {
      ___cxa_last_thrown_exception = ptr;
    }
    throw ptr;
  }

  const ___cxa_caught_exceptions = [];
  function ___cxa_end_catch() {
    if (___cxa_end_catch.rethrown) {
      ___cxa_end_catch.rethrown = false;
      return;
    }
    asm.setThrew(0);
    const ptr = ___cxa_caught_exceptions.pop();
    if (ptr) {
      const header = ptr - ___cxa_exception_header_size;
      const destructor = HEAP32[header + 4 >> 2];
      if (destructor) {
        Runtime.dynCall('vi', destructor, [ptr]);
        HEAP32[header + 4 >> 2] = 0;
      }
      ___cxa_free_exception(ptr);
      ___cxa_last_thrown_exception = 0;
    }
  }

  function ___cxa_free_exception(ptr) {
    try {
      return Module._free(ptr - ___cxa_exception_header_size);
    } catch (e) {
      //
    }
  }

  const ___cxa_exception_header_size = 8;
  function ___cxa_find_matching_catch(thrown, throwntype) {
    if (thrown === -1) thrown = ___cxa_last_thrown_exception;

    const header = thrown - ___cxa_exception_header_size;
    if (throwntype === -1) throwntype = HEAP32[header >> 2];

    const typeArray = Array.prototype.slice.call(arguments, 2);
    if (throwntype !== 0 && !___cxa_is_number_type(throwntype)) {
      const throwntypeInfoAddr = HEAP32[throwntype >> 2] - 8;
      const throwntypeInfo = HEAP32[throwntypeInfoAddr >> 2];
      if (throwntypeInfo === 0) thrown = HEAP32[thrown >> 2];
    }

    for (let i = 0; i < typeArray.length; i++) {
      if (___cxa_does_inherit(typeArray[i], throwntype, thrown)) {
        return (asm.setTempRet0(typeArray[i]), thrown) | 0;
      }
    }
    return (asm.setTempRet0(throwntype), thrown) | 0;
  }

  function ___cxa_rethrow() {
    ___cxa_end_catch.rethrown = true;
    const ptr = ___cxa_caught_exceptions.pop();
    throw ptr;
  }

  function ___cxa_atexit(...args) {
    return _atexit(...args);
  }

  function ___setErrNo(value) {
    HEAP32[___errno_state >> 2] = value;
    return value;
  }

  function ___errno_location() {
    return ___errno_state;
  }

  function _perror(s) {
    const stdout = HEAP32[_stdout >> 2];
    if (s) {
      _fputs(s, stdout);
      _fputc(58, stdout);
      _fputc(32, stdout);
    }
    const errnum = HEAP32[___errno_location() >> 2];
    _puts(_strerror(errnum));
  }

  function ___assert_fail(condition, filename, line, func) {
    Module.ABORT = true;
    throw 'Assertion failed: ' + Pointer_stringify(condition) + ', at: ' + [filename ? Pointer_stringify(filename) : 'unknown filename', line, func ? Pointer_stringify(func) : 'unknown function'] + ' at ' + stackTrace();
  }

  function _sbrk(bytes) {
    const self = _sbrk;
    if (!self.called) {
      DYNAMICTOP = alignMemoryPage(DYNAMICTOP);
      self.called = true;
      assert(Module.Runtime.dynamicAlloc);
      self.alloc = Module.Runtime.dynamicAlloc;
      Module.Runtime.dynamicAlloc = function() {
        Module.abort('cannot dynamically allocate, sbrk now has control');
      };
    }
    const ret = DYNAMICTOP;
    if (bytes !== 0) self.alloc(bytes);
    return ret;
  }

  const _stdin = allocate(1, 'i32*', ALLOC_STATIC);
  const _stdout = allocate(1, 'i32*', ALLOC_STATIC);
  const _stderr = allocate(1, 'i32*', ALLOC_STATIC);
  const FS = Module.getFS(___setErrNo, _stdin, _stdout, _stderr);

  const ___dso_handle = allocate(1, 'i32*', ALLOC_STATIC);
  ___errno_state = Runtime.staticAlloc(4);
  HEAP32[___errno_state >> 2] = 0;
  FS.staticInit();
  // NODEFS.staticInit();

  __ATINIT__.unshift({
    func() {
      if (!Module.noFSInit && !FS.init.initialized) FS.init();
    }
  });
  __ATMAIN__.push({
    func() {
      FS.ignorePermissions = false;
    }
  });
  __ATEXIT__.push({
    func() {
      FS.quit();
    }
  });
  __ATINIT__.unshift({
    func() {
      TTY.init();
    }
  });
  __ATEXIT__.push({
    func() {
      TTY.shutdown();
    }
  });
  __ATINIT__.push({
    func() {
      SOCKFS.root = FS.mount(SOCKFS, {}, null);
    }
  });

  _fputc.ret = allocate([0], 'i8', ALLOC_STATIC);
  _fgetc.ret = allocate([0], 'i8', ALLOC_STATIC);

  STACK_BASE = STACKTOP = Runtime.alignMemory(STATICTOP);
  STACK_MAX = STACK_BASE + TOTAL_STACK;
  DYNAMIC_BASE = DYNAMICTOP = Runtime.alignMemory(STACK_MAX);

  const ctlz_i8 = allocate([8, 7, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'i8', ALLOC_DYNAMIC);
  const cttz_i8 = allocate([8, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 6, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 7, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 6, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0], 'i8', ALLOC_DYNAMIC);

  // DIFF_2
  const ___rand_seed = allocate([41108891, 0, 0, 0], 'i32', ALLOC_STATIC);
  const __ZTISt9exception = allocate([allocate([1, 0, 0, 0, 0, 0, 0], 'i8', ALLOC_STATIC) + 8, 0], 'i32', ALLOC_STATIC);
  const ___tm_current = allocate(44, 'i8', ALLOC_STATIC);
  const ___tm_timezone = allocate(intArrayFromString('GMT'), 'i8', ALLOC_STATIC);

  function _gmtime_r(time, tmPtr) {
    const date = new Date(HEAP32[time >> 2] * 1e3);
    HEAP32[tmPtr >> 2] = date.getUTCSeconds();
    HEAP32[tmPtr + 4 >> 2] = date.getUTCMinutes();
    HEAP32[tmPtr + 8 >> 2] = date.getUTCHours();
    HEAP32[tmPtr + 12 >> 2] = date.getUTCDate();
    HEAP32[tmPtr + 16 >> 2] = date.getUTCMonth();
    HEAP32[tmPtr + 20 >> 2] = date.getUTCFullYear() - 1900;
    HEAP32[tmPtr + 24 >> 2] = date.getUTCDay();
    HEAP32[tmPtr + 36 >> 2] = 0;
    HEAP32[tmPtr + 32 >> 2] = 0;

    const start = new Date(date);
    start.setUTCDate(1);
    start.setUTCMonth(0);
    start.setUTCHours(0);
    start.setUTCMinutes(0);
    start.setUTCSeconds(0);
    start.setUTCMilliseconds(0);

    const yday = Math.floor((date.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24));
    HEAP32[tmPtr + 28 >> 2] = yday;
    HEAP32[tmPtr + 40 >> 2] = ___tm_timezone;
    return tmPtr;
  }

  function _gmtime(time) {
    return _gmtime_r(time, ___tm_current);
  }

  function _localtime_r(time, tmPtr) {
    _tzset();
    const date = new Date(HEAP32[time >> 2] * 1e3);
    HEAP32[tmPtr >> 2] = date.getSeconds();
    HEAP32[tmPtr + 4 >> 2] = date.getMinutes();
    HEAP32[tmPtr + 8 >> 2] = date.getHours();
    HEAP32[tmPtr + 12 >> 2] = date.getDate();
    HEAP32[tmPtr + 16 >> 2] = date.getMonth();
    HEAP32[tmPtr + 20 >> 2] = date.getFullYear() - 1900;
    HEAP32[tmPtr + 24 >> 2] = date.getDay();

    const start = new Date(date.getFullYear(), 0, 1);
    const yday = Math.floor((date.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24));
    HEAP32[tmPtr + 28 >> 2] = yday;
    HEAP32[tmPtr + 36 >> 2] = start.getTimezoneOffset() * 60;

    const dst = Number(start.getTimezoneOffset() !== date.getTimezoneOffset());
    HEAP32[tmPtr + 32 >> 2] = dst;
    HEAP32[tmPtr + 40 >> 2] = ___tm_timezone;

    return tmPtr;
  }

  function _localtime(time) {
    return _localtime_r(time, ___tm_current);
  }

  const _tzname = allocate(8, 'i32*', ALLOC_STATIC);
  const _daylight = allocate(1, 'i32*', ALLOC_STATIC);
  const _timezone = allocate(1, 'i32*', ALLOC_STATIC);

  function _tzset() {
    if (_tzset.called) return;
    _tzset.called = true;
    HEAP32[_timezone >> 2] = -(new Date).getTimezoneOffset() * 60;

    const winter = new Date(2e3, 0, 1);
    const summer = new Date(2e3, 6, 1);

    HEAP32[_daylight >> 2] = Number(winter.getTimezoneOffset() !== summer.getTimezoneOffset());
    const winterName = 'GMT';
    const summerName = 'GMT';
    const winterNamePtr = allocate(intArrayFromString(winterName), 'i8', ALLOC_NORMAL);
    const summerNamePtr = allocate(intArrayFromString(summerName), 'i8', ALLOC_NORMAL);
    HEAP32[_tzname >> 2] = winterNamePtr;
    HEAP32[_tzname + 4 >> 2] = summerNamePtr;
  }

  function _mktime(tmPtr) {
    _tzset();
    const year = HEAP32[tmPtr + 20 >> 2];
    const timestamp = (new Date(year >= 1900 ? year : year + 1900, HEAP32[tmPtr + 16 >> 2], HEAP32[tmPtr + 12 >> 2], HEAP32[tmPtr + 8 >> 2], HEAP32[tmPtr + 4 >> 2], HEAP32[tmPtr >> 2], 0)).getTime() / 1e3;
    HEAP32[tmPtr + 24 >> 2] = (new Date(timestamp)).getDay();

    const yday = Math.round((timestamp - (new Date(year, 0, 1)).getTime()) / (1e3 * 60 * 60 * 24));
    HEAP32[tmPtr + 28 >> 2] = yday;

    return timestamp;
  }

  function nullFunc_iiii(x) {
    Module.printErr("Invalid function pointer called with signature 'iiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_viiiiiii(x) {
    Module.printErr("Invalid function pointer called with signature 'viiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_viiiii(x) {
    Module.printErr("Invalid function pointer called with signature 'viiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_vi(x) {
    Module.printErr("Invalid function pointer called with signature 'vi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_vii(x) {
    Module.printErr("Invalid function pointer called with signature 'vii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_viiiiiiiii(x) {
    Module.printErr("Invalid function pointer called with signature 'viiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_ii(x) {
    Module.printErr("Invalid function pointer called with signature 'ii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_viiiiiid(x) {
    Module.printErr("Invalid function pointer called with signature 'viiiiiid'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_viii(x) {
    Module.printErr("Invalid function pointer called with signature 'viii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_viiiiid(x) {
    Module.printErr("Invalid function pointer called with signature 'viiiiid'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_v(x) {
    Module.printErr("Invalid function pointer called with signature 'v'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_iiiiiiiii(x) {
    Module.printErr("Invalid function pointer called with signature 'iiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_iiiii(x) {
    Module.printErr("Invalid function pointer called with signature 'iiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_viiiiiiii(x) {
    Module.printErr("Invalid function pointer called with signature 'viiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_viiiiii(x) {
    Module.printErr("Invalid function pointer called with signature 'viiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_iii(x) {
    Module.printErr("Invalid function pointer called with signature 'iii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_iiiiii(x) {
    Module.printErr("Invalid function pointer called with signature 'iiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_viiii(x) {
    Module.printErr("Invalid function pointer called with signature 'viiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_vid(x) {
    Module.printErr("Invalid function pointer called with signature 'vid'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_i(x) {
    Module.printErr("Invalid function pointer called with signature 'i'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_iid(x) {
    Module.printErr("Invalid function pointer called with signature 'iid'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr('Build with ASSERTIONS=2 for more info.');
    abort(x);
  }

  function nullFunc_dii(x) {
    Module.printErr("Invalid function pointer '" + x + "' called with signature 'dii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr("This pointer might make sense in another type signature: ii: " + debug_table_ii[x] + "  vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  iiii: " + debug_table_iiii[x] + "  viii: " + debug_table_viii[x] + "  viidd: " + debug_table_viidd[x] + "  iiiii: " + debug_table_iiiii[x] + "  viiii: " + debug_table_viiii[x] + "  vidd: " + debug_table_vidd[x] + "  v: " + debug_table_v[x] + "  viiiii: " + debug_table_viiiii[x] + "  viiiiii: " + debug_table_viiiiii[x] + "  viiiiid: " + debug_table_viiiiid[x] + "  ");
    abort(x)
  }

  function nullFunc_vidd(x) {
    Module.printErr("Invalid function pointer '" + x + "' called with signature 'vidd'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr("This pointer might make sense in another type signature: vi: " + debug_table_vi[x] + "  v: " + debug_table_v[x] + "  viidd: " + debug_table_viidd[x] + "  vii: " + debug_table_vii[x] + "  ii: " + debug_table_ii[x] + "  viii: " + debug_table_viii[x] + "  dii: " + debug_table_dii[x] + "  viiii: " + debug_table_viiii[x] + "  iiii: " + debug_table_iiii[x] + "  viiiii: " + debug_table_viiiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  viiiiid: " + debug_table_viiiiid[x] + "  viiiiii: " + debug_table_viiiiii[x] + "  ");
    abort(x)
  }

  function nullFunc_viidd(x) {
    Module.printErr("Invalid function pointer '" + x + "' called with signature 'viidd'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr("This pointer might make sense in another type signature: vii: " + debug_table_vii[x] + "  vi: " + debug_table_vi[x] + "  v: " + debug_table_v[x] + "  vidd: " + debug_table_vidd[x] + "  ii: " + debug_table_ii[x] + "  viii: " + debug_table_viii[x] + "  dii: " + debug_table_dii[x] + "  viiii: " + debug_table_viiii[x] + "  iiii: " + debug_table_iiii[x] + "  iiiii: " + debug_table_iiiii[x] + "  viiiii: " + debug_table_viiiii[x] + "  viiiiid: " + debug_table_viiiiid[x] + "  viiiiii: " + debug_table_viiiiii[x] + "  ");
    abort(x)
  }

  function nullFunc_di(x) {
    Module.printErr("Invalid function pointer called with signature 'di'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr("Build with ASSERTIONS=2 for more info.");
    abort(x)
  }

  function nullFunc_iiiiiii(x) {
    Module.printErr("Invalid function pointer called with signature 'iiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr("Build with ASSERTIONS=2 for more info.");
    abort(x)
  }

  function nullFunc_iiiiid(x) {
    Module.printErr("Invalid function pointer called with signature 'iiiiid'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
    Module.printErr("Build with ASSERTIONS=2 for more info.");
    abort(x)
  }

  function invoke_iiiiid(index, a1, a2, a3, a4, a5) {
    try {
      return Module.dynCall_iiiiid(index, a1, a2, a3, a4, a5)
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_vidd(index, a1, a2, a3) {
    try {
      Module.dynCall_vidd(index, a1, a2, a3)
    } catch (e) {
      if (typeof e !== "number" && e !== "longjmp") throw e;
      asm.setThrew(1, 0)
    }
  }

  function invoke_viidd(index, a1, a2, a3, a4) {
    try {
      Module.dynCall_viidd(index, a1, a2, a3, a4)
    } catch (e) {
      if (typeof e !== "number" && e !== "longjmp") throw e;
      asm.setThrew(1, 0)
    }
  }

  function invoke_vid(index, a1, a2) {
    try {
      Module.dynCall_vid(index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_i(index) {
    try {
      return Module.dynCall_i(index);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_iid(index, a1, a2) {
    try {
      return Module.dynCall_iid(index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_iiii(index, a1, a2, a3) {
    try {
      return Module.dynCall_iiii(index, a1, a2, a3);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_iiiiiiii(index, a1, a2, a3, a4, a5, a6, a7) {
    try {
      return Module.dynCall_iiiiiiii(index, a1, a2, a3, a4, a5, a6, a7);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viiiiiii(index, a1, a2, a3, a4, a5, a6, a7) {
    try {
      Module.dynCall_viiiiiii(index, a1, a2, a3, a4, a5, a6, a7);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viiiii(index, a1, a2, a3, a4, a5) {
    try {
      Module.dynCall_viiiii(index, a1, a2, a3, a4, a5);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_vi(index, a1) {
    try {
      Module.dynCall_vi(index, a1);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_vii(index, a1, a2) {
    try {
      Module.dynCall_vii(index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
    try {
      Module.dynCall_viiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_ii(index, a1) {
    try {
      return Module.dynCall_ii(index, a1);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viiiiiid(index, a1, a2, a3, a4, a5, a6, a7) {
    try {
      Module.dynCall_viiiiiid(index, a1, a2, a3, a4, a5, a6, a7);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viii(index, a1, a2, a3) {
    try {
      Module.dynCall_viii(index, a1, a2, a3);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viiiiid(index, a1, a2, a3, a4, a5, a6) {
    try {
      Module.dynCall_viiiiid(index, a1, a2, a3, a4, a5, a6);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_v(index) {
    try {
      Module.dynCall_v(index);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_iiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8) {
    try {
      return Module.dynCall_iiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_iiiii(index, a1, a2, a3, a4) {
    try {
      return Module.dynCall_iiiii(index, a1, a2, a3, a4);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8) {
    try {
      Module.dynCall_viiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viiiiii(index, a1, a2, a3, a4, a5, a6) {
    try {
      Module.dynCall_viiiiii(index, a1, a2, a3, a4, a5, a6);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_iii(index, a1, a2) {
    try {
      return Module.dynCall_iii(index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_iiiiii(index, a1, a2, a3, a4, a5) {
    try {
      return Module.dynCall_iiiiii(index, a1, a2, a3, a4, a5);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viiii(index, a1, a2, a3, a4) {
    try {
      Module.dynCall_viiii(index, a1, a2, a3, a4);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_iiiiiii(index, a1, a2, a3, a4, a5, a6) {
    try {
      return Module.dynCall_iiiiiii(index, a1, a2, a3, a4, a5, a6);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_iiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11) {
    try {
      return Module.dynCall_iiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15) {
    try {
      Module.dynCall_viiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_di(index, a1) {
    try {
      return Module.dynCall_di(index, a1);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_dd(index, a1) {
    try {
      return Module.dynCall_dd(index, a1);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10) {
    try {
      Module.dynCall_viiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_dii(index, a1, a2) {
    try {
      return Module.dynCall_dii(index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_diii(index, a1, a2, a3) {
    try {
      return Module.dynCall_diii(index, a1, a2, a3);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_did(index, a1, a2) {
    try {
      return Module.dynCall_did(index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_didi(index, a1, a2, a3) {
    try {
      return Module.dynCall_didi(index, a1, a2, a3);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  function invoke_viid(index, a1, a2, a3) {
    try {
      Module.dynCall_viid(index, a1, a2, a3);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm.setThrew(1, 0);
    }
  }

  const _ = {
    _atexit,
    _stdin,
    _stdout,
    _stderr,
    _gmtime,
    _gmtime_r,
    _mktime,
    _tzset,
    _localtime,
    _localtime_r,
    _perror,

    ctlz_i8,
    cttz_i8,

    ___rand_seed,
    ___dso_handle,
    ___assert_fail,
    ___cxa_atexit,
    ___cxa_find_matching_catch,
    ___cxa_does_inherit,
    ___cxa_end_catch,
    ___cxa_rethrow,
    ___cxa_is_number_type,
    ___cxa_free_exception,
    ___resumeException,
    __ZTISt9exception,

    nullFunc_i,
    nullFunc_ii,
    nullFunc_iid,
    nullFunc_iii,
    nullFunc_iiii,
    nullFunc_iiiii,
    nullFunc_iiiiid,
    nullFunc_iiiiii,
    nullFunc_iiiiiii,
    nullFunc_iiiiiiiii,

    nullFunc_di,
    nullFunc_dii,

    nullFunc_v,
    nullFunc_vi,
    nullFunc_vid,
    nullFunc_vidd,
    nullFunc_vii,
    nullFunc_viidd,
    nullFunc_viii,
    nullFunc_viiii,
    nullFunc_viiiii,
    nullFunc_viiiiid,
    nullFunc_viiiiii,
    nullFunc_viiiiiid,
    nullFunc_viiiiiii,
    nullFunc_viiiiiiii,
    nullFunc_viiiiiiiii,

    invoke_dd,
    invoke_di,
    invoke_did,
    invoke_dii,
    invoke_didi,
    invoke_diii,

    invoke_i,
    invoke_ii,
    invoke_iid,
    invoke_iii,
    invoke_iiii,
    invoke_iiiii,
    invoke_iiiiid,
    invoke_iiiiii,
    invoke_iiiiiii,
    invoke_iiiiiiii,
    invoke_iiiiiiiii,
    invoke_viiiiiiiiii,
    invoke_iiiiiiiiiiii,
    invoke_viiiiiiiiiiiiiii,
    invoke_v,
    invoke_vi,
    invoke_vid,
    invoke_vidd,
    invoke_vii,
    invoke_viid,
    invoke_viidd,
    invoke_viii,
    invoke_viiii,
    invoke_viiiii,
    invoke_viiiiid,
    invoke_viiiiii,
    invoke_viiiiiid,
    invoke_viiiiiii,
    invoke_viiiiiiii,
    invoke_viiiiiiiii,

    Infinity
  };

  Module.asmGlobalArg = CONFIG.asmGlobalArg;
  Module.asmLibraryArg = { STACKTOP, STACK_MAX, tempDoublePtr, _sbrk, ___setErrNo, ___errno_location };
  for (const key of CONFIG.asmLibraryArgs) {
    if (Module.asmLibraryArg[key] === undefined) {
      Module.asmLibraryArg[key] = _[key] || Module._[key] || Module[key];
    }

    if (Module.asmLibraryArg[key] === undefined) {
      switch (key) {
        case 'min':
          Module.asmLibraryArg[key] = Module.Math_min;
          break;
        case 'NaN':
          Module.asmLibraryArg[key] = NaN;
          break;

        default:
          console.error('NOT FOUND ASM ARGUMENT: ', key);
      }
    }
  }

  // EMSCRIPTEN_START_ASM
  const asm = CONFIG.asm(Module.asmGlobalArg, Module.asmLibraryArg, buffer);
  // EMSCRIPTEN_END_ASM

  for (const key in asm) {
    if (key.charAt(0) === '_' || key.substr(0, 7) === 'dynCall' || key === 'runPostSets') {
      Module[key] = asm[key];
    }
  }
  // DIFF_2_END

  Runtime.stackAlloc = asm.stackAlloc;
  Runtime.stackSave = asm.stackSave;
  Runtime.stackRestore = asm.stackRestore;
  Runtime.setTempRet0 = asm.setTempRet0;
  Runtime.getTempRet0 = asm.getTempRet0;

  if (memoryInitializer) {
    if (typeof Module.locateFile === 'function') {
      memoryInitializer = Module.locateFile(memoryInitializer);
    } else if (Module.memoryInitializerPrefixURL) {
      memoryInitializer = Module.memoryInitializerPrefixURL + memoryInitializer;
    }

    const data = Module.readBinary(memoryInitializer);
    HEAPU8.set(data, STATIC_BASE);
  }

  Module.callMain = function callMain(args) {
    args = args || [];
    ensureInitRuntime();

    const argc = args.length + 1;
    let argv = [allocate(intArrayFromString(Module.thisProgram), 'i8', ALLOC_NORMAL)];

    function pad() {
      for (let i = 0; i < 4 - 1; i++) {
        argv.push(0);
      }
    }

    pad();

    for (let i = 0; i < argc - 1; i = i + 1) {
      argv.push(allocate(intArrayFromString(args[i]), 'i8', ALLOC_NORMAL));
      pad();
    }

    argv.push(0);
    argv = allocate(argv, 'i32', ALLOC_NORMAL);

    initialStackTop = STACKTOP;

    try {
      const ret = Module._main(argc, argv, 0);
      Module.exit(ret);
    } catch (e) {
      if (e instanceof ExitStatus) {
        return;
      } else if (e.message === 'SimulateInfiniteLoop') {
        Module.noExitRuntime = true;
        return;
      }
      if (e && typeof e === 'object' && e.stack) {
        Module.printErr(`exception thrown: ${[e, e.stack]}`);
      }
      throw e;
    }
  };

  Module.exit = function exit(status) {
    if (Module.noExitRuntime) {
      return;
    }
    Module.ABORT = true;
    STACKTOP = initialStackTop;
    exitRuntime();
  };

  Module.shouldRunNow = true;
  if (Module.noInitialRun) {
    Module.shouldRunNow = false;
  }

  return Module;
};
