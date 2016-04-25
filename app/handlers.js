'use strict';

// winreg => "feross/node-winreg"

module.exports = {
  install,
  uninstall
};

// const fs = require('fs');
const path = require('path');

function install() {
  if (process.platform === 'darwin') {
    installDarwin();
  }
  if (process.platform === 'win32') {
    installWin32();
  }
  if (process.platform === 'linux') {
    installLinux();
  }
}

function uninstall() {
  if (process.platform === 'darwin') {
    uninstallDarwin();
  }
  if (process.platform === 'win32') {
    uninstallWin32();
  }
  if (process.platform === 'linux') {
    uninstallLinux();
  }
}

function installDarwin() {
  const electron = require('electron');
  const app = electron.app;

  // On OS X, only protocols that are listed in Info.plist can be set as the default
  // handler at runtime.
  app.setAsDefaultProtocolClient('dosgamebox');

  // File handlers are registered in the Info.plist.
}

function uninstallDarwin() {}

function installWin32() {
  const Registry = require('winreg');
  const log = require('./log');
  const staticPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets');
  const iconPath = path.join(staticPath, 'files', 'dosgamebox-default.ico');

  registerProtocolHandlerWin32('dosgamebox', 'URL:DOSGameBox Arhives URL', iconPath, process.execPath);
  registerFileHandlerWin32(`.dosgamebox`, 'com.firejune.dosgamebox', 'DOSGameBoxArchives', iconPath, process.execPath);

  /**
   * To add a protocol handler, the following keys must be added to the Windows registry:
   *
   * HKEY_CLASSES_ROOT
   *   $PROTOCOL
   *     (Default) = "$NAME"
   *     URL Protocol = ""
   *     DefaultIcon
   *       (Default) = "$ICON"
   *     shell
   *       open
   *         command
   *           (Default) = "$COMMAND" "%1"
   *
   * Source: https://msdn.microsoft.com/en-us/library/aa767914.aspx
   *
   * However, the "HKEY_CLASSES_ROOT" key can only be written by the Administrator user.
   * So, we instead write to "HKEY_CURRENT_USER\Software\Classes", which is inherited by
   * "HKEY_CLASSES_ROOT" anyway, and can be written by unprivileged users.
   */

  function registerProtocolHandlerWin32(protocol, name, icon, command) {
    const protocolKey = new Registry({
      hive: Registry.HKCU, // HKEY_CURRENT_USER
      key: '\\Software\\Classes\\' + protocol
    });

    setProtocol();

    function setProtocol(err) {
      if (err) log.error(err.message);
      protocolKey.set('', Registry.REG_SZ, name, setURLProtocol);
    }

    function setURLProtocol(err) {
      if (err) log.error(err.message);
      protocolKey.set('URL Protocol', Registry.REG_SZ, '', setIcon);
    }

    function setIcon(err) {
      if (err) log.error(err.message);

      const iconKey = new Registry({
        hive: Registry.HKCU,
        key: '\\Software\\Classes\\' + protocol + '\\DefaultIcon'
      });
      iconKey.set('', Registry.REG_SZ, icon, setCommand);
    }

    function setCommand(err) {
      if (err) log.error(err.message);

      const commandKey = new Registry({
        hive: Registry.HKCU,
        key: '\\Software\\Classes\\' + protocol + '\\shell\\open\\command'
      });
      commandKey.set('', Registry.REG_SZ, '"' + command + '" "%1"', done);
    }

    function done(err) {
      if (err) log.error(err.message);
    }
  }

  /**
   * To add a file handler, the following keys must be added to the Windows registry:
   *
   * HKEY_CLASSES_ROOT
   *   $EXTENSION
   *     (Default) = "$EXTENSION_ID"
   *   $EXTENSION_ID
   *     (Default) = "$NAME"
   *     DefaultIcon
   *       (Default) = "$ICON"
   *     shell
   *       open
   *         command
   *           (Default) = "$COMMAND" "%1"
   */
  function registerFileHandlerWin32(ext, id, name, icon, command) {
    setExt();

    function setExt() {
      const extKey = new Registry({
        hive: Registry.HKCU, // HKEY_CURRENT_USER
        key: '\\Software\\Classes\\' + ext
      });
      extKey.set('', Registry.REG_SZ, id, setId);
    }

    function setId(err) {
      if (err) log.error(err.message);

      const idKey = new Registry({
        hive: Registry.HKCU,
        key: '\\Software\\Classes\\' + id
      });
      idKey.set('', Registry.REG_SZ, name, setIcon);
    }

    function setIcon(err) {
      if (err) log.error(err.message);

      const iconKey = new Registry({
        hive: Registry.HKCU,
        key: '\\Software\\Classes\\' + id + '\\DefaultIcon'
      });
      iconKey.set('', Registry.REG_SZ, icon, setCommand);
    }

    function setCommand(err) {
      if (err) log.error(err.message);

      const commandKey = new Registry({
        hive: Registry.HKCU,
        key: '\\Software\\Classes\\' + id + '\\shell\\open\\command'
      });
      commandKey.set('', Registry.REG_SZ, '"' + command + '" "%1"', done);
    }

    function done(err) {
      if (err) log.error(err.message);
    }
  }
}

