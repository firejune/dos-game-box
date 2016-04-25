'use strict';

const fs = require('fs');
const path = require('path');
const ini = require('ini');
const ncp = require('ncp');
const JSZip = require('jszip');

const electron = require('electron');
const remote = electron.remote;
const dialog = remote.dialog;
const shell = remote.shell;
const Menu = remote.Menu;
const webFrame = electron.webFrame;

const config = require('../package.json');
const dosboxDefaultConfPath = './dosbox.conf';
const dosboxConfPath = `./${config.name}/dosbox.conf`;


// 두 손까락 더블 탭 줌 막기
webFrame.setZoomLevelLimits(1, 1);

const os = {darwin: 'osx', linux: 'linux', win32: 'windows'}[process.platform];
const app = {
  os,
  name: config.name,
  version: config.version,
  appPath: remote.app.getAppPath(),
  homePath: remote.app.getPath('home'),
  separator: path.sep,
  pathSeparator: os === 'windows' ? '\\' : '/',

  /* Dialog functions */
  showFileOpenDialog(props, callback) {
    app.freezeUI();

    dialog.showOpenDialog({
      title: props.title || 'Open File',
      defaultPath: props.defaultPath || this.homePath,
      filters: props.filters || [],
      properties: props.properties || ['openFile']
    }, (filepath) => {
      app.unfreezeUI();
      callback(filepath);
    });
  },

  showFileSaveDialog(props, callback) {
    app.freezeUI();

    dialog.showSaveDialog({
      title: props.title || 'Save File',
      defaultPath: props.defaultPath || this.homePath,
      filters: props.filters || []
    }, filepath => {
      app.unfreezeUI();
      callback(filepath);
    });
  },

  pathParse(stat) {
    return path.parse(stat);
  },

  readZip(stat) {
    const data = this.readFile(stat);
    return new JSZip(data);
  },

  setup(callback) {
    if (!this.pathExists(path.resolve(this.homePath, `./${this.name}`))) {
      this.mkdirSync(this.name);
    }

    if (!this.pathExists(path.resolve(this.homePath, dosboxConfPath))) {
      this.resetConf();
    }

    if (!this.getFiles('game').length) {
      const source = path.resolve(this.appPath, './bin/games');
      const destination = path.resolve(this.homePath, `./${this.name}`);
      ncp(source, destination, err => {
        if (err) {
          console.error(err);
        } else {
          console.info('init complete');
          callback();
        }
      });
      return;
    }

    callback();
  },

  resetConf() {
    this.writeFile(dosboxConfPath, this.readFile(dosboxDefaultConfPath));
  },

  saveConf(section, key, value) {
    const conf = ini.parse(this.readFile(dosboxConfPath, 'utf-8'));
    conf[section][key] = value;

    /*
    if (section === 'render' && key === 'scale') {
      conf.render.aspect = !value.match(/2x|3x/);
    }
    */

    this.writeFile(dosboxConfPath, ini.stringify(conf));
    console.log('app.saveConf', section, key, conf[section][key]);
  },

  saveConfAsText(section, text) {
    const conf = ini.parse(this.readFile(dosboxConfPath, 'utf-8'));
    conf[section] = ini.parse(text);
    this.writeFile(dosboxConfPath, ini.stringify(conf));
    console.log('app.saveConf', section, conf[section]);
  },

  readConf(section) {
    const conf = ini.parse(this.readFile(dosboxConfPath, 'utf-8'));
    return (section === undefined ? conf : conf[section]) || {};
  },

  pathExists(filepath) {
    return fs.existsSync(filepath);
  },

  mkdirSync(dirpath) {
    dirpath = path.resolve(this.homePath, dirpath);
    try {
      fs.mkdirSync(dirpath);
      return true;
    } catch (err) {
      // Returns true if the file exist, false on all other errors
      return /EEXIST/.test(err.message);
    }
  },

  readFile(filepath, type) {
    let home = this.appPath;
    if (filepath.match(this.name)) {
      home = this.homePath;
    }
    filepath = path.resolve(home, filepath);
    return fs.readFileSync(filepath, type);
  },

  writeFile(filepath, data) {
    filepath = path.resolve(this.homePath, filepath);
    return fs.writeFileSync(filepath, data);
  },

  openBrowserWindow(url) {
    shell.openExternal(url);
  },

  quit() {
    remote.app.quit();
  },

  setTitle(title) {
    let mainTitle = this.name;
    if (title) {
      mainTitle += ` - ${title.toUpperCase()}`;
    }

    remote.getCurrentWindow().setTitle(mainTitle);
  },

  isFullScreen() {
    return remote.getCurrentWindow().isFullScreen();
  },

  getSize() {
    return remote.getCurrentWindow().getSize();
  },

  setSize(width, height) {
    remote.getCurrentWindow().setSize(width, height);
  },

  getFiles(type) {
    const filepath = type === 'game' ? `${this.homePath}/${this.name}` : `${this.appPath}/bin/utils`;
    const files = [];
    fs.readdirSync(filepath).forEach(file => {
      if (file.toLowerCase().indexOf('.zip') !== -1) {
        files.push({
          name: file,
          stat: fs.statSync(`${filepath}/${file}`)
        });
      }
    });

    return files;
  },

  /* Misc */
  saveSetting(set, def) {
    console.log('app.saveSetting', set, def);
    localStorage[set] = JSON.stringify(def);
  },

  readSetting(set, def) {
    console.log('app.readSetting', set, def);

    if (localStorage.hasOwnProperty(set)) {
      return JSON.parse(localStorage[set]);
    }

    return def || null;
  },

  getLastOpened() {
    if (!remote.getGlobal('started')) {
      this.saveSetting('lastOpened', null);
      return null;
    }
    return this.readSetting('lastOpened');
  },

  addToRecent(filepath) {
    filepath && remote.app.addRecentDocument(filepath);
  },

  /* Application menu */
  setMenu(menu) {
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  }
};

module.exports = app;
