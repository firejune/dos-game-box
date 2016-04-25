'use strict';

const goog = {
  math: {}
};

goog.math.Long = function(low, high) {
  this.low_ = low | 0;
  this.high_ = high | 0;
};

goog.math.Long.IntCache_ = {};
goog.math.Long.fromInt = function(value) {
  if (value >= -128 && value < 128) {
    const cachedObj = goog.math.Long.IntCache_[value];
    if (cachedObj) {
      return cachedObj;
    }
  }

  const obj = new goog.math.Long(value | 0, value < 0 ? -1 : 0);
  if (value >= -128 && value < 128) {
    goog.math.Long.IntCache_[value] = obj;
  }

  return obj;
};

goog.math.Long.fromNumber = function(value) {
  if (isNaN(value) || !isFinite(value)) {
    return goog.math.Long.ZERO;
  } else if (value <= -goog.math.Long.TWO_PWR_63_DBL_) {
    return goog.math.Long.MIN_VALUE;
  } else if (value + 1 >= goog.math.Long.TWO_PWR_63_DBL_) {
    return goog.math.Long.MAX_VALUE;
  } else if (value < 0) {
    return goog.math.Long.fromNumber(-value).negate();
  }
  return new goog.math.Long(value % goog.math.Long.TWO_PWR_32_DBL_ | 0, value / goog.math.Long.TWO_PWR_32_DBL_ | 0);
};

goog.math.Long.fromBits = function(lowBits, highBits) {
  return new goog.math.Long(lowBits, highBits);
};

goog.math.Long.fromString = function(str, opt_radix) {
  if (str.length === 0) {
    throw Error('number format error: empty string');
  }

  const radix = opt_radix || 10;
  if (radix < 2 || radix > 36) {
    throw Error('radix out of range: ' + radix);
  }

  if (str.charAt(0) === '-') {
    return goog.math.Long.fromString(str.substring(1), radix).negate();
  } else if (str.indexOf('-') >= 0) {
    throw Error('number format error: interior "-" character: ' + str);
  }

  const radixToPower = goog.math.Long.fromNumber(Math.pow(radix, 8));
  let result = goog.math.Long.ZERO;
  for (let i = 0; i < str.length; i += 8) {
    const size = Math.min(8, str.length - i);
    const value = parseInt(str.substring(i, i + size), radix);
    if (size < 8) {
      const power = goog.math.Long.fromNumber(Math.pow(radix, size));
      result = result.multiply(power).add(goog.math.Long.fromNumber(value));
    } else {
      result = result.multiply(radixToPower);
      result = result.add(goog.math.Long.fromNumber(value));
    }
  }

  return result;
};

goog.math.Long.TWO_PWR_16_DBL_ = 1 << 16;
goog.math.Long.TWO_PWR_24_DBL_ = 1 << 24;
goog.math.Long.TWO_PWR_32_DBL_ = goog.math.Long.TWO_PWR_16_DBL_ * goog.math.Long.TWO_PWR_16_DBL_;
goog.math.Long.TWO_PWR_31_DBL_ = goog.math.Long.TWO_PWR_32_DBL_ / 2;
goog.math.Long.TWO_PWR_48_DBL_ = goog.math.Long.TWO_PWR_32_DBL_ * goog.math.Long.TWO_PWR_16_DBL_;
goog.math.Long.TWO_PWR_64_DBL_ = goog.math.Long.TWO_PWR_32_DBL_ * goog.math.Long.TWO_PWR_32_DBL_;
goog.math.Long.TWO_PWR_63_DBL_ = goog.math.Long.TWO_PWR_64_DBL_ / 2;
goog.math.Long.ZERO = goog.math.Long.fromInt(0);
goog.math.Long.ONE = goog.math.Long.fromInt(1);
goog.math.Long.NEG_ONE = goog.math.Long.fromInt(-1);
goog.math.Long.MAX_VALUE = goog.math.Long.fromBits(4294967295 | 0, 2147483647 | 0);
goog.math.Long.MIN_VALUE = goog.math.Long.fromBits(0, 2147483648 | 0);
goog.math.Long.TWO_PWR_24_ = goog.math.Long.fromInt(1 << 24);
goog.math.Long.prototype.toInt = function() {
  return this.low_;
};

goog.math.Long.prototype.toNumber = function() {
  return this.high_ * goog.math.Long.TWO_PWR_32_DBL_ + this.getLowBitsUnsigned();
};

goog.math.Long.prototype.toString = function(opt_radix) {
  const radix = opt_radix || 10;
  if (radix < 2 || radix > 36) {
    throw Error('radix out of range: ' + radix);
  }

  if (this.isZero()) {
    return '0';
  }

  if (this.isNegative()) {
    if (this.equals(goog.math.Long.MIN_VALUE)) {
      const radixLong = goog.math.Long.fromNumber(radix);
      const div = this.div(radixLong);
      const rem = div.multiply(radixLong).subtract(this);
      return div.toString(radix) + rem.toInt().toString(radix);
    }
    return '-' + this.negate().toString(radix);
  }

  const radixToPower = goog.math.Long.fromNumber(Math.pow(radix, 6));
  let rem = this;
  let result = '';
  while (true) {
    const remDiv = rem.div(radixToPower);
    const intval = rem.subtract(remDiv.multiply(radixToPower)).toInt();
    let digits = intval.toString(radix);
    rem = remDiv;
    if (rem.isZero()) {
      return digits + result;
    }
    while (digits.length < 6) {
      digits = '0' + digits;
    }

    result = '' + digits + result;
  }
};

