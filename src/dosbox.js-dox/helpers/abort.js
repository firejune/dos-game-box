'use strict';

module.exports = function abort(text) {
  if (text) {
    Module.print(text);
    Module.printErr(text);
  }

  Module.ABORT = true;

  const extra = '\nIf this abort() is unexpected, build with -s ASSERTIONS=1 ' +
    'which can give more information.';

  throw new Error(`abort() at ${Module.stackTrace()} ${extra}`);
};
