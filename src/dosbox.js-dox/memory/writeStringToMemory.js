'use strict';

module.exports = function writeStringToMemory(string, buffer, dontAddNull) {
  const array = Module.intArrayFromString(string, dontAddNull);
  let i = 0;
  while (i < array.length) {
    const chr = array[i];
    Module.HEAP8[buffer + i >> 0] = chr;
    i = i + 1;
  }
};