goog.math.Long.prototype.getHighBits = function() {
  return this.high_;
};

goog.math.Long.prototype.getLowBits = function() {
  return this.low_;
};

goog.math.Long.prototype.getLowBitsUnsigned = function() {
  return this.low_ >= 0 ? this.low_ : goog.math.Long.TWO_PWR_32_DBL_ + this.low_;
};

goog.math.Long.prototype.getNumBitsAbs = function() {
  if (this.isNegative()) {
    if (this.equals(goog.math.Long.MIN_VALUE)) {
      return 64;
    }
    return this.negate().getNumBitsAbs();
  }

  const val = this.high_ !== 0 ? this.high_ : this.low_;
  let bit;
  for (bit = 31; bit > 0; bit--) {
    if ((val & 1 << bit) !== 0) {
      break;
    }
  }

  return this.high_ !== 0 ? bit + 33 : bit + 1;
};

goog.math.Long.prototype.isZero = function() {
  return this.high_ === 0 && this.low_ === 0;
};

goog.math.Long.prototype.isNegative = function() {
  return this.high_ < 0;
};

goog.math.Long.prototype.isOdd = function() {
  return (this.low_ & 1) === 1;
};

goog.math.Long.prototype.equals = function(other) {
  return this.high_ === other.high_ && this.low_ === other.low_;
};

goog.math.Long.prototype.notEquals = function(other) {
  return this.high_ !== other.high_ || this.low_ !== other.low_;
};

goog.math.Long.prototype.lessThan = function(other) {
  return this.compare(other) < 0;
};

goog.math.Long.prototype.lessThanOrEqual = function(other) {
  return this.compare(other) <= 0;
};

goog.math.Long.prototype.greaterThan = function(other) {
  return this.compare(other) > 0;
};

goog.math.Long.prototype.greaterThanOrEqual = function(other) {
  return this.compare(other) >= 0;
};

goog.math.Long.prototype.compare = function(other) {
  if (this.equals(other)) {
    return 0;
  }

  const thisNeg = this.isNegative();
  const otherNeg = other.isNegative();
  if (thisNeg && !otherNeg) {
    return -1;
  }

  if (!thisNeg && otherNeg) {
    return 1;
  }

  if (this.subtract(other).isNegative()) {
    return -1;
  }
  return 1;
};

goog.math.Long.prototype.negate = function() {
  if (this.equals(goog.math.Long.MIN_VALUE)) {
    return goog.math.Long.MIN_VALUE;
  }
  return this.not().add(goog.math.Long.ONE);
};

goog.math.Long.prototype.add = function(other) {
  const a48 = this.high_ >>> 16;
  const a32 = this.high_ & 65535;
  const a16 = this.low_ >>> 16;
  const a00 = this.low_ & 65535;
  const b48 = other.high_ >>> 16;
  const b32 = other.high_ & 65535;
  const b16 = other.low_ >>> 16;
  const b00 = other.low_ & 65535;
  let c48 = 0;
  let c32 = 0;
  let c16 = 0;
  let c00 = 0;
  c00 += a00 + b00;
  c16 += c00 >>> 16;
  c00 &= 65535;
  c16 += a16 + b16;
  c32 += c16 >>> 16;
  c16 &= 65535;
  c32 += a32 + b32;
  c48 += c32 >>> 16;
  c32 &= 65535;
  c48 += a48 + b48;
  c48 &= 65535;
  return goog.math.Long.fromBits(c16 << 16 | c00, c48 << 16 | c32);
};

goog.math.Long.prototype.subtract = function(other) {
  return this.add(other.negate());
};

