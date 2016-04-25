'use strict';

module.exports = function readBinary(filename) {
  return Module.read(filename, true);
};
