'use strict';

const fs = require('fs');
const { app, dialog, Menu, ipcMain } = require('electron');
const win = require('./main-window');
const homePath = app.getPath('home');

function init() {
  ipcMain.on('ipc-ready', (e) => {
    app.emit('ipc-ready');
    win.main.show();
  });

  ipcMain.on('context-menu', (event, template) => {
    for (let i = 0; i < template.length; i++) {
      if (template[i].submenu) {
        for (let j = 0; j < template[i].submenu.length; j++) {
          template[i].submenu[j].click = () => event.sender.send('context-menu', i, j);
        }
      } else {
        template[i].click = () => event.sender.send('context-menu', i);
      }
    }

    const contextMenu = Menu.buildFromTemplate(template);
    contextMenu.popup(win.main);
  });

  ipcMain.on('open-file-dialog', (event, props) => {
    dialog.showOpenDialog({
      title: props.title || 'Open File',
      defaultPath: props.defaultPath || homePath,
      filters: props.filters || [],
      properties: props.properties || ['openFile']
    }, (filenames) => event.sender.send('open-file-dialog', filenames));
  });

  ipcMain.on('open-save-dialog', (event, props) => {
    dialog.showSaveDialog({
      title: props.title || 'Save File',
      defaultPath: `${homePath}/${props.name}`
    }, (filename) => event.sender.send('open-save-dialog', filename));
  });

  ipcMain.on('fs-write', (event, filepath, data) => {
    fs.writeFile(filepath, data, (err) => {
      event.sender.send('fs-write', err);
    });
  });
}

module.exports = { init };