goog.math.Long.prototype.multiply = function(other) {
  if (this.isZero()) {
    return goog.math.Long.ZERO;
  } else if (other.isZero()) {
    return goog.math.Long.ZERO;
  }

  if (this.equals(goog.math.Long.MIN_VALUE)) {
    return other.isOdd() ? goog.math.Long.MIN_VALUE : goog.math.Long.ZERO;
  } else if (other.equals(goog.math.Long.MIN_VALUE)) {
    return this.isOdd() ? goog.math.Long.MIN_VALUE : goog.math.Long.ZERO;
  }

  if (this.isNegative()) {
    if (other.isNegative()) {
      return this.negate().multiply(other.negate());
    }
    return this.negate().multiply(other).negate();
  } else if (other.isNegative()) {
    return this.multiply(other.negate()).negate();
  }

  if (this.lessThan(goog.math.Long.TWO_PWR_24_) && other.lessThan(goog.math.Long.TWO_PWR_24_)) {
    return goog.math.Long.fromNumber(this.toNumber() * other.toNumber());
  }

  const a48 = this.high_ >>> 16;
  const a32 = this.high_ & 65535;
  const a16 = this.low_ >>> 16;
  const a00 = this.low_ & 65535;
  const b48 = other.high_ >>> 16;
  const b32 = other.high_ & 65535;
  const b16 = other.low_ >>> 16;
  const b00 = other.low_ & 65535;
  let c48 = 0;
  let c32 = 0;
  let c16 = 0;
  let c00 = 0;
  c00 += a00 * b00;
  c16 += c00 >>> 16;
  c00 &= 65535;
  c16 += a16 * b00;
  c32 += c16 >>> 16;
  c16 &= 65535;
  c16 += a00 * b16;
  c32 += c16 >>> 16;
  c16 &= 65535;
  c32 += a32 * b00;
  c48 += c32 >>> 16;
  c32 &= 65535;
  c32 += a16 * b16;
  c48 += c32 >>> 16;
  c32 &= 65535;
  c32 += a00 * b32;
  c48 += c32 >>> 16;
  c32 &= 65535;
  c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
  c48 &= 65535;
  return goog.math.Long.fromBits(c16 << 16 | c00, c48 << 16 | c32);
};

goog.math.Long.prototype.div = function(other) {
  if (other.isZero()) {
    throw Error('division by zero');
  } else if (this.isZero()) {
    return goog.math.Long.ZERO;
  }

  if (this.equals(goog.math.Long.MIN_VALUE)) {
    if (other.equals(goog.math.Long.ONE) || other.equals(goog.math.Long.NEG_ONE)) {
      return goog.math.Long.MIN_VALUE;
    } else if (other.equals(goog.math.Long.MIN_VALUE)) {
      return goog.math.Long.ONE;
    }
    const halfThis = this.shiftRight(1);
    const approx = halfThis.div(other).shiftLeft(1);
    if (approx.equals(goog.math.Long.ZERO)) {
      return other.isNegative() ? goog.math.Long.ONE : goog.math.Long.NEG_ONE;
    }
    const rem = this.subtract(other.multiply(approx));
    const result = approx.add(rem.div(other));
    return result;
  } else if (other.equals(goog.math.Long.MIN_VALUE)) {
    return goog.math.Long.ZERO;
  }

  if (this.isNegative()) {
    if (other.isNegative()) {
      return this.negate().div(other.negate());
    }
    return this.negate().div(other).negate();
  } else if (other.isNegative()) {
    return this.div(other.negate()).negate();
  }

  let res = goog.math.Long.ZERO;
  let rem = this;
  while (rem.greaterThanOrEqual(other)) {
    let approx = Math.max(1, Math.floor(rem.toNumber() / other.toNumber()));
    const log2 = Math.ceil(Math.log(approx) / Math.LN2);
    const delta = log2 <= 48 ? 1 : Math.pow(2, log2 - 48);
    let approxRes = goog.math.Long.fromNumber(approx);
    let approxRem = approxRes.multiply(other);
    while (approxRem.isNegative() || approxRem.greaterThan(rem)) {
      approx -= delta;
      approxRes = goog.math.Long.fromNumber(approx);
      approxRem = approxRes.multiply(other);
    }

    if (approxRes.isZero()) {
      approxRes = goog.math.Long.ONE;
    }

    res = res.add(approxRes);
    rem = rem.subtract(approxRem);
  }

  return res;
};

goog.math.Long.prototype.modulo = function(other) {
  return this.subtract(this.div(other).multiply(other));
};

goog.math.Long.prototype.not = function() {
  return goog.math.Long.fromBits(~this.low_, ~this.high_);
};

goog.math.Long.prototype.and = function(other) {
  return goog.math.Long.fromBits(this.low_ & other.low_, this.high_ & other.high_);
};

goog.math.Long.prototype.or = function(other) {
  return goog.math.Long.fromBits(this.low_ | other.low_, this.high_ | other.high_);
};

goog.math.Long.prototype.xor = function(other) {
  return goog.math.Long.fromBits(this.low_ ^ other.low_, this.high_ ^ other.high_);
};

goog.math.Long.prototype.shiftLeft = function(numBits) {
  numBits &= 63;
  if (numBits === 0) {
    return this;
  }
  const low = this.low_;
  if (numBits < 32) {
    const high = this.high_;
    return goog.math.Long.fromBits(low << numBits, high << numBits | low >>> 32 - numBits);
  }
  return goog.math.Long.fromBits(0, low << numBits - 32);
};

goog.math.Long.prototype.shiftRight = function(numBits) {
  numBits &= 63;
  if (numBits === 0) {
    return this;
  }
  const high = this.high_;
  if (numBits < 32) {
    const low = this.low_;
    return goog.math.Long.fromBits(low >>> numBits | high << 32 - numBits, high >> numBits);
  }
  return goog.math.Long.fromBits(high >> numBits - 32, high >= 0 ? 0 : -1);
};

