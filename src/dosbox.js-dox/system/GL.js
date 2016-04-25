'use strict';

let JSEvents;
const GL = {
  counter: 1,
  lastError: 0,
  buffers: [],
  mappedBuffers: {},
  programs: [],
  framebuffers: [],
  renderbuffers: [],
  textures: [],
  uniforms: [],
  shaders: [],
  vaos: [],
  contexts: [],
  byteSizeByTypeRoot: 5120,
  byteSizeByType: [1, 1, 2, 2, 4, 4, 4, 2, 3, 4, 8],
  programInfos: {},
  stringCache: {},
  packAlignment: 4,
  unpackAlignment: 4,
  init() {
    GL.miniTempBuffer = new Float32Array(GL.MINI_TEMP_BUFFER_SIZE);
    for (let i = 0; i < GL.MINI_TEMP_BUFFER_SIZE; i++) {
      GL.miniTempBufferViews[i] = GL.miniTempBuffer.subarray(0, i + 1);
    }
  },
  recordError(errorCode) {
    if (!GL.lastError) {
      GL.lastError = errorCode;
    }
  },
  getNewId(table) {
    const ret = GL.counter++;
    for (let i = table.length; i < ret; i++) {
      table[i] = null;
    }
    return ret;
  },
  MINI_TEMP_BUFFER_SIZE: 16,
  miniTempBuffer: null,
  miniTempBufferViews: [0],
  getSource(shader, count, string, length) {
    let source = '';
    for (let i = 0; i < count; ++i) {
      let frag;
      if (length) {
        const len = Module.HEAP32[length + i * 4 >> 2];
        if (len < 0) {
          frag = Module.Pointer_stringify(Module.HEAP32[string + i * 4 >> 2]);
        } else {
          frag = Module.Pointer_stringify(Module.HEAP32[string + i * 4 >> 2], len);
        }
      } else {
        frag = Module.Pointer_stringify(Module.HEAP32[string + i * 4 >> 2]);
      }
      source += frag;
    }
    return source;
  },
  computeImageSize(width, height, sizePerPixel, alignment) {
    function roundedToNextMultipleOf(x, y) {
      return Math.floor((x + y - 1) / y) * y;
    }
    const plainRowSize = width * sizePerPixel;
    const alignedRowSize = roundedToNextMultipleOf(plainRowSize, alignment);
    return height <= 0 ? 0 : (height - 1) * alignedRowSize + plainRowSize;
  },
  get(name_, p, type) {
    if (!p) {
      GL.recordError(1281);
      return;
    }
    let ret = undefined;
    switch (name_) {
      case 36346:
        ret = 1;
        break;
      case 36344:
        if (type !== 'Integer') {
          GL.recordError(1280);
        }
        return;
      case 36345:
        ret = 0;
        break;
      case 34466: {
        const formats = GL.ctx.getParameter(34467);
        ret = formats.length;
        break;
      }
      case 35738:
        ret = 5121;
        break;
      case 35739:
        ret = 6408;
        break;
    }
    if (ret === undefined) {
      const result = GL.ctx.getParameter(name_);
      switch (typeof result) {
        case 'number':
          ret = result;
          break;
        case 'boolean':
          ret = result ? 1 : 0;
          break;
        case 'string':
          GL.recordError(1280);
          return;
        case 'object':
          if (result === null) {
            switch (name_) {
              case 34964:
              case 35725:
              case 34965:
              case 36006:
              case 36007:
              case 32873:
              case 34068:
                {
                  ret = 0;
                  break;
                }
              default:
                {
                  GL.recordError(1280);
                  return;
                }
            }
          } else if (result instanceof Float32Array || result instanceof Uint32Array
            || result instanceof Int32Array || result instanceof Array) {
            for (let i = 0; i < result.length; ++i) {
              switch (type) {
                case 'Integer':
                  Module.HEAP32[p + i * 4 >> 2] = result[i];
                  break;
                case 'Float':
                  Module.HEAPF32[p + i * 4 >> 2] = result[i];
                  break;
                case 'Boolean':
                  Module.HEAP8[p + i >> 0] = result[i] ? 1 : 0;
                  break;
                default:
                  throw new Error(`internal glGet error, bad type: ${type}`);
              }
            }
            return;
          } else if (result instanceof WebGLBuffer || result instanceof WebGLProgram
            || result instanceof WebGLFramebuffer || result instanceof WebGLRenderbuffer
            || result instanceof WebGLTexture) {
            ret = result.name | 0;
          } else {
            GL.recordError(1280);
            return;
          }
          break;
        default:
          GL.recordError(1280);
          return;
      }
    }
    switch (type) {
      case 'Integer':
        Module.HEAP32[p >> 2] = ret;
        break;
      case 'Float':
        Module.HEAPF32[p >> 2] = ret;
        break;
      case 'Boolean':
        Module.HEAP8[p >> 0] = ret ? 1 : 0;
        break;
      default:
        throw new Error(`internal glGet error, bad type: ${type}`);
    }
  },
  getTexPixelData(type, format, width, height, pixels, internalFormat) {
    let sizePerPixel;
    let numChannels;
    switch (format) {
      case 6406:
      case 6409:
      case 6402:
        numChannels = 1;
        break;
      case 6410:
      case 33319:
        numChannels = 2;
        break;
      case 6407:
        numChannels = 3;
        break;
      case 6408:
        numChannels = 4;
        break;
      default:
        GL.recordError(1280);
        return {
          pixels: null,
          internalFormat: 0
        };
    }
    switch (type) {
      case 5121:
        sizePerPixel = numChannels * 1;
        break;
      case 5123:
      case 36193:
        sizePerPixel = numChannels * 2;
        break;
      case 5125:
      case 5126:
        sizePerPixel = numChannels * 4;
        break;
      case 34042:
        sizePerPixel = 4;
        break;
      case 33635:
      case 32819:
      case 32820:
        sizePerPixel = 2;
        break;
      default:
        GL.recordError(1280);
        return {
          pixels: null,
          internalFormat: 0
        };
    }
    const bytes = GL.computeImageSize(width, height, sizePerPixel, GL.unpackAlignment);
    if (type === 5121) {
      pixels = Module.HEAPU8.subarray(pixels, pixels + bytes);
    } else if (type === 5126) {
      pixels = Module.HEAPF32.subarray(pixels >> 2, pixels + bytes >> 2);
    } else if (type === 5125 || type === 34042) {
      pixels = Module.HEAPU32.subarray(pixels >> 2, pixels + bytes >> 2);
    } else {
      pixels = Module.HEAPU16.subarray(pixels >> 1, pixels + bytes >> 1);
    }
    return {
      pixels,
      internalFormat
    };
  },
  validateBufferTarget(target) {
    switch (target) {
      case 34962:
      case 34963:
      case 36662:
      case 36663:
      case 35051:
      case 35052:
      case 35882:
      case 35982:
      case 35345:
        return true;
      default:
        return false;
    }
  },
  createContext(canvas, webGLContextAttributes) {
    if (typeof webGLContextAttributes.majorVersion === 'undefined'
      && typeof webGLContextAttributes.minorVersion === 'undefined') {
      webGLContextAttributes.majorVersion = 1;
      webGLContextAttributes.minorVersion = 0;
    }
    let ctx;
    let errorInfo = '?';

    function onContextCreationError(event) {
      errorInfo = event.statusMessage || errorInfo;
    }

    try {
      canvas.addEventListener('webglcontextcreationerror', onContextCreationError, false);
      const majorVersion = webGLContextAttributes.majorVersion;
      const minorVersion = webGLContextAttributes.minorVersion;

      try {
        if (majorVersion === 1
          && minorVersion === 0) {
          ctx = canvas.getContext('webgl', webGLContextAttributes)
            || canvas.getContext('experimental-webgl', webGLContextAttributes);
        } else if (majorVersion === 2
          && minorVersion === 0) {
          ctx = canvas.getContext('webgl2', webGLContextAttributes)
            || canvas.getContext('experimental-webgl2', webGLContextAttributes);
        }

        throw new Error(`Unsupported WebGL context version ${majorVersion}.${minorVersion}!`);
      } finally {
        canvas.removeEventListener('webglcontextcreationerror', onContextCreationError, false);
      }
      if (!ctx) throw new Error(':(');
    } catch (e) {
      Module.print(
        `Could not create canvas: ${[errorInfo, e, JSON.stringify(webGLContextAttributes)]}`);
      return 0;
    }

    if (!ctx) return 0;

    return GL.registerContext(ctx, webGLContextAttributes);
  },
  registerContext(ctx, webGLContextAttributes) {
    const handle = GL.getNewId(GL.contexts);
    const context = {
      handle,
      version: webGLContextAttributes.majorVersion,
      GLctx: ctx
    };

    if (ctx.canvas) ctx.canvas.GLctxObject = context;
    GL.contexts[handle] = context;

    if (typeof webGLContextAttributes.enableExtensionsByDefault === 'undefined'
      || webGLContextAttributes.enableExtensionsByDefault) {
      GL.initExtensions(context);
    }

    return handle;
  },
  makeContextCurrent(contextHandle) {
    const context = GL.contexts[contextHandle];
    if (!context) return false;
    GL.ctx = Module.ctx = context.GLctx;
    GL.currentContext = context;
    return true;
  },
  getContext(contextHandle) {
    return GL.contexts[contextHandle];
  },
  deleteContext(contextHandle) {
    if (GL.currentContext === GL.contexts[contextHandle]) GL.currentContext = 0;
    if (typeof JSEvents === 'object') {
      JSEvents.removeAllHandlersOnTarget(GL.contexts[contextHandle].canvas);
    }
    if (GL.contexts[contextHandle] && GL.contexts[contextHandle].GLctx.canvas) {
      GL.contexts[contextHandle].GLctx.canvas.GLctxObject = undefined;
    }
    GL.contexts[contextHandle] = null;
  },
  initExtensions(context) {
    if (!context) context = GL.currentContext;
    if (context.initExtensionsDone) return;
    context.initExtensionsDone = true;

    GL.ctx = context.GLctx;
    context.maxVertexAttribs = GL.ctx.getParameter(GL.ctx.MAX_VERTEX_ATTRIBS);
    context.compressionExt = GL.ctx.getExtension('WEBGL_compressed_texture_s3tc')
      || GL.ctx.getExtension('WEBKIT_WEBGL_compressed_texture_s3tc');
    context.anisotropicExt = GL.ctx.getExtension('EXT_texture_filter_anisotropic')
      || GL.ctx.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    context.floatExt = GL.ctx.getExtension('OES_texture_float');
    context.instancedArraysExt = GL.ctx.getExtension('ANGLE_instanced_arrays');
    context.vaoExt = GL.ctx.getExtension('OES_vertex_array_object');

    if (context.version === 2) {
      context.drawBuffersExt = function(n, bufs) {
        GL.ctx.drawBuffers(n, bufs);
      };
    } else {
      const ext = GL.ctx.getExtension('WEBGL_draw_buffers');
      if (ext) {
        context.drawBuffersExt = function(n, bufs) {
          ext.drawBuffersWEBGL(n, bufs);
        };
      }
    }

    const automaticallyEnabledExtensions = [
      'OES_texture_float', 'OES_texture_half_float', 'OES_standard_derivatives',
      'OES_vertex_array_object', 'WEBGL_compressed_texture_s3tc', 'WEBGL_depth_texture',
      'OES_element_index_uint', 'EXT_texture_filter_anisotropic', 'ANGLE_instanced_arrays',
      'OES_texture_float_linear', 'OES_texture_half_float_linear', 'WEBGL_compressed_texture_atc',
      'WEBGL_compressed_texture_pvrtc', 'EXT_color_buffer_half_float', 'WEBGL_color_buffer_float',
      'EXT_frag_depth', 'EXT_sRGB', 'WEBGL_draw_buffers', 'WEBGL_shared_resources',
      'EXT_shader_texture_lod'
    ];

    /*
    function shouldEnableAutomatically(extension) {
      let ret = false;
      automaticallyEnabledExtensions.forEach(function(include) {
        if (ext.indexOf(include) !== -1) {
          ret = true;
        }
      });
      return ret;
    }
    */

    GL.ctx.getSupportedExtensions().forEach(ext => {
      ext = ext.replace('MOZ_', '').replace('WEBKIT_', '');
      if (automaticallyEnabledExtensions.indexOf(ext) !== -1) {
        GL.ctx.getExtension(ext);
      }
    });
  },
  populateUniformTable(program) {
    const p = GL.programs[program];
    GL.programInfos[program] = {
      uniforms: {},
      maxUniformLength: 0,
      maxAttributeLength: -1
    };
    const ptable = GL.programInfos[program];
    const utable = ptable.uniforms;
    const numUniforms = GL.ctx.getProgramParameter(p, GL.ctx.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; ++i) {
      const u = GL.ctx.getActiveUniform(p, i);
      let name = u.name;
      ptable.maxUniformLength = Math.max(ptable.maxUniformLength, name.length + 1);
      if (name.indexOf(']', name.length - 1) !== -1) {
        const ls = name.lastIndexOf('[');
        name = name.slice(0, ls);
      }
      let loc = GL.ctx.getUniformLocation(p, name);
      let id = GL.getNewId(GL.uniforms);
      utable[name] = [u.size, id];
      GL.uniforms[id] = loc;
      for (let j = 1; j < u.size; ++j) {
        const n = `${name}[${j}]`;
        loc = GL.ctx.getUniformLocation(p, n);
        id = GL.getNewId(GL.uniforms);
        GL.uniforms[id] = loc;
      }
    }
  }
};

module.exports = GL;
