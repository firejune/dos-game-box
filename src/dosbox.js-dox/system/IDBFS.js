'use strict';

const assert = require('../helpers/assert');
const PATH = require('./PATH');

module.exports = function(MEMFS) {
  const IDBFS = {
    dbs: {},
    indexedDB() {
      if (typeof indexedDB !== 'undefined') return indexedDB;
      let ret = null;
      if (typeof window === 'object') {
        ret = window.indexedDB || window.webkitIndexedDB;
      }
      assert(ret, 'IDBFS used, but indexedDB not supported');
      return ret;
    },
    DB_VERSION: 21,
    DB_STORE_NAME: 'FILE_DATA',
    mount(mount) {
      return MEMFS.mount.apply(null, arguments);
    },
    syncfs(mount, populate, callback) {
      IDBFS.getLocalSet(mount, (err, local) => {
        if (err) return callback(err);
        IDBFS.getRemoteSet(mount, (_err, remote) => {
          if (_err) return callback(_err);
          const src = populate ? remote : local;
          const dst = populate ? local : remote;
          IDBFS.reconcile(src, dst, callback);
        });
      });
    },
    getDB(name, callback) {
      let db = IDBFS.dbs[name];
      if (db) {
        return callback(null, db);
      }
      let req;
      try {
        req = IDBFS.indexedDB().open(name, IDBFS.DB_VERSION);
      } catch (e) {
        return callback(e);
      }
      req.onupgradeneeded = function(e) {
        const _db = e.target.result;
        const transaction = e.target.transaction;
        let fileStore;
        if (_db.objectStoreNames.contains(IDBFS.DB_STORE_NAME)) {
          fileStore = transaction.objectStore(IDBFS.DB_STORE_NAME);
        } else {
          fileStore = _db.createObjectStore(IDBFS.DB_STORE_NAME);
        }
        fileStore.createIndex('timestamp', 'timestamp', {
          unique: false
        });
      };
      req.onsuccess = function() {
        db = req.result;
        IDBFS.dbs[name] = db;
        callback(null, db);
      };
      req.onerror = function() {
        callback(this.error);
      };
    },
    getLocalSet(mount, callback) {
      const entries = {};

      function isRealDir(p) {
        return p !== '.' && p !== '..';
      }

      function toAbsolute(root) {
        return function(p) {
          return PATH.join2(root, p);
        };
      }
      const check = Module.FS.readdir(
        mount.mountpoint).filter(isRealDir).map(toAbsolute(mount.mountpoint));

      while (check.length) {
        const path = check.pop();
        let stat;
        try {
          stat = Module.FS.stat(path);
        } catch (e) {
          return callback(e);
        }
        if (Module.FS.isDir(stat.mode)) {
          check.push.apply(check, Module.FS.readdir(path).filter(isRealDir).map(toAbsolute(path)));
        }
        entries[path] = {
          timestamp: stat.mtime
        };
      }
      return callback(null, {
        type: 'local',
        entries
      });
    },
    getRemoteSet(mount, callback) {
      const entries = {};
      IDBFS.getDB(mount.mountpoint, (err, db) => {
        if (err) return callback(err);
        const transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readonly');
        transaction.onerror = function() {
          callback(this.error);
        };
        const store = transaction.objectStore(IDBFS.DB_STORE_NAME);
        const index = store.index('timestamp');
        index.openKeyCursor().onsuccess = function(event) {
          const cursor = event.target.result;
          if (!cursor) {
            return callback(null, {
              type: 'remote',
              db,
              entries
            });
          }
          entries[cursor.primaryKey] = {
            timestamp: cursor.key
          };
          cursor.continue();
        };
      });
    },
    loadLocalEntry(path, callback) {
      let stat;
      let node;
      try {
        const lookup = Module.FS.lookupPath(path);
        node = lookup.node;
        stat = Module.FS.stat(path);
      } catch (e) {
        return callback(e);
      }
      if (Module.FS.isDir(stat.mode)) {
        return callback(null, {
          timestamp: stat.mtime,
          mode: stat.mode
        });
      } else if (Module.FS.isFile(stat.mode)) {
        node.contents = MEMFS.getFileDataAsTypedArray(node);
        return callback(null, {
          timestamp: stat.mtime,
          mode: stat.mode,
          contents: node.contents
        });
      }

      return callback(new Error('node type not supported'));
    },
    storeLocalEntry(path, entry, callback) {
      try {
        if (Module.FS.isDir(entry.mode)) {
          Module.FS.mkdir(path, entry.mode);
        } else if (Module.FS.isFile(entry.mode)) {
          Module.FS.writeFile(path, entry.contents, {
            encoding: 'binary',
            canOwn: true
          });
        } else {
          return callback(new Error('node type not supported'));
        }
        Module.FS.chmod(path, entry.mode);
        Module.FS.utime(path, entry.timestamp, entry.timestamp);
      } catch (e) {
        return callback(e);
      }
      callback(null);
    },
    removeLocalEntry(path, callback) {
      try {
        // const lookup = Module.FS.lookupPath(path);
        const stat = Module.FS.stat(path);
        if (Module.FS.isDir(stat.mode)) {
          Module.FS.rmdir(path);
        } else if (Module.FS.isFile(stat.mode)) {
          Module.FS.unlink(path);
        }
      } catch (e) {
        return callback(e);
      }
      callback(null);
    },
    loadRemoteEntry(store, path, callback) {
      const req = store.get(path);
      req.onsuccess = function(event) {
        callback(null, event.target.result);
      };
      req.onerror = function() {
        callback(this.error);
      };
    },
    storeRemoteEntry(store, path, entry, callback) {
      const req = store.put(entry, path);
      req.onsuccess = function() {
        callback(null);
      };
      req.onerror = function() {
        callback(this.error);
      };
    },
    removeRemoteEntry(store, path, callback) {
      const req = store.delete(path);
      req.onsuccess = function() {
        callback(null);
      };
      req.onerror = function() {
        callback(this.error);
      };
    },
    reconcile(src, dst, callback) {
      let total = 0;
      const create = [];
      Object.keys(src.entries).forEach(key => {
        const e = src.entries[key];
        const e2 = dst.entries[key];
        if (!e2 || e.timestamp > e2.timestamp) {
          create.push(key);
          total++;
        }
      });
      const remove = [];
      Object.keys(dst.entries).forEach(key => {
        // const e = dst.entries[key];
        const e2 = src.entries[key];
        if (!e2) {
          remove.push(key);
          total++;
        }
      });
      if (!total) {
        return callback(null);
      }
      // const errored = false;
      let completed = 0;
      const db = src.type === 'remote' ? src.db : dst.db;
      const transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(IDBFS.DB_STORE_NAME);

      function done(err) {
        if (err) {
          if (!done.errored) {
            done.errored = true;
            return callback(err);
          }
          return;
        }
        if (++completed >= total) {
          return callback(null);
        }
      }
      transaction.onerror = function() {
        done(this.error);
      };
      create.sort().forEach(path => {
        if (dst.type === 'local') {
          IDBFS.loadRemoteEntry(store, path, (err, entry) => {
            if (err) return done(err);
            IDBFS.storeLocalEntry(path, entry, done);
          });
        } else {
          IDBFS.loadLocalEntry(path, (err, entry) => {
            if (err) return done(err);
            IDBFS.storeRemoteEntry(store, path, entry, done);
          });
        }
      });
      remove.sort().reverse().forEach(path => {
        if (dst.type === 'local') {
          IDBFS.removeLocalEntry(path, done);
        } else {
          IDBFS.removeRemoteEntry(store, path, done);
        }
      });
    }
  };

  return IDBFS;
};
