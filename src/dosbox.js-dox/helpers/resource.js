'use strict';

const assert = require('./assert');

const JSfuncs = {
  stackSave: function() {
    Module.Runtime.stackSave();
  },
  stackRestore: function() {
    Module.Runtime.stackRestore();
  },
  arrayToC: function(arr) {
    const ret = Module.Runtime.stackAlloc(arr.length);
    Module.writeArrayToMemory(arr, ret);
    return ret;
  },
  stringToC: function(str) {
    let ret = 0;
    if (str !== null && str !== undefined && str !== 0) {
      ret = Module.Runtime.stackAlloc((str.length << 2) + 1);
      Module.writeStringToMemory(str, ret);
    }
    return ret;
  }
};

const toC = {
  string: JSfuncs.stringToC,
  array: JSfuncs.arrayToC
};

const ccall = function ccallFunc(ident, returnType, argTypes, args) {
  const func = getCFunc(ident);
  const cArgs = [];
  let stack = 0;
  if (args) {
    for (let i = 0; i < args.length; i++) {
      const converter = toC[argTypes[i]];
      if (converter) {
        if (stack === 0) stack = Module.Runtime.stackSave();
        cArgs[i] = converter(args[i]);
      } else {
        cArgs[i] = args[i];
      }
    }
  }
  let ret = func.apply(null, cArgs);
  if (returnType === 'string') ret = Module.Pointer_stringify(ret);
  if (stack !== 0) Module.Runtime.stackRestore(stack);
  return ret;
};

const sourceRegex = /^function\s*\(([^)]*)\)\s*{\s*([^*]*?)[\s;]*(?:return\s*(.*?)[;\s]*)?}$/;

function parseJSFunc(jsfunc) {
  const parsed = jsfunc.toString().match(sourceRegex).slice(1);
  return {
    arguments: parsed[0],
    body: parsed[1],
    returnValue: parsed[2]
  };
}

const JSsource = {};
for (const fun in JSfuncs) {
  if (JSfuncs.hasOwnProperty(fun)) {
    JSsource[fun] = parseJSFunc(JSfuncs[fun]);
  }
}

const cwrap = function cwrap(ident, returnType, argTypes) {
  argTypes = argTypes || [];
  const cfunc = getCFunc(ident);
  const numericArgs = argTypes.every(type => type === 'number');
  const numericRet = returnType !== 'string';
  if (numericRet && numericArgs) {
    return cfunc;
  }

  const argNames = argTypes.map((x, i) => `$${i}`);
  let funcstr = `(function(${argNames.join(',')}) {`;
  const nargs = argTypes.length;
  if (!numericArgs) {
    funcstr += `var stack = ${JSsource.stackSave.body};`;
    for (let i = 0; i < nargs; i++) {
      const arg = argNames[i];
      const type = argTypes[i];

      if (type === 'number') continue;
      const convertCode = JSsource[`${type}ToC`];
      funcstr += `var ${convertCode.arguments} = ${arg};`;
      funcstr += `${convertCode.body};`;
      funcstr += `${arg}=${convertCode.returnValue};`;
    }
  }

  const cfuncname = parseJSFunc(() => cfunc).returnValue;
  funcstr += `var ret = ${cfuncname}(${argNames.join(',')});`;
  if (!numericRet) {
    const strgfy = parseJSFunc(() => Module.Pointer_stringify).returnValue;
    funcstr += `ret = ${strgfy}(ret);`;
  }
  if (!numericArgs) {
    funcstr += `${JSsource.stackRestore.body.replace('()', '(stack)')};`;
  }
  funcstr += 'return ret})';

  return eval(funcstr);
};

function getCFunc(ident) {
  let func = Module[`_${ident}`];
  if (!func) {
    try {
      func = eval(`_${ident}`);
    } catch (e) {
      //
    }
  }

  assert(func, `Cannot call unknown function ${ident}
    (perhaps LLVM optimizations or closure removed it?)`);

  return func;
}

module.exports = {cwrap, ccall};