goog.math.Long.prototype.shiftRightUnsigned = function(numBits) {
  numBits &= 63;
  if (numBits === 0) {
    return this;
  }
  const high = this.high_;
  if (numBits < 32) {
    const low = this.low_;
    return goog.math.Long.fromBits(low >>> numBits | high << 32 - numBits, high >>> numBits);
  } else if (numBits === 32) {
    return goog.math.Long.fromBits(high, 0);
  }
  return goog.math.Long.fromBits(high >>> numBits - 32, 0);
};

const navigator = {
  appName: 'Modern Browser'
};
let dbits;
const canary = 0xdeadbeefcafe;
const j_lm = (canary & 16777215) === 15715070;

function BigInteger(a, b, c) {
  if (a !== null) {
    if (typeof a === 'number') this.fromNumber(a, b, c);
    else if (b === null && typeof a !== 'string') this.fromString(a, 256);
    else this.fromString(a, b);
  }
}

function nbi() {
  return new BigInteger(null);
}

function am1(i, x, w, j, c, n) {
  while (--n >= 0) {
    const v = x * this[i++] + w[j] + c;
    c = Math.floor(v / 67108864);
    w[j++] = v & 67108863;
  }

  return c;
}

function am2(i, x, w, j, c, n) {
  const xl = x & 32767;
  const xh = x >> 15;
  while (--n >= 0) {
    let l = this[i] & 32767;
    const h = this[i++] >> 15;
    const m = xh * l + h * xl;
    l = xl * l + ((m & 32767) << 15) + w[j] + (c & 1073741823);
    c = (l >>> 30) + (m >>> 15) + xh * h + (c >>> 30);
    w[j++] = l & 1073741823;
  }

  return c;
}

function am3(i, x, w, j, c, n) {
  const xl = x & 16383;
  const xh = x >> 14;
  while (--n >= 0) {
    let l = this[i] & 16383;
    const h = this[i++] >> 14;
    const m = xh * l + h * xl;
    l = xl * l + ((m & 16383) << 14) + w[j] + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    w[j++] = l & 268435455;
  }

  return c;
}

if (j_lm && navigator.appName === 'Microsoft Internet Explorer') {
  BigInteger.prototype.am = am2;
  dbits = 30;
} else if (j_lm && navigator.appName !== 'Netscape') {
  BigInteger.prototype.am = am1;
  dbits = 26;
} else {
  BigInteger.prototype.am = am3;
  dbits = 28;
}

BigInteger.prototype.DB = dbits;
BigInteger.prototype.DM = (1 << dbits) - 1;
BigInteger.prototype.DV = 1 << dbits;
const BI_FP = 52;
BigInteger.prototype.FV = Math.pow(2, BI_FP);
BigInteger.prototype.F1 = BI_FP - dbits;
BigInteger.prototype.F2 = 2 * dbits - BI_FP;
const BI_RM = '0123456789abcdefghijklmnopqrstuvwxyz';
const BI_RC = new Array;
let rr;
let vv;
rr = '0'.charCodeAt(0);
for (vv = 0; vv <= 9; ++vv) BI_RC[rr++] = vv;
rr = 'a'.charCodeAt(0);
for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;
rr = 'A'.charCodeAt(0);
for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;

function int2char(n) {
  return BI_RM.charAt(n);
}

function intAt(s, i) {
  const c = BI_RC[s.charCodeAt(i)];
  return c === null ? -1 : c;
}

function bnpCopyTo(r) {
  for (let i = this.t - 1; i >= 0; --i) r[i] = this[i];
  r.t = this.t;
  r.s = this.s;
}

function bnpFromInt(x) {
  this.t = 1;
  this.s = x < 0 ? -1 : 0;
  if (x > 0) this[0] = x;
  else if (x < -1) this[0] = x + this.DV;
  else this.t = 0;
}

function nbv(i) {
  const r = nbi();
  r.fromInt(i);
  return r;
}

function bnpFromString(s, b) {
  let k;
  if (b === 16) k = 4;
  else if (b === 8) k = 3;
  else if (b === 256) k = 8;
  else if (b === 2) k = 1;
  else if (b === 32) k = 5;
  else if (b === 4) k = 2;
  else {
    this.fromRadix(s, b);
    return;
  }

  this.t = 0;
  this.s = 0;
  let i = s.length;
  let mi = false;
  let sh = 0;
  while (--i >= 0) {
    const x = k === 8 ? s[i] & 255 : intAt(s, i);
    if (x < 0) {
      if (s.charAt(i) === '-') mi = true;
      continue;
    }

    mi = false;
    if (sh === 0) this[this.t++] = x;
    else if (sh + k > this.DB) {
      this[this.t - 1] |= (x & (1 << this.DB - sh) - 1) << sh;
      this[this.t++] = x >> this.DB - sh;
    } else this[this.t - 1] |= x << sh;
    sh += k;
    if (sh >= this.DB) sh -= this.DB;
  }

  if (k === 8 && (s[0] & 128) !== 0) {
    this.s = -1;
    if (sh > 0) this[this.t - 1] |= (1 << this.DB - sh) - 1 << sh;
  }

  this.clamp();
  if (mi) BigInteger.ZERO.subTo(this, this);
}

