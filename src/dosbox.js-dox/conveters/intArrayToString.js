'use strict';

module.exports = function intArrayToString(array) {
  const ret = [];
  for (let i = 0; i < array.length; i++) {
    let chr = array[i];
    if (chr > 255) {
      chr &= 255;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
};
