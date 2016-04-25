'use strict';

module.exports = function UTF8ToString(ptr) {
  return Module.UTF8ArrayToString(Module.HEAPU8, ptr);
};
