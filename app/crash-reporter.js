'use strict';

module.exports = {
  init
};

const electron = require('electron');
const CRASH_REPORT_URL = 'http://muki.io/desktop/crash-report';

function init() {
  electron.crashReporter.start({
    companyName: electron.app.getName(),
    productName: electron.app.getName(),
    submitURL: CRASH_REPORT_URL
  });
  console.log('crash reporter started');
}
