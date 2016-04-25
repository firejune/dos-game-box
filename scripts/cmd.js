#!/usr/bin/env node

const electron = require('electron-prebuilt');
const cp = require('child_process');
const path = require('path');

const child = cp.spawn(electron, [path.join(__dirname, '..')], {stdio: 'inherit'});
child.on('close', (code) => {
  process.exit(code);
});
