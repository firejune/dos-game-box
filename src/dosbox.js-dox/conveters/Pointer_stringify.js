'use strict';

module.exports = function Pointer_stringify(ptr, length) {
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
