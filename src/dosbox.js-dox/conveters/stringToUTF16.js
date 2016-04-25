'use strict';

module.exports = function stringToUTF16(str, outPtr, maxBytesToWrite) {
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 2147483647;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2;
  const startPtr = outPtr;
  const numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
  for (let i = 0; i < numCharsToWrite; ++i) {
    const codeUnit = str.charCodeAt(i);
    Module.HEAP16[outPtr >> 1] = codeUnit;
    outPtr += 2;
  }
  Module.HEAP16[outPtr >> 1] = 0;
  return outPtr - startPtr;
};