function bnpClamp() {
  const c = this.s & this.DM;
  while (this.t > 0 && this[this.t - 1] === c) --this.t;
}

function bnToString(b) {
  if (this.s < 0) return '-' + this.negate().toString(b);
  let k;
  if (b === 16) k = 4;
  else if (b === 8) k = 3;
  else if (b === 2) k = 1;
  else if (b === 32) k = 5;
  else if (b === 4) k = 2;
  else return this.toRadix(b);
  const km = (1 << k) - 1;
  let d;
  let m = false;
  let r = '';
  let i = this.t;
  let p = this.DB - i * this.DB % k;
  if (i-- > 0) {
    if (p < this.DB && (d = this[i] >> p) > 0) {
      m = true;
      r = int2char(d);
    }

    while (i >= 0) {
      if (p < k) {
        d = (this[i] & (1 << p) - 1) << k - p;
        d |= this[--i] >> (p += this.DB - k);
      } else {
        d = this[i] >> (p -= k) & km;
        if (p <= 0) {
          p += this.DB;
          --i;
        }
      }

      if (d > 0) m = true;
      if (m) r += int2char(d);
    }
  }

  return m ? r : '0';
}

function bnNegate() {
  const r = nbi();
  BigInteger.ZERO.subTo(this, r);
  return r;
}

function bnAbs() {
  return this.s < 0 ? this.negate() : this;
}

function bnCompareTo(a) {
  let r = this.s - a.s;
  if (r !== 0) return r;
  let i = this.t;
  r = i - a.t;
  if (r !== 0) return this.s < 0 ? -r : r;
  while (--i >= 0) {
    if ((r = this[i] - a[i]) !== 0) return r;
  }
  return 0;
}

function nbits(x) {
  let r = 1;
  let t;
  if ((t = x >>> 16) !== 0) {
    x = t;
    r += 16;
  }

  if ((t = x >> 8) !== 0) {
    x = t;
    r += 8;
  }

  if ((t = x >> 4) !== 0) {
    x = t;
    r += 4;
  }

  if ((t = x >> 2) !== 0) {
    x = t;
    r += 2;
  }

  if ((t = x >> 1) !== 0) {
    x = t;
    r += 1;
  }

  return r;
}

function bnBitLength() {
  if (this.t <= 0) return 0;
  return this.DB * (this.t - 1) + nbits(this[this.t - 1] ^ this.s & this.DM);
}

function bnpDLShiftTo(n, r) {
  let i;
  for (i = this.t - 1; i >= 0; --i) r[i + n] = this[i];
  for (i = n - 1; i >= 0; --i) r[i] = 0;
  r.t = this.t + n;
  r.s = this.s;
}

function bnpDRShiftTo(n, r) {
  for (let i = n; i < this.t; ++i) r[i - n] = this[i];
  r.t = Math.max(this.t - n, 0);
  r.s = this.s;
}

function bnpLShiftTo(n, r) {
  const bs = n % this.DB;
  const cbs = this.DB - bs;
  const bm = (1 << cbs) - 1;
  const ds = Math.floor(n / this.DB);
  let c = this.s << bs & this.DM;
  let i;
  for (i = this.t - 1; i >= 0; --i) {
    r[i + ds + 1] = this[i] >> cbs | c;
    c = (this[i] & bm) << bs;
  }

  for (i = ds - 1; i >= 0; --i) r[i] = 0;
  r[ds] = c;
  r.t = this.t + ds + 1;
  r.s = this.s;
  r.clamp();
}

function bnpRShiftTo(n, r) {
  r.s = this.s;
  const ds = Math.floor(n / this.DB);
  if (ds >= this.t) {
    r.t = 0;
    return;
  }

  const bs = n % this.DB;
  const cbs = this.DB - bs;
  const bm = (1 << bs) - 1;
  r[0] = this[ds] >> bs;
  for (let i = ds + 1; i < this.t; ++i) {
    r[i - ds - 1] |= (this[i] & bm) << cbs;
    r[i - ds] = this[i] >> bs;
  }

  if (bs > 0) r[this.t - ds - 1] |= (this.s & bm) << cbs;
  r.t = this.t - ds;
  r.clamp();
}

function bnpSubTo(a, r) {
  let i = 0;
  let c = 0;
  const m = Math.min(a.t, this.t);
  while (i < m) {
    c += this[i] - a[i];
    r[i++] = c & this.DM;
    c >>= this.DB;
  }

  if (a.t < this.t) {
    c -= a.s;
    while (i < this.t) {
      c += this[i];
      r[i++] = c & this.DM;
      c >>= this.DB;
    }

    c += this.s;
  } else {
    c += this.s;
    while (i < a.t) {
      c -= a[i];
      r[i++] = c & this.DM;
      c >>= this.DB;
    }

    c -= a.s;
  }

  r.s = c < 0 ? -1 : 0;
  if (c < -1) r[i++] = this.DV + c;
  else if (c > 0) r[i++] = c;
  r.t = i;
  r.clamp();
}

