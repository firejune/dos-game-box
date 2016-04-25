'use strict';

const ERRNO_CODES = require('../error');
const ERRNO_MESSAGES = require('../message');

module.exports = function(Module, Browser, _stdin, _stdout, _stderr, assert, ___setErrNo) {
  const TTY = Module.TTY;
  const PATH = Module.PATH;
  const MEMFS = require('./MEMFS')(Module, assert);

  const FS = {
    root: null,
    mounts: [],
    devices: [null],
    streams: [],
    nextInode: 1,
    nameTable: null,
    currentPath: '/',
    initialized: false,
    ignorePermissions: true,
    trackingDelegate: {},
    tracking: {
      openFlags: {
        READ: 1,
        WRITE: 2
      }
    },
    ErrnoError: null,
    genericErrors: {},
    handleFSError(e) {
      if (!(e instanceof FS.ErrnoError)) throw new Error(`${e} : ${Module.stackTrace()}`);
      return ___setErrNo(e.errno);
    },

    lookupPath(path, opts) {
      path = PATH.resolve(FS.cwd(), path);
      opts = opts || {};
      if (!path) {
        return {
          path: '',
          node: null
        };
      }
      const defaults = {
        follow_mount: true,
        recurse_count: 0
      };

      for (const key in defaults) {
        if (opts[key] === undefined) {
          opts[key] = defaults[key];
        }
      }

      if (opts.recurse_count > 8) {
        throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
      }

      const parts = PATH.normalizeArray(path.split('/').filter(p => !!p), false);
      let current = FS.root;
      let current_path = '/';
      for (let i = 0; i < parts.length; i++) {
        const islast = i === parts.length - 1;
        if (islast && opts.parent) {
          break;
        }

        current = FS.lookupNode(current, parts[i]);
        current_path = PATH.join2(current_path, parts[i]);
        if (FS.isMountpoint(current)) {
          if (!islast || islast && opts.follow_mount) {
            current = current.mounted.root;
          }
        }

        if (!islast || opts.follow) {
          let count = 0;
          while (FS.isLink(current.mode)) {
            const link = FS.readlink(current_path);
            current_path = PATH.resolve(PATH.dirname(current_path), link);
            const lookup = FS.lookupPath(current_path, {
              recurse_count: opts.recurse_count
            });
            current = lookup.node;
            if (count++ > 40) {
              throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
            }
          }
        }
      }

      return {
        path: current_path,
        node: current
      };
    },

    getPath(node) {
      let path;
      while (true) {
        if (FS.isRoot(node)) {
          const mount = node.mount.mountpoint;
          if (!path) return mount;
          return mount[mount.length - 1] !== '/' ? `${mount}/${path}` : mount + path;
        }

        path = path ? `${node.name}/${path}` : node.name;
        node = node.parent;
      }
    },

    hashName(parentid, name) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = (hash << 5) - hash + name.charCodeAt(i) | 0;
      }

      return (parentid + hash >>> 0) % FS.nameTable.length;
    },

    hashAddNode(node) {
      const hash = FS.hashName(node.parent.id, node.name);
      node.name_next = FS.nameTable[hash];
      FS.nameTable[hash] = node;
    },

    hashRemoveNode(node) {
      const hash = FS.hashName(node.parent.id, node.name);
      if (FS.nameTable[hash] === node) {
        FS.nameTable[hash] = node.name_next;
      } else {
        let current = FS.nameTable[hash];
        while (current) {
          if (current.name_next === node) {
            current.name_next = node.name_next;
            break;
          }

          current = current.name_next;
        }
      }
    },

    lookupNode(parent, name) {
      const err = FS.mayLookup(parent);
      if (err) {
        throw new FS.ErrnoError(err, parent);
      }

      const hash = FS.hashName(parent.id, name);
      for (let node = FS.nameTable[hash]; node; node = node.name_next) {
        const nodeName = node.name;
        if (node.parent.id === parent.id && nodeName === name) {
          return node;
        }
      }

      return FS.lookup(parent, name);
    },

    createNode(parent, name, mode, rdev) {
      if (!FS.FSNode) {
        FS.FSNode = function(_parent, _name, _mode, _rdev) {
          if (!_parent) {
            _parent = this;
          }

          this.parent = _parent;
          this.mount = _parent.mount;
          this.mounted = null;
          this.id = FS.nextInode++;
          this.name = _name;
          this.mode = _mode;
          this.node_ops = {};
          this.stream_ops = {};
          this.rdev = _rdev;
        };

        FS.FSNode.prototype = {};
        const readMode = 292 | 73;
        const writeMode = 146;
        Object.defineProperties(FS.FSNode.prototype, {
          read: {
            get() {
              return (this.mode & readMode) === readMode;
            },

            set(val) {
              val ? this.mode |= readMode : this.mode &= ~readMode;
            }
          },
          write: {
            get() {
              return (this.mode & writeMode) === writeMode;
            },

            set(val) {
              val ? this.mode |= writeMode : this.mode &= ~writeMode;
            }
          },
          isFolder: {
            get() {
              return FS.isDir(this.mode);
            }
          },

          isDevice: {
            get() {
              return FS.isChrdev(this.mode);
            }
          }
        });
      }

      const node = new FS.FSNode(parent, name, mode, rdev);
      FS.hashAddNode(node);
      return node;
    },

    destroyNode(node) {
      FS.hashRemoveNode(node);
    },

    isRoot(node) {
      return node === node.parent;
    },

    isMountpoint(node) {
      return !!node.mounted;
    },

    isFile(mode) {
      return (mode & 61440) === 32768;
    },

    isDir(mode) {
      return (mode & 61440) === 16384;
    },

    isLink(mode) {
      return (mode & 61440) === 40960;
    },

    isChrdev(mode) {
      return (mode & 61440) === 8192;
    },

    isBlkdev(mode) {
      return (mode & 61440) === 24576;
    },

    isFIFO(mode) {
      return (mode & 61440) === 4096;
    },

    isSocket(mode) {
      return (mode & 49152) === 49152;
    },

    flagModes: {
      r: 0,
      rs: 1052672,
      'r+': 2,
      w: 577,
      wx: 705,
      xw: 705,
      'w+': 578,
      'wx+': 706,
      'xw+': 706,
      a: 1089,
      ax: 1217,
      xa: 1217,
      'a+': 1090,
      'ax+': 1218,
      'xa+': 1218
    },

    modeStringToFlags(str) {
      const flags = FS.flagModes[str];
      if (typeof flags === 'undefined') {
        throw new Error(`Unknown file open mode: ${str}`);
      }

      return flags;
    },

    flagsToPermissionString(flag) {
      const accmode = flag & 2097155;
      let perms = ['r', 'w', 'rw'][accmode];
      if (flag & 512) {
        perms += 'w';
      }

      return perms;
    },

    nodePermissions(node, perms) {
      if (FS.ignorePermissions) {
        return 0;
      }

      if (perms.indexOf('r') !== -1 && !(node.mode & 292)) {
        return ERRNO_CODES.EACCES;
      } else if (perms.indexOf('w') !== -1 && !(node.mode & 146)) {
        return ERRNO_CODES.EACCES;
      } else if (perms.indexOf('x') !== -1 && !(node.mode & 73)) {
        return ERRNO_CODES.EACCES;
      }

      return 0;
    },

    mayLookup(dir) {
      const err = FS.nodePermissions(dir, 'x');
      if (err) return err;
      if (!dir.node_ops.lookup) return ERRNO_CODES.EACCES;
      return 0;
    },

    mayCreate(dir, name) {
      try {
        // const node =
        FS.lookupNode(dir, name);
        return ERRNO_CODES.EEXIST;
      } catch (e) {
        //
      }
      return FS.nodePermissions(dir, 'wx');
    },

    mayDelete(dir, name, isdir) {
      let node;
      try {
        node = FS.lookupNode(dir, name);
      } catch (e) {
        return e.errno;
      }
      const err = FS.nodePermissions(dir, 'wx');
      if (err) {
        return err;
      }

      if (isdir) {
        if (!FS.isDir(node.mode)) {
          return ERRNO_CODES.ENOTDIR;
        }
        if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
          return ERRNO_CODES.EBUSY;
        }
      } else {
        if (FS.isDir(node.mode)) {
          return ERRNO_CODES.EISDIR;
        }
      }

      return 0;
    },

    mayOpen(node, flags) {
      if (!node) {
        return ERRNO_CODES.ENOENT;
      }

      if (FS.isLink(node.mode)) {
        return ERRNO_CODES.ELOOP;
      } else if (FS.isDir(node.mode)) {
        if ((flags & 2097155) !== 0 || flags & 512) {
          return ERRNO_CODES.EISDIR;
        }
      }

      return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
    },

    MAX_OPEN_FDS: 4096,
    nextfd(fd_start, fd_end) {
      fd_start = fd_start || 0;
      fd_end = fd_end || FS.MAX_OPEN_FDS;
      for (let fd = fd_start; fd <= fd_end; fd++) {
        if (!FS.streams[fd]) {
          return fd;
        }
      }

      throw new FS.ErrnoError(ERRNO_CODES.EMFILE);
    },

    getStream(fd) {
      return FS.streams[fd];
    },

    createStream(stream, fd_start, fd_end) {
      if (!FS.FSStream) {
        FS.FSStream = function() {};

        FS.FSStream.prototype = {};
        Object.defineProperties(FS.FSStream.prototype, {
          object: {
            get() {
              return this.node;
            },

            set(val) {
              this.node = val;
            }
          },
          isRead: {
            get() {
              return (this.flags & 2097155) !== 1;
            }
          },
          isWrite: {
            get() {
              return (this.flags & 2097155) !== 0;
            }
          },
          isAppend: {
            get() {
              return this.flags & 1024;
            }
          }
        });
      }

      const newStream = new FS.FSStream;
      for (const p in stream) {
        newStream[p] = stream[p];
      }

      stream = newStream;
      const fd = FS.nextfd(fd_start, fd_end);
      stream.fd = fd;
      FS.streams[fd] = stream;
      return stream;
    },

    closeStream(fd) {
      FS.streams[fd] = null;
    },

    getStreamFromPtr(ptr) {
      return FS.streams[ptr - 1];
    },

    getPtrForStream(stream) {
      return stream ? stream.fd + 1 : 0;
    },

    chrdev_stream_ops: {
      open(stream) {
        const device = FS.getDevice(stream.node.rdev);
        stream.stream_ops = device.stream_ops;
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
      },
      llseek() {
        throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
      }
    },

    major(dev) {
      return dev >> 8;
    },

    minor(dev) {
      return dev & 255;
    },

    makedev(ma, mi) {
      return ma << 8 | mi;
    },

    registerDevice(dev, ops) {
      FS.devices[dev] = {
        stream_ops: ops
      };
    },

    getDevice(dev) {
      return FS.devices[dev];
    },

    getMounts(mount) {
      const mounts = [];
      const check = [mount];
      while (check.length) {
        const m = check.pop();
        mounts.push(m);
        check.push.apply(check, m.mounts);
      }

      return mounts;
    },

    syncfs(populate, callback) {
      if (typeof populate === 'function') {
        callback = populate;
        populate = false;
      }

      const mounts = FS.getMounts(FS.root.mount);
      let completed = 0;

      function done(err) {
        if (err) {
          if (!done.errored) {
            done.errored = true;
            return callback(err);
          }

          return;
        }

        if (++completed >= mounts.length) {
          callback(null);
        }
      }

      mounts.forEach(mount => {
        if (!mount.type.syncfs) {
          return done(null);
        }

        mount.type.syncfs(mount, populate, done);
      });
    },

    mount(type, opts, mountpoint) {
      const root = mountpoint === '/';
      const pseudo = !mountpoint;
      let node;
      if (root && FS.root) {
        throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
      } else if (!root && !pseudo) {
        const lookup = FS.lookupPath(mountpoint, {
          follow_mount: false
        });
        mountpoint = lookup.path;
        node = lookup.node;
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }

        if (!FS.isDir(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
        }
      }

      const mount = {
        type,
        opts,
        mountpoint,
        mounts: []
      };
      const mountRoot = type.mount(mount);
      mountRoot.mount = mount;
      mount.root = mountRoot;
      if (root) {
        FS.root = mountRoot;
      } else if (node) {
        node.mounted = mount;
        if (node.mount) {
          node.mount.mounts.push(mount);
        }
      }

      return mountRoot;
    },

    unmount(mountpoint) {
      const lookup = FS.lookupPath(mountpoint, {
        follow_mount: false
      });
      if (!FS.isMountpoint(lookup.node)) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      const node = lookup.node;
      const mount = node.mounted;
      const mounts = FS.getMounts(mount);
      Object.keys(FS.nameTable).forEach(hash => {
        let current = FS.nameTable[hash];
        while (current) {
          const next = current.name_next;
          if (mounts.indexOf(current.mount) !== -1) {
            FS.destroyNode(current);
          }
          current = next;
        }
      });

      node.mounted = null;
      const idx = node.mount.mounts.indexOf(mount);
      assert(idx !== -1);
      node.mount.mounts.splice(idx, 1);
    },

    lookup(parent, name) {
      return parent.node_ops.lookup(parent, name);
    },

    mknod(path, mode, dev) {
      const lookup = FS.lookupPath(path, {
        parent: true
      });
      const parent = lookup.node;
      const name = PATH.basename(path);
      if (!name || name === '.' || name === '..') {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      const err = FS.mayCreate(parent, name);
      if (err) {
        throw new FS.ErrnoError(err);
      }

      if (!parent.node_ops.mknod) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      return parent.node_ops.mknod(parent, name, mode, dev);
    },

    create(path, mode) {
      mode = mode !== undefined ? mode : 438;
      mode &= 4095;
      mode |= 32768;
      return FS.mknod(path, mode, 0);
    },

    mkdir(path, mode) {
      mode = mode !== undefined ? mode : 511;
      mode &= 511 | 512;
      mode |= 16384;
      return FS.mknod(path, mode, 0);
    },

    mkdev(path, mode, dev) {
      if (typeof dev === 'undefined') {
        dev = mode;
        mode = 438;
      }

      mode |= 8192;
      return FS.mknod(path, mode, dev);
    },

    symlink(oldpath, newpath) {
      if (!PATH.resolve(oldpath)) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      const lookup = FS.lookupPath(newpath, {
        parent: true
      });
      const parent = lookup.node;
      if (!parent) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      const newname = PATH.basename(newpath);
      const err = FS.mayCreate(parent, newname);
      if (err) {
        throw new FS.ErrnoError(err);
      }

      if (!parent.node_ops.symlink) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      return parent.node_ops.symlink(parent, newname, oldpath);
    },

    rename(old_path, new_path) {
      const old_dirname = PATH.dirname(old_path);
      const new_dirname = PATH.dirname(new_path);
      const old_name = PATH.basename(old_path);
      const new_name = PATH.basename(new_path);
      let lookup;
      let old_dir;
      let new_dir;
      try {
        lookup = FS.lookupPath(old_path, {
          parent: true
        });
        old_dir = lookup.node;
        lookup = FS.lookupPath(new_path, {
          parent: true
        });
        new_dir = lookup.node;
      } catch (e) {
        throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
      }
      if (!old_dir || !new_dir) throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      if (old_dir.mount !== new_dir.mount) {
        throw new FS.ErrnoError(ERRNO_CODES.EXDEV);
      }

      const old_node = FS.lookupNode(old_dir, old_name);
      let relative = PATH.relative(old_path, new_dirname);
      if (relative.charAt(0) !== '.') {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      relative = PATH.relative(new_path, old_dirname);
      if (relative.charAt(0) !== '.') {
        throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
      }

      let new_node;
      try {
        new_node = FS.lookupNode(new_dir, new_name);
      } catch (e) {
        //
      }

      if (old_node === new_node) {
        return;
      }

      const isdir = FS.isDir(old_node.mode);
      let err = FS.mayDelete(old_dir, old_name, isdir);
      if (err) {
        throw new FS.ErrnoError(err);
      }

      err = new_node ? FS.mayDelete(new_dir, new_name, isdir) : FS.mayCreate(new_dir, new_name);
      if (err) {
        throw new FS.ErrnoError(err);
      }

      if (!old_dir.node_ops.rename) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      if (FS.isMountpoint(old_node) || new_node && FS.isMountpoint(new_node)) {
        throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
      }

      if (new_dir !== old_dir) {
        err = FS.nodePermissions(old_dir, 'w');
        if (err) {
          throw new FS.ErrnoError(err);
        }
      }

      try {
        if (FS.trackingDelegate.willMovePath) {
          FS.trackingDelegate.willMovePath(old_path, new_path);
        }
      } catch (e) {
        console.log(`FS.trackingDelegate.willMovePath('${old_path}', '${new_path}')
          threw an exception: ${e.message}`);
      }
      FS.hashRemoveNode(old_node);
      try {
        old_dir.node_ops.rename(old_node, new_dir, new_name);
      } catch (e) {
        throw e;
      } finally {
        FS.hashAddNode(old_node);
      }

      try {
        if (FS.trackingDelegate.onMovePath) FS.trackingDelegate.onMovePath(old_path, new_path);
      } catch (e) {
        console.log(`FS.trackingDelegate.onMovePath('${old_path}', '${new_path}')
          threw an exception: ${e.message}`);
      }
    },

    rmdir(path) {
      const lookup = FS.lookupPath(path, {
        parent: true
      });
      const parent = lookup.node;
      const name = PATH.basename(path);
      const node = FS.lookupNode(parent, name);
      const err = FS.mayDelete(parent, name, true);
      if (err) {
        throw new FS.ErrnoError(err);
      }

      if (!parent.node_ops.rmdir) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      if (FS.isMountpoint(node)) {
        throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
      }

      try {
        if (FS.trackingDelegate.willDeletePath) {
          FS.trackingDelegate.willDeletePath(path);
        }
      } catch (e) {
        console.log(`FS.trackingDelegate.willDeletePath('${path}')
          threw an exception: ${e.message}`);
      }
      parent.node_ops.rmdir(parent, name);
      FS.destroyNode(node);
      try {
        if (FS.trackingDelegate.onDeletePath) FS.trackingDelegate.onDeletePath(path);
      } catch (e) {
        console.log(`FS.trackingDelegate.onDeletePath('${path}') threw an exception: ${e.message}`);
      }
    },

    readdir(path) {
      const lookup = FS.lookupPath(path, {
        follow: true
      });
      const node = lookup.node;
      if (!node.node_ops.readdir) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
      }

      return node.node_ops.readdir(node);
    },

    unlink(path) {
      const lookup = FS.lookupPath(path, {
        parent: true
      });
      const parent = lookup.node;
      const name = PATH.basename(path);
      const node = FS.lookupNode(parent, name);
      let err = FS.mayDelete(parent, name, false);
      if (err) {
        if (err === ERRNO_CODES.EISDIR) err = ERRNO_CODES.EPERM;
        throw new FS.ErrnoError(err);
      }

      if (!parent.node_ops.unlink) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      if (FS.isMountpoint(node)) {
        throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
      }

      try {
        if (FS.trackingDelegate.willDeletePath) {
          FS.trackingDelegate.willDeletePath(path);
        }
      } catch (e) {
        console.log(`FS.trackingDelegate.willDeletePath('${path}')
          threw an exception: ${e.message}`);
      }
      parent.node_ops.unlink(parent, name);
      FS.destroyNode(node);
      try {
        if (FS.trackingDelegate.onDeletePath) FS.trackingDelegate.onDeletePath(path);
      } catch (e) {
        console.log(`FS.trackingDelegate.onDeletePath('${path}') threw an exception: ${e.message}`);
      }
    },

    readlink(path) {
      const lookup = FS.lookupPath(path);
      const link = lookup.node;
      if (!link) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      if (!link.node_ops.readlink) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      return link.node_ops.readlink(link);
    },

    stat(path, dontFollow) {
      const lookup = FS.lookupPath(path, {
        follow: !dontFollow
      });
      const node = lookup.node;
      if (!node) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      if (!node.node_ops.getattr) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      return node.node_ops.getattr(node);
    },

    lstat(path) {
      return FS.stat(path, true);
    },

    chmod(path, mode, dontFollow) {
      let node;
      if (typeof path === 'string') {
        const lookup = FS.lookupPath(path, {
          follow: !dontFollow
        });
        node = lookup.node;
      } else {
        node = path;
      }

      if (!node.node_ops.setattr) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      node.node_ops.setattr(node, {
        mode: mode & 4095 | node.mode & ~4095,
        timestamp: Date.now()
      });
    },

    lchmod(path, mode) {
      FS.chmod(path, mode, true);
    },

    fchmod(fd, mode) {
      const stream = FS.getStream(fd);
      if (!stream) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      FS.chmod(stream.node, mode);
    },

    chown(path, uid, gid, dontFollow) {
      let node;
      if (typeof path === 'string') {
        const lookup = FS.lookupPath(path, {
          follow: !dontFollow
        });
        node = lookup.node;
      } else {
        node = path;
      }

      if (!node.node_ops.setattr) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      node.node_ops.setattr(node, {
        timestamp: Date.now()
      });
    },

    lchown(path, uid, gid) {
      FS.chown(path, uid, gid, true);
    },

    fchown(fd, uid, gid) {
      const stream = FS.getStream(fd);
      if (!stream) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      FS.chown(stream.node, uid, gid);
    },

    truncate(path, len) {
      if (len < 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      let node;
      if (typeof path === 'string') {
        const lookup = FS.lookupPath(path, {
          follow: true
        });
        node = lookup.node;
      } else {
        node = path;
      }

      if (!node.node_ops.setattr) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      if (FS.isDir(node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
      }

      if (!FS.isFile(node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      const err = FS.nodePermissions(node, 'w');
      if (err) {
        throw new FS.ErrnoError(err);
      }

      node.node_ops.setattr(node, {
        size: len,
        timestamp: Date.now()
      });
    },

    ftruncate(fd, len) {
      const stream = FS.getStream(fd);
      if (!stream) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      if ((stream.flags & 2097155) === 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      FS.truncate(stream.node, len);
    },

    utime(path, atime, mtime) {
      const lookup = FS.lookupPath(path, {
        follow: true
      });
      const node = lookup.node;
      node.node_ops.setattr(node, {
        timestamp: Math.max(atime, mtime)
      });
    },

    open(path, flags, mode, fd_start, fd_end) {
      if (path === '') {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      flags = typeof flags === 'string' ? FS.modeStringToFlags(flags) : flags;
      mode = typeof mode === 'undefined' ? 438 : mode;
      if (flags & 64) {
        mode = mode & 4095 | 32768;
      } else {
        mode = 0;
      }

      let node;
      if (typeof path === 'object') {
        node = path;
      } else {
        path = PATH.normalize(path);
        try {
          const lookup = FS.lookupPath(path, {
            follow: !(flags & 131072)
          });
          node = lookup.node;
        } catch (e) {
          //
        }
      }

      let created = false;
      if (flags & 64) {
        if (node) {
          if (flags & 128) {
            throw new FS.ErrnoError(ERRNO_CODES.EEXIST);
          }
        } else {
          node = FS.mknod(path, mode, 0);
          created = true;
        }
      }

      if (!node) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      if (FS.isChrdev(node.mode)) {
        flags &= ~512;
      }

      if (!created) {
        const err = FS.mayOpen(node, flags);
        if (err) {
          throw new FS.ErrnoError(err);
        }
      }

      if (flags & 512) {
        FS.truncate(node, 0);
      }

      flags &= ~(128 | 512);
      const stream = FS.createStream({
        node,
        path: FS.getPath(node),
        flags,
        seekable: true,
        position: 0,
        stream_ops: node.stream_ops,
        ungotten: [],
        error: false
      }, fd_start, fd_end);
      if (stream.stream_ops.open) {
        stream.stream_ops.open(stream);
      }

      if (Module.logReadFiles && !(flags & 1)) {
        if (!FS.readFiles) FS.readFiles = {};
        if (!(path in FS.readFiles)) {
          FS.readFiles[path] = 1;
          Module.printErr(`read file: ${path}`);
        }
      }

      try {
        if (FS.trackingDelegate.onOpenFile) {
          let trackingFlags = 0;
          if ((flags & 2097155) !== 1) {
            trackingFlags |= FS.tracking.openFlags.READ;
          }

          if ((flags & 2097155) !== 0) {
            trackingFlags |= FS.tracking.openFlags.WRITE;
          }

          FS.trackingDelegate.onOpenFile(path, trackingFlags);
        }
      } catch (e) {
        console.log(`FS.trackingDelegate.onOpenFile('${path}', flags)
          threw an exception: ${e.message}`);
      }
      return stream;
    },

    close(stream) {
      try {
        if (stream.stream_ops.close) {
          stream.stream_ops.close(stream);
        }
      } catch (e) {
        throw e;
      } finally {
        FS.closeStream(stream.fd);
      }
    },

    llseek(stream, offset, whence) {
      if (!stream.seekable || !stream.stream_ops.llseek) {
        throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
      }

      stream.position = stream.stream_ops.llseek(stream, offset, whence);
      stream.ungotten = [];
      return stream.position;
    },

    read(stream, buffer, offset, length, position) {
      if (length < 0 || position < 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      if ((stream.flags & 2097155) === 1) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      if (FS.isDir(stream.node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
      }

      if (!stream.stream_ops.read) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      let seeking = true;
      if (typeof position === 'undefined') {
        position = stream.position;
        seeking = false;
      } else if (!stream.seekable) {
        throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
      }

      const bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
      if (!seeking) stream.position += bytesRead;
      return bytesRead;
    },

    write(stream, buffer, offset, length, position, canOwn) {
      if (length < 0 || position < 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      if ((stream.flags & 2097155) === 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      if (FS.isDir(stream.node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
      }

      if (!stream.stream_ops.write) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      if (stream.flags & 1024) {
        FS.llseek(stream, 0, 2);
      }

      let seeking = true;
      if (typeof position === 'undefined') {
        position = stream.position;
        seeking = false;
      } else if (!stream.seekable) {
        throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
      }

      const bytesWritten =
        stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);

      if (!seeking) stream.position += bytesWritten;
      try {
        if (stream.path && FS.trackingDelegate.onWriteToFile) {
          FS.trackingDelegate.onWriteToFile(stream.path);
        }
      } catch (e) {
        console.log(`FS.trackingDelegate.onWriteToFile('${stream.path}')
          threw an exception: ${e.message}`);
      }
      return bytesWritten;
    },

    allocate(stream, offset, length) {
      if (offset < 0 || length <= 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      if ((stream.flags & 2097155) === 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      if (!FS.isFile(stream.node.mode) && !FS.isDir(stream.node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
      }

      if (!stream.stream_ops.allocate) {
        throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
      }

      stream.stream_ops.allocate(stream, offset, length);
    },

    mmap(stream, buffer, offset, length, position, prot, flags) {
      if ((stream.flags & 2097155) === 1) {
        throw new FS.ErrnoError(ERRNO_CODES.EACCES);
      }

      if (!stream.stream_ops.mmap) {
        throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
      }

      return stream.stream_ops.mmap(stream, buffer, offset, length, position, prot, flags);
    },

    ioctl(stream, cmd, arg) {
      if (!stream.stream_ops.ioctl) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOTTY);
      }
      return stream.stream_ops.ioctl(stream, cmd, arg);
    },

    readFile(path, opts) {
      opts = opts || {};
      opts.flags = opts.flags || 'r';
      opts.encoding = opts.encoding || 'binary';
      if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
        throw new Error(`Invalid encoding type "${opts.encoding}"`);
      }

      let ret;
      const stream = FS.open(path, opts.flags);
      const stat = FS.stat(path);
      const length = stat.size;
      const buf = new Uint8Array(length);
      FS.read(stream, buf, 0, length, 0);
      if (opts.encoding === 'utf8') {
        ret = Module.UTF8ArrayToString(buf, 0);
      } else if (opts.encoding === 'binary') {
        ret = buf;
      }

      FS.close(stream);
      return ret;
    },

    writeFile(path, data, opts) {
      opts = opts || {};
      opts.flags = opts.flags || 'w';
      opts.encoding = opts.encoding || 'utf8';
      if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
        throw new Error(`Invalid encoding type "${opts.encoding}"`);
      }
      const stream = FS.open(path, opts.flags, opts.mode);
      if (opts.encoding === 'utf8') {
        const buf = new Uint8Array(Module.lengthBytesUTF8(data) + 1);
        const actualNumBytes = Module.stringToUTF8Array(data, buf, 0, buf.length);
        FS.write(stream, buf, 0, actualNumBytes, 0, opts.canOwn);
      } else if (opts.encoding === 'binary') {
        FS.write(stream, data, 0, data.length, 0, opts.canOwn);
      }
      FS.close(stream);
    },

    cwd() {
      return FS.currentPath;
    },

    chdir(path) {
      const lookup = FS.lookupPath(path, {
        follow: true
      });

      if (!FS.isDir(lookup.node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
      }

      const err = FS.nodePermissions(lookup.node, 'x');
      if (err) {
        throw new FS.ErrnoError(err);
      }

      FS.currentPath = lookup.path;
    },

    createDefaultDirectories() {
      FS.mkdir('/tmp');
      FS.mkdir('/home');
      FS.mkdir('/home/web_user');
    },

    createDefaultDevices() {
      FS.mkdir('/dev');
      FS.registerDevice(FS.makedev(1, 3), {
        read() {
          return 0;
        },
        write() {
          return 0;
        }
      });
      FS.mkdev('/dev/null', FS.makedev(1, 3));
      TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
      TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
      FS.mkdev('/dev/tty', FS.makedev(5, 0));
      FS.mkdev('/dev/tty1', FS.makedev(6, 0));
      let random_device;
      if (typeof crypto !== 'undefined') {
        const randomBuffer = new Uint8Array(1);
        random_device = function() {
          crypto.getRandomValues(randomBuffer);
          return randomBuffer[0];
        };
      } else {
        random_device = function() {
          return require('crypto').randomBytes(1)[0];
        };
      }

      FS.createDevice('/dev', 'random', random_device);
      FS.createDevice('/dev', 'urandom', random_device);
      FS.mkdir('/dev/shm');
      FS.mkdir('/dev/shm/tmp');
    },

    createStandardStreams() {
      if (Module.stdin) {
        FS.createDevice('/dev', 'stdin', Module.stdin);
      } else {
        FS.symlink('/dev/tty', '/dev/stdin');
      }

      if (Module.stdout) {
        FS.createDevice('/dev', 'stdout', null, Module.stdout);
      } else {
        FS.symlink('/dev/tty', '/dev/stdout');
      }

      if (Module.stderr) {
        FS.createDevice('/dev', 'stderr', null, Module.stderr);
      } else {
        FS.symlink('/dev/tty1', '/dev/stderr');
      }

      const stdin = FS.open('/dev/stdin', 'r');
      Module.HEAP32[_stdin >> 2] = FS.getPtrForStream(stdin);
      assert(stdin.fd === 0, `invalid handle for stdin (${stdin.fd})`);
      const stdout = FS.open('/dev/stdout', 'w');
      Module.HEAP32[_stdout >> 2] = FS.getPtrForStream(stdout);
      assert(stdout.fd === 1, `invalid handle for stdout (${stdout.fd})`);
      const stderr = FS.open('/dev/stderr', 'w');
      Module.HEAP32[_stderr >> 2] = FS.getPtrForStream(stderr);
      assert(stderr.fd === 2, `invalid handle for stderr (${stderr.fd})`);
    },

    ensureErrnoError() {
      if (FS.ErrnoError) return;
      FS.ErrnoError = function ErrnoError(errno, node) {
        this.node = node;
        this.setErrno = function(_errno) {
          this.errno = _errno;
          for (const key in ERRNO_CODES) {
            if (ERRNO_CODES[key] === _errno) {
              this.code = key;
              break;
            }
          }
        };
        this.setErrno(errno);
        this.message = ERRNO_MESSAGES[errno];
      };
      FS.ErrnoError.prototype = new Error;
      FS.ErrnoError.prototype.constructor = FS.ErrnoError;
      [ERRNO_CODES.ENOENT].forEach(code => {
        FS.genericErrors[code] = new FS.ErrnoError(code);
        FS.genericErrors[code].stack = '<generic error, no stack>';
      });
    },

    staticInit() {
      FS.ensureErrnoError();
      FS.nameTable = new Array(4096);
      FS.mount(MEMFS, {}, '/');
      FS.createDefaultDirectories();
      FS.createDefaultDevices();
    },

    init(input, output, error) {
      assert(!FS.init.initialized, `FS.init was previously called.
        If you want to initialize later with custom parameters,
        remove any earlier calls (note that one is automatically added to the generated code)`);
      FS.init.initialized = true;
      FS.ensureErrnoError();
      Module.stdin = input || Module.stdin;
      Module.stdout = output || Module.stdout;
      Module.stderr = error || Module.stderr;
      FS.createStandardStreams();
    },

    quit() {
      FS.init.initialized = false;
      for (let i = 0; i < FS.streams.length; i++) {
        const stream = FS.streams[i];
        if (!stream) {
          continue;
        }
        FS.close(stream);
      }
    },

    getMode(canRead, canWrite) {
      let mode = 0;
      if (canRead) mode |= 292 | 73;
      if (canWrite) mode |= 146;
      return mode;
    },

    joinPath(parts, forceRelative) {
      let path = PATH.join.apply(null, parts);
      if (forceRelative && path[0] === '/') path = path.substr(1);
      return path;
    },

    absolutePath(relative, base) {
      return PATH.resolve(base, relative);
    },

    standardizePath(path) {
      return PATH.normalize(path);
    },

    findObject(path, dontResolveLastLink) {
      const ret = FS.analyzePath(path, dontResolveLastLink);
      if (ret.exists) {
        return ret.object;
      }
      ___setErrNo(ret.error);
      return null;
    },

    analyzePath(path, dontResolveLastLink) {
      try {
        const lookup = FS.lookupPath(path, {
          follow: !dontResolveLastLink
        });
        path = lookup.path;
      } catch (e) {
        //
      }
      const ret = {
        isRoot: false,
        exists: false,
        error: 0,
        name: null,
        path: null,
        object: null,
        parentExists: false,
        parentPath: null,
        parentObject: null
      };
      try {
        let lookup = FS.lookupPath(path, {
          parent: true
        });
        ret.parentExists = true;
        ret.parentPath = lookup.path;
        ret.parentObject = lookup.node;
        ret.name = PATH.basename(path);
        lookup = FS.lookupPath(path, {
          follow: !dontResolveLastLink
        });
        ret.exists = true;
        ret.path = lookup.path;
        ret.object = lookup.node;
        ret.name = lookup.node.name;
        ret.isRoot = lookup.path === '/';
      } catch (e) {
        ret.error = e.errno;
      }
      return ret;
    },

    createFolder(parent, name, canRead, canWrite) {
      const path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
      const mode = FS.getMode(canRead, canWrite);
      return FS.mkdir(path, mode);
    },

    createPath(parent, path, canRead, canWrite) {
      parent = typeof parent === 'string' ? parent : FS.getPath(parent);
      let current;
      const parts = path.split('/').reverse();
      while (parts.length) {
        const part = parts.pop();
        if (!part) continue;
        current = PATH.join2(parent, part);
        try {
          FS.mkdir(current);
        } catch (e) {
          //
        }
        parent = current;
      }

      return current;
    },

    createFile(parent, name, properties, canRead, canWrite) {
      const path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
      const mode = FS.getMode(canRead, canWrite);
      return FS.create(path, mode);
    },

    createDataFile(parent, name, data, canRead, canWrite, canOwn) {
      const path = name
        ? PATH.join2(typeof parent === 'string'
          ? parent
          : FS.getPath(parent), name)
        : parent;

      const mode = FS.getMode(canRead, canWrite);
      const node = FS.create(path, mode);
      if (data) {
        if (typeof data === 'string') {
          const arr = new Array(data.length);
          for (let i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
          data = arr;
        }

        FS.chmod(node, mode | 146);
        const stream = FS.open(node, 'w');
        FS.write(stream, data, 0, data.length, 0, canOwn);
        FS.close(stream);
        FS.chmod(node, mode);
      }

      return node;
    },

    createDevice(parent, name, input, output) {
      const path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
      const mode = FS.getMode(!!input, !!output);
      if (!FS.createDevice.major) FS.createDevice.major = 64;
      const dev = FS.makedev(FS.createDevice.major++, 0);
      FS.registerDevice(dev, {
        open(stream) {
          stream.seekable = false;
        },

        close(stream) {
          if (output && output.buffer && output.buffer.length) {
            output(10);
          }
        },

        read(stream, buffer, offset, length, pos) {
          let bytesRead = 0;
          for (let i = 0; i < length; i++) {
            let result;
            try {
              result = input();
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
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
          let i;
          for (i = 0; i < length; i++) {
            try {
              output(buffer[offset + i]);
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
          }

          if (length) {
            stream.node.timestamp = Date.now();
          }

          return i;
        }
      });
      return FS.mkdev(path, mode, dev);
    },

    createLink(parent, name, target, canRead, canWrite) {
      const path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
      return FS.symlink(target, path);
    },

    forceLoadFile(obj) {
      if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
      let success = true;
      if (typeof XMLHttpRequest !== 'undefined') {
        throw new Error(`Lazy loading should have been performed (contents set) in createLazyFile,
          but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file
          in emcc on the main thread.`);
      } else if (Module.read) {
        try {
          obj.contents = Module.intArrayFromString(Module.read(obj.url), true);
          obj.usedBytes = obj.contents.length;
        } catch (e) {
          success = false;
        }
      } else {
        throw new Error('Cannot load without read() or XMLHttpRequest.');
      }

      if (!success) ___setErrNo(ERRNO_CODES.EIO);
      return success;
    },

    createLazyFile(parent, name, url, canRead, canWrite) {
      function LazyUint8Array() {
        this.lengthKnown = false;
        this.chunks = [];
      }

      LazyUint8Array.prototype.get = function LazyUint8Array_get(idx) {
        if (idx > this.length - 1 || idx < 0) {
          return undefined;
        }
        const chunkOffset = idx % this.chunkSize;
        const chunkNum = idx / this.chunkSize | 0;
        return this.getter(chunkNum)[chunkOffset];
      };

      LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(getter) {
        this.getter = getter;
      };

      LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
        const xhr = new XMLHttpRequest;
        xhr.open('HEAD', url, false);
        xhr.send(null);
        if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) {
          throw new Error(`Couldn't load ${url}. Status: ${xhr.status}`);
        }
        const datalength = Number(xhr.getResponseHeader('Content-length'));
        let header;
        const hasByteServing = (header = xhr.getResponseHeader('Accept-Ranges'))
          && header === 'bytes';
        let chunkSize = 1024 * 1024;
        if (!hasByteServing) chunkSize = datalength;
        const doXHR = function(from, to) {
          if (from > to) throw new Error(`invalid range (${from}, ${to}) or no bytes requested!`);
          if (to > datalength - 1) {
            throw new Error(`only ${datalength} bytes available! programmer error!`);
          }
          const _xhr = new XMLHttpRequest;
          _xhr.open('GET', url, false);
          if (datalength !== chunkSize) _xhr.setRequestHeader('Range', `bytes=${from}-${to}`);
          if (typeof Uint8Array !== 'undefined') _xhr.responseType = 'arraybuffer';
          if (_xhr.overrideMimeType) {
            _xhr.overrideMimeType('text/plain; charset=x-user-defined');
          }

          _xhr.send(null);
          if (!(_xhr.status >= 200 && _xhr.status < 300 || _xhr.status === 304)) {
            throw new Error(`Couldn't load ${url}. Status: ${_xhr.status}`);
          }
          if (_xhr.response !== undefined) {
            return new Uint8Array(_xhr.response || []);
          }
          return Module.intArrayFromString(_xhr.responseText || '', true);
        };

        const lazyArray = this;
        lazyArray.setDataGetter(chunkNum => {
          const start = chunkNum * chunkSize;
          let end = (chunkNum + 1) * chunkSize - 1;
          end = Math.min(end, datalength - 1);
          if (typeof lazyArray.chunks[chunkNum] === 'undefined') {
            lazyArray.chunks[chunkNum] = doXHR(start, end);
          }

          if (typeof lazyArray.chunks[chunkNum] === 'undefined') throw new Error('doXHR failed!');
          return lazyArray.chunks[chunkNum];
        });

        this._length = datalength;
        this._chunkSize = chunkSize;
        this.lengthKnown = true;
      };

      let properties;
      if (typeof XMLHttpRequest !== 'undefined') {
        // if (!ENVIRONMENT_IS_WORKER)
        throw new Error(`Cannot do synchronous binary XHRs outside webworkers in modern browsers.
          Use --embed-file or --preload-file in emcc`);
        /*
        const lazyArray = new LazyUint8Array;
        Object.defineProperty(lazyArray, 'length', {
          get() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }
            return this._length;
          }
        });
        Object.defineProperty(lazyArray, 'chunkSize', {
          get() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }
            return this._chunkSize;
          }
        });
        properties = {
          isDevice: false,
          contents: lazyArray
        };
        */
      } else {
        properties = {
          isDevice: false,
          url
        };
      }

      const node = FS.createFile(parent, name, properties, canRead, canWrite);
      if (properties.contents) {
        node.contents = properties.contents;
      } else if (properties.url) {
        node.contents = null;
        node.url = properties.url;
      }

      Object.defineProperty(node, 'usedBytes', {
        get() {
          return this.contents.length;
        }
      });
      const stream_ops = {};
      const keys = Object.keys(node.stream_ops);
      keys.forEach(key => {
        const fn = node.stream_ops[key];
        stream_ops[key] = function forceLoadLazyFile() {
          if (!FS.forceLoadFile(node)) {
            throw new FS.ErrnoError(ERRNO_CODES.EIO);
          }

          return fn.apply(null, arguments);
        };
      });

      stream_ops.read = function stream_ops_read(stream, buffer, offset, length, position) {
        if (!FS.forceLoadFile(node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EIO);
        }

        const contents = stream.node.contents;
        if (position >= contents.length) return 0;
        const size = Math.min(contents.length - position, length);
        assert(size >= 0);
        if (contents.slice) {
          for (let i = 0; i < size; i++) {
            buffer[offset + i] = contents[position + i];
          }
        } else {
          for (let i = 0; i < size; i++) {
            buffer[offset + i] = contents.get(position + i);
          }
        }

        return size;
      };

      node.stream_ops = stream_ops;
      return node;
    },

    createPreloadedFile(parent, name, url, canRead, canWrite, onload, onerror,
      dontCreateFile, canOwn) {
      Browser.init();
      const fullname = name ? PATH.resolve(PATH.join2(parent, name)) : parent;

      function processData(byteArray) {
        function finish(_byteArray) {
          if (!dontCreateFile) {
            FS.createDataFile(parent, name, _byteArray, canRead, canWrite, canOwn);
          }

          if (onload) onload();
          Module.removeRunDependency(`cp ${fullname}`);
        }

        let handled = false;
        Module.preloadPlugins.forEach(plugin => {
          if (handled) return;
          if (plugin.canHandle(fullname)) {
            plugin.handle(byteArray, fullname, finish, () => {
              if (onerror) onerror();
              Module.removeRunDependency(`cp ${fullname}`);
            });

            handled = true;
          }
        });

        if (!handled) finish(byteArray);
      }
      Module.addRunDependency(`cp ${fullname}`);
      if (typeof url === 'string') {
        Browser.asyncLoad(url, byteArray => processData(byteArray), onerror);
      } else {
        processData(url);
      }
    },

    indexedDB() {
      return window.indexedDB || window.webkitIndexedDB;
    },

    DB_NAME() {
      return `EM_FS_${window.location.pathname}`;
    },

    DB_VERSION: 20,
    DB_STORE_NAME: 'FILE_DATA',
    saveFilesToDB(paths, onload, onerror) {
      onload = onload || function() {};
      onerror = onerror || function() {};

      const indexedDB = FS.indexedDB();
      let openRequest;
      try {
        openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
      } catch (e) {
        return onerror(e);
      }
      openRequest.onupgradeneeded = function openRequest_onupgradeneeded() {
        console.log('creating db');
        const db = openRequest.result;
        db.createObjectStore(FS.DB_STORE_NAME);
      };

      openRequest.onsuccess = function openRequest_onsuccess() {
        const db = openRequest.result;
        const transaction = db.transaction([FS.DB_STORE_NAME], 'readwrite');
        const files = transaction.objectStore(FS.DB_STORE_NAME);
        let ok = 0;
        let fail = 0;
        const total = paths.length;

        function finish() {
          if (fail === 0) onload();
          else onerror();
        }
        paths.forEach(path => {
          const putRequest = files.put(FS.analyzePath(path).object.contents, path);
          putRequest.onsuccess = function putRequest_onsuccess() {
            ok++;
            if (ok + fail === total) finish();
          };

          putRequest.onerror = function putRequest_onerror() {
            fail++;
            if (ok + fail === total) finish();
          };
        });

        transaction.onerror = onerror;
      };

      openRequest.onerror = onerror;
    },

    loadFilesFromDB(paths, onload, onerror) {
      onload = onload || function() {};
      onerror = onerror || function() {};

      const indexedDB = FS.indexedDB();
      let openRequest;
      try {
        openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
      } catch (e) {
        return onerror(e);
      }
      openRequest.onupgradeneeded = onerror;
      openRequest.onsuccess = function openRequest_onsuccess() {
        const db = openRequest.result;
        let transaction;
        try {
          transaction = db.transaction([FS.DB_STORE_NAME], 'readonly');
        } catch (e) {
          onerror(e);
          return;
        }
        const files = transaction.objectStore(FS.DB_STORE_NAME);
        let ok = 0;
        let fail = 0;
        const total = paths.length;

        function finish() {
          if (fail === 0) onload();
          else onerror();
        }

        paths.forEach(path => {
          const getRequest = files.get(path);
          getRequest.onsuccess = function getRequest_onsuccess() {
            if (FS.analyzePath(path).exists) {
              FS.unlink(path);
            }

            FS.createDataFile(PATH.dirname(path), PATH.basename(path),
              getRequest.result, true, true, true);

            ok++;
            if (ok + fail === total) finish();
          };

          getRequest.onerror = function getRequest_onerror() {
            fail++;
            if (ok + fail === total) finish();
          };
        });

        transaction.onerror = onerror;
      };

      openRequest.onerror = onerror;
    }
  };

  return FS;
};
