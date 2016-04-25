'use strict';

module.exports = function AsciiToString(ptr) {
  let str = '';
  while (1) {
    const ch = Module.HEAP8[ptr++ >> 0];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
};
