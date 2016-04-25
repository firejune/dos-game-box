'use strict';

const assert = require('./helpers/assert');
const i64Math = require('./helpers/i64math');
const ExitStatus = require('./helpers/ExitStatus');
const ERRNO_CODES = require('./error');
const ERRNO_MESSAGES = require('./message');
const TTY = require('./system/TTY');
const PATH = require('./system/PATH');
const LOCALE = require('./system/LOCALE');

module.exports = function(Module) {
  global.Module = Module;

  const PAGE_SIZE = 4096;
  const ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof require === 'function';
  const ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';

  Module.ALLOC_NORMAL = 0;
  Module.ALLOC_STACK = 1;
  Module.ALLOC_STATIC = 2;
  Module.ALLOC_DYNAMIC = 3;
  Module.ALLOC_NONE = 4;
  Module.ABORT = false;

  Module.preRun = [];
  Module.postRun = [];
  Module.preloadedImages = {};
  Module.preloadedAudios = {};

  if (!Module.arguments) Module.arguments = [];
  if (!Module.print) Module.print = (x) => console.log(x);
  if (!Module.printErr) Module.printErr = (x) => console.error(x);

  Module.load = require('./helpers/load');
  Module.read = require('./helpers/read');
  Module.readBinary = require('./helpers/readBinary');
  Module.cwrap = require('./helpers/resource').cwrap;
  Module.ccall = require('./helpers/resource').ccall;
  Module.setValue = require('./helpers/heap').setValue;
  Module.getValue = require('./helpers/heap').getValue;
  Module.allocate = require('./helpers/allocate');
  Module.stackTrace = require('./helpers/stackTrace');
  Module._calloc = require('./helpers/_calloc');
  Module.abort = require('./helpers/abort');

  Module.Pointer_stringify = require('./conveters/Pointer_stringify');
  Module.AsciiToString = require('./conveters/AsciiToString');
  Module.stringToAscii = require('./conveters/stringToAscii');
  Module.UTF8ArrayToString = require('./conveters/UTF8ArrayToString');
  Module.UTF8ToString = require('./conveters/UTF8ToString');
  Module.stringToUTF8Array = require('./conveters/stringToUTF8Array');
  Module.stringToUTF8 = require('./conveters/stringToUTF8');
  Module.lengthBytesUTF8 = require('./conveters/lengthBytesUTF8');
  Module.UTF16ToString = require('./conveters/UTF16ToString');
  Module.stringToUTF16 = require('./conveters/stringToUTF16');
  Module.lengthBytesUTF16 = require('./conveters/lengthBytesUTF16');
  Module.UTF32ToString = require('./conveters/UTF32ToString');
  Module.stringToUTF32 = require('./conveters/stringToUTF32');
  Module.lengthBytesUTF32 = require('./conveters/lengthBytesUTF32');
  Module.intArrayFromString = require('./conveters/intArrayFromString');
  Module.intArrayToString = require('./conveters/intArrayToString');

  Module.writeStringToMemory = require('./memory/writeStringToMemory');
  Module.writeArrayToMemory = require('./memory/writeArrayToMemory');
  Module.writeAsciiToMemory = require('./memory/writeAsciiToMemory');

  const TOTAL_STACK = Module.TOTAL_STACK || 5242880;
  let TOTAL_MEMORY = Module.TOTAL_MEMORY || 134217728;
  let totalMemory = 64 * 1024;
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

  assert(typeof Int32Array !== 'undefined'
    && typeof Float64Array !== 'undefined'
    && !!(new Int32Array(1)).subarray
    && !!(new Int32Array(1)).set, 'JS engine does not provide full typed array support');

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

  assert(Module.HEAPU8[0] === 255
    && Module.HEAPU8[3] === 0, 'Typed arrays 2 must be run on a little-endian system');

  let STATIC_BASE = 0;
  let STATICTOP = 0;
  let STACK_BASE = 0;
  let STACKTOP = 0;
  let STACK_MAX = 0;
  let DYNAMIC_BASE = 0;
  let DYNAMICTOP = 0;
  let tempRet0;

  const Runtime = {
    setTempRet0: value => tempRet0 = value,
    getTempRet0: () => tempRet0,
    stackSave: () => STACKTOP,
    stackRestore: stackTop => STACKTOP = stackTop,
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
          {
            if (type[type.length - 1] === '*') {
              return Runtime.QUANTUM_SIZE;
            } else if (type[0] === 'i') {
              const bits = parseInt(type.substr(1), 10);
              assert(bits % 8 === 0);
              return bits / 8;
            }
            return 0;
          }
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
      const ret = size = Math.ceil(size / (quantum ? quantum : 16)) * (quantum ? quantum : 16);
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

  function alignMemoryPage(x) {
    return x + 4095 & -4096;
  }

  function enlargeMemory() {
    Module.abort(`Cannot enlarge memory arrays. Either (1) compile with -s TOTAL_MEMORY=X with X
      higher than the current value ${TOTAL_MEMORY}, (2) compile with ALLOW_MEMORY_GROWTH
      which adjusts the size at runtime but prevents some optimizations, or (3) set
      Module.TOTAL_MEMORY before the program runs.`);
  }

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
          Runtime.dynCall('v', func);
        } else {
          Runtime.dynCall('vi', func, [callback.arg]);
        }
      } else {
        func(callback.arg === undefined ? null : callback.arg);
      }
    }
  }

  const __ATPRERUN__ = [];
  const __ATINIT__ = [];
  const __ATMAIN__ = [];
  const __ATEXIT__ = [];
  const __ATPOSTRUN__ = [];
  let runtimeInitialized = false;

  function preRun() {
    if (Module.preRun) {
      if (typeof Module.preRun === 'function') Module.preRun = [Module.preRun];
      while (Module.preRun.length) {
        addOnPreRun(Module.preRun.shift());
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
        addOnPostRun(Module.postRun.shift());
      }
    }
    callRuntimeCallbacks(__ATPOSTRUN__);
  }

  function addOnPreRun(cb) {
    __ATPRERUN__.unshift(cb);
  }
  Module.addOnPreRun = addOnPreRun;

  function addOnInit(cb) {
    __ATINIT__.unshift(cb);
  }
  Module.addOnInit = addOnInit;

  function addOnPreMain(cb) {
    __ATMAIN__.unshift(cb);
  }
  Module.addOnPreMain = addOnPreMain;

  function addOnExit(cb) {
    __ATEXIT__.unshift(cb);
  }
  Module.addOnExit = addOnExit;

  function addOnPostRun(cb) {
    __ATPOSTRUN__.unshift(cb);
  }

  Module.addOnPostRun = addOnPostRun;


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

  let runDependencies = 0;
  let runDependencyWatcher = null;
  let dependenciesFulfilled = null;

  Module.addRunDependency = function addRunDependency(id) {
    runDependencies++;
    if (Module.monitorRunDependencies) {
      Module.monitorRunDependencies(runDependencies);
    }
  };

  Module.removeRunDependency = function removeRunDependency(id) {
    runDependencies--;
    if (Module.monitorRunDependencies) {
      Module.monitorRunDependencies(runDependencies);
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

  let memoryInitializer = null;
  STATIC_BASE = 8;
  STATICTOP = STATIC_BASE + 30042320;
  __ATINIT__.push(
    { func: () => __GLOBAL__sub_I_drives_cpp() },
    { func: () => __GLOBAL__sub_I_dos_memory_cpp() },
    { func: () => __GLOBAL__sub_I_dos_misc_cpp() },
    { func: () => __GLOBAL__sub_I_shell_misc_cpp() },
    { func: () => __GLOBAL__sub_I_shell_cpp() },
    { func: () => __GLOBAL__sub_I_programs_cpp() },
    { func: () => __GLOBAL__sub_I_messages_cpp() },
    { func: () => __GLOBAL__sub_I_setup_cpp() },
    { func: () => __GLOBAL__sub_I_sdl_mapper_cpp() },
    { func: () => __GLOBAL__sub_I_cpu_cpp() },
    { func: () => __GLOBAL__sub_I_vga_memory_cpp() },
    { func: () => __GLOBAL__sub_I_hardware_cpp() },
    { func: () => __GLOBAL__sub_I_iostream_cpp() }
  );

  require('./allocate');

  const Browser = require('./browser')(_emscripten_set_main_loop, _emscripten_set_main_loop_timing);

  // const IDBFS = require('./system/IDBFS')(MEMFS);
  // const NODEFS = require('./system/NODEFS');
  const SOCKFS = require('./system/SOCKFS');
  const EXCEPTIONS = require('./system/EXCEPTIONS')(___cxa_free_exception);

  const _stdin = Module.allocate(1, 'i32*', Module.ALLOC_STATIC);
  const _stdout = Module.allocate(1, 'i32*', Module.ALLOC_STATIC);
  const _stderr = Module.allocate(1, 'i32*', Module.ALLOC_STATIC);

  const FS = require('./system/FS')(Browser, _stdin, _stdout, _stderr, ___setErrNo);
  Module.FS = FS;

  const SDL = require('./system/SDL')(Browser, _SDL_LockSurface, _SDL_GetTicks);
  Module.SDL = SDL;
  /*
  if (Module.canvas.gl) {
    SDL.GL = true;
  }
  */

  const tempDoublePtr = Runtime.alignMemory(Module.allocate(12, 'i8', Module.ALLOC_STATIC), 8);
  assert(tempDoublePtr % 8 === 0);

  let ___errno_state = 0;

  function ___setErrNo(value) {
    Module.HEAP32[___errno_state >> 2] = value;
    return value;
  }

  function _fflush(stream) {}

  function _emscripten_set_main_loop_timing(mode, value) {
    Browser.mainLoop.timingMode = mode;
    Browser.mainLoop.timingValue = value;
    if (!Browser.mainLoop.func) {
      return 1;
    }
    if (mode === 0) {
      Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler() {
        setTimeout(Browser.mainLoop.runner, value);
      };
      Browser.mainLoop.method = 'timeout';
    } else if (mode === 1) {
      Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler() {
        Browser.requestAnimationFrame(Browser.mainLoop.runner);
      };
      Browser.mainLoop.method = 'rAF';
    }
    return 0;
  }

  function _emscripten_set_main_loop(func, fps, simulateInfiniteLoop, arg) {
    Module.noExitRuntime = true;
    assert(!Browser.mainLoop.func, 'emscripten_set_main_loop: there can only be one main loop ' +
      'function at once: call emscripten_cancel_main_loop to cancel the previous one before ' +
      'setting a new one with different parameters.');
    Browser.mainLoop.func = func;
    Browser.mainLoop.arg = arg;
    const thisMainLoopId = Browser.mainLoop.currentlyRunningMainloop;
    Browser.mainLoop.runner = function Browser_mainLoop_runner() {
      if (Module.ABORT) return;
      if (Browser.mainLoop.queue.length > 0) {
        const start = Date.now();
        const blocker = Browser.mainLoop.queue.shift();
        blocker.func(blocker.arg);
        if (Browser.mainLoop.remainingBlockers) {
          const remaining = Browser.mainLoop.remainingBlockers;
          let next = remaining % 1 === 0 ? remaining - 1 : Math.floor(remaining);
          if (blocker.counted) {
            Browser.mainLoop.remainingBlockers = next;
          } else {
            next = next + 0.5;
            Browser.mainLoop.remainingBlockers = (8 * remaining + next) / 9;
          }
        }
        console.log(`main loop blocker "${blocker.name}" took ${Date.now() - start} ms`);
        Browser.mainLoop.updateStatus();
        setTimeout(Browser.mainLoop.runner, 0);
        return;
      }
      if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
      Browser.mainLoop.currentFrameNumber = Browser.mainLoop.currentFrameNumber + 1 | 0;
      if (Browser.mainLoop.timingMode === 1 && Browser.mainLoop.timingValue > 1
        && Browser.mainLoop.currentFrameNumber % Browser.mainLoop.timingValue !== 0) {
        Browser.mainLoop.scheduler();
        return;
      }
      if (Browser.mainLoop.method === 'timeout' && Module.ctx) {
        Module.printErr('Looks like you are rendering without using requestAnimationFrame for the ' +
          'main loop. You should use 0 for the frame rate in emscripten_set_main_loop in order to ' +
          'use requestAnimationFrame, as that can greatly improve your frame rates!');
        Browser.mainLoop.method = '';
      }
      Browser.mainLoop.runIter(() => {
        if (typeof arg !== 'undefined') {
          Runtime.dynCall('vi', func, [arg]);
        } else {
          Runtime.dynCall('v', func);
        }
      });
      if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
      if (typeof SDL === 'object' && SDL.audio && SDL.audio.queueNewAudioData) {
        SDL.audio.queueNewAudioData();
      }
      Browser.mainLoop.scheduler();
    };
    if (fps && fps > 0) _emscripten_set_main_loop_timing(0, 1e3 / fps);
    else _emscripten_set_main_loop_timing(1, 1);
    Browser.mainLoop.scheduler();
    if (simulateInfiniteLoop) {
      throw new Error('SimulateInfiniteLoop');
    }
  }

  const ENV = {};
  const _environ = Module.allocate(1, 'i32*', Module.ALLOC_STATIC);
  function ___buildEnvironment(env) {
    const MAX_ENV_VALUES = 64;
    const TOTAL_ENV_SIZE = 1024;
    let poolPtr;
    let envPtr;
    if (!___buildEnvironment.called) {
      ___buildEnvironment.called = true;
      ENV.USER = 'web_user';
      ENV.PATH = '/';
      ENV.PWD = '/';
      ENV.HOME = '/home/web_user';
      ENV.LANG = 'C';
      ENV._ = Module.thisProgram;
      poolPtr = Module.allocate(TOTAL_ENV_SIZE, 'i8', Module.ALLOC_STATIC);
      envPtr = Module.allocate(MAX_ENV_VALUES * 4, 'i8*', Module.ALLOC_STATIC);
      Module.HEAP32[envPtr >> 2] = poolPtr;
      Module.HEAP32[_environ >> 2] = envPtr;
    } else {
      envPtr = Module.HEAP32[_environ >> 2];
      poolPtr = Module.HEAP32[envPtr >> 2];
    }
    const strings = [];
    let totalSize = 0;
    for (const key in env) {
      if (typeof env[key] === 'string') {
        const line = `${key}=${env[key]}`;
        strings.push(line);
        totalSize += line.length;
      }
    }
    if (totalSize > TOTAL_ENV_SIZE) {
      throw new Error('Environment size exceeded TOTAL_ENV_SIZE!');
    }
    const ptrSize = 4;
    for (let i = 0; i < strings.length; i++) {
      const line = strings[i];
      Module.writeAsciiToMemory(line, poolPtr);
      Module.HEAP32[envPtr + i * ptrSize >> 2] = poolPtr;
      poolPtr += line.length + 1;
    }
    Module.HEAP32[envPtr + strings.length * ptrSize >> 2] = 0;
  }

  function _getenv(name) {
    if (name === 0) return 0;
    name = Module.Pointer_stringify(name);
    if (!ENV.hasOwnProperty(name)) return 0;
    if (_getenv.ret) Module._free(_getenv.ret);
    _getenv.ret = Module.allocate(Module.intArrayFromString(ENV[name]), 'i8', Module.ALLOC_NORMAL);
    return _getenv.ret;
  }

  function _putenv(string) {
    if (string === 0) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    string = Module.Pointer_stringify(string);
    const splitPoint = string.indexOf('=');
    if (string === '' || string.indexOf('=') === -1) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    const name = string.slice(0, splitPoint);
    const value = string.slice(splitPoint + 1);
    if (!(name in ENV) || ENV[name] !== value) {
      ENV[name] = value;
      ___buildEnvironment(ENV);
    }
    return 0;
  }

  function _SDL_RWFromConstMem(mem, size) {
    const id = SDL.rwops.length;
    SDL.rwops.push({
      bytes: mem,
      count: size
    });
    return id;
  }

  function _TTF_FontHeight(font) {
    const fontData = SDL.fonts[font];
    return fontData.size;
  }

  function _TTF_SizeText(font, text, w, h) {
    const fontData = SDL.fonts[font];
    if (w) {
      Module.HEAP32[w >> 2] = SDL.estimateTextWidth(fontData, Module.Pointer_stringify(text));
    }
    if (h) {
      Module.HEAP32[h >> 2] = fontData.size;
    }
    return 0;
  }

  function _TTF_RenderText_Solid(font, text, color) {
    text = Module.Pointer_stringify(text) || ' ';
    const fontData = SDL.fonts[font];
    const w = SDL.estimateTextWidth(fontData, text);
    const h = fontData.size;
    color = SDL.loadColorToCSSRGB(color);
    const fontString = `${h}px ${fontData.name}`;
    const surf = SDL.makeSurface(w, h, 0, false, `text:${text}`);
    const surfData = SDL.surfaces[surf];
    surfData.ctx.save();
    surfData.ctx.fillStyle = color;
    surfData.ctx.font = fontString;
    surfData.ctx.textBaseline = 'top';
    surfData.ctx.fillText(text, 0, 0);
    surfData.ctx.restore();
    return surf;
  }

  function _Mix_HaltMusic() {
    const audio = SDL.music.audio;
    if (audio) {
      audio.src = audio.src;
      audio.currentPosition = 0;
      audio.pause();
    }
    SDL.music.audio = null;
    if (SDL.hookMusicFinished) {
      Runtime.dynCall('v', SDL.hookMusicFinished);
    }
    return 0;
  }

  function _Mix_PlayMusic(id, loops) {
    if (SDL.music.audio) {
      if (!SDL.music.audio.paused) Module.printErr(`Music is already playing. ${SDL.music.source}`);
      SDL.music.audio.pause();
    }
    const info = SDL.audios[id];
    let audio;
    if (info.webAudio) {
      audio = {};
      audio.resource = info;
      audio.paused = false;
      audio.currentPosition = 0;
      audio.play = function() {
        SDL.playWebAudio(this);
      };
      audio.pause = function() {
        SDL.pauseWebAudio(this);
      };
    } else if (info.audio) {
      audio = info.audio;
    }
    audio.onended = function() {
      if (SDL.music.audio === this) _Mix_HaltMusic();
    };
    audio.loop = loops !== 0;
    audio.volume = SDL.music.volume;
    SDL.music.audio = audio;
    audio.play();
    return 0;
  }

  function _Mix_FreeChunk(id) {
    SDL.audios[id] = null;
  }

  function _Mix_LoadWAV_RW(rwopsID, freesrc) {
    const rwops = SDL.rwops[rwopsID];
    if (rwops === undefined) return 0;
    let filename = '';
    let audio;
    let webAudio;
    let bytes;
    if (rwops.filename !== undefined) {
      filename = PATH.resolve(rwops.filename);
      const raw = Module.preloadedAudios[filename];
      if (!raw) {
        if (raw === null) {
          Module.printErr('Trying to reuse preloaded audio, but freePreloadedMediaOnUse is set!');
        }
        if (!Module.noAudioDecoding) {
          Runtime.warnOnce(`Cannot find preloaded audio ${filename}`);
        }
        try {
          bytes = FS.readFile(filename);
        } catch (e) {
          Module.printErr(`Couldn't find file for: ${filename}`);
          return 0;
        }
      }
      if (Module.freePreloadedMediaOnUse) {
        Module.preloadedAudios[filename] = null;
      }
      audio = raw;
    } else if (rwops.bytes !== undefined) {
      if (SDL.webAudioAvailable()) {
        bytes = Module.HEAPU8.buffer.slice(rwops.bytes, rwops.bytes + rwops.count);
      } else {
        bytes = Module.HEAPU8.subarray(rwops.bytes, rwops.bytes + rwops.count);
      }
    } else {
      return 0;
    }

    const arrayBuffer = bytes ? bytes.buffer || bytes : bytes;
    const canPlayWithWebAudio = Module.SDL_canPlayWithWebAudio === undefined
      || Module.SDL_canPlayWithWebAudio(filename, arrayBuffer);
    if (bytes !== undefined && SDL.webAudioAvailable() && canPlayWithWebAudio) {
      audio = undefined;
      webAudio = {};
      webAudio.onDecodeComplete = [];

      SDL.audioContext.decodeAudioData(arrayBuffer, data => {
        webAudio.decodedBuffer = data;
        webAudio.onDecodeComplete.forEach(e => e());
        webAudio.onDecodeComplete = undefined;
      });
    } else if (audio === undefined && bytes) {
      const blob = new Blob([bytes], {
        type: rwops.mimetype
      });
      const url = URL.createObjectURL(blob);
      audio = new Audio;
      audio.src = url;
      audio.mozAudioChannelType = 'content';
    }
    const id = SDL.audios.length;
    SDL.audios.push({
      source: filename,
      audio,
      webAudio
    });
    return id;
  }

  function _Mix_PlayChannel(channel, id, loops) {
    const info = SDL.audios[id];
    if (!info) return -1;
    if (!info.audio && !info.webAudio) return -1;
    if (channel === -1) {
      for (let i = SDL.channelMinimumNumber; i < SDL.numChannels; i++) {
        if (!SDL.channels[i].audio) {
          channel = i;
          break;
        }
      }
      if (channel === -1) {
        Module.printErr(`All ${SDL.numChannels} channels in use!`);
        return -1;
      }
    }
    const channelInfo = SDL.channels[channel];
    let audio;
    if (info.webAudio) {
      audio = {};
      audio.resource = info;
      audio.paused = false;
      audio.currentPosition = 0;
      audio.play = function() {
        SDL.playWebAudio(this);
      };
      audio.pause = function() {
        SDL.pauseWebAudio(this);
      };
    } else {
      audio = info.audio.cloneNode(true);
      audio.numChannels = info.audio.numChannels;
      audio.frequency = info.audio.frequency;
    }
    audio.onended = function SDL_audio_onended() {
      if (channelInfo.audio === this) {
        channelInfo.audio.paused = true;
        channelInfo.audio = null;
      }
      if (SDL.channelFinished) Runtime.getFuncWrapper(SDL.channelFinished, 'vi')(channel);
    };
    channelInfo.audio = audio;
    audio.loop = loops !== 0;
    audio.volume = channelInfo.volume;
    audio.play();
    return channel;
  }

  function _SDL_PauseAudio(pauseOn) {
    if (!SDL.audio) {
      return;
    }
    if (pauseOn) {
      if (SDL.audio.timer !== undefined) {
        clearTimeout(SDL.audio.timer);
        SDL.audio.numAudioTimersPending = 0;
        SDL.audio.timer = undefined;
      }
    } else if (!SDL.audio.timer) {
      SDL.audio.numAudioTimersPending = 1;
      SDL.audio.timer = Browser.safeSetTimeout(SDL.audio.caller, 1);
    }
    SDL.audio.paused = pauseOn;
  }

  function _SDL_CloseAudio() {
    if (SDL.audio) {
      _SDL_PauseAudio(1);
      Module._free(SDL.audio.buffer);
      SDL.audio = null;
      SDL.allocateChannels(0);
    }
  }

  function _SDL_LockSurface(surf) {
    const surfData = SDL.surfaces[surf];
    surfData.locked++;

    if (surfData.locked > 1) return 0;
    if (!surfData.buffer) {
      surfData.buffer = Module._malloc(surfData.width * surfData.height * 4);
      Module.HEAP32[surf + 20 >> 2] = surfData.buffer;
    }
    Module.HEAP32[surf + 20 >> 2] = surfData.buffer;

    if (surf === SDL.screen && Module.screenIsReadOnly && surfData.image) return 0;
    if (SDL.defaults.discardOnLock) {
      if (!surfData.image) {
        surfData.image = surfData.ctx.createImageData(surfData.width, surfData.height);
      }
      if (!SDL.defaults.opaqueFrontBuffer) return;
    } else {
      surfData.image = surfData.ctx.getImageData(0, 0, surfData.width, surfData.height);
    }

    if (surf === SDL.screen && SDL.defaults.opaqueFrontBuffer) {
      const data = surfData.image.data;
      const num = data.length;
      for (let i = 0; i < num / 4; i++) {
        data[i * 4 + 3] = 255;
      }
    }

    if (SDL.defaults.copyOnLock && !SDL.defaults.discardOnLock) {
      if (surfData.isFlagSet(2097152)) {
        throw new Error(
          'CopyOnLock is not supported for SDL_LockSurface with SDL_HWPALETTE flag set'
        );
      } else {
        Module.HEAPU8.set(surfData.image.data, surfData.buffer);
      }
    }
    return 0;
  }

  function _SDL_FreeRW(rwopsID) {
    SDL.rwops[rwopsID] = null;
    while (SDL.rwops.length > 0 && SDL.rwops[SDL.rwops.length - 1] === null) {
      SDL.rwops.pop();
    }
  }

  function _IMG_Load_RW(rwopsID, freeSrc) {
    const rwops = SDL.rwops[rwopsID];
    function cleanup() {
      if (rwops && freeSrc) _SDL_FreeRW(rwopsID);
    }

    try {
      if (rwops === undefined) {
        return 0;
      }

      let filename = rwops.filename;
      if (filename === undefined) {
        Runtime.warnOnce('Only file names that have been preloaded are supported for IMG_Load_RW. ' +
          'Consider using STB_IMAGE=1 if you want synchronous image decoding (see settings.js)');
        return 0;
      }
      filename = PATH.resolve(filename);

      const raw = Module.preloadedImages[filename];
      if (!raw) {
        if (raw === null) {
          Module.printErr('Trying to reuse preloaded image, ' +
            'but freePreloadedMediaOnUse is set!');
        }
        Runtime.warnOnce(`Cannot find preloaded image ${filename}`);
        Runtime.warnOnce(`Cannot find preloaded image ${filename}.
          Consider using STB_IMAGE=1 if you want synchronous image decoding (see settings.js)`);
        return 0;
      } else if (Module.freePreloadedMediaOnUse) {
        Module.preloadedImages[filename] = null;
      }

      const surf = SDL.makeSurface(raw.width, raw.height, 0, false, `load:${filename}`);
      const surfData = SDL.surfaces[surf];
      surfData.ctx.globalCompositeOperation = 'copy';

      if (!raw.rawData) {
        surfData.ctx.drawImage(raw, 0, 0, raw.width, raw.height, 0, 0, raw.width, raw.height);
      } else {
        const imageData = surfData.ctx.getImageData(0, 0, surfData.width, surfData.height);
        if (raw.bpp === 4) {
          imageData.data.set(Module.HEAPU8.subarray(raw.data, raw.data + raw.size));
        } else if (raw.bpp === 3) {
          const pixels = raw.size / 3;
          const data = imageData.data;
          let sourcePtr = raw.data;
          let destPtr = 0;
          for (let i = 0; i < pixels; i++) {
            data[destPtr++] = Module.HEAPU8[sourcePtr++ >> 0];
            data[destPtr++] = Module.HEAPU8[sourcePtr++ >> 0];
            data[destPtr++] = Module.HEAPU8[sourcePtr++ >> 0];
            data[destPtr++] = 255;
          }
        } else if (raw.bpp === 1) {
          const pixels = raw.size;
          const data = imageData.data;
          let sourcePtr = raw.data;
          let destPtr = 0;
          for (let i = 0; i < pixels; i++) {
            const value = Module.HEAPU8[sourcePtr++ >> 0];
            data[destPtr++] = value;
            data[destPtr++] = value;
            data[destPtr++] = value;
            data[destPtr++] = 255;
          }
        } else {
          Module.printErr(`cannot handle bpp ${raw.bpp}`);
          return 0;
        }
        surfData.ctx.putImageData(imageData, 0, 0);
      }
      surfData.ctx.globalCompositeOperation = 'source-over';
      _SDL_LockSurface(surf);
      surfData.locked--;
      if (SDL.GL) {
        surfData.canvas = surfData.ctx = null;
      }
      return surf;
    } finally {
      cleanup();
    }
  }

  function _SDL_RWFromFile(_name, mode) {
    const id = SDL.rwops.length;
    const name = Module.Pointer_stringify(_name);
    SDL.rwops.push({
      filename: name,
      mimetype: Browser.getMimetype(name)
    });
    return id;
  }

  function _IMG_Load(filename) {
    const rwops = _SDL_RWFromFile(filename);
    const result = _IMG_Load_RW(rwops, 1);
    return result;
  }

  function _SDL_UpperBlitScaled(src, srcrect, dst, dstrect) {
    return SDL.blitSurface(src, srcrect, dst, dstrect, true);
  }

  function _SDL_UpperBlit(src, srcrect, dst, dstrect) {
    return SDL.blitSurface(src, srcrect, dst, dstrect, false);
  }

  function _SDL_GetTicks() {
    return Date.now() - SDL.startTime | 0;
  }

  function _SDL_JoystickGetAxis(joystick, axis) {
    const gamepad = SDL.getGamepad(joystick - 1);
    if (gamepad && gamepad.axes.length > axis) {
      return SDL.joystickAxisValueConversion(gamepad.axes[axis]);
    }
    return 0;
  }

  function _SDL_WaitEvent() {
    Module.printErr('missing function: SDL_WaitEvent');
    Module.abort(-1);
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

  function _fileno(stream) {
    stream = FS.getStreamFromPtr(stream);
    if (!stream) return -1;
    return stream.fd;
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

  function _SDL_JoystickNumHats(joystick) {
    return 0;
  }

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

  function _fclose(stream) {
    const fd = _fileno(stream);
    _fsync(fd);
    return _close(fd);
  }

  function _pthread_mutex_lock() {}

  function _SDL_JoystickGetButton(joystick, button) {
    const gamepad = SDL.getGamepad(joystick - 1);
    if (gamepad && gamepad.buttons.length > button) {
      return SDL.getJoystickButtonState(gamepad.buttons[button]) ? 1 : 0;
    }
    return 0;
  }

  function _SDL_JoystickOpen(deviceIndex) {
    const gamepad = SDL.getGamepad(deviceIndex);
    if (gamepad) {
      const joystick = deviceIndex + 1;
      SDL.recordJoystickState(joystick, gamepad);
      return joystick;
    }
    return 0;
  }

  function _execl() {
    ___setErrNo(ERRNO_CODES.ENOEXEC);
    return -1;
  }

  function _execlp() {
    return _execl.apply(null, arguments);
  }

  function _mkport() {
    throw new Error('TODO');
  }

  function _send(fd, buf, len, flags) {
    const sock = SOCKFS.getSocket(fd);
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

  function __reallyNegative(x) {
    return x < 0 || x === 0 && 1 / x === -Infinity;
  }

  function __formatString(format, varargs) {
    let textIndex = format;
    let argIndex = 0;

    function getNextArg(type) {
      let ret;
      if (type === 'double') {
        ret = (Module.HEAP32[tempDoublePtr >> 2] = Module.HEAP32[varargs + argIndex >> 2],
          Module.HEAP32[tempDoublePtr + 4 >> 2] = Module.HEAP32[varargs + (argIndex + 4) >> 2],
          +Module.HEAPF64[tempDoublePtr >> 3]);
      } else if (type === 'i64') {
        ret = [Module.HEAP32[varargs + argIndex >> 2], Module.HEAP32[varargs + (argIndex + 4) >> 2]];
      } else {
        type = 'i32';
        ret = Module.HEAP32[varargs + argIndex >> 2];
      }
      argIndex += Runtime.getNativeFieldSize(type);
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
                currArg = Runtime.makeBigInt(currArg[0], currArg[1], next === 117);
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

  function _fprintf(stream, format, varargs) {
    const result = __formatString(format, varargs);
    const stack = Runtime.stackSave();
    const ret = _fwrite(Module.allocate(result,
      'i8', Module.ALLOC_STACK), 1, result.length, stream);
    Runtime.stackRestore(stack);
    return ret;
  }

  function _umask(newMask) {
    if (_umask.cmask === undefined) _umask.cmask = 511;
    const oldMask = _umask.cmask;
    _umask.cmask = newMask;
    return oldMask;
  }

  function _SDL_GetModState() {
    return SDL.modState;
  }

  function _fputs(s, stream) {
    const fd = _fileno(stream);
    return _write(fd, s, Module._strlen(s));
  }

  function _SDL_Delay(delay) {
    if (!ENVIRONMENT_IS_WORKER) {
      Module.abort('SDL_Delay called on the main thread! Potential infinite loop, quitting.');
    }
    const now = Date.now();
    while (Date.now() - now < delay) {
      //
    }
  }

  function __exit(status) {
    Module.exit(status);
  }

  function _exit(status) {
    __exit(status);
  }

  function _stat(path, buf, dontResolveLastLink) {
    path = typeof path !== 'string' ? Module.Pointer_stringify(path) : path;
    try {
      const stat = dontResolveLastLink ? FS.lstat(path) : FS.stat(path);
      Module.HEAP32[buf >> 2] = stat.dev;
      Module.HEAP32[buf + 4 >> 2] = 0;
      Module.HEAP32[buf + 8 >> 2] = stat.ino;
      Module.HEAP32[buf + 12 >> 2] = stat.mode;
      Module.HEAP32[buf + 16 >> 2] = stat.nlink;
      Module.HEAP32[buf + 20 >> 2] = stat.uid;
      Module.HEAP32[buf + 24 >> 2] = stat.gid;
      Module.HEAP32[buf + 28 >> 2] = stat.rdev;
      Module.HEAP32[buf + 32 >> 2] = 0;
      Module.HEAP32[buf + 36 >> 2] = stat.size;
      Module.HEAP32[buf + 40 >> 2] = 4096;
      Module.HEAP32[buf + 44 >> 2] = stat.blocks;
      Module.HEAP32[buf + 48 >> 2] = stat.atime.getTime() / 1e3 | 0;
      Module.HEAP32[buf + 52 >> 2] = 0;
      Module.HEAP32[buf + 56 >> 2] = stat.mtime.getTime() / 1e3 | 0;
      Module.HEAP32[buf + 60 >> 2] = 0;
      Module.HEAP32[buf + 64 >> 2] = stat.ctime.getTime() / 1e3 | 0;
      Module.HEAP32[buf + 68 >> 2] = 0;
      Module.HEAP32[buf + 72 >> 2] = stat.ino;
      return 0;
    } catch (e) {
      if (e.node && PATH.normalize(path) !== PATH.normalize(FS.getPath(e.node))) {
        e.setErrno(ERRNO_CODES.ENOTDIR);
      }
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fstat(fildes, buf) {
    const stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    return _stat(stream.path, buf);
  }
  const ___tm_current = Module.allocate(44, 'i8', Module.ALLOC_STATIC);
  const _tzname = Module.allocate(8, 'i32*', Module.ALLOC_STATIC);
  const _daylight = Module.allocate(1, 'i32*', Module.ALLOC_STATIC);
  const _timezone = Module.allocate(1, 'i32*', Module.ALLOC_STATIC);

  function _tzset() {
    if (_tzset.called) return;
    _tzset.called = true;
    Module.HEAP32[_timezone >> 2] = -(new Date).getTimezoneOffset() * 60;
    const winter = new Date(2e3, 0, 1);
    const summer = new Date(2e3, 6, 1);
    Module.HEAP32[_daylight >> 2] = Number(winter.getTimezoneOffset() !== summer.getTimezoneOffset());

    function extractZone(date) {
      const match = date.toTimeString().match(/\(([A-Za-z ]+)\)$/);
      return match ? match[1] : 'GMT';
    }
    const winterName = extractZone(winter);
    const summerName = extractZone(summer);
    const winterNamePtr = Module.allocate(Module.intArrayFromString(winterName),
      'i8', Module.ALLOC_NORMAL);
    const summerNamePtr = Module.allocate(Module.intArrayFromString(summerName),
      'i8', Module.ALLOC_NORMAL);
    if (summer.getTimezoneOffset() < winter.getTimezoneOffset()) {
      Module.HEAP32[_tzname >> 2] = winterNamePtr;
      Module.HEAP32[_tzname + 4 >> 2] = summerNamePtr;
    } else {
      Module.HEAP32[_tzname >> 2] = summerNamePtr;
      Module.HEAP32[_tzname + 4 >> 2] = winterNamePtr;
    }
  }

  function _localtime_r(time, tmPtr) {
    _tzset();
    const date = new Date(Module.HEAP32[time >> 2] * 1e3);
    Module.HEAP32[tmPtr >> 2] = date.getSeconds();
    Module.HEAP32[tmPtr + 4 >> 2] = date.getMinutes();
    Module.HEAP32[tmPtr + 8 >> 2] = date.getHours();
    Module.HEAP32[tmPtr + 12 >> 2] = date.getDate();
    Module.HEAP32[tmPtr + 16 >> 2] = date.getMonth();
    Module.HEAP32[tmPtr + 20 >> 2] = date.getFullYear() - 1900;
    Module.HEAP32[tmPtr + 24 >> 2] = date.getDay();
    const start = new Date(date.getFullYear(), 0, 1);
    const yday = (date.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24) | 0;
    Module.HEAP32[tmPtr + 28 >> 2] = yday;
    Module.HEAP32[tmPtr + 36 >> 2] = -(date.getTimezoneOffset() * 60);
    const summerOffset = (new Date(2e3, 6, 1)).getTimezoneOffset();
    const winterOffset = start.getTimezoneOffset();
    const dst = date.getTimezoneOffset() === Math.min(winterOffset, summerOffset) | 0;
    Module.HEAP32[tmPtr + 32 >> 2] = dst;
    const zonePtr = Module.HEAP32[_tzname + (dst ? Runtime.QUANTUM_SIZE : 0) >> 2];
    Module.HEAP32[tmPtr + 40 >> 2] = zonePtr;
    return tmPtr;
  }

  function _localtime(time) {
    return _localtime_r(time, ___tm_current);
  }

  function _SDL_NumJoysticks() {
    let count = 0;
    const gamepads = SDL.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] !== undefined) count++;
    }
    return count;
  }

  function _getpwnam() {
    throw new Error('getpwnam: TODO');
  }

  function _emscripten_memcpy_big(dest, src, num) {
    Module.HEAPU8.set(Module.HEAPU8.subarray(src, src + num), dest);
    return dest;
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
    if (!_strerror.buffer) _strerror.buffer = Module._malloc(256);
    _strerror_r(errnum, _strerror.buffer, 256);
    return _strerror.buffer;
  }

  function ___errno_location() {
    return ___errno_state;
  }

  function _perror(s) {
    const stdout = Module.HEAP32[_stdout >> 2];
    if (s) {
      _fputs(s, stdout);
      _fputc(58, stdout);
      _fputc(32, stdout);
    }
    const errnum = Module.HEAP32[___errno_location() >> 2];
    _puts(_strerror(errnum));
  }

  function _newlocale(mask, locale, base) {
    if (!LOCALE.check(locale)) {
      ___setErrNo(ERRNO_CODES.ENOENT);
      return 0;
    }
    if (!base) base = Module._calloc(1, 4);
    return base;
  }

  function _unlink(path) {
    path = Module.Pointer_stringify(path);
    try {
      FS.unlink(path);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _rmdir(path) {
    path = Module.Pointer_stringify(path);
    try {
      FS.rmdir(path);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _remove(path) {
    let ret = _unlink(path);
    if (ret === -1) ret = _rmdir(path);
    return ret;
  }

  function _pthread_cond_wait() {
    return 0;
  }

  function ___cxa_free_exception(ptr) {
    try {
      return Module._free(ptr);
    } catch (e) {
      //
    }
  }

  function ___cxa_end_catch() {
    if (___cxa_end_catch.rethrown) {
      ___cxa_end_catch.rethrown = false;
      return;
    }
    asm.setThrew(0);
    const ptr = EXCEPTIONS.caught.pop();
    if (ptr) {
      EXCEPTIONS.decRef(EXCEPTIONS.deAdjust(ptr));
      EXCEPTIONS.last = 0;
    }
  }

  function ___cxa_rethrow() {
    ___cxa_end_catch.rethrown = true;
    const ptr = EXCEPTIONS.caught.pop();
    EXCEPTIONS.last = ptr;
    throw new Error(`${ptr} - Exception catching is disabled, this exception cannot be caught.
      Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.`);
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

  function _opendir(dirname) {
    const path = Module.Pointer_stringify(dirname);
    if (!path) {
      ___setErrNo(ERRNO_CODES.ENOENT);
      return 0;
    }
    let node;
    try {
      const lookup = FS.lookupPath(path, {
        follow: true
      });
      node = lookup.node;
    } catch (e) {
      FS.handleFSError(e);
      return 0;
    }
    if (!FS.isDir(node.mode)) {
      ___setErrNo(ERRNO_CODES.ENOTDIR);
      return 0;
    }
    const fd = _open(dirname, 0, Module.allocate([0, 0, 0, 0], 'i32', Module.ALLOC_STACK));
    return fd === -1 ? 0 : FS.getPtrForStream(FS.getStream(fd));
  }

  function _SDL_JoystickName(deviceIndex) {
    const gamepad = SDL.getGamepad(deviceIndex);
    if (gamepad) {
      const name = gamepad.id;
      if (SDL.joystickNamePool.hasOwnProperty(name)) {
        return SDL.joystickNamePool[name];
      }

      SDL.joystickNamePool[name] =
        Module.allocate(Module.intArrayFromString(name), 'i8', Module.ALLOC_NORMAL);

      return SDL.joystickNamePool[name];
    }
    return 0;
  }

  function _SDL_SetColors(surf, colors, firstColor, nColors) {
    const surfData = SDL.surfaces[surf];
    if (!surfData.colors) {
      const buffer = new ArrayBuffer(256 * 4);
      surfData.colors = new Uint8Array(buffer);
      surfData.colors32 = new Uint32Array(buffer);
    }
    for (let i = 0; i < nColors; ++i) {
      const index = (firstColor + i) * 4;
      surfData.colors[index] = Module.HEAPU8[colors + i * 4 >> 0];
      surfData.colors[index + 1] = Module.HEAPU8[colors + (i * 4 + 1) >> 0];
      surfData.colors[index + 2] = Module.HEAPU8[colors + (i * 4 + 2) >> 0];
      surfData.colors[index + 3] = 255;
    }
    return 1;
  }

  function _SDL_SetPalette(surf, flags, colors, firstColor, nColors) {
    return _SDL_SetColors(surf, colors, firstColor, nColors);
  }

  function _readdir_r(dirp, entry, result) {
    const stream = FS.getStreamFromPtr(dirp);
    if (!stream) {
      return ___setErrNo(ERRNO_CODES.EBADF);
    }
    if (!stream.currReading) {
      try {
        stream.currReading = FS.readdir(stream.path);
      } catch (e) {
        return FS.handleFSError(e);
      }
    }
    if (stream.position < 0 || stream.position >= stream.currReading.length) {
      Module.HEAP32[result >> 2] = 0;
      return 0;
    }
    let id;
    let type;
    const name = stream.currReading[stream.position++];
    if (!name.indexOf('.')) {
      id = 1;
      type = 4;
    } else {
      let child;
      try {
        child = FS.lookupNode(stream.node, name);
      } catch (e) {
        return _readdir_r(dirp, entry, result);
      }
      id = child.id;
      type = FS.isChrdev(child.mode)
        ? 2
        : FS.isDir(child.mode)
          ? 4
          : FS.isLink(child.mode)
            ? 10
            : 8;
    }
    Module.HEAP32[entry >> 2] = id;
    Module.HEAP32[entry + 4 >> 2] = stream.position;
    Module.HEAP32[entry + 8 >> 2] = name.length + 1;
    let i;
    for (i = 0; i < name.length; i++) {
      Module.HEAP8[entry + 11 + i >> 0] = name.charCodeAt(i);
    }
    Module.HEAP8[entry + 11 + i >> 0] = 0;
    Module.HEAP8[entry + 10 >> 0] = type;
    Module.HEAP32[result >> 2] = entry;
    return 0;
  }

  function _readdir(dirp) {
    const stream = FS.getStreamFromPtr(dirp);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return 0;
    }
    if (!_readdir.entry) _readdir.entry = Module._malloc(268);
    if (!_readdir.result) _readdir.result = Module._malloc(4);

    const err = _readdir_r(dirp, _readdir.entry, _readdir.result);
    if (err) {
      ___setErrNo(err);
      return 0;
    }
    return Module.HEAP32[_readdir.result >> 2];
  }

  function _SDL_JoystickClose(joystick) {
    delete SDL.lastJoystickState[joystick];
  }

  function _SDL_LockAudio() {}

  function _recv(fd, buf, len, flags) {
    const sock = SOCKFS.getSocket(fd);
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

  function _fgets(s, n, stream) {
    const streamObj = FS.getStreamFromPtr(stream);
    if (!streamObj) return 0;
    if (streamObj.error || streamObj.eof) return 0;
    let byte_;
    let i;
    for (i = 0; i < n - 1 && byte_ !== 10; i++) {
      byte_ = _fgetc(stream);
      if (byte_ === -1) {
        if (streamObj.error || streamObj.eof && i === 0) return 0;
        else if (streamObj.eof) break;
      }
      Module.HEAP8[s + i >> 0] = byte_;
    }
    Module.HEAP8[s + i >> 0] = 0;
    return s;
  }

  function _SDL_FillRect(surf, rect, color) {
    const surfData = SDL.surfaces[surf];
    assert(!surfData.locked);
    if (surfData.isFlagSet(2097152)) {
      color = surfData.colors32[color];
    }
    let r = rect ? SDL.loadRect(rect) : {
      x: 0,
      y: 0,
      w: surfData.width,
      h: surfData.height
    };
    if (surfData.clipRect) {
      r = SDL.intersectionOfRects(surfData.clipRect, r);
      if (rect) {
        SDL.updateRect(rect, r);
      }
    }
    surfData.ctx.save();
    surfData.ctx.fillStyle = SDL.translateColorToCSSRGBA(color);
    surfData.ctx.fillRect(r.x, r.y, r.w, r.h);
    surfData.ctx.restore();
    return 0;
  }

  function _emscripten_force_exit(status) {
    Module.noExitRuntime = false;
    Module.exit(status);
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

  function _access(path, amode) {
    path = Module.Pointer_stringify(path);
    if (amode & ~7) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    let node;
    try {
      const lookup = FS.lookupPath(path, {
        follow: true
      });
      node = lookup.node;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
    let perms = '';
    if (amode & 4) perms += 'r';
    if (amode & 2) perms += 'w';
    if (amode & 1) perms += 'x';
    if (perms && FS.nodePermissions(node, perms)) {
      ___setErrNo(ERRNO_CODES.EACCES);
      return -1;
    }
    return 0;
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

  const PTHREAD_SPECIFIC = {};

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

  function _catgets(catd, set_id, msg_id, s) {
    return s;
  }

  function _SDL_ShowCursor(toggle) {
    switch (toggle) {
      case 0:
        if (Browser.isFullScreen) {
          Module.canvas.requestPointerLock();
          return 0;
        }
        return 1;

      case 1:
        Module.canvas.exitPointerLock();
        return 1;

      case -1:
        return !Browser.pointerLock;

      default:
        console.log(`SDL_ShowCursor called with unknown toggle parameter value: ${toggle}.`);
        break;
    }
  }

  function _ferror(stream) {
    stream = FS.getStreamFromPtr(stream);
    return Number(stream && stream.error);
  }

  function ___cxa_allocate_exception(size) {
    return Module._malloc(size);
  }

  function _getcwd(buf, size) {
    if (size === 0) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return 0;
    }
    const cwd = FS.cwd();
    if (size < cwd.length + 1) {
      ___setErrNo(ERRNO_CODES.ERANGE);
      return 0;
    }
    Module.writeAsciiToMemory(cwd, buf);
    return buf;
  }

  function ___cxa_guard_acquire(variable) {
    if (!Module.HEAP8[variable >> 0]) {
      Module.HEAP8[variable >> 0] = 1;
      return 1;
    }
    return 0;
  }

  function _SDL_WM_GrabInput() {}

  function __ZSt18uncaught_exceptionv() {
    return !!__ZSt18uncaught_exceptionv.uncaught_exception;
  }

  function ___cxa_begin_catch(ptr) {
    __ZSt18uncaught_exceptionv.uncaught_exception--;
    EXCEPTIONS.caught.push(ptr);
    EXCEPTIONS.addRef(EXCEPTIONS.deAdjust(ptr));
    return ptr;
  }

  function _fseeko() {
    return _fseek.apply(null, arguments);
  }

  function _SDL_UnlockSurface(surf) {
    assert(!SDL.GL);
    const surfData = SDL.surfaces[surf];
    if (!surfData.locked || --surfData.locked > 0) {
      return;
    }
    if (surfData.isFlagSet(2097152)) {
      SDL.copyIndexedColorData(surfData);
    } else if (!surfData.colors) {
      const data = surfData.image.data;
      const buffer = surfData.buffer;
      assert(buffer % 4 === 0, `Invalid buffer offset: ${buffer}`);
      let src = buffer >> 2;
      let dst = 0;
      const isScreen = surf === SDL.screen;
      let num;
      if (typeof CanvasPixelArray !== 'undefined' && data instanceof CanvasPixelArray) {
        num = data.length;
        while (dst < num) {
          const val = Module.HEAP32[src];
          data[dst] = val & 255;
          data[dst + 1] = val >> 8 & 255;
          data[dst + 2] = val >> 16 & 255;
          data[dst + 3] = isScreen ? 255 : val >> 24 & 255;
          src++;
          dst += 4;
        }
      } else {
        const data32 = new Uint32Array(data.buffer);
        if (isScreen && SDL.defaults.opaqueFrontBuffer) {
          num = data32.length;
          data32.set(Module.HEAP32.subarray(src, src + num));
          const data8 = new Uint8Array(data.buffer);
          let i = 3;
          const j = i + 4 * num;
          if (num % 8 === 0) {
            while (i < j) {
              data8[i] = 255;
              i = i + 4 | 0;
              data8[i] = 255;
              i = i + 4 | 0;
              data8[i] = 255;
              i = i + 4 | 0;
              data8[i] = 255;
              i = i + 4 | 0;
              data8[i] = 255;
              i = i + 4 | 0;
              data8[i] = 255;
              i = i + 4 | 0;
              data8[i] = 255;
              i = i + 4 | 0;
              data8[i] = 255;
              i = i + 4 | 0;
            }
          } else {
            while (i < j) {
              data8[i] = 255;
              i = i + 4 | 0;
            }
          }
        } else {
          data32.set(Module.HEAP32.subarray(src, src + data32.length));
        }
      }
    } else {
      const width = Module.canvas.width;
      const height = Module.canvas.height;
      let s = surfData.buffer;
      const data = surfData.image.data;
      const colors = surfData.colors;
      for (let y = 0; y < height; y++) {
        const base = y * width * 4;
        for (let x = 0; x < width; x++) {
          const val = Module.HEAPU8[s++ >> 0] * 4;
          const start = base + x * 4;
          data[start] = colors[val];
          data[start + 1] = colors[val + 1];
          data[start + 2] = colors[val + 2];
        }
        s += width * 3;
      }
    }
    surfData.ctx.putImageData(surfData.image, 0, 0);
  }

  function _SDL_Init(initFlags) {
    SDL.startTime = Date.now();
    SDL.initFlags = initFlags;
    if (!Module.doNotCaptureKeyboard) {
      const keyboardListeningElement = Module.keyboardListeningElement || document;
      keyboardListeningElement.addEventListener('keydown', SDL.receiveEvent);
      keyboardListeningElement.addEventListener('keyup', SDL.receiveEvent);
      keyboardListeningElement.addEventListener('keypress', SDL.receiveEvent);
      window.addEventListener('focus', SDL.receiveEvent);
      window.addEventListener('blur', SDL.receiveEvent);
      document.addEventListener('visibilitychange', SDL.receiveEvent);
    }
    if (initFlags & 512) {
      // addEventListener('gamepadconnected', function() {});
    }
    window.addEventListener('unload', SDL.receiveEvent);
    SDL.keyboardState = Module._malloc(65536);
    Module._memset(SDL.keyboardState, 0, 65536);
    SDL.DOMEventToSDLEvent.keydown = 768;
    SDL.DOMEventToSDLEvent.keyup = 769;
    SDL.DOMEventToSDLEvent.keypress = 771;
    SDL.DOMEventToSDLEvent.mousedown = 1025;
    SDL.DOMEventToSDLEvent.mouseup = 1026;
    SDL.DOMEventToSDLEvent.mousemove = 1024;
    SDL.DOMEventToSDLEvent.wheel = 1027;
    SDL.DOMEventToSDLEvent.touchstart = 1792;
    SDL.DOMEventToSDLEvent.touchend = 1793;
    SDL.DOMEventToSDLEvent.touchmove = 1794;
    SDL.DOMEventToSDLEvent.unload = 256;
    SDL.DOMEventToSDLEvent.resize = 28673;
    SDL.DOMEventToSDLEvent.visibilitychange = 512;
    SDL.DOMEventToSDLEvent.focus = 512;
    SDL.DOMEventToSDLEvent.blur = 512;
    SDL.DOMEventToSDLEvent.joystick_axis_motion = 1536;
    SDL.DOMEventToSDLEvent.joystick_button_down = 1539;
    SDL.DOMEventToSDLEvent.joystick_button_up = 1540;
    return 0;
  }

  function _atexit(func, arg) {
    __ATEXIT__.unshift({
      func,
      arg
    });
  }

  function ___cxa_atexit() {
    return _atexit.apply(null, arguments);
  }

  function ___resumeException(ptr) {
    if (!EXCEPTIONS.last) {
      EXCEPTIONS.last = ptr;
    }
    EXCEPTIONS.clearRef(EXCEPTIONS.deAdjust(ptr));
    throw new Error(`${ptr} - Exception catching is disabled, this exception cannot be caught.
      Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.`);
  }

  function ___cxa_find_matching_catch() {
    let thrown = EXCEPTIONS.last;
    if (!thrown) {
      return (asm.setTempRet0(0), 0) | 0;
    }
    const info = EXCEPTIONS.infos[thrown];
    const throwntype = info.type;
    if (!throwntype) {
      return (asm.setTempRet0(0), thrown) | 0;
    }
    const typeArray = Array.prototype.slice.call(arguments);
    // const pointer = Module.___cxa_is_pointer_type(throwntype);
    if (!___cxa_find_matching_catch.buffer) ___cxa_find_matching_catch.buffer = Module._malloc(4);
    Module.HEAP32[___cxa_find_matching_catch.buffer >> 2] = thrown;
    thrown = ___cxa_find_matching_catch.buffer;
    for (let i = 0; i < typeArray.length; i++) {
      if (typeArray[i] && Module.___cxa_can_catch(typeArray[i], throwntype, thrown)) {
        thrown = Module.HEAP32[thrown >> 2];
        info.adjusted = thrown;
        return (asm.setTempRet0(typeArray[i]), thrown) | 0;
      }
    }
    thrown = Module.HEAP32[thrown >> 2];
    return (asm.setTempRet0(throwntype), thrown) | 0;
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

  function _SDL_JoystickNumButtons(joystick) {
    const gamepad = SDL.getGamepad(joystick - 1);
    if (gamepad) {
      return gamepad.buttons.length;
    }
    return 0;
  }

  function _chmod(path, mode, dontResolveLastLink) {
    path = typeof path !== 'string' ? Module.Pointer_stringify(path) : path;
    try {
      FS.chmod(path, mode);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _printf(format, varargs) {
    const stdout = Module.HEAP32[_stdout >> 2];
    return _fprintf(stdout, format, varargs);
  }

  function _SDL_SetVideoMode(width, height, depth, flags) {
    ['touchstart', 'touchend', 'touchmove', 'mousedown', 'mouseup', 'mousemove',
      'DOMMouseScroll', 'mousewheel', 'wheel', 'mouseout'
    ].forEach(event => {
      Module.canvas.addEventListener(event, SDL.receiveEvent, true);
    });
    const canvas = Module.canvas;
    if (width === 0 && height === 0) {
      width = canvas.width;
      height = canvas.height;
    }
    if (!SDL.addedResizeListener) {
      SDL.addedResizeListener = true;
      Browser.resizeListeners.push((w, h) => {
        if (!SDL.settingVideoMode) {
          SDL.receiveEvent({
            type: 'resize',
            w,
            h
          });
        }
      });
    }
    if (width !== canvas.width || height !== canvas.height) {
      SDL.settingVideoMode = true;
      Browser.setCanvasSize(width, height);
      SDL.settingVideoMode = false;
    }
    if (SDL.screen) {
      SDL.freeSurface(SDL.screen);
      assert(!SDL.screen);
    }
    if (SDL.GL) flags = flags | 67108864;
    SDL.screen = SDL.makeSurface(width, height, flags, true, 'screen');
    return SDL.screen;
  }

  function _mktime(tmPtr) {
    _tzset();
    const date = new Date(Module.HEAP32[tmPtr + 20 >> 2] + 1900, Module.HEAP32[tmPtr + 16 >> 2],
        Module.HEAP32[tmPtr + 12 >> 2], Module.HEAP32[tmPtr + 8 >> 2], Module.HEAP32[tmPtr + 4 >> 2],
        Module.HEAP32[tmPtr >> 2], 0);
    const dst = Module.HEAP32[tmPtr + 32 >> 2];
    const guessedOffset = date.getTimezoneOffset();
    const start = new Date(date.getFullYear(), 0, 1);
    // const summerOffset = (new Date(2e3, 6, 1)).getTimezoneOffset();
    const winterOffset = start.getTimezoneOffset();
    // const dstOffset = Math.min(winterOffset, summerOffset);
    if (dst < 0) {
      Module.HEAP32[tmPtr + 32 >> 2] = Number(winterOffset !== guessedOffset);
    } else if (dst > 0 !== (winterOffset !== guessedOffset)) {
      const summerOffset = (new Date(date.getFullYear(), 6, 1)).getTimezoneOffset();
      const trueOffset = dst > 0 ? summerOffset : winterOffset;
      date.setTime(date.getTime() + (trueOffset - guessedOffset) * 6e4);
    }
    Module.HEAP32[tmPtr + 24 >> 2] = date.getDay();
    const yday = (date.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24) | 0;
    Module.HEAP32[tmPtr + 28 >> 2] = yday;
    return date.getTime() / 1e3 | 0;
  }

  function _fdopen(fildes, mode) {
    mode = Module.Pointer_stringify(mode);
    const stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return 0;
    }
    if (mode.indexOf('w') !== -1 && !stream.isWrite
      || mode.indexOf('r') !== -1 && !stream.isRead
      || mode.indexOf('a') !== -1 && !stream.isAppend
      || mode.indexOf('+') !== -1 && (!stream.isRead
      || !stream.isWrite)) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return 0;
    }
    stream.error = false;
    stream.eof = false;
    return FS.getPtrForStream(stream);
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

  function _SDL_Flip(surf) {}

  function _mknod(path, mode, dev) {
    path = Module.Pointer_stringify(path);
    switch (mode & 61440) {
      case 32768:
      case 8192:
      case 24576:
      case 4096:
      case 49152:
        break;
      default:
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
    }
    try {
      FS.mknod(path, mode, dev);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _mkdir(path, mode) {
    path = Module.Pointer_stringify(path);
    path = PATH.normalize(path);
    if (path[path.length - 1] === '/') path = path.substr(0, path.length - 1);
    try {
      FS.mkdir(path, mode, 0);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _putc() {
    return _fputc.apply(null, arguments);
  }

  function _SDL_InitSubSystem(flags) {
    return 0;
  }

  function _SDL_GetError() {
    if (!SDL.errorMessage) {
      SDL.errorMessage = Module.allocate(Module.intArrayFromString('unknown SDL-emscripten error'),
        'i8', Module.ALLOC_NORMAL);
    }
    return SDL.errorMessage;
  }

  function _pthread_cond_broadcast() {
    return 0;
  }

  function _vfprintf(s, f, va_arg) {
    return _fprintf(s, f, Module.HEAP32[va_arg >> 2]);
  }

  function _pthread_mutex_unlock() {}

  function _SDL_WM_SetCaption(title, icon) {
    title = title && Module.Pointer_stringify(title);
    icon = icon && Module.Pointer_stringify(icon);
  }

  function _SDL_JoystickGetHat(joystick, hat) {
    return 0;
  }

  function _sbrk(bytes) {
    const self = _sbrk;
    if (!self.called) {
      DYNAMICTOP = alignMemoryPage(DYNAMICTOP);
      self.called = true;
      assert(Runtime.dynamicAlloc);
      self.alloc = Runtime.dynamicAlloc;
      Runtime.dynamicAlloc = function() {
        Module.abort('cannot dynamically allocate, sbrk now has control');
      };
    }
    const ret = DYNAMICTOP;
    if (bytes !== 0) self.alloc(bytes);
    return ret;
  }

  function _emscripten_cancel_main_loop() {
    Browser.mainLoop.pause();
    Browser.mainLoop.func = null;
  }

  function _catclose(catd) {
    return 0;
  }

  function _SDL_AudioQuit() {
    for (let i = 0; i < SDL.numChannels; ++i) {
      if (SDL.channels[i].audio) {
        SDL.channels[i].audio.pause();
        SDL.channels[i].audio = undefined;
      }
    }
    if (SDL.music.audio) SDL.music.audio.pause();
    SDL.music.audio = undefined;
  }

  function _SDL_Quit() {
    _SDL_AudioQuit();
    Module.print('SDL_Quit called (and ignored)');
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

  function _SDL_OpenAudio(desired, obtained) {
    try {
      SDL.audio = {
        freq: Module.HEAPU32[desired >> 2],
        format: Module.HEAPU16[desired + 4 >> 1],
        channels: Module.HEAPU8[desired + 6 >> 0],
        samples: Module.HEAPU16[desired + 8 >> 1],
        callback: Module.HEAPU32[desired + 16 >> 2],
        userdata: Module.HEAPU32[desired + 20 >> 2],
        paused: true,
        timer: null
      };
      if (SDL.audio.format === 8) {
        SDL.audio.silence = 128;
      } else if (SDL.audio.format === 32784) {
        SDL.audio.silence = 0;
      } else {
        throw new Error(`Invalid SDL audio format ${SDL.audio.format}!`);
      }
      if (SDL.audio.freq <= 0) {
        throw new Error(`Unsupported sound frequency ${SDL.audio.freq}!`);
      } else if (SDL.audio.freq <= 22050) {
        SDL.audio.freq = 22050;
      } else if (SDL.audio.freq <= 32e3) {
        SDL.audio.freq = 32e3;
      } else if (SDL.audio.freq <= 44100) {
        SDL.audio.freq = 44100;
      } else if (SDL.audio.freq <= 48e3) {
        SDL.audio.freq = 48e3;
      } else if (SDL.audio.freq <= 96e3) {
        SDL.audio.freq = 96e3;
      } else {
        throw new Error(`Unsupported sound frequency ${SDL.audio.freq}!`);
      }
      if (SDL.audio.channels === 0) {
        SDL.audio.channels = 1;
      } else if (SDL.audio.channels < 0 || SDL.audio.channels > 32) {
        throw new Error(`Unsupported number of audio channels for SDL audio: ${SDL.audio.channels}!`);
      } else if (SDL.audio.channels !== 1 && SDL.audio.channels !== 2) {
        console.log(`Warning: Using untested number of audio channels ${SDL.audio.channels}`);
      }
      if (SDL.audio.samples < 128 || SDL.audio.samples > 524288) {
        throw new Error(`Unsupported audio callback buffer size ${SDL.audio.samples}!`);
      } else if ((SDL.audio.samples & SDL.audio.samples - 1) !== 0) {
        throw new Error(`Audio callback buffer size ${SDL.audio.samples} must be a power-of-two!`);
      }
      const totalSamples = SDL.audio.samples * SDL.audio.channels;
      SDL.audio.bytesPerSample = SDL.audio.format === 8 || SDL.audio.format === 32776 ? 1 : 2;
      SDL.audio.bufferSize = totalSamples * SDL.audio.bytesPerSample;
      SDL.audio.bufferDurationSecs = SDL.audio.bufferSize / SDL.audio.bytesPerSample /
        SDL.audio.channels / SDL.audio.freq;
      SDL.audio.bufferingDelay = 50 / 1e3;
      SDL.audio.buffer = Module._malloc(SDL.audio.bufferSize);
      SDL.audio.numSimultaneouslyQueuedBuffers = Module.SDL_numSimultaneouslyQueuedBuffers || 5;
      SDL.audio.queueNewAudioData = function SDL_queueNewAudioData() {
        if (!SDL.audio) return;
        for (let i = 0; i < SDL.audio.numSimultaneouslyQueuedBuffers; ++i) {
          const secsUntilNextPlayStart = SDL.audio.nextPlayTime - SDL.audioContext.currentTime;
          if (secsUntilNextPlayStart >= SDL.audio.bufferingDelay + SDL.audio.bufferDurationSecs *
            SDL.audio.numSimultaneouslyQueuedBuffers) return;
          Runtime.dynCall('viii', SDL.audio.callback,
            [SDL.audio.userdata, SDL.audio.buffer, SDL.audio.bufferSize]);
          SDL.audio.pushAudio(SDL.audio.buffer, SDL.audio.bufferSize);
        }
      };
      SDL.audio.caller = function SDL_audioCaller() {
        if (!SDL.audio) return;
        --SDL.audio.numAudioTimersPending;
        SDL.audio.queueNewAudioData();
        const secsUntilNextPlayStart = SDL.audio.nextPlayTime - SDL.audioContext.currentTime;
        const preemptBufferFeedSecs = SDL.audio.bufferDurationSecs / 2;
        if (SDL.audio.numAudioTimersPending < SDL.audio.numSimultaneouslyQueuedBuffers) {
          ++SDL.audio.numAudioTimersPending;
          SDL.audio.timer = Browser.safeSetTimeout(SDL.audio.caller,
            Math.max(0, 1e3 * (secsUntilNextPlayStart - preemptBufferFeedSecs)));
          if (SDL.audio.numAudioTimersPending < SDL.audio.numSimultaneouslyQueuedBuffers) {
            ++SDL.audio.numAudioTimersPending;
            Browser.safeSetTimeout(SDL.audio.caller, 1);
          }
        }
      };
      SDL.audio.audioOutput = new Audio;
      SDL.openAudioContext();
      if (!SDL.audioContext) throw new Error('Web Audio API is not available!');
      SDL.audio.nextPlayTime = 0;
      SDL.audio.pushAudio = function(ptr, sizeBytes) {
        try {
          if (SDL.audio.paused) return;
          const sizeSamples = sizeBytes / SDL.audio.bytesPerSample;
          const sizeSamplesPerChannel = sizeSamples / SDL.audio.channels;
          if (sizeSamplesPerChannel !== SDL.audio.samples) {
            throw new Error('Received mismatching audio buffer size!');
          }
          const source = SDL.audioContext.createBufferSource();
          const soundBuffer = SDL.audioContext.createBuffer(SDL.audio.channels,
            sizeSamplesPerChannel, SDL.audio.freq);
          source.connect(SDL.audioContext.destination);
          SDL.fillWebAudioBufferFromHeap(ptr, sizeSamplesPerChannel, soundBuffer);
          source.buffer = soundBuffer;
          const curtime = SDL.audioContext.currentTime;
          const playtime = Math.max(curtime + SDL.audio.bufferingDelay, SDL.audio.nextPlayTime);
          if (typeof source.start !== 'undefined') {
            source.start(playtime);
          } else if (typeof source.noteOn !== 'undefined') {
            source.noteOn(playtime);
          }
          SDL.audio.nextPlayTime = playtime + SDL.audio.bufferDurationSecs;
        } catch (e) {
          console.log(`Web Audio API error playing back audio: ${e.toString()}`);
        }
      };
      if (obtained) {
        Module.HEAP32[obtained >> 2] = SDL.audio.freq;
        Module.HEAP16[obtained + 4 >> 1] = SDL.audio.format;
        Module.HEAP8[obtained + 6 >> 0] = SDL.audio.channels;
        Module.HEAP8[obtained + 7 >> 0] = SDL.audio.silence;
        Module.HEAP16[obtained + 8 >> 1] = SDL.audio.samples;
        Module.HEAP32[obtained + 16 >> 2] = SDL.audio.callback;
        Module.HEAP32[obtained + 20 >> 2] = SDL.audio.userdata;
      }
      SDL.allocateChannels(32);
    } catch (e) {
      console.log(
        `Initializing SDL audio threw an exception: "${e.toString()}"! Continuing without audio.`);

      SDL.audio = null;
      SDL.allocateChannels(0);
      if (obtained) {
        Module.HEAP32[obtained >> 2] = 0;
        Module.HEAP16[obtained + 4 >> 1] = 0;
        Module.HEAP8[obtained + 6 >> 0] = 0;
        Module.HEAP8[obtained + 7 >> 0] = 0;
        Module.HEAP16[obtained + 8 >> 1] = 0;
        Module.HEAP32[obtained + 16 >> 2] = 0;
        Module.HEAP32[obtained + 20 >> 2] = 0;
      }
    }
    if (!SDL.audio) {
      return -1;
    }
    return 0;
  }

  function _SDL_UnlockAudio() {}

  function _uselocale(locale) {
    const old = LOCALE.curr;
    if (locale) LOCALE.curr = locale;
    return old;
  }

  function _rename(old_path, new_path) {
    old_path = Module.Pointer_stringify(old_path);
    new_path = Module.Pointer_stringify(new_path);
    try {
      FS.rename(old_path, new_path);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
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

  function _SDL_MapRGB(fmt, r, g, b) {
    SDL.checkPixelFormat(fmt);
    return r & 255 | (g & 255) << 8 | (b & 255) << 16 | 4278190080;
  }

  function _ftello() {
    return _ftell.apply(null, arguments);
  }

  function _pthread_getspecific(key) {
    return PTHREAD_SPECIFIC[key] || 0;
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

  function _SDL_GetKeyName(key) {
    if (!SDL.keyName) {
      SDL.keyName = Module.allocate(Module.intArrayFromString('unknown key'),
        'i8', Module.ALLOC_NORMAL);
    }
    return SDL.keyName;
  }

  function _pthread_once(ptr, func) {
    if (!_pthread_once.seen) _pthread_once.seen = {};
    if (ptr in _pthread_once.seen) return;
    Runtime.dynCall('v', func);
    _pthread_once.seen[ptr] = 1;
  }

  function _emscripten_asm_const(code) {
    Runtime.getAsmConst(code, 0)();
  }

  function _clearerr(stream) {
    stream = FS.getStreamFromPtr(stream);
    if (!stream) {
      return;
    }
    stream.eof = false;
    stream.error = false;
  }

  function _getc() {
    return _fgetc.apply(null, arguments);
  }

  function _SDL_PollEvent(ptr) {
    return SDL.pollEvent(ptr);
  }

  function _creat(path, mode) {
    return _open(path, 1 | 64 | 512, Module.allocate([mode, 0, 0, 0], 'i32', Module.ALLOC_STACK));
  }

  function _mktemp(template) {
    if (!_mktemp.counter) _mktemp.counter = 0;
    let c = (_mktemp.counter++).toString();
    const rep = 'XXXXXX';
    while (c.length < rep.length) c = `0${c}`;
    Module.writeArrayToMemory(Module.intArrayFromString(c),
      template + Module.Pointer_stringify(template).indexOf(rep));
    return template;
  }

  function _mkstemp(template) {
    return _creat(_mktemp(template), 384);
  }

  function _SDL_CreateRGBSurface(flags, width, height, depth, rmask, gmask, bmask, amask) {
    return SDL
      .makeSurface(width, height, flags, false, 'CreateRGBSurface', rmask, gmask, bmask, amask);
  }

  function _truncate(path, length) {
    if (typeof path !== 'string') path = Module.Pointer_stringify(path);
    try {
      FS.truncate(path, length);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _ftruncate(fildes, length) {
    try {
      FS.ftruncate(fildes, length);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function ___cxa_pure_virtual() {
    Module.ABORT = true;
    throw new Error('Pure virtual function called!');
  }

  function _llvm_trap() {
    Module.abort('trap!');
  }

  function _SDL_JoystickNumAxes(joystick) {
    const gamepad = SDL.getGamepad(joystick - 1);
    if (gamepad) {
      return gamepad.axes.length;
    }
    return 0;
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

  function _closedir(dirp) {
    const fd = _fileno(dirp);
    const stream = FS.getStream(fd);
    if (stream.currReading) stream.currReading = null;
    return _close(fd);
  }

  function _SDL_JoystickEventState(state) {
    if (state < 0) {
      return SDL.joystickEventState;
    }
    return (SDL.joystickEventState = state);
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

  function _SDL_VideoModeOK(width, height, depth, flags) {
    return depth;
  }

  function _SDL_FreeSurface(surf) {
    if (surf) SDL.freeSurface(surf);
  }

  function _time(ptr) {
    const ret = Date.now() / 1e3 | 0;
    if (ptr) {
      Module.HEAP32[ptr >> 2] = ret;
    }
    return ret;
  }

  function _SDL_JoystickUpdate() {
    SDL.queryJoysticks();
  }

  const ___dso_handle = Module.allocate(1, 'i32*', Module.ALLOC_STATIC);

  FS.staticInit();
  __ATINIT__.unshift({ func: () => (!Module.noFSInit && !FS.init.initialized) && FS.init() });
  __ATMAIN__.push({ func: () => FS.ignorePermissions = false });
  __ATEXIT__.push({ func: () => FS.quit() });

  Module.FS_createFolder = FS.createFolder;
  Module.FS_createPath = FS.createPath;
  Module.FS_createDataFile = FS.createDataFile;
  Module.FS_createPreloadedFile = FS.createPreloadedFile;
  Module.FS_createLazyFile = FS.createLazyFile;
  Module.FS_createLink = FS.createLink;
  Module.FS_createDevice = FS.createDevice;
  ___errno_state = Runtime.staticAlloc(4);
  Module.HEAP32[___errno_state >> 2] = 0;
  __ATINIT__.unshift({ func: () => TTY.init() });
  __ATEXIT__.push({ func: () => TTY.shutdown() });

  /*
  if (ENVIRONMENT_IS_NODE) {
    NODEFS.staticInit();
  }
  */

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
  ___buildEnvironment(ENV);
  _fputc.ret = Module.allocate([0], 'i8', Module.ALLOC_STATIC);
  __ATINIT__.push({
    func: () => {
      SOCKFS.root = FS.mount(SOCKFS, {}, null);
    }
  });
  _fgetc.ret = Module.allocate([0], 'i8', Module.ALLOC_STATIC);

  STACK_BASE = STACKTOP = Runtime.alignMemory(STATICTOP);
  STACK_MAX = STACK_BASE + TOTAL_STACK;
  DYNAMIC_BASE = DYNAMICTOP = Runtime.alignMemory(STACK_MAX);
  assert(DYNAMIC_BASE < TOTAL_MEMORY, 'TOTAL_MEMORY not big enough for stack');
  const cttz_i8 = Module.allocate([
    8, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5,
    0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 6, 0,
    1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1,
    0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 7, 0, 1, 0,
    2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2,
    0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 6, 0, 1, 0, 2, 0,
    1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1,
    0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0], 'i8',
    Module.ALLOC_DYNAMIC);

  Module.asmGlobalArg = {
    Math,
    Int8Array,
    Int16Array,
    Int32Array,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    NaN,
    Infinity
  };

  const _llvm_pow_f32 = Math.pow;
  const _ceil = Math.ceil;
  const _cos = Math.cos;
  const _fabsf = Math.abs;
  const _log = Math.log;
  const _llvm_pow_f64 = Math.pow;
  const _tan = Math.tan;
  const _fabs = Math.abs;
  const _floor = Math.floor;
  const _sqrt = Math.sqrt;
  const _sin = Math.sin;
  const _atan2 = Math.atan2;

  Module.asmLibraryArg = {
    abort: Module.abort, assert, invoke_iiii, invoke_viiiiiii, invoke_viiiii, invoke_i, invoke_vi,
    invoke_vii, invoke_iiiiiii, invoke_viiiiiiiii, invoke_ii, invoke_viiiiiid, invoke_viii,
    invoke_viiiiid, invoke_v, invoke_iiiiiiiii, invoke_iiiii, invoke_viiiiiiii, invoke_viiiiii,
    invoke_iii, invoke_iiiiii, invoke_viiii, _fabs, _log, _fread, ___cxa_guard_acquire,
    _SDL_RWFromFile, _fstat, _truncate, __ZSt18uncaught_exceptionv, ___ctype_toupper_loc, __addDays,
    _ftell, _SDL_GetError, _llvm_pow_f64, _emscripten_set_main_loop_timing, _sbrk, _SDL_OpenAudio,
    _SDL_FreeSurface, _Mix_PlayChannel, _TTF_RenderText_Solid, _SDL_JoystickClose, _sysconf, _execl,
    _close, _ferror, _SDL_InitSubSystem, _Mix_PlayMusic, _cos, _readdir, _recv, _SDL_WaitEvent,
    _IMG_Load, _umask, _unlink, _write, __isLeapYear, _fsync, _SDL_GetModState, ___cxa_atexit,
    __exit, _SDL_JoystickOpen, ___cxa_rethrow, _catclose, _Mix_HaltMusic, _TTF_FontHeight, _mknod,
    _mkdir, _closedir, _llvm_trap, __formatString, _TTF_SizeText, _send, _atan2, _SDL_GetTicks,
    _chmod, ___cxa_free_exception, ___cxa_find_matching_catch, _SDL_LockAudio, _Mix_LoadWAV_RW,
    ___cxa_guard_release, _opendir, _SDL_LockSurface, _strerror_r, __reallyNegative, ___setErrNo,
    _creat, _llvm_pow_f32, _newlocale, ___resumeException, _freelocale, _mktime,
    _emscripten_force_exit, _SDL_SetPalette, _pthread_once, _SDL_SetColors, _printf,
    _SDL_JoystickGetButton, _mktemp, _localtime, _execlp, _stat, _SDL_MapRGB, _SDL_CreateRGBSurface,
    _getpwnam, _read, _SDL_SetVideoMode, _fwrite, _time, _pthread_mutex_lock, _SDL_GetKeyName,
    _SDL_UpperBlitScaled, _catopen, _exit, _readdir_r, _putenv, _SDL_ShowCursor, _fgetc, _getcwd,
    ___ctype_b_loc, _lseek, _rename, _access, _vfprintf, _SDL_Delay, _rmdir,
    ___cxa_allocate_exception, ___buildEnvironment, _pwrite, _localtime_r, _tzset, _open, _fabsf,
    _remove, _uselocale, _SDL_Init, _SDL_WM_GrabInput, ___cxa_end_catch, _SDL_Quit, _perror,
    _SDL_JoystickNumHats, ___cxa_begin_catch, _pthread_getspecific, _ftruncate,
    _emscripten_memcpy_big, _fdopen, _putc, _fseek, _SDL_JoystickName, _getenv, _fclose,
    _SDL_UpperBlit, _pthread_key_create, _pthread_cond_broadcast, _SDL_NumJoysticks,
    _SDL_JoystickNumAxes, _tan, _ftello, _SDL_UnlockSurface, _abort, _SDL_Flip, _fopen,
    _SDL_JoystickGetAxis, _floor, _SDL_JoystickEventState, _strftime, _pthread_cond_wait, _sin,
    _SDL_JoystickNumButtons, _emscripten_asm_const, _SDL_UnlockAudio, ___cxa_pure_virtual,
    _SDL_CloseAudio, _ceil, _ungetc, _calloc: Module._calloc, _mkstemp, _SDL_FreeRW, _strftime_l,
    _fprintf, _SDL_PauseAudio, _SDL_PollEvent, _catgets, _strerror, _fileno, _Mix_FreeChunk,
    _SDL_WM_SetCaption, _IMG_Load_RW, __arraySum, _fseeko, _SDL_JoystickUpdate, ___ctype_tolower_loc,
    _SDL_FillRect, _fputs, _pthread_mutex_unlock, _pread, _mkport, _getc, _SDL_AudioQuit, _fflush,
    _emscripten_set_main_loop, ___errno_location, _puts, _SDL_RWFromConstMem, _pthread_setspecific,
    _clearerr, _fputc, ___cxa_throw, _SDL_VideoModeOK, _emscripten_cancel_main_loop, _fgets, _atexit,
    _sqrt, _SDL_JoystickGetHat, STACKTOP, STACK_MAX, tempDoublePtr, ABORT: Module.ABORT, cttz_i8,
    ___dso_handle, _environ, _stderr, _stdin, _stdout
  };

  function invoke_iiii(index, a1, a2, a3) {
    try {
      return Module.dynCall_iiii(index, a1, a2, a3);
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

  function invoke_i(index) {
    try {
      return Module.dynCall_i(index);
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

  function invoke_iiiiiii(index, a1, a2, a3, a4, a5, a6) {
    try {
      return Module.dynCall_iiiiiii(index, a1, a2, a3, a4, a5, a6);
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

  // EMSCRIPTEN_START_ASM
  const asm = require('./asm');

  // EMSCRIPTEN_END_ASM
  Module.___cxa_can_catch = asm.___cxa_can_catch;
  Module._strcat = asm._strcat;

  Module._dosbox_main = asm._dosbox_main;
  Module.___cxa_is_pointer_type = asm.___cxa_is_pointer_type;
  Module._i64Add = asm._i64Add;
  Module._memmove = asm._memmove;
  Module._realloc = asm._realloc;
  Module._strlen = asm._strlen;
  Module._memset = asm._memset;
  Module._free = asm._free;
  Module._malloc = asm._malloc;
  Module._bitshift64Ashr = asm._bitshift64Ashr;
  Module._extract_zip = asm._extract_zip;
  Module._memcpy = asm._memcpy;
  Module._strncpy = asm._strncpy;
  Module._bitshift64Lshr = asm._bitshift64Lshr;
  Module._i64Subtract = asm._i64Subtract;
  Module._strcpy = asm._strcpy;
  Module._llvm_bswap_i32 = asm._llvm_bswap_i32;
  Module._bitshift64Shl = asm._bitshift64Shl;

  const __GLOBAL__sub_I_drives_cpp =
    Module.__GLOBAL__sub_I_drives_cpp = asm.__GLOBAL__sub_I_drives_cpp;
  const __GLOBAL__sub_I_dos_memory_cpp =
    Module.__GLOBAL__sub_I_dos_memory_cpp = asm.__GLOBAL__sub_I_dos_memory_cpp;
  const __GLOBAL__sub_I_dos_misc_cpp =
    Module.__GLOBAL__sub_I_dos_misc_cpp = asm.__GLOBAL__sub_I_dos_misc_cpp;
  const __GLOBAL__sub_I_shell_misc_cpp =
    Module.__GLOBAL__sub_I_shell_misc_cpp = asm.__GLOBAL__sub_I_shell_misc_cpp;
  const __GLOBAL__sub_I_shell_cpp =
    Module.__GLOBAL__sub_I_shell_cpp = asm.__GLOBAL__sub_I_shell_cpp;
  const __GLOBAL__sub_I_programs_cpp =
    Module.__GLOBAL__sub_I_programs_cpp = asm.__GLOBAL__sub_I_programs_cpp;
  const __GLOBAL__sub_I_messages_cpp =
    Module.__GLOBAL__sub_I_messages_cpp = asm.__GLOBAL__sub_I_messages_cpp;
  const __GLOBAL__sub_I_setup_cpp =
    Module.__GLOBAL__sub_I_setup_cpp = asm.__GLOBAL__sub_I_setup_cpp;
  const __GLOBAL__sub_I_sdl_mapper_cpp =
    Module.__GLOBAL__sub_I_sdl_mapper_cpp = asm.__GLOBAL__sub_I_sdl_mapper_cpp;
  const __GLOBAL__sub_I_cpu_cpp =
    Module.__GLOBAL__sub_I_cpu_cpp = asm.__GLOBAL__sub_I_cpu_cpp;
  const __GLOBAL__sub_I_vga_memory_cpp =
    Module.__GLOBAL__sub_I_vga_memory_cpp = asm.__GLOBAL__sub_I_vga_memory_cpp;
  const __GLOBAL__sub_I_hardware_cpp =
    Module.__GLOBAL__sub_I_hardware_cpp = asm.__GLOBAL__sub_I_hardware_cpp;
  const __GLOBAL__sub_I_iostream_cpp =
    Module.__GLOBAL__sub_I_iostream_cpp = asm.__GLOBAL__sub_I_iostream_cpp;

  Module.runPostSets = asm.runPostSets;
  Module.dynCall_iiii = asm.dynCall_iiii;
  Module.dynCall_viiiiiii = asm.dynCall_viiiiiii;
  Module.dynCall_viiiii = asm.dynCall_viiiii;
  Module.dynCall_i = asm.dynCall_i;
  Module.dynCall_vi = asm.dynCall_vi;
  Module.dynCall_vii = asm.dynCall_vii;
  Module.dynCall_iiiiiii = asm.dynCall_iiiiiii;
  Module.dynCall_viiiiiiiii = asm.dynCall_viiiiiiiii;
  Module.dynCall_ii = asm.dynCall_ii;
  Module.dynCall_viiiiiid = asm.dynCall_viiiiiid;
  Module.dynCall_viii = asm.dynCall_viii;
  Module.dynCall_viiiiid = asm.dynCall_viiiiid;
  Module.dynCall_v = asm.dynCall_v;
  Module.dynCall_iiiiiiiii = asm.dynCall_iiiiiiiii;
  Module.dynCall_iiiii = asm.dynCall_iiiii;
  Module.dynCall_viiiiiiii = asm.dynCall_viiiiiiii;
  Module.dynCall_viiiiii = asm.dynCall_viiiiii;
  Module.dynCall_iii = asm.dynCall_iii;
  Module.dynCall_iiiiii = asm.dynCall_iiiiii;
  Module.dynCall_viiii = asm.dynCall_viiii;

  Runtime.stackAlloc = asm.stackAlloc;
  Runtime.stackSave = asm.stackSave;
  Runtime.stackRestore = asm.stackRestore;
  Runtime.setTempRet0 = asm.setTempRet0;
  Runtime.getTempRet0 = asm.getTempRet0;

  if (memoryInitializer) {
    const data = Module.readBinary(memoryInitializer);
    Module.HEAPU8.set(data, STATIC_BASE);
  }

  let initialStackTop;
  let preloadStartTime = null;

  dependenciesFulfilled = function runCaller() {
    if (!Module.calledRun && shouldRunNow) Module.run();
    if (!Module.calledRun) dependenciesFulfilled = runCaller;
  };

  Module.callMain = function callMain(args) {
    assert(runDependencies === 0,
      'cannot call main when async dependencies remain! (listen on __ATMAIN__)');
    assert(__ATPRERUN__.length === 0, 'cannot call main when preRun functions remain to be called');
    args = args || [];
    ensureInitRuntime();

    const argc = args.length + 1;
    let argv = [Module.allocate(Module.intArrayFromString(Module.thisProgram),
      'i8', Module.ALLOC_NORMAL)];

    function pad() {
      for (let i = 0; i < 4 - 1; i++) {
        argv.push(0);
      }
    }

    pad();

    for (let i = 0; i < argc - 1; i = i + 1) {
      argv.push(Module.allocate(Module.intArrayFromString(args[i]), 'i8', Module.ALLOC_NORMAL));
      pad();
    }

    argv.push(0);
    argv = Module.allocate(argv, 'i32', Module.ALLOC_NORMAL);

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
      if (Module._main && shouldRunNow) Module.callMain(args);
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

  Module.exit = function exit(status) {
    if (Module.noExitRuntime) {
      return;
    }
    Module.ABORT = true;
    STACKTOP = initialStackTop;
    exitRuntime();
  };

  if (Module.preInit) {
    if (typeof Module.preInit === 'function') Module.preInit = [Module.preInit];
    while (Module.preInit.length > 0) {
      Module.preInit.pop()();
    }
  }

  let shouldRunNow = true;
  if (Module.noInitialRun) {
    shouldRunNow = false;
  }

  Module.run();

  return Module;
};

