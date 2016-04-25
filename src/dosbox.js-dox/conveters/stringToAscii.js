'use strict';

module.exports = function stringToAscii(str, outPtr) {
  return Module.writeAsciiToMemory(str, outPtr, false);
};
