'use strict';

const $ = require('jquery');
require('jquery.scrollto');

const app = require('./src/app');
const Emulator = require('./src/emulator');
const createMenuTemplate = require('./src/menu');

class Gamebox {
  constructor() {
    this.engine = 'sdl2.sync';
    this.recent = app.readSetting('recent', []);
    this.$win = $(window);
    this.$doc = $(document);
    this.$nav = $('#nav');
    this.$set = $('#set');
    this.$box = $('#box');
    this.$util = $('#utils');
    this.$dialog = $('#dialog');
    this.$overlay = $('#overlay');
    this.$canvas = this.$box.find('canvas');
    this.canvas = this.$canvas.get(0);

    // 저장된 설정 호출
    this.isAspectRatio = app.readSetting('aspect', true);
    this.isMouseLocked = app.readSetting('locked', true);
    // this.canvas.gl = this.canvas.getContext('webgl');

    const $nav = this.$nav.add(this.$set).add(this.$util);
    this.$doc.on('keydown', e => {
      const isDialogOpen = this.$dialog.is(':visible');
      // ESC
      if (!e.metaKey && !e.shiftKey && !e.ctrlKey && e.which === 27) {
        if (this.unlockMouse()) {
          e.stopPropagation();
          e.preventDefault();
        }

        if (isDialogOpen) {
          this.$dialog.hide();
          this.$overlay.hide();
        }
      }

      if (this.isRunning() || isDialogOpen) {
        return;
      }

      const $cur = $nav.filter(':visible').find('.focus:first');
      let $next = null;

      // Up
      if (!e.metaKey && !e.shiftKey && !e.ctrlKey && e.which === 38) {
        $next = $cur.prev('.item');
      }

      // Down
      if (!e.metaKey && !e.shiftKey && !e.ctrlKey && e.which === 40) {
        $next = $cur.next('.item');
      }

      if ($next && $next.length) {
        $next.addClass('focus');
        $cur.removeClass('focus');

        $nav.filter(':visible').scrollTo($next, {
          interrupt: true,
          offset: { top: -this.$win.height() / 2 },
          over: { top: 0.5 },
          duration: 100
        });
        e.preventDefault();
      }

      // Enter
      if (!e.metaKey && !e.shiftKey && !e.ctrlKey && e.which === 13
        && ($next = $cur.next('.item')).length) {
        this.execute($cur.find('a'));
      }
    });

    this.$canvas.on('click', (ev) => {
      if (document.pointerLockElement !== this.canvas && this.isMouseLocked) {
        this.canvas.requestPointerLock();
        ev.preventDefault();
      }
    });

    let resizeTimer = null;
    this.$win.on('resize', () => {
      if (!this.isRunning()) {
        return;
      }

      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.resizeWindow(), 400);
    });

    $nav.on('click', '.item a', e => {
      const $el = $(e.target);
      this.execute($el);
    });
    $nav.find('.sdl').html(this.engine);
    $nav.find('.ver').html(app.version);
    $nav.on('mouseenter mouseleave', '.item a', e => {
      $nav.filter(':visible').find('.focus').removeClass('focus');
      $(e.target).parent().addClass('focus');
    });

    this.$dialog.on('click', '.button', e => {
      if ($(e.target).hasClass('ok')) {
        this.saveConf();
      }
      this.$dialog.hide();
      this.$overlay.hide();
    });

    this.$overlay.on('click', () => {
      this.$dialog.hide();
      this.$overlay.hide();
    });

