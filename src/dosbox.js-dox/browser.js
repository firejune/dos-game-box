'use strict';

const assert = require('./helpers/assert');
const ExitStatus = require('./helpers/ExitStatus');
const GL = require('./system/GL');

module.exports = function(_emscripten_set_main_loop, _emscripten_set_main_loop_timing) {
  const Browser = {
    mainLoop: {
      scheduler: null,
      method: '',
      currentlyRunningMainloop: 0,
      func: null,
      arg: 0,
      timingMode: 0,
      timingValue: 0,
      currentFrameNumber: 0,
      queue: [],
      pause() {
        Browser.mainLoop.scheduler = null;
        Browser.mainLoop.currentlyRunningMainloop++;
      },
      resume() {
        Browser.mainLoop.currentlyRunningMainloop++;
        const timingMode = Browser.mainLoop.timingMode;
        const timingValue = Browser.mainLoop.timingValue;
        const func = Browser.mainLoop.func;
        Browser.mainLoop.func = null;
        _emscripten_set_main_loop(func, 0, false, Browser.mainLoop.arg);
        _emscripten_set_main_loop_timing(timingMode, timingValue);
      },
      updateStatus() {
        if (Module.setStatus) {
          const message = Module.statusMessage || 'Please wait...';
          const remaining = Browser.mainLoop.remainingBlockers;
          const expected = Browser.mainLoop.expectedBlockers;
          if (remaining) {
            if (remaining < expected) {
              Module.setStatus(`${message} (${expected - remaining}/${expected})`);
            } else {
              Module.setStatus(message);
            }
          } else {
            Module.setStatus('');
          }
        }
      },
      runIter(func) {
        if (Module.ABORT) return;
        if (Module.preMainLoop) {
          const preRet = Module.preMainLoop();
          if (preRet === false) {
            return;
          }
        }
        try {
          func();
        } catch (e) {
          if (e instanceof ExitStatus) {
            return;
          } else if (e.message === 'SimulateInfiniteLoop') {
            return;
          }
          if (e && typeof e === 'object' && e.stack) {
            Module.printErr(`exception thrown: ${[e, e.stack]}`);
          }
          throw e;
        }
        if (Module.postMainLoop) Module.postMainLoop();
      }
    },
    isFullScreen: false,
    pointerLock: false,
    moduleContextCreatedCallbacks: [],
    workers: [],
    init() {
      if (!Module.preloadPlugins) Module.preloadPlugins = [];
      if (Browser.initted) return;
      Browser.initted = true;
      try {
        new Blob;
        Browser.hasBlobConstructor = true;
      } catch (e) {
        Browser.hasBlobConstructor = false;
        console.log('warning: no blob constructor, cannot create blobs with mimetypes');
      }

      Browser.BlobBuilder = typeof window.WebKitBlobBuilder !== 'undefined'
        ? window.WebKitBlobBuilder : !Browser.hasBlobConstructor
          ? console.log('warning: no BlobBuilder') : null;

      Browser.URLObject = typeof window !== 'undefined'
        ? window.URL
          ? window.URL
          : window.webkitURL
        : undefined;

      if (!Module.noImageDecoding && typeof Browser.URLObject === 'undefined') {
        console.log('warning: Browser does not support creating object URLs. Built-in browser ' +
          'image decoding will not be available.');
        Module.noImageDecoding = true;
      }
      const imagePlugin = {};
      imagePlugin.canHandle = function imagePlugin_canHandle(name) {
        return !Module.noImageDecoding && /\.(jpg|jpeg|png|bmp)$/i.test(name);
      };
      imagePlugin.handle = function imagePlugin_handle(byteArray, name, onload, onerror) {
        let b = null;
        if (Browser.hasBlobConstructor) {
          try {
            b = new Blob([byteArray], {
              type: Browser.getMimetype(name)
            });
            if (b.size !== byteArray.length) {
              b = new Blob([(new Uint8Array(byteArray)).buffer], {
                type: Browser.getMimetype(name)
              });
            }
          } catch (e) {
            Module.Runtime.warnOnce(
              `Blob constructor present but fails: ${e}; falling back to blob builder`);
          }
        }
        if (!b) {
          const bb = new Browser.BlobBuilder;
          bb.append((new Uint8Array(byteArray)).buffer);
          b = bb.getBlob();
        }
        const url = Browser.URLObject.createObjectURL(b);
        const img = new Image;
        img.onload = function img_onload() {
          assert(img.complete, `Image ${name} could not be decoded`);
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          Module.preloadedImages[name] = canvas;
          Browser.URLObject.revokeObjectURL(url);
          if (onload) onload(byteArray);
        };
        img.onerror = function img_onerror(event) {
          console.log(`Image ${url} could not be decoded`);
          if (onerror) onerror();
        };
        img.src = url;
      };
      Module.preloadPlugins.push(imagePlugin);
      const audioPlugin = {};
      audioPlugin.canHandle = function audioPlugin_canHandle(name) {
        return !Module.noAudioDecoding && name.substr(-4) in {
          '.ogg': 1,
          '.wav': 1,
          '.mp3': 1
        };
      };
      audioPlugin.handle = function audioPlugin_handle(byteArray, name, onload, onerror) {
        let done = false;

        function finish(audio) {
          if (done) return;
          done = true;
          Module.preloadedAudios[name] = audio;
          if (onload) onload(byteArray);
        }

        function fail() {
          if (done) return;
          done = true;
          Module.preloadedAudios[name] = new Audio;
          if (onerror) onerror();
        }
        if (Browser.hasBlobConstructor) {
          let b;
          try {
            b = new Blob([byteArray], {
              type: Browser.getMimetype(name)
            });
          } catch (e) {
            return fail();
          }
          const url = Browser.URLObject.createObjectURL(b);
          const audio = new Audio;
          audio.addEventListener('canplaythrough', () => {
            finish(audio);
          }, false);
          audio.onerror = function audio_onerror(event) {
            if (done) return;
            console.log(
              `warning: browser could not fully decode audio ${name},
              trying slower base64 approach`);

            function encode64(data) {
              const BASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
              const PAD = '=';
              let ret = '';
              let leftchar = 0;
              let leftbits = 0;
              for (let i = 0; i < data.length; i++) {
                leftchar = leftchar << 8 | data[i];
                leftbits += 8;
                while (leftbits >= 6) {
                  const curr = leftchar >> leftbits - 6 & 63;
                  leftbits -= 6;
                  ret += BASE[curr];
                }
              }
              if (leftbits === 2) {
                ret += BASE[(leftchar & 3) << 4];
                ret += PAD + PAD;
              } else if (leftbits === 4) {
                ret += BASE[(leftchar & 15) << 2];
                ret += PAD;
              }
              return ret;
            }
            audio.src = `data:audio/x-${name.substr(-3)};base64,${encode64(byteArray)}`;
            finish(audio);
          };
          audio.src = url;
          Browser.safeSetTimeout(() => finish(audio), 1e4);
        } else {
          return fail();
        }
      };
      Module.preloadPlugins.push(audioPlugin);
      const canvas = Module.canvas;

      function pointerLockChange() {
        Browser.pointerLock = document.pointerLockElement === canvas
          || document.webkitPointerLockElement === canvas;
      }
      if (canvas) {
        canvas.requestPointerLock = canvas.requestPointerLock
          || canvas.webkitRequestPointerLock || function() {};
        canvas.exitPointerLock = document.exitPointerLock
          || document.webkitExitPointerLock || function() {};
        canvas.exitPointerLock = canvas.exitPointerLock.bind(document);
        document.addEventListener('pointerlockchange', pointerLockChange, false);
        document.addEventListener('webkitpointerlockchange', pointerLockChange, false);
        if (Module.elementPointerLock) {
          canvas.addEventListener('click', ev => {
            if (!Browser.pointerLock && canvas.requestPointerLock) {
              canvas.requestPointerLock();
              ev.preventDefault();
            }
          }, false);
        }
      }
    },
    createContext(canvas, useWebGL, setInModule, webGLContextAttributes) {
      if (useWebGL && Module.ctx && canvas === Module.canvas) return Module.ctx;
      let ctx;
      let contextHandle;
      if (useWebGL) {
        const contextAttributes = { antialias: false, alpha: false };
        if (webGLContextAttributes) {
          for (const attribute in webGLContextAttributes) {
            contextAttributes[attribute] = webGLContextAttributes[attribute];
          }
        }
        contextHandle = GL.createContext(canvas, contextAttributes);
        if (contextHandle) {
          ctx = GL.getContext(contextHandle).GLctx;
        }
        canvas.style.backgroundColor = 'black';
      } else {
        ctx = canvas.getContext('2d');
      }
      if (!ctx) return null;

      if (setInModule) {
        if (!useWebGL) {
          assert(typeof GL.ctx === 'undefined',
            'cannot set in module if GL.ctx is used, but we are a non-GL ' +
            'context that would replace it');
        }
        Module.ctx = ctx;
        if (useWebGL) GL.makeContextCurrent(contextHandle);

        Module.useWebGL = useWebGL;
        Browser.moduleContextCreatedCallbacks.forEach(callback => callback());
        Browser.init();
      }
      return ctx;
    },
    destroyContext(canvas, useWebGL, setInModule) {},
    fullScreenHandlersInstalled: false,
    lockPointer: undefined,
    resizeCanvas: undefined,
    requestFullScreen(lockPointer, resizeCanvas) {
      Browser.lockPointer = lockPointer;
      Browser.resizeCanvas = resizeCanvas;
      if (typeof Browser.lockPointer === 'undefined') Browser.lockPointer = true;
      if (typeof Browser.resizeCanvas === 'undefined') Browser.resizeCanvas = false;
      const canvas = Module.canvas;

      function fullScreenChange() {
        Browser.isFullScreen = false;
        const canvasContainer = canvas.parentNode;
        if ((document.webkitFullScreenElement || document.webkitFullscreenElement
          || document.fullScreenElement || document.fullscreenElement
          || document.webkitCurrentFullScreenElement) === canvasContainer) {
          canvas.cancelFullScreen = document.cancelFullScreen || document.webkitCancelFullScreen
          || document.exitFullscreen || function() {};
          canvas.cancelFullScreen = canvas.cancelFullScreen.bind(document);
          if (Browser.lockPointer) canvas.requestPointerLock();
          Browser.isFullScreen = true;
          if (Browser.resizeCanvas) Browser.setFullScreenCanvasSize();
        } else {
          canvasContainer.parentNode.insertBefore(canvas, canvasContainer);
          canvasContainer.parentNode.removeChild(canvasContainer);
          if (Browser.resizeCanvas) Browser.setWindowedCanvasSize();
        }
        if (Module.onFullScreen) Module.onFullScreen(Browser.isFullScreen);
        Browser.updateCanvasDimensions(canvas);
      }
      if (!Browser.fullScreenHandlersInstalled) {
        Browser.fullScreenHandlersInstalled = true;
        document.addEventListener('fullscreenchange', fullScreenChange, false);
        document.addEventListener('mozfullscreenchange', fullScreenChange, false);
        document.addEventListener('webkitfullscreenchange', fullScreenChange, false);
        document.addEventListener('MSFullscreenChange', fullScreenChange, false);
      }
      const canvasContainer = document.createElement('div');
      canvas.parentNode.insertBefore(canvasContainer, canvas);
      canvasContainer.appendChild(canvas);
      canvasContainer.requestFullScreen = canvasContainer.requestFullScreen
        || (canvasContainer.webkitRequestFullScreen ? function() {
          canvasContainer.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
        } : null);
      canvasContainer.requestFullScreen();
    },
    nextRAF: 0,
    fakeRequestAnimationFrame(func) {
      const now = Date.now();
      if (Browser.nextRAF === 0) {
        Browser.nextRAF = now + 1e3 / 60;
      } else {
        while (now + 2 >= Browser.nextRAF) {
          Browser.nextRAF += 1e3 / 60;
        }
      }
      const delay = Math.max(Browser.nextRAF - now, 0);
      setTimeout(func, delay);
    },
    requestAnimationFrame(func) {
      if (typeof window === 'undefined') {
        Browser.fakeRequestAnimationFrame(func);
      } else {
        if (!window.requestAnimationFrame) {
          window.requestAnimationFrame = window.requestAnimationFrame
            || window.webkitRequestAnimationFrame || Browser.fakeRequestAnimationFrame;
        }
        window.requestAnimationFrame(func);
      }
    },
    safeCallback(func) {
      return function() {
        if (!Module.ABORT) return func.apply(null, arguments);
      };
    },
    safeRequestAnimationFrame(func) {
      return Browser.requestAnimationFrame(() => {
        if (!Module.ABORT) func();
      });
    },
    safeSetTimeout(func, timeout) {
      Module.noExitRuntime = true;
      return setTimeout(() => {
        if (!Module.ABORT) func();
      }, timeout);
    },
    safeSetInterval(func, timeout) {
      Module.noExitRuntime = true;
      return setInterval(() => {
        if (!Module.ABORT) func();
      }, timeout);
    },
    getMimetype(name) {
      return {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        bmp: 'image/bmp',
        ogg: 'audio/ogg',
        wav: 'audio/wav',
        mp3: 'audio/mpeg'
      }[name.substr(name.lastIndexOf('.') + 1)];
    },
    getUserMedia(func) {
      if (!window.getUserMedia) {
        window.getUserMedia = navigator.getUserMedia || navigator.mozGetUserMedia;
      }
      window.getUserMedia(func);
    },
    getMovementX(event) {
      return event.movementX || event.mozMovementX || event.webkitMovementX || 0;
    },
    getMovementY(event) {
      return event.movementY || event.mozMovementY || event.webkitMovementY || 0;
    },
    getMouseWheelDelta(event) {
      let delta = 0;
      switch (event.type) {
        case 'DOMMouseScroll':
          delta = event.detail;
          break;
        case 'mousewheel':
          delta = event.wheelDelta;
          break;
        case 'wheel':
          delta = event.deltaY;
          break;
        default:
          throw new Error(`unrecognized mouse wheel event: ${event.type}`);
      }
      return delta;
    },
    mouseX: 0,
    mouseY: 0,
    mouseMovementX: 0,
    mouseMovementY: 0,
    touches: {},
    lastTouches: {},
    calculateMouseEvent(event) {
      if (Browser.pointerLock) {
        if (event.type !== 'mousemove' && 'mozMovementX' in event) {
          Browser.mouseMovementX = Browser.mouseMovementY = 0;
        } else {
          Browser.mouseMovementX = Browser.getMovementX(event);
          Browser.mouseMovementY = Browser.getMovementY(event);
        }
        // FIXED NaN error
        if (typeof Module.SDL !== 'undefined' && Module.SDL.mouseX !== undefined
          && Module.SDL.mouseX !== undefined) {
          Browser.mouseX = Module.SDL.mouseX + Browser.mouseMovementX;
          Browser.mouseY = Module.SDL.mouseY + Browser.mouseMovementY;
        } else {
          Browser.mouseX += Browser.mouseMovementX;
          Browser.mouseY += Browser.mouseMovementY;
        }
      } else {
        const rect = Module.canvas.getBoundingClientRect();
        const cw = Module.canvas.width;
        const ch = Module.canvas.height;
        const scrollX = typeof window.scrollX !== 'undefined' ? window.scrollX : window.pageXOffset;
        const scrollY = typeof window.scrollY !== 'undefined' ? window.scrollY : window.pageYOffset;
        if (event.type === 'touchstart' || event.type === 'touchend'
          || event.type === 'touchmove') {
          const touch = event.touch;
          if (touch === undefined) {
            return;
          }
          let adjustedX = touch.pageX - (scrollX + rect.left);
          let adjustedY = touch.pageY - (scrollY + rect.top);
          adjustedX = adjustedX * (cw / rect.width);
          adjustedY = adjustedY * (ch / rect.height);
          const coords = {
            x: adjustedX,
            y: adjustedY
          };
          if (event.type === 'touchstart') {
            Browser.lastTouches[touch.identifier] = coords;
            Browser.touches[touch.identifier] = coords;
          } else if (event.type === 'touchend' || event.type === 'touchmove') {
            Browser.lastTouches[touch.identifier] = Browser.touches[touch.identifier];
            Browser.touches[touch.identifier] = {
              x: adjustedX,
              y: adjustedY
            };
          }
          return;
        }
        let x = event.pageX - (scrollX + rect.left);
        let y = event.pageY - (scrollY + rect.top);
        x = x * (cw / rect.width);
        y = y * (ch / rect.height);
        Browser.mouseMovementX = x - Browser.mouseX;
        Browser.mouseMovementY = y - Browser.mouseY;
        Browser.mouseX = x;
        Browser.mouseY = y;
      }
    },
    xhrLoad(url, onload, onerror) {
      const xhr = new XMLHttpRequest;
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function xhr_onload() {
        if (xhr.status === 200 || xhr.status === 0 && xhr.response) {
          onload(xhr.response);
        } else {
          onerror();
        }
      };
      xhr.onerror = onerror;
      xhr.send(null);
    },
    asyncLoad(url, onload, onerror, noRunDep) {
      Browser.xhrLoad(url, arrayBuffer => {
        assert(arrayBuffer, `Loading data file "${url}" failed (no arrayBuffer).`);
        onload(new Uint8Array(arrayBuffer));
        if (!noRunDep) Module.removeRunDependency(`al ${url}`);
      }, event => {
        if (onerror) {
          onerror();
        } else {
          throw new Error(`Loading data file "${url}" failed.`);
        }
      });
      if (!noRunDep) Module.addRunDependency(`al ${url}`);
    },
    resizeListeners: [],
    updateResizeListeners() {
      const canvas = Module.canvas;
      Browser.resizeListeners.forEach(listener => {
        listener(canvas.width, canvas.height);
      });
    },
    setCanvasSize(width, height, noUpdates) {
      const canvas = Module.canvas;
      Browser.updateCanvasDimensions(canvas, width, height);
      if (!noUpdates) Browser.updateResizeListeners();
    },
    windowedWidth: 0,
    windowedHeight: 0,
    setFullScreenCanvasSize() {
      if (typeof Module.SDL !== 'undefined') {
        let flags = Module.HEAPU32[Module.SDL.screen + Module.Runtime.QUANTUM_SIZE * 0 >> 2];
        flags = flags | 8388608;
        Module.HEAP32[Module.SDL.screen + Module.Runtime.QUANTUM_SIZE * 0 >> 2] = flags;
      }
      Browser.updateResizeListeners();
    },
    setWindowedCanvasSize() {
      if (typeof Module.SDL !== 'undefined') {
        let flags = Module.HEAPU32[Module.SDL.screen + Module.Runtime.QUANTUM_SIZE * 0 >> 2];
        flags = flags & ~8388608;
        Module.HEAP32[Module.SDL.screen + Module.Runtime.QUANTUM_SIZE * 0 >> 2] = flags;
      }
      Browser.updateResizeListeners();
    },
    updateCanvasDimensions(canvas, wNative, hNative) {
      if (wNative && hNative) {
        canvas.widthNative = wNative;
        canvas.heightNative = hNative;
      } else {
        wNative = canvas.widthNative;
        hNative = canvas.heightNative;
      }
      let w = wNative;
      let h = hNative;
      if (Module.forcedAspectRatio && Module.forcedAspectRatio > 0) {
        if (w / h < Module.forcedAspectRatio) {
          w = Math.round(h * Module.forcedAspectRatio);
        } else {
          h = Math.round(w / Module.forcedAspectRatio);
        }
      }
      if ((document.webkitFullScreenElement || document.webkitFullscreenElement
        || document.fullScreenElement || document.fullscreenElement
        || document.webkitCurrentFullScreenElement) === canvas.parentNode
        && typeof screen !== 'undefined') {
        const factor = Math.min(screen.width / w, screen.height / h);
        w = Math.round(w * factor);
        h = Math.round(h * factor);
      }
      if (Browser.resizeCanvas) {
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        if (typeof canvas.style !== 'undefined') {
          canvas.style.removeProperty('width');
          canvas.style.removeProperty('height');
        }
      } else {
        if (canvas.width !== wNative) canvas.width = wNative;
        if (canvas.height !== hNative) canvas.height = hNative;
        if (typeof canvas.style !== 'undefined') {
          if (w !== wNative || h !== hNative) {
            canvas.style.setProperty('width', `${w}px`, 'important');
            canvas.style.setProperty('height', `${h}px`, 'important');
          } else {
            canvas.style.removeProperty('width');
            canvas.style.removeProperty('height');
          }
        }
      }

      Module.dimensionsUpdate && Module.dimensionsUpdate(w, h);
    },
    wgetRequests: {},
    nextWgetRequestHandle: 0,
    getNextWgetRequestHandle() {
      const handle = Browser.nextWgetRequestHandle;
      Browser.nextWgetRequestHandle++;
      return handle;
    }
  };

  GL.init();

  return Browser;
};
