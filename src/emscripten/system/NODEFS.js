'use strict';

const fs = require('fs');
const ERRNO_CODES = require('../error');

module.exports = function(Module) {
  const PATH = Module.PATH;
  const NODEFS = {
    isWindows: false,
    staticInit() {
      NODEFS.isWindows = !!process.platform.match(/^win/);
    },
    mount(mount) {
      return NODEFS.createNode(null, '/', NODEFS.getMode(mount.opts.root), 0);
    },
    createNode(parent, name, mode, dev) {
      if (!Module.FS.isDir(mode) && !Module.FS.isFile(mode) && !Module.FS.isLink(mode)) {
        throw new Module.FS.ErrnoError(ERRNO_CODES.EINVAL);
      }
      const node = Module.FS.createNode(parent, name, mode);
      node.node_ops = NODEFS.node_ops;
      node.stream_ops = NODEFS.stream_ops;
      return node;
    },
    getMode(path) {
      let stat;
      try {
        stat = fs.lstatSync(path);
        if (NODEFS.isWindows) {
          stat.mode = stat.mode | (stat.mode & 146) >> 1;
        }
      } catch (e) {
        if (!e.code) throw e;
        throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
      }
      return stat.mode;
    },
    realPath(node) {
      const parts = [];
      while (node.parent !== node) {
        parts.push(node.name);
        node = node.parent;
      }
      parts.push(node.mount.opts.root);
      parts.reverse();

      return PATH.join.apply(null, parts);
    },
    flagsToPermissionStringMap: {
      0: 'r',
      1: 'r+',
      2: 'r+',
      64: 'r',
      65: 'r+',
      66: 'r+',
      129: 'rx+',
      193: 'rx+',
      514: 'w+',
      577: 'w',
      578: 'w+',
      705: 'wx',
      706: 'wx+',
      1024: 'a',
      1025: 'a',
      1026: 'a+',
      1089: 'a',
      1090: 'a+',
      1153: 'ax',
      1154: 'ax+',
      1217: 'ax',
      1218: 'ax+',
      4096: 'rs',
      4098: 'rs+'
    },
    flagsToPermissionString(flags) {
      if (flags in NODEFS.flagsToPermissionStringMap) {
        return NODEFS.flagsToPermissionStringMap[flags];
      }
      return flags;
    },
    node_ops: {
      getattr(node) {
        const path = NODEFS.realPath(node);
        let stat;
        try {
          stat = fs.lstatSync(path);
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        if (NODEFS.isWindows && !stat.blksize) {
          stat.blksize = 4096;
        }
        if (NODEFS.isWindows && !stat.blocks) {
          stat.blocks = (stat.size + stat.blksize - 1) / stat.blksize | 0;
        }
        return {
          dev: stat.dev,
          ino: stat.ino,
          mode: stat.mode,
          nlink: stat.nlink,
          uid: stat.uid,
          gid: stat.gid,
          rdev: stat.rdev,
          size: stat.size,
          atime: stat.atime,
          mtime: stat.mtime,
          ctime: stat.ctime,
          blksize: stat.blksize,
          blocks: stat.blocks
        };
      },
      setattr(node, attr) {
        const path = NODEFS.realPath(node);
        try {
          if (attr.mode !== undefined) {
            fs.chmodSync(path, attr.mode);
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            const date = new Date(attr.timestamp);
            fs.utimesSync(path, date, date);
          }
          if (attr.size !== undefined) {
            fs.truncateSync(path, attr.size);
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      },
      lookup(parent, name) {
        const path = PATH.join2(NODEFS.realPath(parent), name);
        const mode = NODEFS.getMode(path);
        return NODEFS.createNode(parent, name, mode);
      },
      mknod(parent, name, mode, dev) {
        const node = NODEFS.createNode(parent, name, mode, dev);
        const path = NODEFS.realPath(node);
        try {
          if (Module.FS.isDir(node.mode)) {
            fs.mkdirSync(path, node.mode);
          } else {
            fs.writeFileSync(path, '', {
              mode: node.mode
            });
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        return node;
      },
      rename(oldNode, newDir, newName) {
        const oldPath = NODEFS.realPath(oldNode);
        const newPath = PATH.join2(NODEFS.realPath(newDir), newName);
        try {
          Module.FS.renameSync(oldPath, newPath);
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      },
      unlink(parent, name) {
        const path = PATH.join2(NODEFS.realPath(parent), name);
        try {
          fs.unlinkSync(path);
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      },
      rmdir(parent, name) {
        const path = PATH.join2(NODEFS.realPath(parent), name);
        try {
          fs.rmdirSync(path);
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      },
      readdir(node) {
        const path = NODEFS.realPath(node);
        try {
          return fs.readdirSync(path);
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      },
      symlink(parent, newName, oldPath) {
        const newPath = PATH.join2(NODEFS.realPath(parent), newName);
        try {
          fs.symlinkSync(oldPath, newPath);
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      },
      readlink(node) {
        const path = NODEFS.realPath(node);
        try {
          return fs.readlinkSync(path);
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      }
    },
    stream_ops: {
      open(stream) {
        const path = NODEFS.realPath(stream.node);
        try {
          if (Module.FS.isFile(stream.node.mode)) {
            stream.nfd = fs.openSync(path, NODEFS.flagsToPermissionString(stream.flags));
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      },
      close(stream) {
        try {
          if (Module.FS.isFile(stream.node.mode) && stream.nfd) {
            fs.closeSync(stream.nfd);
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      },
      read(stream, buffer, offset, length, position) {
        if (length === 0) return 0;
        const nbuffer = new Buffer(length);
        let res;
        try {
          res = fs.readSync(stream.nfd, nbuffer, 0, length, position);
        } catch (e) {
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        if (res > 0) {
          for (let i = 0; i < res; i++) {
            buffer[offset + i] = nbuffer[i];
          }
        }
        return res;
      },
      write(stream, buffer, offset, length, position) {
        const nbuffer = new Buffer(buffer.subarray(offset, offset + length));
        let res;
        try {
          res = fs.writeSync(stream.nfd, nbuffer, 0, length, position);
        } catch (e) {
          throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        return res;
      },
      llseek(stream, offset, whence) {
        let position = offset;
        if (whence === 1) {
          position += stream.position;
        } else if (whence === 2) {
          if (Module.FS.isFile(stream.node.mode)) {
            try {
              const stat = fs.fstatSync(stream.nfd);
              position += stat.size;
            } catch (e) {
              throw new Module.FS.ErrnoError(ERRNO_CODES[e.code]);
            }
          }
        }
        if (position < 0) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        return position;
      }
    }
  };

  return NODEFS;
};
