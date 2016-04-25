'use strict';

const assert = require('../helpers/assert');
const ERRNO_CODES = require('../error');

const SOCKFS = {
  mount(mount) {
    Module.websocket = Module.websocket && typeof Module.websocket === 'object'
      ? Module.websocket
      : {};
    Module.websocket._callbacks = {};
    Module.websocket.on = function(event, callback) {
      if (typeof callback === 'function') {
        this._callbacks[event] = callback;
      }
      return this;
    };
    Module.websocket.emit = function(event, param) {
      if (typeof this._callbacks[event] === 'function') {
        this._callbacks[event].call(this, param);
      }
    };
    return Module.FS.createNode(null, '/', 16384 | 511, 0);
  },
  createSocket(family, type, protocol) {
    const streaming = type === 1;
    if (protocol) {
      assert(streaming === (protocol === 6));
    }
    const sock = {
      family,
      type,
      protocol,
      server: null,
      error: null,
      peers: {},
      pending: [],
      recv_queue: [],
      sock_ops: SOCKFS.websocket_sock_ops
    };
    const name = SOCKFS.nextname();
    const node = Module.FS.createNode(SOCKFS.root, name, 49152, 0);
    node.sock = sock;
    const stream = Module.FS.createStream({
      path: name,
      node,
      flags: Module.FS.modeStringToFlags('r+'),
      seekable: false,
      stream_ops: SOCKFS.stream_ops
    });
    sock.stream = stream;
    return sock;
  },
  getSocket(fd) {
    const stream = Module.FS.getStream(fd);
    if (!stream || !Module.FS.isSocket(stream.node.mode)) {
      return null;
    }
    return stream.node.sock;
  },
  stream_ops: {
    poll(stream) {
      const sock = stream.node.sock;
      return sock.sock_ops.poll(sock);
    },
    ioctl(stream, request, varargs) {
      const sock = stream.node.sock;
      return sock.sock_ops.ioctl(sock, request, varargs);
    },
    read(stream, buffer, offset, length, position) {
      const sock = stream.node.sock;
      const msg = sock.sock_ops.recvmsg(sock, length);
      if (!msg) {
        return 0;
      }
      buffer.set(msg.buffer, offset);
      return msg.buffer.length;
    },
    write(stream, buffer, offset, length, position) {
      const sock = stream.node.sock;
      return sock.sock_ops.sendmsg(sock, buffer, offset, length);
    },
    close(stream) {
      const sock = stream.node.sock;
      sock.sock_ops.close(sock);
    }
  },
  nextname() {
    if (!SOCKFS.nextname.current) {
      SOCKFS.nextname.current = 0;
    }
    return `socket[${SOCKFS.nextname.current++}]`;
  },
  websocket_sock_ops: {
    createPeer(sock, addr, port) {
      let ws;
      if (typeof addr === 'object') {
        ws = addr;
        addr = null;
        port = null;
      }
      if (ws) {
        if (ws._socket) {
          addr = ws._socket.remoteAddress;
          port = ws._socket.remotePort;
        } else {
          const result = /ws[s]?:\/\/([^:]+):(\d+)/.exec(ws.url);
          if (!result) {
            throw new Error('WebSocket URL must be in the format ws(s)://address:port');
          }
          addr = result[1];
          port = parseInt(result[2], 10);
        }
      } else {
        try {
          const runtimeConfig = Module.websocket && typeof Module.websocket === 'object';
          let url = 'ws:#'.replace('#', '//');
          if (runtimeConfig) {
            if (typeof Module.websocket.url === 'string') {
              url = Module.websocket.url;
            }
          }
          if (url === 'ws://' || url === 'wss://') {
            const parts = addr.split('/');
            url = `${url}${parts[0]}:${port}/${parts.slice(1).join('/')}`;
          }
          let subProtocols = 'binary';
          if (runtimeConfig) {
            if (typeof Module.websocket.subprotocol === 'string') {
              subProtocols = Module.websocket.subprotocol;
            }
          }
          subProtocols = subProtocols.replace(/^ +| +$/g, '').split(/ *, */);
          const opts = {
            protocol: subProtocols.toString()
          };
          const WebSocket = require('ws');
          ws = new WebSocket(url, opts);
          ws.binaryType = 'arraybuffer';
        } catch (e) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.EHOSTUNREACH);
        }
      }
      const peer = {
        addr,
        port,
        socket: ws,
        dgram_send_queue: []
      };
      SOCKFS.websocket_sock_ops.addPeer(sock, peer);
      SOCKFS.websocket_sock_ops.handlePeerEvents(sock, peer);
      if (sock.type === 2 && typeof sock.sport !== 'undefined') {
        peer.dgram_send_queue.push(new Uint8Array([
          255, 255, 255, 255, 'p'.charCodeAt(0), 'o'.charCodeAt(0), 'r'.charCodeAt(0),
          't'.charCodeAt(0), (sock.sport & 65280) >> 8, sock.sport & 255
        ]));
      }
      return peer;
    },
    getPeer(sock, addr, port) {
      return sock.peers[`${addr}:${port}`];
    },
    addPeer(sock, peer) {
      sock.peers[`${peer.addr}:${peer.port}`] = peer;
    },
    removePeer(sock, peer) {
      delete sock.peers[`${peer.addr}:${peer.port}`];
    },
    handlePeerEvents(sock, peer) {
      let first = true;
      const handleOpen = function() {
        Module.websocket.emit('open', sock.stream.fd);
        try {
          let queued = peer.dgram_send_queue.shift();
          while (queued) {
            peer.socket.send(queued);
            queued = peer.dgram_send_queue.shift();
          }
        } catch (e) {
          peer.socket.close();
        }
      };

      function handleMessage(data) {
        assert(typeof data !== 'string' && data.byteLength !== undefined);
        data = new Uint8Array(data);
        const wasfirst = first;
        first = false;
        if (wasfirst && data.length === 10 && data[0] === 255 && data[1] === 255 &&
          data[2] === 255 && data[3] === 255 && data[4] === 'p'.charCodeAt(0) &&
          data[5] === 'o'.charCodeAt(0) && data[6] === 'r'.charCodeAt(0) &&
          data[7] === 't'.charCodeAt(0)) {
          const newport = data[8] << 8 | data[9];
          SOCKFS.websocket_sock_ops.removePeer(sock, peer);
          peer.port = newport;
          SOCKFS.websocket_sock_ops.addPeer(sock, peer);
          return;
        }
        sock.recv_queue.push({
          addr: peer.addr,
          port: peer.port,
          data
        });
        Module.websocket.emit('message', sock.stream.fd);
      }

      peer.socket.on('open', handleOpen);
      peer.socket.on('message', (data, flags) => {
        if (!flags.binary) {
          return;
        }
        handleMessage((new Uint8Array(data)).buffer);
      });
      peer.socket.on('close', () => {
        Module.websocket.emit('close', sock.stream.fd);
      });
      peer.socket.on('error', (error) => {
        sock.error = ERRNO_CODES.ECONNREFUSED;
        Module.websocket.emit('error',
          [sock.stream.fd, sock.error, 'ECONNREFUSED: Connection refused']);
      });
    },
    poll(sock) {
      if (sock.type === 1 && sock.server) {
        return sock.pending.length ? 64 | 1 : 0;
      }
      let mask = 0;
      const dest = sock.type === 1
        ? SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport)
        : null;

      if (sock.recv_queue.length || !dest || dest && dest.socket.readyState === dest.socket.CLOSING
        || dest && dest.socket.readyState === dest.socket.CLOSED) {
        mask |= 64 | 1;
      }
      if (!dest || dest && dest.socket.readyState === dest.socket.OPEN) {
        mask |= 4;
      }
      if (dest && dest.socket.readyState === dest.socket.CLOSING
        || dest && dest.socket.readyState === dest.socket.CLOSED) {
        mask |= 16;
      }
      return mask;
    },
    ioctl(sock, request, arg) {
      switch (request) {
        case 21531: {
          let bytes = 0;
          if (sock.recv_queue.length) {
            bytes = sock.recv_queue[0].data.length;
          }
          Module.HEAP32[arg >> 2] = bytes;
          return 0;
        }
        default:
          return ERRNO_CODES.EINVAL;
      }
    },
    close(sock) {
      if (sock.server) {
        try {
          sock.server.close();
        } catch (e) {
          //
        }
        sock.server = null;
      }
      const peers = Object.keys(sock.peers);
      for (let i = 0; i < peers.length; i++) {
        const peer = sock.peers[peers[i]];
        try {
          peer.socket.close();
        } catch (e) {
          //
        }
        SOCKFS.websocket_sock_ops.removePeer(sock, peer);
      }
      return 0;
    },
    bind(sock, addr, port) {
      if (typeof sock.saddr !== 'undefined' || typeof sock.sport !== 'undefined') {
        throw new Module.FS.ErrnoError(ERRNO_CODES.EINVAL);
      }
      sock.saddr = addr;
      sock.sport = port || _mkport();
      if (sock.type === 2) {
        if (sock.server) {
          sock.server.close();
          sock.server = null;
        }
        try {
          sock.sock_ops.listen(sock, 0);
        } catch (e) {
          if (!(e instanceof Module.FS.ErrnoError)) throw e;
          if (e.errno !== ERRNO_CODES.EOPNOTSUPP) throw e;
        }
      }
    },
    connect(sock, addr, port) {
      if (sock.server) {
        throw new Module.FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
      }
      if (typeof sock.daddr !== 'undefined' && typeof sock.dport !== 'undefined') {
        const dest = SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport);
        if (dest) {
          if (dest.socket.readyState === dest.socket.CONNECTING) {
            throw new Module.FS.ErrnoError(ERRNO_CODES.EALREADY);
          } else {
            throw new Module.FS.ErrnoError(ERRNO_CODES.EISCONN);
          }
        }
      }
      const peer = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
      sock.daddr = peer.addr;
      sock.dport = peer.port;
      throw new Module.FS.ErrnoError(ERRNO_CODES.EINPROGRESS);
    },
    listen(sock, backlog) {
      if (sock.server) {
        throw new Module.FS.ErrnoError(ERRNO_CODES.EINVAL);
      }
      const WebSocketServer = require('ws').Server;
      const host = sock.saddr;
      sock.server = new WebSocketServer({
        host,
        port: sock.sport
      });
      Module.websocket.emit('listen', sock.stream.fd);
      sock.server.on('connection', ws => {
        if (sock.type === 1) {
          const newsock = SOCKFS.createSocket(sock.family, sock.type, sock.protocol);
          const peer = SOCKFS.websocket_sock_ops.createPeer(newsock, ws);
          newsock.daddr = peer.addr;
          newsock.dport = peer.port;
          sock.pending.push(newsock);
          Module.websocket.emit('connection', newsock.stream.fd);
        } else {
          SOCKFS.websocket_sock_ops.createPeer(sock, ws);
          Module.websocket.emit('connection', sock.stream.fd);
        }
      });
      sock.server.on('closed', () => {
        Module.websocket.emit('close', sock.stream.fd);
        sock.server = null;
      });
      sock.server.on('error', error => {
        sock.error = ERRNO_CODES.EHOSTUNREACH;
        Module.websocket.emit('error',
          [sock.stream.fd, sock.error, 'EHOSTUNREACH: Host is unreachable']);
      });
    },
    accept(listensock) {
      if (!listensock.server) {
        throw new Module.FS.ErrnoError(ERRNO_CODES.EINVAL);
      }
      const newsock = listensock.pending.shift();
      newsock.stream.flags = listensock.stream.flags;
      return newsock;
    },
    getname(sock, peer) {
      let addr;
      let port;
      if (peer) {
        if (sock.daddr === undefined || sock.dport === undefined) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.ENOTCONN);
        }
        addr = sock.daddr;
        port = sock.dport;
      } else {
        addr = sock.saddr || 0;
        port = sock.sport || 0;
      }
      return { addr, port };
    },
    sendmsg(sock, buffer, offset, length, addr, port) {
      if (sock.type === 2) {
        if (addr === undefined || port === undefined) {
          addr = sock.daddr;
          port = sock.dport;
        }
        if (addr === undefined || port === undefined) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.EDESTADDRREQ);
        }
      } else {
        addr = sock.daddr;
        port = sock.dport;
      }
      let dest = SOCKFS.websocket_sock_ops.getPeer(sock, addr, port);
      if (sock.type === 1) {
        if (!dest || dest.socket.readyState === dest.socket.CLOSING
          || dest.socket.readyState === dest.socket.CLOSED) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.ENOTCONN);
        } else if (dest.socket.readyState === dest.socket.CONNECTING) {
          throw new Module.FS.ErrnoError(ERRNO_CODES.EAGAIN);
        }
      }

      let data;
      if (buffer instanceof Array || buffer instanceof ArrayBuffer) {
        data = buffer.slice(offset, offset + length);
      } else {
        data = buffer.buffer.slice(buffer.byteOffset + offset, buffer.byteOffset + offset + length);
      }
      if (sock.type === 2) {
        if (!dest || dest.socket.readyState !== dest.socket.OPEN) {
          if (!dest || dest.socket.readyState === dest.socket.CLOSING
            || dest.socket.readyState === dest.socket.CLOSED) {
            dest = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
          }
          dest.dgram_send_queue.push(data);
          return length;
        }
      }
      try {
        dest.socket.send(data);
        return length;
      } catch (e) {
        throw new Module.FS.ErrnoError(ERRNO_CODES.EINVAL);
      }
    },
    recvmsg(sock, length) {
      if (sock.type === 1 && sock.server) {
        throw new Module.FS.ErrnoError(ERRNO_CODES.ENOTCONN);
      }
      const queued = sock.recv_queue.shift();
      if (!queued) {
        if (sock.type === 1) {
          const dest = SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport);
          if (!dest) {
            throw new Module.FS.ErrnoError(ERRNO_CODES.ENOTCONN);
          } else if (dest.socket.readyState === dest.socket.CLOSING
            || dest.socket.readyState === dest.socket.CLOSED) {
            return null;
          } else {
            throw new Module.FS.ErrnoError(ERRNO_CODES.EAGAIN);
          }
        } else {
          throw new Module.FS.ErrnoError(ERRNO_CODES.EAGAIN);
        }
      }
      const queuedLength = queued.data.byteLength || queued.data.length;
      const queuedOffset = queued.data.byteOffset || 0;
      const queuedBuffer = queued.data.buffer || queued.data;
      const bytesRead = Math.min(length, queuedLength);
      const res = {
        buffer: new Uint8Array(queuedBuffer, queuedOffset, bytesRead),
        addr: queued.addr,
        port: queued.port
      };
      if (sock.type === 1 && bytesRead < queuedLength) {
        const bytesRemaining = queuedLength - bytesRead;
        queued.data = new Uint8Array(queuedBuffer, queuedOffset + bytesRead, bytesRemaining);
        sock.recv_queue.unshift(queued);
      }
      return res;
    }
  }
};

function _mkport() {
  throw new Error('TODO');
}

module.exports = SOCKFS;
