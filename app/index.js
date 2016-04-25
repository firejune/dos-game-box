'use strict';

const electron = require('electron');
const { app } = electron;

const handlers = require('./handlers');
const win = require('./main-window');
const ipc = require('./ipc-main');
const log = require('./log');
const squirrelWin32 = require('./squirrel-win32');
// const autoUpdater = require('./auto-updater');
// const crashReporter = require('./crash-reporter');

const env = process.argv.indexOf('development') > -1 ? 'development' : 'production';
const startWithFileOpen = process.argv.indexOf('-o') > -1;
const files = [];
let shouldQuit = false;

global.development = env === 'development';

if (process.platform === 'win32') {
  const argv = process.argv.slice(global.development ? 2 : 1);
  log(argv);
  shouldQuit = squirrelWin32.handleEvent(argv[0]);
}

// for debugging in production
// global.development = true;

if (!shouldQuit) {
  // Prevent multiple instances of app from running at same time. New instances signal
  // this instance and quit.
  shouldQuit = app.makeSingleInstance(onAppOpen);
  if (shouldQuit) {
    app.quit();
  }
}

if (!shouldQuit) {
  init();
}

function init() {
  app.on('ready', () => {
    win.create();
    handlers.install();
  });

  // File open with app
  app.on('open-file', onOpen);
  app.on('open-url', onOpen);

  // Quit when all windows are closed.
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-finish-launching', () => {
    // crashReporter.init();
    // autoUpdater.init();
  });

  ipc.init();

  app.on('ipc-ready', evt => {
    app.ipcReady = true;
    console.timeEnd('init');

    if (files.length) {
      for (const filepath of files) {
        win.main.webContents.send('open-file', filepath);
      }
      files.length = 0;
    }

    if (startWithFileOpen) {
      console.log('startWithFileOpen');
      win.main.webContents.send('open-file-start');
    }
  });

  app.on('activate', () => {
    win.create();
  });
}

function onOpen(event, filepath) {
  // event.preventDefault();

  if (app.ipcReady) {
    win.main.webContents.send('open-file', filepath);
  } else {
    files.push(filepath);
  }
}

function onAppOpen(newArgv) {
  newArgv = newArgv.slice(1);

  if (app.ipcReady) {
    log('Second app instance opened, but was prevented:', newArgv);
    if (newArgv.indexOf('-o') > -1) {
      win.main.webContents.send('open-file-start');
    }
    win.focus();
  }
}

console.log({
  env,
  name: app.getName(),
  app: app.getVersion(),
  electron: process.versions.electron,
  v8: process.versions.v8,
  chrome: process.versions.chrome,
  node: process.versions.node,
  modules: process.versions.modules
});
