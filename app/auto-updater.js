module.exports = {
  init
};

const electron = require('electron');
const get = require('simple-get');

const log = require('./log');
const windows = require('./windows');

const autoUpdater = electron.autoUpdater;
const APP_VERSION = electron.app.getVersion();
const AUTO_UPDATE_URL = `https://muki.io/desktop/update?version=${APP_VERSION}&platform=${process.platform}`;
const AUTO_UPDATE_CHECK_STARTUP_DELAY = 5 * 1000; /* 5 seconds */

function init() {
  autoUpdater.on('error', (err) => {
    log.error('App update error: ' + err.message || err);
  });

  autoUpdater.setFeedURL(AUTO_UPDATE_URL);

  /*
   * We always check for updates on app startup. To keep app startup fast, we delay this
   * first check so it happens when there is less going on.
   */
  setTimeout(checkForUpdates, AUTO_UPDATE_CHECK_STARTUP_DELAY);

  autoUpdater.on('checking-for-update', () => log('Checking for app update'));
  autoUpdater.on('update-available', () => log('App update available'));
  autoUpdater.on('update-not-available', () => log('App update not available'));
  autoUpdater.on('update-downloaded', (e, releaseNotes, releaseName, releaseDate, updateURL) => {
    log('App update downloaded: ', releaseName, updateURL);
  });
}

function checkForUpdates() {
  // Electron's built-in auto updater only supports Mac and Windows, for now
  if (process.platform !== 'linux') {
    return autoUpdater.checkForUpdates();
  }

  // If we're on Linux, we have to do it ourselves
  get.concat(AUTO_UPDATE_URL, (err, res, data) => {
    if (err) return log('Error checking for app update: ' + err.message);
    if (![200, 204].includes(res.statusCode)) return log('Error checking for app update, got HTTP ' + res.statusCode);
    if (res.statusCode !== 200) return;

    const obj = JSON.parse(data);
    windows.main.send('dispatch', 'updateAvailable', obj.version);
  });
}