function bnpMultiplyTo(a, r) {
  const x = this.abs();
  const y = a.abs();
  let i = x.t;
  r.t = i + y.t;
  while (--i >= 0) r[i] = 0;
  for (i = 0; i < y.t; ++i) r[i + x.t] = x.am(0, y[i], r, i, 0, x.t);
  r.s = 0;
  r.clamp();
  if (this.s !== a.s) BigInteger.ZERO.subTo(r, r);
}

function bnpSquareTo(r) {
  const x = this.abs();
  let i = r.t = 2 * x.t;
  while (--i >= 0) r[i] = 0;
  for (i = 0; i < x.t - 1; ++i) {
    const c = x.am(i, x[i], r, 2 * i, 0, 1);
    if ((r[i + x.t] += x.am(i + 1, 2 * x[i], r, 2 * i + 1, c, x.t - i - 1)) >= x.DV) {
      r[i + x.t] -= x.DV;
      r[i + x.t + 1] = 1;
    }
  }

  if (r.t > 0) r[r.t - 1] += x.am(i, x[i], r, 2 * i, 0, 1);
  r.s = 0;
  r.clamp();
}

function bnpDivRemTo(m, q, r) {
  const pm = m.abs();
  if (pm.t <= 0) return;
  const pt = this.abs();
  if (pt.t < pm.t) {
    if (q !== null) q.fromInt(0);
    if (r !== null) this.copyTo(r);
    return;
  }

  if (r === null) r = nbi();
  const y = nbi();
  const ts = this.s;
  const ms = m.s;
  const nsh = this.DB - nbits(pm[pm.t - 1]);
  if (nsh > 0) {
    pm.lShiftTo(nsh, y);
    pt.lShiftTo(nsh, r);
  } else {
    pm.copyTo(y);
    pt.copyTo(r);
  }

  const ys = y.t;
  const y0 = y[ys - 1];
  if (y0 === 0) return;
  const yt = y0 * (1 << this.F1) + (ys > 1 ? y[ys - 2] >> this.F2 : 0);
  const d1 = this.FV / yt;
  const d2 = (1 << this.F1) / yt;
  const e = 1 << this.F2;
  let i = r.t;
  let j = i - ys;
  const t = q === null ? nbi() : q;
  y.dlShiftTo(j, t);
  if (r.compareTo(t) >= 0) {
    r[r.t++] = 1;
    r.subTo(t, r);
  }

  BigInteger.ONE.dlShiftTo(ys, t);
  t.subTo(y, y);
  while (y.t < ys) y[y.t++] = 0;
  while (--j >= 0) {
    let qd = r[--i] === y0 ? this.DM : Math.floor(r[i] * d1 + (r[i - 1] + e) * d2);
    if ((r[i] += y.am(0, qd, r, j, 0, ys)) < qd) {
      y.dlShiftTo(j, t);
      r.subTo(t, r);
      while (r[i] < --qd) r.subTo(t, r);
    }
  }

  if (q !== null) {
    r.drShiftTo(ys, q);
    if (ts !== ms) BigInteger.ZERO.subTo(q, q);
  }

  r.t = ys;
  r.clamp();
  if (nsh > 0) r.rShiftTo(nsh, r);
  if (ts < 0) BigInteger.ZERO.subTo(r, r);
}

function bnMod(a) {
  const r = nbi();
  this.abs().divRemTo(a, null, r);
  if (this.s < 0 && r.compareTo(BigInteger.ZERO) > 0) a.subTo(r, r);
  return r;
}

function Classic(m) {
  this.m = m;
}

function cConvert(x) {
  if (x.s < 0 || x.compareTo(this.m) >= 0) return x.mod(this.m);
  return x;
}

function cRevert(x) {
  return x;
}

function cReduce(x) {
  x.divRemTo(this.m, null, x);
}

function cMulTo(x, y, r) {
  x.multiplyTo(y, r);
  this.reduce(r);
}

function cSqrTo(x, r) {
  x.squareTo(r);
  this.reduce(r);
}

Classic.prototype.convert = cConvert;
Classic.prototype.revert = cRevert;
Classic.prototype.reduce = cReduce;
Classic.prototype.mulTo = cMulTo;
Classic.prototype.sqrTo = cSqrTo;

function bnpInvDigit() {
  if (this.t < 1) return 0;
  const x = this[0];
  if ((x & 1) === 0) return 0;
  let y = x & 3;
  y = y * (2 - (x & 15) * y) & 15;
  y = y * (2 - (x & 255) * y) & 255;
  y = y * (2 - ((x & 65535) * y & 65535)) & 65535;
  y = y * (2 - x * y % this.DV) % this.DV;
  return y > 0 ? this.DV - y : -y;
}

function Montgomery(m) {
  this.m = m;
  this.mp = m.invDigit();
  this.mpl = this.mp & 32767;
  this.mph = this.mp >> 15;
  this.um = (1 << m.DB - 15) - 1;
  this.mt2 = 2 * m.t;
}

function montConvert(x) {
  const r = nbi();
  x.abs().dlShiftTo(this.m.t, r);
  r.divRemTo(this.m, null, r);
  if (x.s < 0 && r.compareTo(BigInteger.ZERO) > 0) this.m.subTo(r, r);
  return r;
}

