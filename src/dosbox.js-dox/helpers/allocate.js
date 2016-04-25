'use strict';

const assert = require('./assert');

module.exports = function allocate(slab, types, allocator, ptr) {
  let zeroinit;
  let size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }
  const singleType = typeof types === 'string' ? types : null;
  let ret;
  if (allocator === Module.ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [
      Module._malloc,
      Module.Runtime.stackAlloc,
      Module.Runtime.staticAlloc,
      Module.Runtime.dynamicAlloc
    ][allocator === undefined ? Module.ALLOC_STATIC : allocator](
      Math.max(size, singleType ? 1 : types.length)
    );
  }
  if (zeroinit) {
    let _ptr = ret;
    let stop;
    assert((ret & 3) === 0);
    stop = ret + (size & ~3);
    for (; _ptr < stop; _ptr += 4) {
      Module.HEAP32[_ptr >> 2] = 0;
    }
    stop = ret + size;
    while (_ptr < stop) {
      Module.HEAP8[_ptr++ >> 0] = 0;
    }
    return ret;
  }
  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      Module.HEAPU8.set(slab, ret);
    } else {
      Module.HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }
  let i = 0;
  let type;
  let typeSize;
  let previousType;
  while (i < size) {
    let curr = slab[i];
    if (typeof curr === 'function') {
      curr = Module.Runtime.getFunctionIndex(curr);
    }
    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }
    if (type === 'i64') type = 'i32';
    Module.setValue(ret + i, curr, type);
    if (previousType !== type) {
      typeSize = Module.Runtime.getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }
  return ret;
};
