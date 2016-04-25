'use strict';

module.exports = function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (let i = 0; i < str.length; ++i) {
    Module.HEAP8[buffer++ >> 0] = str.charCodeAt(i);
  }
  if (!dontAddNull) Module.HEAP8[buffer >> 0] = 0;
};
