'use strict';

module.exports = function stringToUTF32(str, outPtr, maxBytesToWrite) {
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 2147483647;
  }

  if (maxBytesToWrite < 4) return 0;

  const startPtr = outPtr;
  const endPtr = startPtr + maxBytesToWrite - 4;
  for (let i = 0; i < str.length; ++i) {
    let codeUnit = str.charCodeAt(i);
    if (codeUnit >= 55296 && codeUnit <= 57343) {
      const trailSurrogate = str.charCodeAt(++i);
      codeUnit = 65536 + ((codeUnit & 1023) << 10) | trailSurrogate & 1023;
    }
    Module.HEAP32[outPtr >> 2] = codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  Module.HEAP32[outPtr >> 2] = 0;
  return outPtr - startPtr;
};