function uninstallWin32() {
  const Registry = require('winreg');

  unregisterProtocolHandlerWin32('dosgamebox', process.execPath);
  unregisterFileHandlerWin32('.dosgamebox', 'com.firejune.dosgamebox', process.execPath);

  function unregisterProtocolHandlerWin32(protocol, command) {
    getCommand();

    function getCommand() {
      const commandKey = new Registry({
        hive: Registry.HKCU, // HKEY_CURRENT_USER
        key: '\\Software\\Classes\\' + protocol + '\\shell\\open\\command'
      });
      commandKey.get('', (err, item) => {
        if (!err && item.value.indexOf(command) >= 0) {
          eraseProtocol();
        }
      });
    }

    function eraseProtocol() {
      const protocolKey = new Registry({
        hive: Registry.HKCU,
        key: '\\Software\\Classes\\' + protocol
      });
      protocolKey.erase(() => {});
    }
  }

  function unregisterFileHandlerWin32(ext, id, command) {
    eraseId();

    function eraseId() {
      const idKey = new Registry({
        hive: Registry.HKCU, // HKEY_CURRENT_USER
        key: '\\Software\\Classes\\' + id
      });
      idKey.erase(getExt);
    }

    function getExt() {
      const extKey = new Registry({
        hive: Registry.HKCU,
        key: '\\Software\\Classes\\' + ext
      });
      extKey.get('', (err, item) => {
        if (!err && item.value === id) {
          eraseExt();
        }
      });
    }

    function eraseExt() {
      const extKey = new Registry({
        hive: Registry.HKCU, // HKEY_CURRENT_USER
        key: '\\Software\\Classes\\' + ext
      });
      extKey.erase(() => {});
    }
  }
}

function installLinux() {
  const fs = require('fs');
  const mkdirp = require('mkdirp');
  const os = require('os');
  const log = require('./log');
  const pkg = require('../package.json');

  const STATIC_PATH = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets');

  installDesktopFile();
  installIconFile();

  function installDesktopFile() {
    const templatePath = path.join(STATIC_PATH, 'linux', 'dosgamebox.desktop');
    fs.readFile(templatePath, 'utf8', writeDesktopFile);
  }

  function writeDesktopFile(err, desktopFile) {
    if (err) return log.error(err.message);

    const appPath = path.dirname(process.execPath);
    const execPath = process.execPath;
    const tryExecPath = process.execPath;
    const ver = pkg.version.split('.');
    const mimeTypes = ['dosgamebox'];

    desktopFile = desktopFile.replace(/\$APP_NAME/g, pkg.productName || pkg.name);
    desktopFile = desktopFile.replace(/\$APP_ICON/g, 'dosgamebox.png');
    desktopFile = desktopFile.replace(/\$APP_DESCRIPTION/g, pkg.description);
    desktopFile = desktopFile.replace(/\$APP_VERSION/g, `${ver[0]}.${ver[1]}`);
    desktopFile = desktopFile.replace(/\$APP_PATH/g, appPath);
    desktopFile = desktopFile.replace(/\$EXEC_PATH/g, execPath);
    desktopFile = desktopFile.replace(/\$TRY_EXEC_PATH/g, tryExecPath);
    desktopFile = desktopFile.replace(/\$APP_MIME_TYPE/g, mimeTypes.join(';'));

    const desktopFilePath = path.join(
      os.homedir(),
      '.local',
      'share',
      'applications',
      'dosgamebox.desktop'
    );

    mkdirp(path.dirname(desktopFilePath));
    fs.writeFile(desktopFilePath, desktopFile, (err_) => {
      if (err_) return log.error(err_.message);
    });
  }

  function installIconFile() {
    const iconStaticPath = path.join(STATIC_PATH, 'dosgamebox.png');
    fs.readFile(iconStaticPath, writeIconFile);
  }

  function writeIconFile(err, iconFile) {
    if (err) return log.error(err.message);

    const iconFilePath = path.join(
      os.homedir(),
      '.local',
      'share',
      'icons',
      'dosgamebox.png'
    );

    log('writeIconFile', iconFilePath);
    mkdirp(path.dirname(iconFilePath));
    fs.writeFile(iconFilePath, iconFile, (err_) => {
      if (err_) return log.error(err_.message);
    });
  }
}

function uninstallLinux() {
  const os = require('os');
  const rimraf = require('rimraf');

  const desktopFilePath = path.join(
    os.homedir(),
    '.local',
    'share',
    'applications',
    'dosgamebox.desktop'
  );
  rimraf.sync(desktopFilePath);

  const iconFilePath = path.join(
    os.homedir(),
    '.local',
    'share',
    'icons',
    'dosgamebox.png'
  );
  rimraf.sync(iconFilePath);
}
