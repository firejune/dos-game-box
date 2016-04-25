'use strict';

module.exports = function _calloc(n, s) {
  const ret = Module._malloc(n * s);
  Module._memset(ret, 0, n * s);
  return ret;
};
