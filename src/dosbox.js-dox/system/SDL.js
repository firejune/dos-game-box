'use strict';

module.exports = function(Browser, _SDL_LockSurface, _SDL_GetTicks) {
  const SDL = {
    defaults: {
      width: 320,
      height: 200,
      copyOnLock: true,
      discardOnLock: false,
      opaqueFrontBuffer: true
    },
    version: null,
    surfaces: {},
    canvasPool: [],
    events: [],
    fonts: [null],
    audios: [null],
    rwops: [null],
    music: {
      audio: null,
      volume: 1
    },
    mixerFrequency: 22050,
    mixerFormat: 32784,
    mixerNumChannels: 2,
    mixerChunkSize: 1024,
    channelMinimumNumber: 0,
    GL: false,
    glAttributes: {
      0: 3, 1: 3, 2: 2, 3: 0, 4: 0, 5: 1, 6: 16, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0,
      14: 0, 15: 1, 16: 0, 17: 0, 18: 0
    },
    keyboardState: null,
    keyboardMap: {},
    canRequestFullscreen: false,
    isRequestingFullscreen: false,
    textInput: false,
    startTime: null,
    initFlags: 0,
    buttonState: 0,
    modState: 0,
    DOMButtons: [0, 0, 0],
    DOMEventToSDLEvent: {},
    TOUCH_DEFAULT_ID: 0,
    eventHandler: null,
    eventHandlerContext: null,
    keyCodes: {
      16: 1249, 17: 1248, 18: 1250, 20: 1081, 33: 1099, 34: 1102, 35: 1101, 36: 1098, 37: 1104,
      38: 1106, 39: 1103, 40: 1105, 44: 316, 45: 1097, 46: 127, 91: 1251, 93: 1125, 96: 1122,
      97: 1113, 98: 1114, 99: 1115, 100: 1116, 101: 1117, 102: 1118, 103: 1119, 104: 1120,
      105: 1121, 106: 1109, 107: 1111, 109: 1110, 110: 1123, 111: 1108, 112: 1082, 113: 1083,
      114: 1084, 115: 1085, 116: 1086, 117: 1087, 118: 1088, 119: 1089, 120: 1090, 121: 1091,
      122: 1092, 123: 1093, 124: 1128, 125: 1129, 126: 1130, 127: 1131, 128: 1132, 129: 1133,
      130: 1134, 131: 1135, 132: 1136, 133: 1137, 134: 1138, 135: 1139, 144: 1107, 160: 94,
      161: 33, 162: 34, 163: 35, 164: 36, 165: 37, 166: 38, 167: 95, 168: 40, 169: 41, 170: 42,
      171: 43, 172: 124, 173: 45, 174: 123, 175: 125, 176: 126, 181: 127, 182: 129, 183: 128,
      188: 44, 190: 46, 191: 47, 192: 96, 219: 91, 220: 92, 221: 93, 222: 39
    },
    scanCodes: {
      8: 42, 9: 43, 13: 40, 27: 41, 32: 44, 35: 204, 39: 53, 44: 54, 46: 55, 47: 56, 48: 39,
      49: 30, 50: 31, 51: 32, 52: 33, 53: 34, 54: 35, 55: 36, 56: 37, 57: 38, 58: 203, 59: 51,
      61: 46, 91: 47, 92: 49, 93: 48, 96: 52, 97: 4, 98: 5, 99: 6, 100: 7, 101: 8, 102: 9, 103: 10,
      104: 11, 105: 12, 106: 13, 107: 14, 108: 15, 109: 16, 110: 17, 111: 18, 112: 19, 113: 20,
      114: 21, 115: 22, 116: 23, 117: 24, 118: 25, 119: 26, 120: 27, 121: 28, 122: 29, 127: 76,
      305: 224, 308: 226, 316: 70
    },
    loadRect(rect) {
      return {
        x: Module.HEAP32[rect + 0 >> 2],
        y: Module.HEAP32[rect + 4 >> 2],
        w: Module.HEAP32[rect + 8 >> 2],
        h: Module.HEAP32[rect + 12 >> 2]
      };
    },
    updateRect(rect, r) {
      Module.HEAP32[rect >> 2] = r.x;
      Module.HEAP32[rect + 4 >> 2] = r.y;
      Module.HEAP32[rect + 8 >> 2] = r.w;
      Module.HEAP32[rect + 12 >> 2] = r.h;
    },
    intersectionOfRects(first, second) {
      const leftX = Math.max(first.x, second.x);
      const leftY = Math.max(first.y, second.y);
      const rightX = Math.min(first.x + first.w, second.x + second.w);
      const rightY = Math.min(first.y + first.h, second.y + second.h);
      return {
        x: leftX,
        y: leftY,
        w: Math.max(leftX, rightX) - leftX,
        h: Math.max(leftY, rightY) - leftY
      };
    },
    checkPixelFormat(fmt) {},
    loadColorToCSSRGB(color) {
      const rgba = Module.HEAP32[color >> 2];
      return `rgb(${rgba & 255},${rgba >> 8 & 255},${rgba >> 16 & 255})`;
    },
    loadColorToCSSRGBA(color) {
      const rgba = Module.HEAP32[color >> 2];
      return `rgba(${rgba & 255},${rgba >> 8 & 255},${rgba >> 16 & 255},${(rgba >> 24 & 255) / 255})`;
    },
    translateColorToCSSRGBA(rgba) {
      return `rgba(${rgba & 255},${rgba >> 8 & 255},${rgba >> 16 & 255},${(rgba >>> 24) / 255})`;
    },
    translateRGBAToCSSRGBA(r, g, b, a) {
      return `rgba(${r & 255},${g & 255},${b & 255},${(a & 255) / 255})`;
    },
    translateRGBAToColor(r, g, b, a) {
      return r | g << 8 | b << 16 | a << 24;
    },
    makeSurface(width, height, flags, usePageCanvas, source, rmask, gmask, bmask, amask) {
      flags = flags || 0;
      const is_SDL_HWSURFACE = flags & 1;
      const is_SDL_HWPALETTE = flags & 2097152;
      const is_SDL_OPENGL = flags & 67108864;
      const surf = Module._malloc(60);
      const pixelFormat = Module._malloc(44);
      const bpp = is_SDL_HWPALETTE ? 1 : 4;
      let buffer = 0;
      if (!is_SDL_HWSURFACE && !is_SDL_OPENGL) {
        buffer = Module._malloc(width * height * 4);
      }
      Module.HEAP32[surf >> 2] = flags;
      Module.HEAP32[surf + 4 >> 2] = pixelFormat;
      Module.HEAP32[surf + 8 >> 2] = width;
      Module.HEAP32[surf + 12 >> 2] = height;
      Module.HEAP32[surf + 16 >> 2] = width * bpp;
      Module.HEAP32[surf + 20 >> 2] = buffer;
      Module.HEAP32[surf + 36 >> 2] = 0;
      Module.HEAP32[surf + 40 >> 2] = 0;
      Module.HEAP32[surf + 44 >> 2] = Module.canvas.width;
      Module.HEAP32[surf + 48 >> 2] = Module.canvas.height;
      Module.HEAP32[surf + 56 >> 2] = 1;
      Module.HEAP32[pixelFormat >> 2] = -2042224636;
      Module.HEAP32[pixelFormat + 4 >> 2] = 0;
      Module.HEAP8[pixelFormat + 8 >> 0] = bpp * 8;
      Module.HEAP8[pixelFormat + 9 >> 0] = bpp;
      Module.HEAP32[pixelFormat + 12 >> 2] = rmask || 255;
      Module.HEAP32[pixelFormat + 16 >> 2] = gmask || 65280;
      Module.HEAP32[pixelFormat + 20 >> 2] = bmask || 16711680;
      Module.HEAP32[pixelFormat + 24 >> 2] = amask || 4278190080;
      SDL.GL = SDL.GL || is_SDL_OPENGL;
      let canvas;
      if (!usePageCanvas) {
        if (SDL.canvasPool.length > 0) {
          canvas = SDL.canvasPool.pop();
        } else {
          canvas = document.createElement('canvas');
        }
        const err = new Error('+');
        console.log('setting width to', width, height, err.stack);
        canvas.width = width;
        canvas.height = height;
      } else {
        canvas = Module.canvas;
      }
      const webGLContextAttributes = {
        antialias: SDL.glAttributes[13] !== 0 && SDL.glAttributes[14] > 1,
        depth: SDL.glAttributes[6] > 0,
        stencil: SDL.glAttributes[7] > 0
      };

      const ctx = Browser.createContext(canvas, is_SDL_OPENGL, usePageCanvas,
        webGLContextAttributes);
      SDL.surfaces[surf] = {
        width,
        height,
        canvas,
        ctx,
        surf,
        buffer,
        pixelFormat,
        alpha: 255,
        flags,
        locked: 0,
        usePageCanvas,
        source,
        isFlagSet: flag => flags & flag
      };
      return surf;
    },
    copyIndexedColorData(surfData, rX, rY, rW, rH) {
      if (!surfData.colors) {
        return;
      }
      const fullWidth = Module.canvas.width;
      const fullHeight = Module.canvas.height;
      const startX = rX || 0;
      const startY = rY || 0;
      const endX = (rW || fullWidth - startX) + startX;
      const endY = (rH || fullHeight - startY) + startY;
      const buffer = surfData.buffer;
      if (!surfData.image.data32) {
        surfData.image.data32 = new Uint32Array(surfData.image.data.buffer);
      }
      const data32 = surfData.image.data32;
      const colors32 = surfData.colors32;
      for (let y = startY; y < endY; ++y) {
        const base = y * fullWidth;
        for (let x = startX; x < endX; ++x) {
          data32[base + x] = colors32[Module.HEAPU8[buffer + base + x >> 0]];
        }
      }
    },
    freeSurface(surf) {
      const refcountPointer = surf + 56;
      const refcount = Module.HEAP32[refcountPointer >> 2];
      if (refcount > 1) {
        Module.HEAP32[refcountPointer >> 2] = refcount - 1;
        return;
      }
      const info = SDL.surfaces[surf];
      if (!info.usePageCanvas && info.canvas) SDL.canvasPool.push(info.canvas);
      if (info.buffer) Module._free(info.buffer);
      Module._free(info.pixelFormat);
      Module._free(surf);
      SDL.surfaces[surf] = null;
      if (surf === SDL.screen) {
        SDL.screen = null;
      }
    },
    blitSurface__deps: ['SDL_LockSurface'],
    blitSurface(src, srcrect, dst, dstrect, scale) {
      const srcData = SDL.surfaces[src];
      const dstData = SDL.surfaces[dst];
      let sr;
      let dr;
      if (srcrect) {
        sr = SDL.loadRect(srcrect);
      } else {
        sr = {
          x: 0,
          y: 0,
          w: srcData.width,
          h: srcData.height
        };
      }
      if (dstrect) {
        dr = SDL.loadRect(dstrect);
      } else {
        dr = {
          x: 0,
          y: 0,
          w: srcData.width,
          h: srcData.height
        };
      }
      if (dstData.clipRect) {
        const widthScale = !scale || sr.w === 0 ? 1 : sr.w / dr.w;
        const heightScale = !scale || sr.h === 0 ? 1 : sr.h / dr.h;
        dr = SDL.intersectionOfRects(dstData.clipRect, dr);
        sr.w = dr.w * widthScale;
        sr.h = dr.h * heightScale;
        if (dstrect) {
          SDL.updateRect(dstrect, dr);
        }
      }
      let blitw;
      let blith;
      if (scale) {
        blitw = dr.w;
        blith = dr.h;
      } else {
        blitw = sr.w;
        blith = sr.h;
      }
      if (sr.w === 0 || sr.h === 0 || blitw === 0 || blith === 0) {
        return 0;
      }
      const oldAlpha = dstData.ctx.globalAlpha;
      dstData.ctx.globalAlpha = srcData.alpha / 255;
      dstData.ctx.drawImage(srcData.canvas, sr.x, sr.y, sr.w, sr.h, dr.x, dr.y, blitw, blith);
      dstData.ctx.globalAlpha = oldAlpha;
      if (dst !== SDL.screen) {
        Module.Runtime.warnOnce('WARNING: copying canvas data to memory for compatibility');
        _SDL_LockSurface(dst);
        dstData.locked--;
      }
      return 0;
    },
    downFingers: {},
    savedKeydown: null,
    receiveEvent(event) {
      function unpressAllPressedKeys() {
        for (const code in SDL.keyboardMap) {
          SDL.events.push({
            type: 'keyup',
            keyCode: SDL.keyboardMap[code]
          });
        }
      }
      switch (event.type) {
        case 'touchstart':
        case 'touchmove':
          {
            event.preventDefault();
            let touches = [];
            if (event.type === 'touchstart') {
              for (let i = 0; i < event.touches.length; i++) {
                const touch = event.touches[i];
                if (SDL.downFingers[touch.identifier] !== true) {
                  SDL.downFingers[touch.identifier] = true;
                  touches.push(touch);
                }
              }
            } else {
              touches = event.touches;
            }
            const firstTouch = touches[0];
            if (event.type === 'touchstart') {
              SDL.DOMButtons[0] = 1;
            }
            let mouseEventType;
            switch (event.type) {
              case 'touchstart':
                mouseEventType = 'mousedown';
                break;
              case 'touchmove':
                mouseEventType = 'mousemove';
                break;
            }
            const mouseEvent = {
              type: mouseEventType,
              button: 0,
              pageX: firstTouch.clientX,
              pageY: firstTouch.clientY
            };
            SDL.events.push(mouseEvent);
            for (let i = 0; i < touches.length; i++) {
              const touch = touches[i];
              SDL.events.push({
                type: event.type,
                touch
              });
            }
            break;
          }
        case 'touchend':
          {
            event.preventDefault();
            for (let i = 0; i < event.changedTouches.length; i++) {
              const touch = event.changedTouches[i];
              if (SDL.downFingers[touch.identifier] === true) {
                delete SDL.downFingers[touch.identifier];
              }
            }
            const mouseEvent = {
              type: 'mouseup',
              button: 0,
              pageX: event.changedTouches[0].clientX,
              pageY: event.changedTouches[0].clientY
            };
            SDL.DOMButtons[0] = 0;
            SDL.events.push(mouseEvent);
            for (let i = 0; i < event.changedTouches.length; i++) {
              const touch = event.changedTouches[i];
              SDL.events.push({
                type: 'touchend',
                touch
              });
            }
            break;
          }
        case 'DOMMouseScroll':
        case 'mousewheel':
        case 'wheel': {
          let delta = -Browser.getMouseWheelDelta(event);
          delta = delta === 0 ? 0 : delta > 0 ? Math.max(delta, 1) : Math.min(delta, -1);
          const button = delta > 0 ? 3 : 4;
          SDL.events.push({
            type: 'mousedown',
            button,
            pageX: event.pageX,
            pageY: event.pageY
          });
          SDL.events.push({
            type: 'mouseup',
            button,
            pageX: event.pageX,
            pageY: event.pageY
          });
          SDL.events.push({
            type: 'wheel',
            deltaX: 0,
            deltaY: delta
          });
          event.preventDefault();
          break;
        }
        case 'mousemove':
          if (SDL.DOMButtons[0] === 1) {
            SDL.events.push({
              type: 'touchmove',
              touch: {
                identifier: 0,
                deviceID: -1,
                pageX: event.pageX,
                pageY: event.pageY
              }
            });
          }
          if (Browser.pointerLock) {
            if ('mozMovementX' in event) {
              event.movementX = event.mozMovementX;
              event.movementY = event.mozMovementY;
            }
            if (event.movementX === 0 && event.movementY === 0) {
              event.preventDefault();
              return;
            }
          }
        case 'keydown':
        case 'keyup':
        case 'keypress':
        case 'mousedown':
        case 'mouseup':
          // CHANGED event stop for global menu
          if (event.type !== 'keydown'
            && !event.metaKey
            && (!SDL.unicode && !SDL.textInput)
            || event.keyCode === 8
            || event.keyCode === 9) {
            event.preventDefault();
          }
          if (event.type === 'mousedown') {
            SDL.DOMButtons[event.button] = 1;
            SDL.events.push({
              type: 'touchstart',
              touch: {
                identifier: 0,
                deviceID: -1,
                pageX: event.pageX,
                pageY: event.pageY
              }
            });
          } else if (event.type === 'mouseup') {
            if (!SDL.DOMButtons[event.button]) {
              return;
            }
            SDL.events.push({
              type: 'touchend',
              touch: {
                identifier: 0,
                deviceID: -1,
                pageX: event.pageX,
                pageY: event.pageY
              }
            });
            SDL.DOMButtons[event.button] = 0;
          }
          if (event.type === 'keydown' || event.type === 'mousedown') {
            SDL.canRequestFullscreen = true;
          } else if (event.type === 'keyup' || event.type === 'mouseup') {
            if (SDL.isRequestingFullscreen) {
              Module.requestFullScreen(true, true);
              SDL.isRequestingFullscreen = false;
            }
            SDL.canRequestFullscreen = false;
          }
          if (event.type === 'keypress' && SDL.savedKeydown) {
            SDL.savedKeydown.keypressCharCode = event.charCode;
            SDL.savedKeydown = null;
          } else if (event.type === 'keydown') {
            SDL.savedKeydown = event;
          }
          if (event.type !== 'keypress' || SDL.textInput) {
            SDL.events.push(event);
          }
          break;
        case 'mouseout':
          for (let i = 0; i < 3; i++) {
            if (SDL.DOMButtons[i]) {
              SDL.events.push({
                type: 'mouseup',
                button: i,
                pageX: event.pageX,
                pageY: event.pageY
              });
              SDL.DOMButtons[i] = 0;
            }
          }
          event.preventDefault();
          break;
        case 'focus':
          SDL.events.push(event);
          event.preventDefault();
          break;
        case 'blur':
          SDL.events.push(event);
          unpressAllPressedKeys();
          event.preventDefault();
          break;
        case 'visibilitychange':
          SDL.events.push({
            type: 'visibilitychange',
            visible: !document.hidden
          });
          unpressAllPressedKeys();
          event.preventDefault();
          break;
        case 'unload':
          if (Browser.mainLoop.runner) {
            SDL.events.push(event);
            Browser.mainLoop.runner();
          }
          return;
        case 'resize':
          SDL.events.push(event);
          if (event.preventDefault) {
            event.preventDefault();
          }
          break;
      }
      if (SDL.events.length >= 1e4) {
        Module.printErr('SDL event queue full, dropping events');
        SDL.events = SDL.events.slice(0, 1e4);
      }
      SDL.flushEventsToHandler();
      return;
    },
    lookupKeyCodeForEvent(event) {
      let code = event.keyCode;
      if (code >= 65 && code <= 90) {
        code += 32;
      } else {
        code = SDL.keyCodes[event.keyCode] || event.keyCode;
        if (event.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT
          && code >= (224 | 1 << 10) && code <= (227 | 1 << 10)) {
          code += 4;
        }
      }
      return code;
    },
    handleEvent(event) {
      if (event.handled) return;
      event.handled = true;
      switch (event.type) {
        case 'touchstart':
        case 'touchend':
        case 'touchmove':
          {
            Browser.calculateMouseEvent(event);
            break;
          }
        case 'keydown':
        case 'keyup':
          {
            const down = event.type === 'keydown';
            const code = SDL.lookupKeyCodeForEvent(event);
            Module.HEAP8[SDL.keyboardState + code >> 0] = down;
            SDL.modState = (Module.HEAP8[SDL.keyboardState + 1248 >> 0]
              ? 64
              : 0) | (Module.HEAP8[SDL.keyboardState + 1249 >> 0]
                ? 1
                : 0) | (Module.HEAP8[SDL.keyboardState + 1250 >> 0]
                  ? 256
                  : 0) | (Module.HEAP8[SDL.keyboardState + 1252 >> 0]
                    ? 128
                    : 0) | (Module.HEAP8[SDL.keyboardState + 1253 >> 0]
                      ? 2
                      : 0) | (Module.HEAP8[SDL.keyboardState + 1254 >> 0]
                        ? 512
                        : 0);
            if (down) {
              SDL.keyboardMap[code] = event.keyCode;
            } else {
              delete SDL.keyboardMap[code];
            }
            break;
          }
        case 'mousedown':
        case 'mouseup':
          if (event.type === 'mousedown') {
            SDL.buttonState |= 1 << event.button;
          } else if (event.type === 'mouseup') {
            SDL.buttonState &= ~(1 << event.button);
          }
        case 'mousemove':
          {
            Browser.calculateMouseEvent(event);
            break;
          }
      }
    },
    flushEventsToHandler() {
      if (!SDL.eventHandler) return;
      const sdlEventPtr = Module.allocate(28, 'i8', Module.ALLOC_STACK);
      while (SDL.pollEvent(sdlEventPtr)) {
        Module.Runtime.dynCall('iii', SDL.eventHandler, [SDL.eventHandlerContext, sdlEventPtr]);
      }
    },
    pollEvent(ptr) {
      if (SDL.initFlags & 512 && SDL.joystickEventState) {
        SDL.queryJoysticks();
      }
      if (ptr) {
        while (SDL.events.length > 0) {
          if (SDL.makeCEvent(SDL.events.shift(), ptr) !== false) return 1;
        }
        return 0;
      }
      return SDL.events.length > 0;
    },
    makeCEvent(event, ptr) {
      if (typeof event === 'number') {
        Module._memcpy(ptr, event, 28);
        Module._free(event);
        return;
      }
      SDL.handleEvent(event);
      switch (event.type) {
        case 'keydown':
        case 'keyup':
          {
            const down = event.type === 'keydown';
            const key = SDL.lookupKeyCodeForEvent(event);
            let scan;
            if (key >= 1024) {
              scan = key - 1024;
            } else {
              scan = SDL.scanCodes[key] || key;
            }
            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            Module.HEAP8[ptr + 8 >> 0] = down ? 1 : 0;
            Module.HEAP8[ptr + 9 >> 0] = 0;
            Module.HEAP32[ptr + 12 >> 2] = scan;
            Module.HEAP32[ptr + 16 >> 2] = key;
            Module.HEAP16[ptr + 20 >> 1] = SDL.modState;
            Module.HEAP32[ptr + 24 >> 2] = event.keypressCharCode || key;
            break;
          }
        case 'keypress':
          {
            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            const cStr = Module.intArrayFromString(String.fromCharCode(event.charCode));
            for (let i = 0; i < cStr.length; ++i) {
              Module.HEAP8[ptr + (8 + i) >> 0] = cStr[i];
            }
            break;
          }
        case 'mousedown':
        case 'mouseup':
        case 'mousemove':
          {
            if (event.type !== 'mousemove') {
              const down = event.type === 'mousedown';
              Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
              Module.HEAP32[ptr + 4 >> 2] = 0;
              Module.HEAP32[ptr + 8 >> 2] = 0;
              Module.HEAP32[ptr + 12 >> 2] = 0;
              Module.HEAP8[ptr + 16 >> 0] = event.button + 1;
              Module.HEAP8[ptr + 17 >> 0] = down ? 1 : 0;
              Module.HEAP32[ptr + 20 >> 2] = Browser.mouseX;
              Module.HEAP32[ptr + 24 >> 2] = Browser.mouseY;
            } else {
              Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
              Module.HEAP32[ptr + 4 >> 2] = 0;
              Module.HEAP32[ptr + 8 >> 2] = 0;
              Module.HEAP32[ptr + 12 >> 2] = 0;
              Module.HEAP32[ptr + 16 >> 2] = SDL.buttonState;
              Module.HEAP32[ptr + 20 >> 2] = Browser.mouseX;
              Module.HEAP32[ptr + 24 >> 2] = Browser.mouseY;
              Module.HEAP32[ptr + 28 >> 2] = Browser.mouseMovementX;
              Module.HEAP32[ptr + 32 >> 2] = Browser.mouseMovementY;
            }
            break;
          }
        case 'wheel':
          {
            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            Module.HEAP32[ptr + 16 >> 2] = event.deltaX;
            Module.HEAP32[ptr + 20 >> 2] = event.deltaY;
            break;
          }
        case 'touchstart':
        case 'touchend':
        case 'touchmove':
          {
            const touch = event.touch;
            if (!Browser.touches[touch.identifier]) break;
            const w = Module.canvas.width;
            const h = Module.canvas.height;
            const x = Browser.touches[touch.identifier].x / w;
            const y = Browser.touches[touch.identifier].y / h;
            const lx = Browser.lastTouches[touch.identifier].x / w;
            const ly = Browser.lastTouches[touch.identifier].y / h;
            const dx = x - lx;
            const dy = y - ly;
            if (touch.deviceID === undefined) touch.deviceID = SDL.TOUCH_DEFAULT_ID;
            if (dx === 0 && dy === 0 && event.type === 'touchmove') return false;
            let tempI64;
            let tempDouble;

            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            Module.HEAP32[ptr + 4 >> 2] = _SDL_GetTicks();

            tempI64 = [
              touch.deviceID >>> 0, (tempDouble = touch.deviceID, +Math.abs(tempDouble) >= +1
                ? tempDouble > +0
                  ? (Math.min(+Math.floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0
                  : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0
                : 0)
            ];
            Module.HEAP32[ptr + 8 >> 2] = tempI64[0];
            Module.HEAP32[ptr + 12 >> 2] = tempI64[1];

            tempI64 = [
              touch.identifier >>> 0, (tempDouble = touch.identifier, +Math.abs(tempDouble) >= +1
                ? tempDouble > +0
                  ? (Math.min(+Math.floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0
                  : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0
                : 0)
            ];
            Module.HEAP32[ptr + 16 >> 2] = tempI64[0];
            Module.HEAP32[ptr + 20 >> 2] = tempI64[1];
            Module.HEAPF32[ptr + 24 >> 2] = x;
            Module.HEAPF32[ptr + 28 >> 2] = y;
            Module.HEAPF32[ptr + 32 >> 2] = dx;
            Module.HEAPF32[ptr + 36 >> 2] = dy;
            if (touch.force !== undefined) {
              Module.HEAPF32[ptr + 40 >> 2] = touch.force;
            } else {
              Module.HEAPF32[ptr + 40 >> 2] = event.type === 'touchend' ? 0 : 1;
            }
            break;
          }
        case 'unload':
          {
            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            break;
          }
        case 'resize':
          {
            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            Module.HEAP32[ptr + 4 >> 2] = event.w;
            Module.HEAP32[ptr + 8 >> 2] = event.h;
            break;
          }
        case 'joystick_button_up':
        case 'joystick_button_down':
          {
            const state = event.type === 'joystick_button_up' ? 0 : 1;
            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            Module.HEAP8[ptr + 4 >> 0] = event.index;
            Module.HEAP8[ptr + 5 >> 0] = event.button;
            Module.HEAP8[ptr + 6 >> 0] = state;
            break;
          }
        case 'joystick_axis_motion':
          {
            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            Module.HEAP8[ptr + 4 >> 0] = event.index;
            Module.HEAP8[ptr + 5 >> 0] = event.axis;
            Module.HEAP32[ptr + 8 >> 2] = SDL.joystickAxisValueConversion(event.value);
            break;
          }
        case 'focus':
          {
            const SDL_WINDOWEVENT_FOCUS_GAINED = 12;
            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            Module.HEAP32[ptr + 4 >> 2] = 0;
            Module.HEAP8[ptr + 8 >> 0] = SDL_WINDOWEVENT_FOCUS_GAINED;
            break;
          }
        case 'blur':
          {
            const SDL_WINDOWEVENT_FOCUS_LOST = 13;
            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            Module.HEAP32[ptr + 4 >> 2] = 0;
            Module.HEAP8[ptr + 8 >> 0] = SDL_WINDOWEVENT_FOCUS_LOST;
            break;
          }
        case 'visibilitychange':
          {
            const SDL_WINDOWEVENT_SHOWN = 1;
            const SDL_WINDOWEVENT_HIDDEN = 2;
            const visibilityEventID = event.visible
              ? SDL_WINDOWEVENT_SHOWN
              : SDL_WINDOWEVENT_HIDDEN;
            Module.HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
            Module.HEAP32[ptr + 4 >> 2] = 0;
            Module.HEAP8[ptr + 8 >> 0] = visibilityEventID;
            break;
          }
        default:
          throw new Error(`Unhandled SDL event: ${event.type}`);
      }
    },
    estimateTextWidth(fontData, text) {
      const h = fontData.size;
      const fontString = `${h}px ${fontData.name}`;
      const tempCtx = SDL.ttfContext;
      tempCtx.save();
      tempCtx.font = fontString;
      const ret = tempCtx.measureText(text).width | 0;
      tempCtx.restore();
      return ret;
    },
    allocateChannels(num) {
      if (SDL.numChannels && SDL.numChannels >= num && num !== 0) return;
      SDL.numChannels = num;
      SDL.channels = [];
      for (let i = 0; i < num; i++) {
        SDL.channels[i] = {
          audio: null,
          volume: 1
        };
      }
    },
    setGetVolume(info, volume) {
      if (!info) return 0;
      const ret = info.volume * 128;
      if (volume !== -1) {
        info.volume = Math.min(Math.max(volume, 0), 128) / 128;
        if (info.audio) {
          try {
            info.audio.volume = info.volume;
            if (info.audio.webAudioGainNode) info.audio.webAudioGainNode.gain.value = info.volume;
          } catch (e) {
            Module.printErr(`setGetVolume failed to set audio volume: ${e}`);
          }
        }
      }
      return ret;
    },
    setPannerPosition(info, x, y, z) {
      if (!info) return;
      if (info.audio) {
        if (info.audio.webAudioPannerNode) {
          info.audio.webAudioPannerNode.setPosition(x, y, z);
        }
      }
    },
    playWebAudio(audio) {
      if (!audio) return;
      if (audio.webAudioNode) return;
      if (!SDL.webAudioAvailable()) return;
      try {
        const webAudio = audio.resource.webAudio;
        audio.paused = false;
        if (!webAudio.decodedBuffer) {
          if (webAudio.onDecodeComplete === undefined) {
            Module.abort('Cannot play back audio object that was not loaded');
          }
          webAudio.onDecodeComplete.push(() => {
            if (!audio.paused) SDL.playWebAudio(audio);
          });
          return;
        }
        audio.webAudioNode = SDL.audioContext.createBufferSource();
        audio.webAudioNode.buffer = webAudio.decodedBuffer;
        audio.webAudioNode.loop = audio.loop;
        audio.webAudioNode.onended = function() {
          audio.onended();
        };
        audio.webAudioPannerNode = SDL.audioContext.createPanner();
        audio.webAudioPannerNode.panningModel = 'equalpower';
        audio.webAudioGainNode = SDL.audioContext.createGain();
        audio.webAudioGainNode.gain.value = audio.volume;
        audio.webAudioNode.connect(audio.webAudioPannerNode);
        audio.webAudioPannerNode.connect(audio.webAudioGainNode);
        audio.webAudioGainNode.connect(SDL.audioContext.destination);
        audio.webAudioNode.start(0, audio.currentPosition);
        audio.startTime = SDL.audioContext.currentTime - audio.currentPosition;
      } catch (e) {
        Module.printErr(`playWebAudio failed: ${e}`);
      }
    },
    pauseWebAudio(audio) {
      if (!audio) return;
      if (audio.webAudioNode) {
        try {
          audio.currentPosition = (SDL.audioContext.currentTime - audio.startTime) %
            audio.resource.webAudio.decodedBuffer.duration;
          audio.webAudioNode.onended = undefined;
          audio.webAudioNode.stop();
          audio.webAudioNode = undefined;
        } catch (e) {
          Module.printErr(`pauseWebAudio failed: ${e}`);
        }
      }
      audio.paused = true;
    },
    openAudioContext() {
      if (!SDL.audioContext) {
        if (typeof AudioContext !== 'undefined') {
          SDL.audioContext = new AudioContext;
        }
      }
    },
    webAudioAvailable() {
      return !!SDL.audioContext;
    },
    fillWebAudioBufferFromHeap(heapPtr, sizeSamplesPerChannel, dstAudioBuffer) {
      const numChannels = SDL.audio.channels;
      for (let c = 0; c < numChannels; ++c) {
        const channelData = dstAudioBuffer.getChannelData(c);
        if (channelData.length !== sizeSamplesPerChannel) {
          throw new Error(`Web Audio output buffer length mismatch! Destination size:
            ${channelData.length} samples vs expected ${sizeSamplesPerChannel} samples!`);
        }
        if (SDL.audio.format === 32784) {
          for (let j = 0; j < sizeSamplesPerChannel; ++j) {
            channelData[j] = Module.HEAP16[heapPtr + (j * numChannels + c) * 2 >> 1] / 32768;
          }
        } else if (SDL.audio.format === 8) {
          for (let j = 0; j < sizeSamplesPerChannel; ++j) {
            const v = Module.HEAP8[heapPtr + (j * numChannels + c) >> 0];
            channelData[j] = (v >= 0 ? v - 128 : v + 128) / 128;
          }
        }
      }
    },
    debugSurface(surfData) {
      console.log(`dumping surface
        ${[surfData.surf, surfData.source, surfData.width, surfData.height]}`);

      const image = surfData.ctx.getImageData(0, 0, surfData.width, surfData.height);
      const data = image.data;
      const num = Math.min(surfData.width, surfData.height);
      for (let i = 0; i < num; i++) {
        console.log(`   diagonal ${i}:${[data[i * surfData.width * 4 + i * 4 + 0],
          data[i * surfData.width * 4 + i * 4 + 1], data[i * surfData.width * 4 + i * 4 + 2],
          data[i * surfData.width * 4 + i * 4 + 3]]}`);
      }
    },
    joystickEventState: 1,
    lastJoystickState: {},
    joystickNamePool: {},
    recordJoystickState(joystick, state) {
      const buttons = new Array(state.buttons.length);
      for (let i = 0; i < state.buttons.length; i++) {
        buttons[i] = SDL.getJoystickButtonState(state.buttons[i]);
      }
      SDL.lastJoystickState[joystick] = {
        buttons,
        axes: state.axes.slice(0),
        timestamp: state.timestamp,
        index: state.index,
        id: state.id
      };
    },
    getJoystickButtonState(button) {
      if (typeof button === 'object') {
        return button.pressed;
      }
      return button > 0;
    },
    queryJoysticks() {
      for (const joystick in SDL.lastJoystickState) {
        const state = SDL.getGamepad(joystick - 1);
        const prevState = SDL.lastJoystickState[joystick];
        if (typeof state.timestamp !== 'number' || state.timestamp !== prevState.timestamp) {
          let i;
          for (i = 0; i < state.buttons.length; i++) {
            const buttonState = SDL.getJoystickButtonState(state.buttons[i]);
            if (buttonState !== prevState.buttons[i]) {
              SDL.events.push({
                type: buttonState ? 'joystick_button_down' : 'joystick_button_up',
                joystick,
                index: joystick - 1,
                button: i
              });
            }
          }
          for (i = 0; i < state.axes.length; i++) {
            if (state.axes[i] !== prevState.axes[i]) {
              SDL.events.push({
                type: 'joystick_axis_motion',
                joystick,
                index: joystick - 1,
                axis: i,
                value: state.axes[i]
              });
            }
          }
          SDL.recordJoystickState(joystick, state);
        }
      }
    },
    joystickAxisValueConversion(value) {
      return Math.ceil((value + 1) * 32767.5 - 32768);
    },
    getGamepads() {
      const fcn = navigator.getGamepads;
      if (fcn !== undefined) {
        return fcn.apply(navigator);
      }
      return [];
    },
    getGamepad(deviceIndex) {
      const gamepads = SDL.getGamepads();
      if (gamepads.length > deviceIndex && deviceIndex >= 0) {
        return gamepads[deviceIndex];
      }
      return null;
    }
  };

  return SDL;
};
