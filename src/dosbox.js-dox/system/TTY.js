'use strict';

const ERRNO_CODES = require('../error');

const TTY = {
  ttys: [],
  init() {},
  shutdown() {},
  register(dev, ops) {
    TTY.ttys[dev] = {
      input: [],
      output: [],
      ops
    };
    Module.FS.registerDevice(dev, TTY.stream_ops);
  },
  stream_ops: {
    open(stream) {
      const tty = TTY.ttys[stream.node.rdev];
      if (!tty) {
        throw new Module.FS.ErrnoError(ERRNO_CODES.ENODEV);
      }
      stream.tty = tty;
      stream.seekable = false;
    },
    close(stream) {
      stream.tty.ops.flush(stream.tty);
    },
    flush(stream) {
      stream.tty.ops.flush(stream.tty);
    },
    read(stream, buffer, offset, length, pos) {
      if (!stream.tty || !stream.tty.ops.get_char) {
        throw new Module.FS.ErrnoError(ERRNO_CODES.ENXIO);
      }
      let bytesRead = 0;
      for (let i = 0; i < length; i++) {
        let result;
        try {
          result = stream.tty.ops.get_char(stream.tty);
        } catch (e) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.EIO);
        }
        if (result === undefined && bytesRead === 0) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.EAGAIN);
        }
        if (result === null || result === undefined) break;
        bytesRead++;
        buffer[offset + i] = result;
      }
      if (bytesRead) {
        stream.node.timestamp = Date.now();
      }
      return bytesRead;
    },
    write(stream, buffer, offset, length, pos) {
      if (!stream.tty || !stream.tty.ops.put_char) {
        throw new Module.FS.ErrnoError(ERRNO_CODES.ENXIO);
      }
      let i;
      for (i = 0; i < length; i++) {
        try {
          stream.tty.ops.put_char(stream.tty, buffer[offset + i]);
        } catch (e) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.EIO);
        }
      }
      if (length) {
        stream.node.timestamp = Date.now();
      }
      return i;
    }
  },
  default_tty_ops: {
    get_char(tty) {
      if (!tty.input.length) {
        let result = null;
        result = process.stdin.read();
        if (!result) {
          if (process.stdin._readableState && process.stdin._readableState.ended) {
            return null;
          }
          return undefined;
        }
        if (!result) {
          return null;
        }
        tty.input = Module.intArrayFromString(result, true);
      }
      return tty.input.shift();
    },
    put_char(tty, val) {
      if (val === null || val === 10) {
        Module.print(Module.UTF8ArrayToString(tty.output, 0));
        tty.output = [];
      } else {
        if (val !== 0) tty.output.push(val);
      }
    },
    flush(tty) {
      if (tty.output && tty.output.length > 0) {
        Module.print(Module.UTF8ArrayToString(tty.output, 0));
        tty.output = [];
      }
    }
  },
  default_tty1_ops: {
    put_char(tty, val) {
      if (val === null || val === 10) {
        Module.printErr(Module.UTF8ArrayToString(tty.output, 0));
        tty.output = [];
      } else {
        if (val !== 0) tty.output.push(val);
      }
    },
    flush(tty) {
      if (tty.output && tty.output.length > 0) {
        Module.printErr(Module.UTF8ArrayToString(tty.output, 0));
        tty.output = [];
      }
    }
  }
};

module.exports = TTY;
