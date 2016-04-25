'use strict';

module.exports = function lengthBytesUTF32(str) {
  let len = 0;
  for (let i = 0; i < str.length; ++i) {
    const codeUnit = str.charCodeAt(i);
    if (codeUnit >= 55296 && codeUnit <= 57343) ++i;
    len += 4;
  }
  return len;
};
