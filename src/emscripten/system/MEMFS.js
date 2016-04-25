'use strict';

const ERRNO_CODES = require('../error');

module.exports = function(Module, assert) {
  const MEMFS = {
    ops_table: null,
    mount(mount) {
      return MEMFS.createNode(null, '/', 16384 | 511, 0);
    },
    createNode(parent, name, mode, dev) {
      if (Module.FS.isBlkdev(mode) || Module.FS.isFIFO(mode)) {
        throw new Module.FS.ErrnoError(ERRNO_CODES.EPERM);
      }
      if (!MEMFS.ops_table) {
        MEMFS.ops_table = {
          dir: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              lookup: MEMFS.node_ops.lookup,
              mknod: MEMFS.node_ops.mknod,
              rename: MEMFS.node_ops.rename,
              unlink: MEMFS.node_ops.unlink,
              rmdir: MEMFS.node_ops.rmdir,
              readdir: MEMFS.node_ops.readdir,
              symlink: MEMFS.node_ops.symlink
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek
            }
          },
          file: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek,
              read: MEMFS.stream_ops.read,
              write: MEMFS.stream_ops.write,
              allocate: MEMFS.stream_ops.allocate,
              mmap: MEMFS.stream_ops.mmap
            }
          },
          link: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              readlink: MEMFS.node_ops.readlink
            },
            stream: {}
          },
          chrdev: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: Module.FS.chrdev_stream_ops
          }
        };
      }
      const node = Module.FS.createNode(parent, name, mode, dev);
      if (Module.FS.isDir(node.mode)) {
        node.node_ops = MEMFS.ops_table.dir.node;
        node.stream_ops = MEMFS.ops_table.dir.stream;
        node.contents = {};
      } else if (Module.FS.isFile(node.mode)) {
        node.node_ops = MEMFS.ops_table.file.node;
        node.stream_ops = MEMFS.ops_table.file.stream;
        node.usedBytes = 0;
        node.contents = null;
      } else if (Module.FS.isLink(node.mode)) {
        node.node_ops = MEMFS.ops_table.link.node;
        node.stream_ops = MEMFS.ops_table.link.stream;
      } else if (Module.FS.isChrdev(node.mode)) {
        node.node_ops = MEMFS.ops_table.chrdev.node;
        node.stream_ops = MEMFS.ops_table.chrdev.stream;
      }
      node.timestamp = Date.now();
      if (parent) {
        parent.contents[name] = node;
      }
      return node;
    },
    getFileDataAsRegularArray(node) {
      if (node.contents && node.contents.subarray) {
        const arr = [];
        for (let i = 0; i < node.usedBytes; ++i) arr.push(node.contents[i]);
        return arr;
      }
      return node.contents;
    },
    getFileDataAsTypedArray(node) {
      if (!node.contents) return new Uint8Array;
      if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes);
      return new Uint8Array(node.contents);
    },
    expandFileStorage(node, newCapacity) {
      if (node.contents && node.contents.subarray && newCapacity > node.contents.length) {
        node.contents = MEMFS.getFileDataAsRegularArray(node);
        node.usedBytes = node.contents.length;
      }
      if (!node.contents || node.contents.subarray) {
        const prevCapacity = node.contents ? node.contents.buffer.byteLength : 0;
        if (prevCapacity >= newCapacity) return;
        const CAPACITY_DOUBLING_MAX = 1024 * 1024;
        newCapacity = Math.max(newCapacity,
          prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2 : 1.125) | 0);

        if (prevCapacity !== 0) newCapacity = Math.max(newCapacity, 256);
        const oldContents = node.contents;
        node.contents = new Uint8Array(newCapacity);
        if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0);
        return;
      }
      if (!node.contents && newCapacity > 0) node.contents = [];
      while (node.contents.length < newCapacity) node.contents.push(0);
    },
    resizeFileStorage(node, newSize) {
      if (node.usedBytes === newSize) return;
      if (newSize === 0) {
        node.contents = null;
        node.usedBytes = 0;
        return;
      }
      if (!node.contents || node.contents.subarray) {
        const oldContents = node.contents;
        node.contents = new Uint8Array(new ArrayBuffer(newSize));
        if (oldContents) {
          node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes)));
        }
        node.usedBytes = newSize;
        return;
      }
      if (!node.contents) node.contents = [];
      if (node.contents.length > newSize) {
        node.contents.length = newSize;
      } else {
        while (node.contents.length < newSize) node.contents.push(0);
      }
      node.usedBytes = newSize;
    },
    node_ops: {
      getattr(node) {
        const attr = {};
        attr.dev = Module.FS.isChrdev(node.mode) ? node.id : 1;
        attr.ino = node.id;
        attr.mode = node.mode;
        attr.nlink = 1;
        attr.uid = 0;
        attr.gid = 0;
        attr.rdev = node.rdev;
        if (Module.FS.isDir(node.mode)) {
          attr.size = 4096;
        } else if (Module.FS.isFile(node.mode)) {
          attr.size = node.usedBytes;
        } else if (Module.FS.isLink(node.mode)) {
          attr.size = node.link.length;
        } else {
          attr.size = 0;
        }
        attr.atime = new Date(node.timestamp);
        attr.mtime = new Date(node.timestamp);
        attr.ctime = new Date(node.timestamp);
        attr.blksize = 4096;
        attr.blocks = Math.ceil(attr.size / attr.blksize);
        return attr;
      },
      setattr(node, attr) {
        if (attr.mode !== undefined) {
          node.mode = attr.mode;
        }
        if (attr.timestamp !== undefined) {
          node.timestamp = attr.timestamp;
        }
        if (attr.size !== undefined) {
          MEMFS.resizeFileStorage(node, attr.size);
        }
      },
      lookup(parent, name) {
        throw Module.FS.genericErrors[ERRNO_CODES.ENOENT];
      },
      mknod(parent, name, mode, dev) {
        return MEMFS.createNode(parent, name, mode, dev);
      },
      rename(old_node, new_dir, new_name) {
        if (Module.FS.isDir(old_node.mode)) {
          let new_node;
          try {
            new_node = Module.FS.lookupNode(new_dir, new_name);
          } catch (e) {
            //
          }
          if (new_node) {
            for (const i in new_node.contents) {
              throw new Module.FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
            }
          }
        }
        delete old_node.parent.contents[old_node.name];
        old_node.name = new_name;
        new_dir.contents[new_name] = old_node;
        old_node.parent = new_dir;
      },
      unlink(parent, name) {
        delete parent.contents[name];
      },
      rmdir(parent, name) {
        const node = Module.FS.lookupNode(parent, name);
        for (const i in node.contents) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
        }
        delete parent.contents[name];
      },
      readdir(node) {
        const entries = ['.', '..'];
        for (const key in node.contents) {
          if (!node.contents.hasOwnProperty(key)) {
            continue;
          }
          entries.push(key);
        }
        return entries;
      },
      symlink(parent, newname, oldpath) {
        const node = MEMFS.createNode(parent, newname, 511 | 40960, 0);
        node.link = oldpath;
        return node;
      },
      readlink(node) {
        if (!Module.FS.isLink(node.mode)) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        return node.link;
      }
    },
    stream_ops: {
      read(stream, buffer, offset, length, position) {
        const contents = stream.node.contents;
        if (position >= stream.node.usedBytes) return 0;
        const size = Math.min(stream.node.usedBytes - position, length);
        assert(size >= 0);
        if (size > 8 && contents.subarray) {
          buffer.set(contents.subarray(position, position + size), offset);
        } else {
          for (let i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
        }
        return size;
      },
      write(stream, buffer, offset, length, position, canOwn) {
        if (!length) return 0;
        const node = stream.node;
        node.timestamp = Date.now();
        if (buffer.subarray && (!node.contents || node.contents.subarray)) {
          if (canOwn) {
            node.contents = buffer.subarray(offset, offset + length);
            node.usedBytes = length;
            return length;
          } else if (node.usedBytes === 0 && position === 0) {
            node.contents = new Uint8Array(buffer.subarray(offset, offset + length));
            node.usedBytes = length;
            return length;
          } else if (position + length <= node.usedBytes) {
            node.contents.set(buffer.subarray(offset, offset + length), position);
            return length;
          }
        }
        MEMFS.expandFileStorage(node, position + length);
        if (node.contents.subarray && buffer.subarray) {
          node.contents.set(buffer.subarray(offset, offset + length), position);
        } else {
          for (let i = 0; i < length; i++) {
            node.contents[position + i] = buffer[offset + i];
          }
        }
        node.usedBytes = Math.max(node.usedBytes, position + length);
        return length;
      },
      llseek(stream, offset, whence) {
        let position = offset;
        if (whence === 1) {
          position += stream.position;
        } else if (whence === 2) {
          if (Module.FS.isFile(stream.node.mode)) {
            position += stream.node.usedBytes;
          }
        }
        if (position < 0) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        return position;
      },
      allocate(stream, offset, length) {
        MEMFS.expandFileStorage(stream.node, offset + length);
        stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
      },
      mmap(stream, buffer, offset, length, position, prot, flags) {
        if (!Module.FS.isFile(stream.node.mode)) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.ENODEV);
        }
        let ptr;
        let allocated;
        let contents = stream.node.contents;
        if (!(flags & 2) && (contents.buffer === buffer || contents.buffer === buffer.buffer)) {
          allocated = false;
          ptr = contents.byteOffset;
        } else {
          if (position > 0 || position + length < stream.node.usedBytes) {
            if (contents.subarray) {
              contents = contents.subarray(position, position + length);
            } else {
              contents = Array.prototype.slice.call(contents, position, position + length);
            }
          }
          allocated = true;
          ptr = Module._malloc(length);
          if (!ptr) {
            throw new Module.FS.ErrnoError(ERRNO_CODES.ENOMEM);
          }
          buffer.set(contents, ptr);
        }
        return { ptr, allocated };
      }
    }
  };

  return MEMFS;
};
