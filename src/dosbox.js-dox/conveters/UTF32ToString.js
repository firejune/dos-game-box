'use strict';

module.exports = function UTF32ToString(ptr) {
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