    app.setup(() => {
      this.makeList(this.$nav, app.getFiles('game'));
      this.makeList(this.$util, app.getFiles('util'));
      app.register({});
    });
  }

  execute($el) {
    if ($el.parent().hasClass('settings')) {
      this.$nav.hide();
      this.$set.show();
    } else if ($el.parent().hasClass('utils')) {
      this.$nav.hide().removeClass('enter');
      this.$util.show().addClass('enter');
    } else if ($el.parent().hasClass('parent')) {
      this.$set.hide();
      this.$nav.show().addClass('enter');
      this.$util.hide().removeClass('enter');
    } else if ($el.parent().hasClass('prompt')) {
      this.launch();
    } else if ($el.parent().hasClass('set')) {
      this.showConf($el);
    } else {
      this.launch(this.getParams($el, this.$nav.is(':visible') ? app.name : 'bin/utils'));
    }
  }

  saveConf() {
    const section = this.$dialog.find('.section span').html();

    if (section === 'default') {
      app.resetConf();
      this.updateMenu();
    } else {
      const text = this.$dialog.find('textarea').val();
      app.saveConfAsText(section, text);
    }
  }

  showConf($el) {
    const section = $el.html().replace('SET_', '');
    const reset = section === 'default';
    let text = '';

    if (reset) {
      text = 'Reset Your DOSBox To Its Default Settings?';
    } else {
      const conf = app.readConf(section);
      for (const key in conf) {
        text += `${key}=${conf[key]}\n`;
      }
    }

    this.$dialog
      .show()
      .find('textarea').attr('disabled', reset).focus().val(text).end()
      .find('.section span').html(section);

    this.$overlay.show();
  }

  makeList($nav, files) {
    const items = [];
    let totalSize = 0;

    for (const file of files) {
      if (file.name.split('-').length !== 2) {
        continue;
      }
      const zip = file.name.split('-')[0];
      const exe = file.name.split('-')[1].replace(/\|/g, '/').replace(/\.zip/i, '');
      const size = file.stat.size.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const time = file.stat.ctime.toISOString().replace(/T/, ' ').replace(/\..+/, '');
      totalSize += file.stat.size;

      items.push(`
        <p class="item">
          <a data-exe="${exe}" data-file="${file.name}">${zip}.exe</a>
          <span class="pull-right"><b class="size">${size}</b>&nbsp;&nbsp;${time}</span>
        </p>`
      );
    }

    $nav.find('.target').after(items.join(''));
    $nav.find('.target').next().addClass('focus');
    $nav.find('.count').show()
      .find('.files').html(items.length).end()
      .find('.total').html(totalSize.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  }

  updateMenu() {
    app.setMenu(createMenuTemplate());
  }

  toggleAspectRatio() {
    this.isAspectRatio = !this.isAspectRatio;
    app.saveSetting('aspect', this.isAspectRatio);
    this.isRunning() && this.resizeWindow();
  }

  aspectRatio() {
    const forcedAspectRatio = this.isAspectRatio ? 1.3333333333333333 : 1.6;
    let height = this.$canvas.removeAttr('style').width() / forcedAspectRatio;

    if (app.isFullScreen() && this.isAspectRatio && height > this.$win.height()) {
      height = this.$win.height();

      // 비율고정이 활성화 되면 전채화면에서도 비율 유지
      const windowWidth = this.$win.width();
      const width = height * forcedAspectRatio;
      const marginLeft = (windowWidth - width) / 2;
      this.$canvas.css({width, marginLeft});
    }

    this.$canvas.css({height});
  }

  resizeWindow() {
    const size = app.getSize();
    const dist = {
      width: size[0] - this.$win.width(),
      height: size[1] - this.$win.height()
    };

    this.aspectRatio();

    const width = this.$canvas.width() + dist.width;
    const height = this.$canvas.height() + dist.height;

    if (!app.isFullScreen() && size[0] !== width || size[1] !== height) {
      app.setSize(width, height);
    }
  }

  getParams($el, type) {
    return {
      name: $el.html(),
      exe: `game/${$el.data('exe')}`,
      path: `./${type}/${$el.data('file')}`
    };
  }

  launch(params) {
    if (this.isRunning() && this.game.module.Runtime) {
      this.game.onexit = () => {
        this.game = null;
        this.setTitle();
        this.updateMenu();
        this.unlockMouse();
        this.launch(params);
      };

      this.game.exit();
      return;
    }

    this.game = new Emulator({
      $nav: this.$nav.add(this.$util),
      $div: this.$box,
      exe: params && params.exe,
      path: params && params.path,
      engine: this.engine,
      onstat: stat => {
        if (!stat) stat = '';
        stat = stat.split(/,\s+/);
        if (stat.length !== 4) return;
        const dosboxVersion = stat[0];
        const cpuSpeed = stat[1].split(/\:\s+/)[1];
        const frameSkip = stat[2].split(/\s+/)[1];
        const program = stat[3].split(/\:\s+/)[1];

        console.info(dosboxVersion, cpuSpeed, frameSkip, program);
        this.setTitle(program);
      },

      onresize: () => {
        this.resizeWindow();
      },

      onrun: () => {
        this.updateMenu();
        this.resizeWindow();

        if (params) {
          const recent = [params];
          for (const data of this.recent) {
            if (data.path !== params.path) {
              recent.push(data);
            }

            if (recent.length > 10) {
              break;
            }
          }

          app.saveSetting('recent', this.recent = recent);
        }
      },

      onerror: () => {
        //
      },

      onexit: () => {
        this.game = null;
        this.setTitle();
        this.updateMenu();
        this.unlockMouse();
      }
    });
  }

  toggleMouseLock() {
    this.isMouseLocked = !this.isMouseLocked;
    app.saveSetting('locked', this.isMouseLocked);
  }

  unlockMouse() {
    if (document.pointerLockElement === this.canvas) {
      if (document.exitPointerLock) {
        document.exitPointerLock();
      }
      if (this.canvas.exitPointerLock) {
        this.canvas.exitPointerLock();
      }
      return true;
    }
    return false;
  }

  setTitle(title) {
    app.setTitle(title);
  }

  isRunning() {
    return !!this.game;
  }

  getRecentRun() {
    return this.recent;
  }

  saveStatus() {
    const stack = this.game.module.Runtime.stackSave();
    console.log(stack);
  }

  loadStatus() {
    this.game.module.Runtime.stackRestore();
  }

  importROM() {

  }

  exportROM() {

  }

  isMuted() {
    return false;
  }

  muteSound() {

  }

  isPaused() {
    return this.game && this.game.paused;
  }

  togglePause() {
    this.game.togglePause();
  }

  exitGame() {
    this.game.exit();
  }
}

$(() => {
  global.box = new Gamebox();
  box.updateMenu();
});
