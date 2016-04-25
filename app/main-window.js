'use strict';

const path = require('path');
const { app, BrowserWindow } = require('electron');

const conf = new (require('configstore'))(app.getName(), {
  width: 640,
  height: 400,
  devtools: false,
  x: 0,
  y: 0
});

const win = module.exports = {
  main: null,
  create: createMainWindow,
  focus: focusWindow
};

function focusWindow() {
  if (win.main.isMinimized()) {
    win.main.restore();
  }
  win.main.show(); // shows and gives focus
}

function createMainWindow() {
  if (win.main) {
    return focusWindow();
  }

  // Keep a global reference of the window object, if you don't, the window will be closed
  // automatically when the JavaScript object is garbage collected.
  const mainWindow = new BrowserWindow({
    x: conf.get('x'),
    y: conf.get('y'),
    width: conf.get('width'),
    height: conf.get('height'),
    show: false,
    minWidth: 320,
    minHeight: 200,
    useContentSize: true,
    autoHideMenuBar: true,
    darkTheme: true,  // Forces dark theme (GTK+3)
    // transparent: true,
    // titleBarStyle: 'default',
    // backgroundColor: '#000',
    // type: 'textured',
    icon: path.join(app.getAppPath(), 'assets/dosgamebox.png'),
    webPreferences: {
      // experimentalFeatures: true,
      // experimentalCanvasFeatures: true,
      textAreasAreResizable: false,
      webSecurity: false,
      webgl: true,
      webaudio: true
    }
  });

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
    global.app && app.updateMenu();
  });

  mainWindow.on('devtools-closed', () => {
    conf.set('devtools', false);
    global.app && app.updateMenu();
  });

  mainWindow.once('closed', () => {
    win.main = null;
  });

  mainWindow.webContents.on('will-navigate', e => {
    e.preventDefault();
  });

  if (conf.get('devtools') && global.development) {
    mainWindow.openDevTools();
  }

  mainWindow.loadURL(`file://${app.getAppPath()}/index.html`);

  return (win.main = mainWindow);
}