function montRevert(x) {
  const r = nbi();
  x.copyTo(r);
  this.reduce(r);
  return r;
}

function montReduce(x) {
  while (x.t <= this.mt2) x[x.t++] = 0;
  for (let i = 0; i < this.m.t; ++i) {
    let j = x[i] & 32767;
    const u0 = j * this.mpl + ((j * this.mph + (x[i] >> 15) * this.mpl & this.um) << 15) & x.DM;
    j = i + this.m.t;
    x[j] += this.m.am(0, u0, x, i, 0, this.m.t);
    while (x[j] >= x.DV) {
      x[j] -= x.DV;
      x[++j]++;
    }
  }

  x.clamp();
  x.drShiftTo(this.m.t, x);
  if (x.compareTo(this.m) >= 0) x.subTo(this.m, x);
}

function montSqrTo(x, r) {
  x.squareTo(r);
  this.reduce(r);
}

function montMulTo(x, y, r) {
  x.multiplyTo(y, r);
  this.reduce(r);
}

Montgomery.prototype.convert = montConvert;
Montgomery.prototype.revert = montRevert;
Montgomery.prototype.reduce = montReduce;
Montgomery.prototype.mulTo = montMulTo;
Montgomery.prototype.sqrTo = montSqrTo;

function bnpIsEven() {
  return (this.t > 0 ? this[0] & 1 : this.s) === 0;
}

function bnpExp(e, z) {
  if (e > 4294967295 || e < 1) return BigInteger.ONE;
  let r = nbi();
  let r2 = nbi();
  const g = z.convert(this);
  let i = nbits(e) - 1;
  g.copyTo(r);
  while (--i >= 0) {
    z.sqrTo(r, r2);
    if ((e & 1 << i) > 0) z.mulTo(r2, g, r);
    else {
      const t = r;
      r = r2;
      r2 = t;
    }
  }

  return z.revert(r);
}

function bnModPowInt(e, m) {
  let z;
  if (e < 256 || m.isEven()) z = new Classic(m);
  else z = new Montgomery(m);
  return this.exp(e, z);
}

BigInteger.prototype.copyTo = bnpCopyTo;
BigInteger.prototype.fromInt = bnpFromInt;
BigInteger.prototype.fromString = bnpFromString;
BigInteger.prototype.clamp = bnpClamp;
BigInteger.prototype.dlShiftTo = bnpDLShiftTo;
BigInteger.prototype.drShiftTo = bnpDRShiftTo;
BigInteger.prototype.lShiftTo = bnpLShiftTo;
BigInteger.prototype.rShiftTo = bnpRShiftTo;
BigInteger.prototype.subTo = bnpSubTo;
BigInteger.prototype.multiplyTo = bnpMultiplyTo;
BigInteger.prototype.squareTo = bnpSquareTo;
BigInteger.prototype.divRemTo = bnpDivRemTo;
BigInteger.prototype.invDigit = bnpInvDigit;
BigInteger.prototype.isEven = bnpIsEven;
BigInteger.prototype.exp = bnpExp;
BigInteger.prototype.toString = bnToString;
BigInteger.prototype.negate = bnNegate;
BigInteger.prototype.abs = bnAbs;
BigInteger.prototype.compareTo = bnCompareTo;
BigInteger.prototype.bitLength = bnBitLength;
BigInteger.prototype.mod = bnMod;
BigInteger.prototype.modPowInt = bnModPowInt;
BigInteger.ZERO = nbv(0);
BigInteger.ONE = nbv(1);

function bnpFromRadix(s, b) {
  this.fromInt(0);
  if (b === null) b = 10;
  const cs = this.chunkSize(b);
  const d = Math.pow(b, cs);
  let mi = false;
  let j = 0;
  let w = 0;
  for (let i = 0; i < s.length; ++i) {
    const x = intAt(s, i);
    if (x < 0) {
      if (s.charAt(i) === '-' && this.signum() === 0) mi = true;
      continue;
    }

    w = b * w + x;
    if (++j >= cs) {
      this.dMultiply(d);
      this.dAddOffset(w, 0);
      j = 0;
      w = 0;
    }
  }

  if (j > 0) {
    this.dMultiply(Math.pow(b, j));
    this.dAddOffset(w, 0);
  }

  if (mi) BigInteger.ZERO.subTo(this, this);
}

function bnpChunkSize(r) {
  return Math.floor(Math.LN2 * this.DB / Math.log(r));
}

function bnSigNum() {
  if (this.s < 0) return -1;
  else if (this.t <= 0 || this.t === 1 && this[0] <= 0) return 0;
  return 1;
}

function bnpDMultiply(n) {
  this[this.t] = this.am(0, n - 1, this, 0, 0, this.t);
  ++this.t;
  this.clamp();
}

function bnpDAddOffset(n, w) {
  if (n === 0) return;
  while (this.t <= w) this[this.t++] = 0;
  this[w] += n;
  while (this[w] >= this.DV) {
    this[w] -= this.DV;
    if (++w >= this.t) this[this.t++] = 0;
    ++this[w];
  }
}

