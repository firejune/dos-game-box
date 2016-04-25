'use strict';

module.exports = function writeArrayToMemory(array, buffer) {
  for (let i = 0; i < array.length; i++) {
    Module.HEAP8[buffer++ >> 0] = array[i];
  }
};
