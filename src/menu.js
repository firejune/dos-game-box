'use strict';

const pack = require('../package.json');

const electron = require('electron');
const remote = electron.remote;
const shell = remote.shell;

function createMenuTemplate() {
  const isDarwin = process.platform === 'darwin';
  const win = remote.getCurrentWindow();
  const conf = app.readConf();
  console.info('dosbox.conf', conf);
  const recent = [];

  const cpuCore = conf.cpu && conf.cpu.core || 'auto';
  const cpuType = conf.cpu && conf.cpu.type || 'auto';
  const cpuCycles = conf.cpu && conf.cpu.cycles || 'auto';

  const memSize = conf.dosbox && conf.dosbox.memsize || '16';
  let memXMS = conf.dos && conf.dos.xms;
  let memEMS = conf.dos && conf.dos.ems;
  let memUMB = conf.dos && conf.dos.umb;

  const machine = conf.dosbox && conf.dosbox.machine || 'svga_s3';
  const mpu401 = conf.midi && conf.midi.mpu401 || 'intelligent';
  const mididevice = conf.midi && conf.midi.device || 'default';

  const sbtype = conf.sblaster && conf.sblaster.sbtype || 'sb16';
  const sbbase = conf.sblaster && conf.sblaster.sbbase || '220';
  const sbirq = conf.sblaster && conf.sblaster.irq || '7';
  const sbdma = conf.sblaster && conf.sblaster.dma || '1';
  const sbhdma = conf.sblaster && conf.sblaster.hdma || '5';
  const sboplmode = conf.sblaster && conf.sblaster.oplmode || 'auto';
  const sboplemu = conf.sblaster && conf.sblaster.oplemu || 'default';
  let sbmixer = conf.sblaster && conf.sblaster.mixer;

  const gusbase = conf.gus && conf.gus.gusbase || '240';
  const gusirq = conf.gus && conf.gus.irq2 || '5';
  const gusdma = conf.gus && conf.gus.dma2 || '3';
  let gus = conf.gus && conf.gus.gus;

  const tandy = conf.speaker && conf.speaker.tandy || 'auto';
  let pcspeaker = conf.speaker && conf.speaker.pcspeaker;
  let disney = conf.speaker && conf.speaker.disney;

  const joysticktype = conf.joystick && conf.joystick.joysticktype || 'auto';
  let joytimed = conf.joystick && conf.joystick.timed;
  let joyautofire = conf.joystick && conf.joystick.autofire;
  let joyswap34 = conf.joystick && conf.joystick.swap34;
  let joybuttonwrap = conf.joystick && conf.joystick.buttonwrap;

  const confScaler = conf.render && conf.render.scaler || 'none';
  const confScale = confScaler === 'none' ? '' : confScaler.match('x3') ? '3x' : '2x';

  const scale = app.readSetting('scale', confScale);
  const scaler = app.readSetting('scaler', confScaler);
  const sndRate = app.readSetting('rate', 22050);

  for (const data of box.getRecentRun()) {
    recent.push({
      label: data.name,
      click: box.launch.bind(box, data)
    });
  }

  /*
  - SERIAL
  - IPX
  - Sound
    - Volumn Up/Down

  - Auto Pause in Background
  - Send Key = [
    '\', '/', ':', '-', 'separator',
    'Insert', 'Delete', 'End', 'Page Up', 'Page Down', 'separator',
    'Num Lock', 'Scroll Lock', 'Print Screen', 'Pause (Key)', 'Break', 'separator',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
  ]
  */

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Recent Run', enabled: recent.length > 0, submenu: recent },
        { type: 'separator' },
        { label: 'Import ROM', click: () => box.importROM() },
        { label: 'Export ROM', click: () => box.exportROM() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectall' }
      ]
    },
    {
      label: 'View', submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
        { label: 'Full Screen', accelerator: isDarwin ? 'Ctrl+Command+F' : 'F11',
          type: 'checkbox', checked: win.isFullScreen(),
          click: () => win.setFullScreen(!win.isFullScreen()) },
        { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { type: 'separator' },
        { label: 'Screen Scale', submenu: [
          { label: 'Original', type: 'checkbox', enabled: !box.isRunning(),
            checked: !scale, click: () => changeScale('none') },
          { type: 'separator' },
          { label: '2x Scale', type: 'checkbox', enabled: !box.isRunning(),
            checked: scale === '2x', click: () => changeScale('2x') },
          { label: '3x Scale', type: 'checkbox', enabled: !box.isRunning(),
            checked: scale === '3x', click: () => changeScale('3x') }]
        },
        { label: 'Rendering Style', submenu: [
          { label: 'None', type: 'checkbox', enabled: !box.isRunning(),
            checked: !!scaler.match(/none|normal/),
            click: () => changeStyle(!scale ? 'none' : 'normal') },
          { type: 'separator' },
          { label: 'Fast Smoothing', type: 'checkbox', enabled: !!scale && !box.isRunning(),
            checked: scaler === 'advmame', click: () => changeStyle('advmame') },
          { label: 'Adv. Smoothing', type: 'checkbox', enabled: !!scale && !box.isRunning(),
            checked: scaler === 'advinterp',
            click: () => changeStyle('advinterp') },
          { label: 'Fancy Smoothing', type: 'checkbox', enabled: !!scale && !box.isRunning(),
            checked: scaler === 'hq', click: () => changeStyle('hq') },
          { type: 'separator' },
          { label: 'Super Smoothing', type: 'checkbox', enabled: scale === '2x' && !box.isRunning(),
            checked: scaler === 'super2xsai', click: () => changeStyle('super2xsai') },
          { label: 'Soft Smoothing', type: 'checkbox', enabled: scale === '2x' && !box.isRunning(),
            checked: scaler === '2xsai', click: () => changeStyle('2xsai') },
          { label: 'Super Eagle', type: 'checkbox', enabled: scale === '2x' && !box.isRunning(),
            checked: scaler === 'supereagle', click: () => changeStyle('supereagle') },
          { type: 'separator' },
          { label: 'RGB Phosphors', type: 'checkbox', enabled: !!scale && !box.isRunning(),
            checked: scaler === 'rgb', click: () => changeStyle('rgb') },
          { label: 'TV Scanlines', type: 'checkbox', enabled: !!scale && !box.isRunning(),
            checked: scaler === 'tv', click: () => changeStyle('tv') },
          { label: 'Scanlines', type: 'checkbox', enabled: !!scale && !box.isRunning(),
            checked: scaler === 'scan', click: () => changeStyle('scan2x') }
        ]},
        { label: 'Use 4:3 Aspect Ratio', accelerator: 'CmdOrCtrl+Shift+A',
          type: 'checkbox', checked: box.isAspectRatio, click: () => box.toggleAspectRatio() },
        { type: 'separator' },
        { label: 'Show Developer Tools', accelerator: isDarwin ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          type: 'checkbox', checked: win.isDevToolsOpened(),
          click: () => win.toggleDevTools() }
      ]
    },
    {
      label: 'Game',
      submenu: [
        { label: 'Save Status', accelerator: 'CmdOrCtrl+S', enabled: box.isRunning(),
          click: () => box.saveStatus() },
        { label: 'Load Status', accelerator: 'CmdOrCtrl+L', enabled: box.isRunning(),
          click: () => box.loadStatus() },
        { type: 'separator' },
        { label: 'Pause', accelerator: 'CmdOrCtrl+F', enabled: box.isRunning(),
          type: 'checkbox', checked: box.isPaused(), click: () => box.togglePause() },
        { label: 'Mouse Lock', accelerator: 'CmdOrCtrl+P',
          type: 'checkbox', checked: box.isMouseLocked, click: () => box.toggleMouseLock() },
        { label: 'Mute Sound', accelerator: 'CmdOrCtrl+M', enabled: box.isRunning(),
          type: 'checkbox', checked: box.isMuted(), click: () => box.muteSound() },
        { label: 'Send Key', submenu: [] },
        { type: 'separator' },
        { label: 'Exit Game', accelerator: 'CmdOrCtrl+W', enabled: box.isRunning(),
          click: () => box.exitGame() }
      ]
    },
    {
      label: 'Emulation',
      submenu: [
        { label: 'CPU Type', submenu: [
          { label: 'Auto', type: 'checkbox', enabled: !box.isRunning(),
            checked: cpuType === 'auto',
            click: () => app.saveConf('cpu', 'cputype', 'auto') },
          { type: 'separator' },
          { label: '386', type: 'checkbox', enabled: !box.isRunning(),
            checked: cpuType === '386',
            click: () => app.saveConf('cpu', 'cputype', '386') },
          { label: '386 Slow', type: 'checkbox', enabled: !box.isRunning(),
            checked: cpuType === '386_slow',
            click: () => app.saveConf('cpu', 'cputype', '386_slow') },
          { label: '386 Prefetch', type: 'checkbox', enabled: !box.isRunning(),
            checked: cpuType === '386_prefetch',
            click: () => app.saveConf('cpu', 'cputype', '386_prefetch') },
          { label: '486 Slow', type: 'checkbox', enabled: !box.isRunning(),
            checked: cpuType === '486_slow',
            click: () => app.saveConf('cpu', 'cputype', '486_slow') },
          { label: 'Pentium Slow', type: 'checkbox', enabled: !box.isRunning(),
            checked: cpuType === 'pentium_slow',
            click: () => app.saveConf('cpu', 'cputype', 'pentium_slow') }
        ] },
        { label: 'CPU Core', submenu: [
          { label: 'Auto', type: 'checkbox', enabled: !box.isRunning(),
            checked: cpuCore === 'auto',
            click: () => app.saveConf('cpu', 'core', 'auto') },
          { type: 'separator' },
          { label: 'Dynamic', type: 'checkbox', enabled: !box.isRunning(),
            checked: cpuCore === 'dynamic',
            click: () => app.saveConf('cpu', 'core', 'dynamic') },
          { label: 'Normal', type: 'checkbox', enabled: !box.isRunning(),
            checked: cpuCore === 'normal',
            click: () => app.saveConf('cpu', 'core', 'normal') },
          { label: 'Simple', type: 'checkbox', enabled: !box.isRunning(),
            checked: cpuCore === 'simple',
            click: () => app.saveConf('cpu', 'core', 'simple') }
        ] },
        { type: 'separator' },
        { label: 'CPU Cycles Auto', type: 'checkbox', enabled: !box.isRunning(),
          checked: cpuCycles === 'auto',
          click: () => app.saveConf('cpu', 'cycles', 'auto') },
        { label: 'CPU Cycles Max', type: 'checkbox', enabled: !box.isRunning(),
          checked: cpuCycles === 'max',
          click: () => app.saveConf('cpu', 'cycles', 'max') },
        { label: 'Fixed 200000(Pentium II)', type: 'checkbox', enabled: !box.isRunning(),
          checked: cpuCycles === 'fixed 200000',
          click: () => app.saveConf('cpu', 'cycles', 'fixed 200000') },
        { label: 'Fixed 77000(Pentium)', type: 'checkbox', enabled: !box.isRunning(),
          checked: cpuCycles === 'fixed 77000',
          click: () => app.saveConf('cpu', 'cycles', 'fixed 77000') },
        { label: 'Fixed 26800(486)', type: 'checkbox', enabled: !box.isRunning(),
          checked: cpuCycles === 'fixed 26800',
          click: () => app.saveConf('cpu', 'cycles', 'fixed 26800') },
        { label: 'Fixed 7800(386)', type: 'checkbox', enabled: !box.isRunning(),
          checked: cpuCycles === 'fixed 7800',
          click: () => app.saveConf('cpu', 'cycles', 'fixed 7800') },
        { label: 'Fixed 2750(AT)', type: 'checkbox', enabled: !box.isRunning(),
          checked: cpuCycles === 'fixed 2750',
          click: () => app.saveConf('cpu', 'cycles', 'fixed 2750') },
        { label: 'Fixed 315(XT)', type: 'checkbox', enabled: !box.isRunning(),
          checked: cpuCycles === 'fixed 315',
          click: () => app.saveConf('cpu', 'cycles', 'fixed 315') },
        { type: 'separator' },
        {
          label: 'Memory Size', submenu: [
            { label: '32 MB', type: 'checkbox', enabled: !box.isRunning(),
              checked: memSize === '31',
              click: () => app.saveConf('dosbox', 'memsize', '31') },
            { type: 'separator' },
            { label: '64 MB', type: 'checkbox', enabled: !box.isRunning(),
              checked: memSize === '63',
              click: () => app.saveConf('dosbox', 'memsize', '63') },
            { label: '16 MB', type: 'checkbox', enabled: !box.isRunning(),
              checked: memSize === '16',
              click: () => app.saveConf('dosbox', 'memsize', '16') }
          ]
        },
        { type: 'separator' },
        { label: 'Extended Memory(XMS)', type: 'checkbox', enabled: !box.isRunning(),
          checked: memXMS, click: () => app.saveConf('dos', 'xms', memXMS = !memXMS) },
        { label: 'Expanded Memory(EMS)', type: 'checkbox', enabled: !box.isRunning(),
          checked: memEMS, click: () => app.saveConf('dos', 'ems', memEMS = !memEMS) },
        { label: 'Upper Memory Block(UMB)', type: 'checkbox', enabled: !box.isRunning(),
          checked: memUMB, click: () => app.saveConf('dos', 'umb', memUMB = !memUMB) },
        { type: 'separator' },
        { label: 'Graphic', submenu: [
          { label: 'SVGA', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'svga_s3',
            click: () => app.saveConf('dosbox', 'machine', 'svga_s3') },
          { type: 'separator' },
          { label: 'VESA(1.3)', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'vesa_oldvbe',
            click: () => app.saveConf('dosbox', 'machine', 'vesa_oldvbe') },
          { label: 'VESA(NO-LFB)', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'vesa_nolfb',
            click: () => app.saveConf('dosbox', 'machine', 'vesa_nolfb') },
          { label: 'SVGA Paradise', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'svga_paradise',
            click: () => app.saveConf('dosbox', 'machine', 'svga_paradise') },
          { label: 'SVGA ET4000', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'svga_et4000',
            click: () => app.saveConf('dosbox', 'machine', 'svga_et4000') },
          { label: 'SVGA ET3000', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'svga_et3000',
            click: () => app.saveConf('dosbox', 'machine', 'svga_et3000') },
          { type: 'separator' },
          { label: 'VGA(256 Colors)', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'vgaonly',
            click: () => app.saveConf('dosbox', 'machine', 'vgaonly') },
          { label: 'EGA(16 Colors)', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'ega',
            click: () => app.saveConf('dosbox', 'machine', 'ega') },
          { label: 'PCjr(16 Colors)', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'pcjr',
            click: () => app.saveConf('dosbox', 'machine', 'pcjr') },
          { label: 'Tandy(16 Colors)', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'tandy',
            click: () => app.saveConf('dosbox', 'machine', 'tandy') },
          { label: 'CGA(4 Colors)', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'cga',
            click: () => app.saveConf('dosbox', 'machine', 'cga') },
          { label: 'Hercules(2 Colors)', type: 'checkbox', enabled: !box.isRunning(),
            checked: machine === 'hercules',
            click: () => app.saveConf('dosbox', 'machine', 'hercules') }
        ] },
        { type: 'separator' },
        { label: 'Sound', submenu: [
          { label: 'MIDI', submenu: [
            { label: 'MPU-401', submenu: [
              { label: 'Intelligent', type: 'checkbox', enabled: !box.isRunning(),
                checked: mpu401 === 'intelligent',
                click: () => updateMenu('midi', 'mpu401', 'intelligent') },
              { type: 'separator' },
              { label: 'UART', type: 'checkbox', enabled: !box.isRunning(),
                checked: mpu401 === 'uart',
                click: () => updateMenu('midi', 'mpu401', 'uart') },
              { label: 'None', type: 'checkbox', enabled: !box.isRunning(),
                checked: mpu401 === 'none',
                click: () => updateMenu('midi', 'mpu401', 'none') }
            ] },
            { type: 'separator' },
            { label: 'Default System MIDI', type: 'checkbox', enabled: !box.isRunning(),
              checked: mididevice === 'default',
              click: () => updateMenu('midi', 'device', 'default') },

            { label: 'Win32 MIDI Playback', type: 'checkbox', enabled: !box.isRunning(),
              checked: mididevice === 'win32',
              click: () => updateMenu('midi', 'device', 'win32') },
            { label: 'Advanced Linux Sound', type: 'checkbox', enabled: !box.isRunning(),
              checked: mididevice === 'alsa',
              click: () => updateMenu('midi', 'device', 'alsa') },
            { label: 'Open Sound System', type: 'checkbox', enabled: !box.isRunning(),
              checked: mididevice === 'oss',
              click: () => updateMenu('midi', 'device', 'oss') },
            { label: 'OS X Synthesizer', type: 'checkbox', enabled: !box.isRunning(),
              checked: mididevice === 'coreaudio',
              click: () => updateMenu('midi', 'device', 'coreaudio') },
            { label: 'OS X Audio MIDI', type: 'checkbox', enabled: !box.isRunning(),
              checked: mididevice === 'coremidi',
              click: () => updateMenu('midi', 'device', 'coremidi') },
            { label: 'None', type: 'checkbox', enabled: !box.isRunning(),
              checked: mididevice === 'none',
              click: () => updateMenu('midi', 'device', 'none') }
          ] },
          { label: 'Sound Blaster', submenu: [
            { label: 'Type', submenu: [
              { label: 'Sound Blaster 16', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbtype === 'sb16',
                click: () => updateMenu('sblaster', 'sbtype', 'sb16') },
              { type: 'separator' },
              { label: 'Sound Blaster Pro 2', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbtype === 'sbpro2',
                click: () => updateMenu('sblaster', 'sbtype', 'sbpro2') },
              { label: 'Sound Blaster Pro 1', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbtype === 'sbpro1',
                click: () => updateMenu('sblaster', 'sbtype', 'sbpro1') },
              { label: 'Sound Blaster 2', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbtype === 'sb2',
                click: () => updateMenu('sblaster', 'sbtype', 'sb2') },
              { label: 'Sound Blaster 1', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbtype === 'sb1',
                click: () => updateMenu('sblaster', 'sbtype', 'sb1') },
              { label: 'None', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbtype === 'none',
                click: () => updateMenu('sblaster', 'sbtype', 'none') }
            ] },
            { type: 'separator' },
            { label: `Base [${sbbase}]`, submenu: [
              { label: '220', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbbase === '220',
                click: () => updateMenu('sblaster', 'sbbase', '220') },
              { type: 'separator' },
              { label: '240', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbbase === '240',
                click: () => updateMenu('sblaster', 'sbbase', '240') },
              { label: '260', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbbase === '260',
                click: () => updateMenu('sblaster', 'sbbase', '260') },
              { label: '280', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbbase === '280',
                click: () => updateMenu('sblaster', 'sbbase', '280') },
              { label: '2a0', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbbase === '2a0',
                click: () => updateMenu('sblaster', 'sbbase', '2a0') },
              { label: '2c0', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbbase === '2c0',
                click: () => updateMenu('sblaster', 'sbbase', '2c0') },
              { label: '2e0', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbbase === '2e0',
                click: () => updateMenu('sblaster', 'sbbase', '2e0') },
              { label: '300', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbbase === '300',
                click: () => updateMenu('sblaster', 'sbbase', '300') }
            ] },
            { label: `IRQ [${sbirq}]`, submenu: [
              { label: '7', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbirq === '7',
                click: () => updateMenu('sblaster', 'irq', '7') },
              { type: 'separator' },
              { label: '5', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbirq === '5',
                click: () => updateMenu('sblaster', 'irq', '5') },
              { label: '3', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbirq === '3',
                click: () => updateMenu('sblaster', 'irq', '3') },
              { label: '9', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbirq === '9',
                click: () => updateMenu('sblaster', 'irq', '9') },
              { label: '10', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbirq === '10',
                click: () => updateMenu('sblaster', 'irq', '10') },
              { label: '11', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbirq === '11',
                click: () => updateMenu('sblaster', 'irq', '11') },
              { label: '12', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbirq === '12',
                click: () => updateMenu('sblaster', 'irq', '12') }
            ] },
            { label: `DMB [${sbdma}]`, submenu: [
              { label: '1', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbdma === '1',
                click: () => updateMenu('sblaster', 'dma', '1') },
              { type: 'separator' },
              { label: '5', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbdma === '5',
                click: () => updateMenu('sblaster', 'dma', '5') },
              { label: '0', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbdma === '0',
                click: () => updateMenu('sblaster', 'dma', '0') },
              { label: '3', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbdma === '3',
                click: () => updateMenu('sblaster', 'dma', '3') },
              { label: '6', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbdma === '6',
                click: () => updateMenu('sblaster', 'dma', '6') },
              { label: '7', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbdma === '7',
                click: () => updateMenu('sblaster', 'dma', '7') }
            ] },
            { label: `HDMA [${sbhdma}]`, submenu: [
              { label: '1', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbhdma === '1',
                click: () => updateMenu('sblaster', 'hdma', '1') },
              { type: 'separator' },
              { label: '5', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbhdma === '5',
                click: () => updateMenu('sblaster', 'hdma', '5') },
              { label: '0', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbhdma === '0',
                click: () => updateMenu('sblaster', 'hdma', '0') },
              { label: '3', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbhdma === '3',
                click: () => updateMenu('sblaster', 'hdma', '3') },
              { label: '6', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbhdma === '6',
                click: () => updateMenu('sblaster', 'hdma', '6') },
              { label: '7', type: 'checkbox', enabled: !box.isRunning(),
                checked: sbhdma === '7',
                click: () => updateMenu('sblaster', 'hdma', '7') }
            ] },
            { type: 'separator' },
            { label: `OPL Mode`, submenu: [
              { label: 'auto', type: 'checkbox', enabled: !box.isRunning(),
                checked: sboplmode === 'auto',
                click: () => updateMenu('sblaster', 'oplmode', 'auto') },
              { type: 'separator' },
              { label: 'CMS', type: 'checkbox', enabled: !box.isRunning(),
                checked: sboplmode === 'cms',
                click: () => updateMenu('sblaster', 'oplmode', 'cms') },
              { label: 'OPL-2', type: 'checkbox', enabled: !box.isRunning(),
                checked: sboplmode === 'opl2',
                click: () => updateMenu('sblaster', 'oplmode', 'opl2') },
              { label: 'Dule OPL-2', type: 'checkbox', enabled: !box.isRunning(),
                checked: sboplmode === 'dualopl2',
                click: () => updateMenu('sblaster', 'oplmode', 'dualopl2') },
              { label: 'OPL-3', type: 'checkbox', enabled: !box.isRunning(),
                checked: sboplmode === 'opl3',
                click: () => updateMenu('sblaster', 'oplmode', 'opl3') },
              { label: 'None', type: 'checkbox', enabled: !box.isRunning(),
                checked: sboplmode === 'none',
                click: () => updateMenu('sblaster', 'oplmode', 'none') }
            ] },
            { label: `OPL Emulation`, submenu: [
              { label: 'default', type: 'checkbox', enabled: !box.isRunning(),
                checked: sboplemu === 'default',
                click: () => updateMenu('sblaster', 'oplemu', 'default') },
              { type: 'separator' },
              { label: 'Compat', type: 'checkbox', enabled: !box.isRunning(),
                checked: sboplemu === 'compat',
                click: () => updateMenu('sblaster', 'oplemu', 'compat') },
              { label: 'Fast', type: 'checkbox', enabled: !box.isRunning(),
                checked: sboplemu === 'fast',
                click: () => updateMenu('sblaster', 'oplemu', 'fast') },
              { label: 'Old', type: 'checkbox', enabled: !box.isRunning(),
                checked: sboplemu === 'old',
                click: () => updateMenu('sblaster', 'oplemu', 'old') }
            ] },
            { type: 'separator' },
            { label: 'Use Mixer', type: 'checkbox', enabled: !box.isRunning(),
              checked: sbmixer,
              click: () => app.saveConf('sblaster', 'mixer', sbmixer = !sbmixer) }
          ] },
          { label: 'Gravis Ultra Sound', submenu: [
            { label: 'Enabled', type: 'checkbox', enabled: !box.isRunning(),
              checked: gus,
              click: () => app.saveConf('gus', 'gus', gus = !gus) },
            { type: 'separator' },
            { label: `Base [${gusbase}]`, submenu: [
              { label: '220', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusbase === '220',
                click: () => updateMenu('gus', 'gusbase', '220') },
              { type: 'separator' },
              { label: '240', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusbase === '240',
                click: () => updateMenu('gus', 'gusbase', '240') },
              { label: '260', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusbase === '260',
                click: () => updateMenu('gus', 'gusbase', '260') },
              { label: '280', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusbase === '280',
                click: () => updateMenu('gus', 'gusbase', '280') },
              { label: '2a0', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusbase === '2a0',
                click: () => updateMenu('gus', 'gusbase', '2a0') },
              { label: '2c0', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusbase === '2c0',
                click: () => updateMenu('gus', 'gusbase', '2c0') },
              { label: '2e0', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusbase === '2e0',
                click: () => updateMenu('gus', 'gusbase', '2e0') },
              { label: '300', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusbase === '300',
                click: () => updateMenu('gus', 'gusbase', '300') }
            ] },
            { label: `IRQ [${gusirq}]`, submenu: [
              { label: '5', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusirq === '5',
                click: () => updateMenu('gus', 'irq2', '5') },
              { type: 'separator' },
              { label: '3', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusirq === '3',
                click: () => updateMenu('gus', 'irq2', '3') },
              { label: '7', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusirq === '7',
                click: () => updateMenu('gus', 'irq2', '7') },
              { label: '9', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusirq === '9',
                click: () => updateMenu('gus', 'irq2', '9') },
              { label: '10', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusirq === '10',
                click: () => updateMenu('gus', 'irq2', '10') },
              { label: '11', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusirq === '11',
                click: () => updateMenu('gus', 'irq2', '11') },
              { label: '12', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusirq === '12',
                click: () => updateMenu('gus', 'irq2', '12') }
            ] },
            { label: `DMA [${gusdma}]`, submenu: [
              { label: '3', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusdma === '3',
                click: () => updateMenu('gus', 'dma2', '3') },
              { type: 'separator' },
              { label: '0', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusdma === '0',
                click: () => updateMenu('gus', 'dma2', '0') },
              { label: '1', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusdma === '1',
                click: () => updateMenu('gus', 'dma2', '1') },
              { label: '5', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusdma === '5',
                click: () => updateMenu('gus', 'dma2', '5') },
              { label: '6', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusdma === '6',
                click: () => updateMenu('gus', 'dma2', '6') },
              { label: '7', type: 'checkbox', enabled: !box.isRunning(),
                checked: gusdma === '7',
                click: () => updateMenu('gus', 'dma2', '7') }
            ] }
          ] },
          { label: 'PC Speaker', submenu: [
            { label: 'Enabled', type: 'checkbox', enabled: !box.isRunning(),
              checked: pcspeaker,
              click: () => app.saveConf('speaker', 'pcspeaker', pcspeaker = !pcspeaker) },
            { type: 'separator' },
            { label: 'Tandy Sound', submenu: [
              { label: 'Auto', type: 'checkbox', enabled: !box.isRunning(),
                checked: tandy === 'auto',
                click: () => updateMenu('speaker', 'tandy', 'auto') },
              { type: 'separator' },
              { label: 'On', type: 'checkbox', enabled: !box.isRunning(),
                checked: tandy === 'on',
                click: () => updateMenu('speaker', 'tandy', 'on') },
              { label: 'Off', type: 'checkbox', enabled: !box.isRunning(),
                checked: tandy === 'off',
                click: () => updateMenu('speaker', 'tandy', 'off') }
            ] },
            { label: 'Disney Sound', type: 'checkbox', enabled: !box.isRunning(),
              checked: disney,
              click: () => app.saveConf('speaker', 'memsize', disney = !disney) }
          ] },
          { type: 'separator' },
          { label: 'Sample Rate 49.7 KHz', type: 'checkbox', enabled: !box.isRunning(),
            checked: sndRate === '49716', click: () => changeSempleRate('49716') },
          { label: 'Sample Rate 48 KHz', type: 'checkbox', enabled: !box.isRunning(),
            checked: sndRate === '48000', click: () => changeSempleRate('48000') },
          { label: 'Sample Rate 44.1 KHz', type: 'checkbox', enabled: !box.isRunning(),
            checked: sndRate === '44100', click: () => changeSempleRate('44100') },
          { label: 'Sample Rate 32 KHz', type: 'checkbox', enabled: !box.isRunning(),
            checked: sndRate === '32000', click: () => changeSempleRate('32000') },
          { label: 'Sample Rate 22 KHz', type: 'checkbox', enabled: !box.isRunning(),
            checked: sndRate === '22050', click: () => changeSempleRate('22050') },
          { label: 'Sample Rate 16 KHz', type: 'checkbox', enabled: !box.isRunning(),
            checked: sndRate === '16000', click: () => changeSempleRate('16000') },
          { label: 'Sample Rate 11 KHz', type: 'checkbox', enabled: !box.isRunning(),
            checked: sndRate === '11025', click: () => changeSempleRate('11025') },
          { label: 'Sample Rate 8 KHz', type: 'checkbox', enabled: !box.isRunning(),
            checked: sndRate === '8000', click: () => changeSempleRate('8000') }
        ] },
        { type: 'separator' },
        { label: 'Joystick', submenu: [
          { label: 'Type', submenu: [
            { label: 'Auto', type: 'checkbox', enabled: !box.isRunning(),
              checked: joysticktype === 'auto',
              click: () => updateMenu('joystick', 'joysticktype', 'auto') },
            { type: 'separator' },
            { label: '2 Axis', type: 'checkbox', enabled: !box.isRunning(),
              checked: joysticktype === '2axis',
              click: () => updateMenu('joystick', 'joysticktype', '2axis') },
            { label: 'First 4 Axis', type: 'checkbox', enabled: !box.isRunning(),
              checked: joysticktype === '4axis',
              click: () => updateMenu('joystick', 'joysticktype', '4axis') },
            { label: 'Second 4 Axis', type: 'checkbox', enabled: !box.isRunning(),
              checked: joysticktype === '4axis_2',
              click: () => updateMenu('joystick', 'joysticktype', '4axis_2') },
            { label: 'Flight Stick', type: 'checkbox', enabled: !box.isRunning(),
              checked: joysticktype === 'fcs',
              click: () => updateMenu('joystick', 'joysticktype', 'fcs') },
            { label: 'None', type: 'checkbox', enabled: !box.isRunning(),
              checked: joysticktype === 'none',
              click: () => updateMenu('joystick', 'joysticktype', 'none') }
          ] },
          { type: 'separator' },
          { label: 'Timed Interval', type: 'checkbox', enabled: !box.isRunning(),
            checked: joytimed,
            click: () => app.saveConf('joystick', 'timed', joytimed = !joytimed) },

          { label: 'Auto Fire', type: 'checkbox', enabled: !box.isRunning(),
            checked: joyautofire,
            click: () => app.saveConf('joystick', 'autofire', joyautofire = !joyautofire) },

          { label: 'Swap 3rd 4th Axis', type: 'checkbox', enabled: !box.isRunning(),
            checked: joyswap34,
            click: () => app.saveConf('joystick', 'swap34', joyswap34 = !joyswap34) },

          { label: 'Button Wrapping', type: 'checkbox', enabled: !box.isRunning(),
            checked: joybuttonwrap,
            click: () => app.saveConf('joystick', 'buttonwrap', joybuttonwrap = !joybuttonwrap) }
        ] }
      ]
    },
    {
      label: 'Help', role: 'help', submenu: [
        { label: 'Homepage', click: () => shell.openExternal(app, pack.homepage) },
        { label: 'Documentation', click: () => shell.openExternal(pack.bugs.url) },
        { label: 'Bug Report', click: () => shell.openExternal(pack.repository.url) }
      ]
    }
  ];

  if (isDarwin) {
    template.unshift({
      label: 'Electron',
      submenu: [
        { label: `About ${pack.name}`, role: 'about' },
        { type: 'separator' },
        { label: 'Services', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: `Hide ${pack.name}`, accelerator: 'Command+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Command+Alt+H', role: 'hideothers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', click: () => remote.app.quit() }
      ]
    });
  }

  function changeSempleRate(value) {
    app.saveConf('mixer', 'rate', value);
    app.saveConf('sblaster', 'oplrate', value);
    app.saveConf('gus', 'gusrate', value);
    app.saveConf('speaker', 'pcrate', value);
    app.saveConf('speaker', 'tandyrate', value);

    app.saveSetting('rate', value);
    box.updateMenu();
  }

  function changeScale(value) {
    switch (value) {
      case 'none':
        value = '';
        changeStyle('none', true);
        break;

      case '2x':
      case '3x':
        changeStyle(scaler, true);
        break;
    }

    app.saveSetting('scale', value);
    box.updateMenu();
  }

  function changeStyle(value, notSave) {
    if (!notSave) {
      app.saveSetting('scaler', value);
    }

    switch (value) {
      case 'normal':
      case 'advmame':
      case 'advinterp':
      case 'hq':
      case 'rgb':
      case 'tv':
      case 'scan':
        value += scale;
        break;
    }

    updateMenu('render', 'scaler', value);
  }

  function updateMenu(section, key, val) {
    if (section === 'gus') {
      if (key === 'dma2') {
        app.saveConf(section, 'dma1', val);
      }
      if (key === 'irq2') {
        app.saveConf(section, 'irq1', val);
      }
    }

    app.saveConf(section, key, val);
    box.updateMenu();
  }

  return template;
}

module.exports = createMenuTemplate;