function bnpToRadix(b) {
  if (b === null) b = 10;
  if (this.signum() === 0 || b < 2 || b > 36) return '0';
  const cs = this.chunkSize(b);
  const a = Math.pow(b, cs);
  const d = nbv(a);
  const y = nbi();
  const z = nbi();
  let r = '';
  this.divRemTo(d, y, z);
  while (y.signum() > 0) {
    r = (a + z.intValue()).toString(b).substr(1) + r;
    y.divRemTo(d, y, z);
  }

  return z.intValue().toString(b) + r;
}

function bnIntValue() {
  if (this.s < 0) {
    if (this.t === 1) return this[0] - this.DV;
    else if (this.t === 0) return -1;
  } else if (this.t === 1) return this[0];
  else if (this.t === 0) return 0;
  return (this[1] & (1 << 32 - this.DB) - 1) << this.DB | this[0];
}

function bnpAddTo(a, r) {
  const m = Math.min(a.t, this.t);
  let i = 0;
  let c = 0;

  while (i < m) {
    c += this[i] + a[i];
    r[i++] = c & this.DM;
    c >>= this.DB;
  }

  if (a.t < this.t) {
    c += a.s;
    while (i < this.t) {
      c += this[i];
      r[i++] = c & this.DM;
      c >>= this.DB;
    }

    c += this.s;
  } else {
    c += this.s;
    while (i < a.t) {
      c += a[i];
      r[i++] = c & this.DM;
      c >>= this.DB;
    }

    c += a.s;
  }

  r.s = c < 0 ? -1 : 0;
  if (c > 0) r[i++] = c;
  else if (c < -1) r[i++] = this.DV + c;
  r.t = i;
  r.clamp();
}

BigInteger.prototype.fromRadix = bnpFromRadix;
BigInteger.prototype.chunkSize = bnpChunkSize;
BigInteger.prototype.signum = bnSigNum;
BigInteger.prototype.dMultiply = bnpDMultiply;
BigInteger.prototype.dAddOffset = bnpDAddOffset;
BigInteger.prototype.toRadix = bnpToRadix;
BigInteger.prototype.intValue = bnIntValue;
BigInteger.prototype.addTo = bnpAddTo;

module.exports = function(Module) {
  const Wrapper = {
    abs(l, h) {
      const x = new goog.math.Long(l, h);
      let ret;
      if (x.isNegative()) {
        ret = x.negate();
      } else {
        ret = x;
      }

      Module.HEAP32[Module.asmLibraryArg.tempDoublePtr >> 2] = ret.low_;
      Module.HEAP32[Module.asmLibraryArg.tempDoublePtr + 4 >> 2] = ret.high_;
    },

    ensureTemps() {
      if (Wrapper.ensuredTemps) return;
      Wrapper.ensuredTemps = true;
      Wrapper.two32 = new BigInteger;
      Wrapper.two32.fromString('4294967296', 10);
      Wrapper.two64 = new BigInteger;
      Wrapper.two64.fromString('18446744073709551616', 10);
      Wrapper.temp1 = new BigInteger;
      Wrapper.temp2 = new BigInteger;
    },

    lh2bignum(l, h) {
      const a = new BigInteger;
      a.fromString(h.toString(), 10);
      const b = new BigInteger;
      a.multiplyTo(Wrapper.two32, b);
      const c = new BigInteger;
      c.fromString(l.toString(), 10);
      const d = new BigInteger;
      c.addTo(b, d);
      return d;
    },

    stringify(l, h, unsigned) {
      let ret = (new goog.math.Long(l, h)).toString();
      if (unsigned && ret[0] === '-') {
        Wrapper.ensureTemps();
        const bignum = new BigInteger;
        bignum.fromString(ret, 10);
        ret = new BigInteger;
        Wrapper.two64.addTo(bignum, ret);
        ret = ret.toString(10);
      }

      return ret;
    },

    fromString(str, base, min, max, unsigned) {
      Wrapper.ensureTemps();
      let bignum = new BigInteger;
      bignum.fromString(str, base);
      const bigmin = new BigInteger;
      bigmin.fromString(min, 10);
      const bigmax = new BigInteger;
      bigmax.fromString(max, 10);
      if (unsigned && bignum.compareTo(BigInteger.ZERO) < 0) {
        const temp = new BigInteger;
        bignum.addTo(Wrapper.two64, temp);
        bignum = temp;
      }

      let error = false;
      if (bignum.compareTo(bigmin) < 0) {
        bignum = bigmin;
        error = true;
      } else if (bignum.compareTo(bigmax) > 0) {
        bignum = bigmax;
        error = true;
      }

      const ret = goog.math.Long.fromString(bignum.toString());
      Module.HEAP32[Module.asmLibraryArg.tempDoublePtr >> 2] = ret.low_;
      Module.HEAP32[Module.asmLibraryArg.tempDoublePtr + 4 >> 2] = ret.high_;
      if (error) throw 'range error';
    }
  };

  return Wrapper;
}