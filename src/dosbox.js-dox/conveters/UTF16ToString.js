'use strict';

module.exports = function UTF16ToString(ptr) {
  let i = 0;
  let str = '';
  while (1) {
    const codeUnit = Module.HEAP16[ptr + i * 2 >> 1];
    if (codeUnit === 0) return str;
    ++i;
    str += String.fromCharCode(codeUnit);
  }
};
