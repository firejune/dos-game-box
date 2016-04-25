'use strict';

const fs = require('fs');
const $ = require('jquery');
require('./v86/libv86.js');

function readfile(path) {
  return new Uint8Array(fs.readFileSync(path)).buffer;
}

const bios = readfile(__dirname + '/v86/bios/seabios.bin');
const vag = readfile(__dirname + '/v86/bios/vgabios.bin');
const freedos = readfile(__dirname + '/v86/images/freedos722.img');
const msdos = readfile(__dirname + '/v86/images/msdos710.img');

const emulator = new V86Starter({
  memory_size: 64 * 1024 * 1024,
  vga_memory_size: 8 * 1024 * 1024,

  screen_container: $('#box').get(0),
  // serial_container: $('serial').get(0),
  boot_order: 0, // 1:CD / 2:Hard Disk / 3:Floppy
  // network_relay_url: 'ws://relay.widgetry.org/',

  bios: { buffer: bios },
  vga_bios: { buffer: vag },
  fda: { buffer: freedos },
  // cdrom: { buffer: prince },
  // hda: { buffer: msdos },
  // hda: { buffer: prince },

  // initial_state: {},
  // filesystem: {},

  autostart: true
});

/*
emulator.add_listener('serial0-output-char', function(chr) {
  console.log(chr);
}.bind(this));

function send(data) {
  emulator.serial0_send(data);
}
*/

global.emulator = emulator;
