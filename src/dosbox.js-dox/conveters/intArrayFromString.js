'use strict';

module.exports = function intArrayFromString(stringy, dontAddNull, length) {
  const len = length > 0 ? length : Module.lengthBytesUTF8(stringy) + 1;
  const u8array = new Array(len);
  const numBytesWritten = Module.stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
};
