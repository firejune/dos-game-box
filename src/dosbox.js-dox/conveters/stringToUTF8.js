'use strict';

module.exports = function stringToUTF8(str, outPtr, maxBytesToWrite) {
  return Module.stringToUTF8Array(str, Module.HEAPU8, outPtr, maxBytesToWrite);
};
