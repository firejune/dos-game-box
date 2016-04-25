'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function read(filename, binary) {
  filename = path.normalize(filename);
  let ret = fs.readFileSync(filename);
  if (!ret && filename !== path.resolve(filename)) {
    filename = path.join(__dirname, '..', 'src', filename);
    ret = fs.readFileSync(filename);
  }
  if (ret && !binary) ret = ret.toString();
  return ret;
};
