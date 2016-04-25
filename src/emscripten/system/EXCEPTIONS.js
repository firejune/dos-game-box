'use strict';

module.exports = function(Module, assert, ___cxa_free_exception) {
  const EXCEPTIONS = {
    last: 0,
    caught: [],
    infos: {},
    deAdjust: adjusted => {
      if (!adjusted || EXCEPTIONS.infos[adjusted]) return adjusted;
      for (const ptr in EXCEPTIONS.infos) {
        const info = EXCEPTIONS.infos[ptr];
        if (info.adjusted === adjusted) {
          return ptr;
        }
      }
      return adjusted;
    },
    addRef: ptr => {
      if (!ptr) return;
      const info = EXCEPTIONS.infos[ptr];
      info.refcount++;
    },
    decRef: ptr => {
      if (!ptr) return;
      const info = EXCEPTIONS.infos[ptr];
      assert(info.refcount > 0);
      info.refcount--;
      if (info.refcount === 0) {
        if (info.destructor) {
          Module.Runtime.dynCall('vi', info.destructor, [ptr]);
        }
        delete EXCEPTIONS.infos[ptr];
        ___cxa_free_exception(ptr);
      }
    },
    clearRef: ptr => {
      if (!ptr) return;
      const info = EXCEPTIONS.infos[ptr];
      info.refcount = 0;
    }
  };

  return EXCEPTIONS;
};
