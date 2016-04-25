'use strict';

const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;

const conf = new (require('configstore'))('DOSGameBox', {
  width: 640,
  height: 400,
  devtools: false,
  x: 0,
  y: 0
});

// This is the only instance running
const env = process.argv.indexOf('development') > -1 ? 'development' : 'production';

console.log({
  env,
  electron: process.versions.electron,
  v8: process.versions.v8,
  chrome: process.versions.chrome,
  node: process.versions.node,
  modules: process.versions.modules
});

app.on('ready', () => {
  // Keep a global reference of the window object, if you don't, the window will be closed
  // automatically when the JavaScript object is garbage collected.
  const mainWindow = new BrowserWindow({
    // Window's width in pixels.
    width: conf.get('width'),
    // Window's height in pixels.
    height: conf.get('height'),
    // Window's minimum width.
    minWidth: 320,
    // Window's minimum height.
    minHeight: 200,
    // Window's left offset from screen.
    x: conf.get('x'),
    // Window's top offset from screen.
    y: conf.get('y'),
    // OS X - specifies the style of window title bar. This option is supported on
    // OS X 10.10 Yosemite and newer. 'default' or 'hidden' or 'hidden-inset'
    // titleBarStyle: 'hidden',
    // Window's background color as Hexadecimal value, like #66CD00 or #FFF.
    // This is only implemented on Linux and Windows.
    // backgroundColor: '#e8e6e8',
    // NativeImage - The window icon, when omitted on Windows
    // the executable's icon would be used as window icon.
    icon: require('path').join(__dirname, 'assets/icon.png'),
    webPreferences: {
      // Make TextArea elements resizable.
      textAreasAreResizable: false,
      // When setting false, it will disable the same-origin policy
      // (Usually using testing websites by people), and set allowDisplayingInsecureContent
      // and allowRunningInsecureContent to true if these two options are not set by user.
      webSecurity: false,
      // Enables WebGL support.
      webgl: true,
      // Enables WebAudio support.
      webaudio: true
    }
  });

  mainWindow.loadURL(`file://${__dirname}/main.html`);
  // mainWindow.loadURL(`file://${__dirname}/v86/index.html`);

  if (conf.get('devtools') && env !== 'production') {
    mainWindow.openDevTools();
  }

  // 윈도 크기 및 위치 기억
  let resizeTimer;
  let moveTimer;

  mainWindow.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const wh = mainWindow.getSize();
      conf.set('width', wh[0]);
      conf.set('height', wh[1]);
    }, 400);
  });

  mainWindow.on('move', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const bounds = mainWindow.getBounds();
      conf.set('x', bounds.x);
      conf.set('y', bounds.y);
    }, 400);
  });

  mainWindow.on('closed', () => {
    clearTimeout(resizeTimer);
    clearTimeout(moveTimer);
  });

  mainWindow.on('devtools-opened', () => {
    conf.set('devtools', true);
    global.box && box.updateMenu();
  });

  mainWindow.on('devtools-closed', () => {
    conf.set('devtools', false);
    global.box && box.updateMenu();
  });

  mainWindow.webContents.on('will-navigate', e => {
    e.preventDefault();
  });
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  app.quit();
});
