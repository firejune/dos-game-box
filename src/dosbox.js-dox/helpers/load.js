'use strict';

function globalEval(x) {
  eval.call(null, x);
}

module.exports = function load(f) {
  globalEval(Module.read(f));
};
