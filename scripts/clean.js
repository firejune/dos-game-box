#!/usr/bin/env node

/**
 * Remove all traces of WebTorrent Desktop from the system (config and temp files).
 * Useful for developers.
 */

const os = require('os');
const path = require('path');
const pathExists = require('path-exists');
const rimraf = require('rimraf');

// const config = require('../config');
const handlers = require('../handlers');

// rimraf.sync(config.CONFIG_PATH);

const tmpPath = path.join(pathExists.sync('/tmp') ? '/tmp' : os.tmpDir(), 'webtorrent');
rimraf.sync(tmpPath);

// Uninstall .torrent file and magnet link handlers
handlers.uninstall();
