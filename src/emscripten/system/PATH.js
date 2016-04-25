'use strict';

module.exports = function(Module) {
  const PATH = {
    splitPath(filename) {
      const splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
      return splitPathRe.exec(filename).slice(1);
    },

    normalizeArray(parts, allowAboveRoot) {
      let up = 0;
      for (let i = parts.length - 1; i >= 0; i--) {
        const last = parts[i];
        if (last === '.') {
          parts.splice(i, 1);
        } else if (last === '..') {
          parts.splice(i, 1);
          up++;
        } else if (up) {
          parts.splice(i, 1);
          up--;
        }
      }

      if (allowAboveRoot) {
        for (; up--; up) {
          parts.unshift('..');
        }
      }

      return parts;
    },

    normalize(path) {
      const isAbsolute = path.charAt(0) === '/';
      const trailingSlash = path.substr(-1) === '/';
      path = PATH.normalizeArray(path.split('/').filter(p => !!p), !isAbsolute).join('/');

      if (!path && !isAbsolute) {
        path = '.';
      }

      if (path && trailingSlash) {
        path += '/';
      }

      return (isAbsolute ? '/' : '') + path;
    },

    dirname(path) {
      const result = PATH.splitPath(path);
      const root = result[0];
      let dir = result[1];

      if (!root && !dir) {
        return '.';
      }

      if (dir) {
        dir = dir.substr(0, dir.length - 1);
      }

      return root + dir;
    },

    basename(path) {
      if (path === '/') return '/';
      const lastSlash = path.lastIndexOf('/');
      if (lastSlash === -1) return path;
      return path.substr(lastSlash + 1);
    },

    extname(path) {
      return PATH.splitPath(path)[3];
    },

    join() {
      const paths = Array.prototype.slice.call(arguments, 0);
      return PATH.normalize(paths.join('/'));
    },

    join2(l, r) {
      return PATH.normalize(`${l}/${r}`);
    },

    resolve() {
      let resolvedPath = '';
      let resolvedAbsolute = false;
      for (let i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
        const path = i >= 0 ? arguments[i] : Module.FS.cwd();
        if (typeof path !== 'string') {
          throw new TypeError('Arguments to path.resolve must be strings');
        } else if (!path) {
          return '';
        }
        resolvedPath = `${path}/${resolvedPath}`;
        resolvedAbsolute = path.charAt(0) === '/';
      }
      resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter(p => !!p),
        !resolvedAbsolute).join('/');

      return (resolvedAbsolute ? '/' : '') + resolvedPath || '.';
    },

    relative(from, to) {
      from = PATH.resolve(from).substr(1);
      to = PATH.resolve(to).substr(1);

      function trim(arr) {
        let start = 0;
        for (; start < arr.length; start++) {
          if (arr[start] !== '') break;
        }
        let end = arr.length - 1;
        for (; end >= 0; end--) {
          if (arr[end] !== '') break;
        }
        if (start > end) return [];
        return arr.slice(start, end - start + 1);
      }

      const fromParts = trim(from.split('/'));
      const toParts = trim(to.split('/'));
      const length = Math.min(fromParts.length, toParts.length);
      let samePartsLength = length;

      for (let i = 0; i < length; i++) {
        if (fromParts[i] !== toParts[i]) {
          samePartsLength = i;
          break;
        }
      }

      let outputParts = [];
      for (let i = samePartsLength; i < fromParts.length; i++) {
        outputParts.push('..');
      }

      outputParts = outputParts.concat(toParts.slice(samePartsLength));
      return outputParts.join('/');
    }
  };

  return PATH;
};
