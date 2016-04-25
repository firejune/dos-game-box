'use strict';

module.exports = function assert(condition, text) {
  if (!condition) {
    Module.abort(`Assertion failed: ${text}`);
  }
};
