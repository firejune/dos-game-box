'use strict';

let tempDouble;
let tempI64;
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length - 1) === '*') type = 'i32';
  switch (type) {
    case 'i1':
      Module.HEAP8[ptr >> 0] = value;
      break;
    case 'i8':
      Module.HEAP8[ptr >> 0] = value;
      break;
    case 'i16':
      Module.HEAP16[ptr >> 1] = value;
      break;
    case 'i32':
      Module.HEAP32[ptr >> 2] = value;
      break;
    case 'i64':
      tempI64 = [value >>> 0, (tempDouble = value, +Math.abs(tempDouble) >= +1 ? tempDouble > +0
        ? (Math.min(+Math.floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0
        : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0 : 0)],
        Module.HEAP32[ptr >> 2] = tempI64[0], Module.HEAP32[ptr + 4 >> 2] = tempI64[1];
      break;
    case 'float':
      Module.HEAPF32[ptr >> 2] = value;
      break;
    case 'double':
      Module.HEAPF64[ptr >> 3] = value;
      break;
    default:
      Module.abort(`invalid type for setValue: ${type}`);
  }
}

function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length - 1) === '*') type = 'i32';
  switch (type) {
    case 'i1':
      return Module.HEAP8[ptr >> 0];
    case 'i8':
      return Module.HEAP8[ptr >> 0];
    case 'i16':
      return Module.HEAP16[ptr >> 1];
    case 'i32':
      return Module.HEAP32[ptr >> 2];
    case 'i64':
      return Module.HEAP32[ptr >> 2];
    case 'float':
      return Module.HEAPF32[ptr >> 2];
    case 'double':
      return Module.HEAPF64[ptr >> 3];
    default:
      Module.abort(`invalid type for setValue: ${type}`);
  }

  return null;
}

module.exports = {setValue, getValue};
