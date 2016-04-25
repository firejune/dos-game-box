'use strict';

/*
//Image/Zip file 파일 선택

//Genaric Configuration
Scale Factor: [-1, 1*, 2, 3]
Frame skip: [-1, 0, 1*, 2, 3, 5, 6]
Core: [normal, dynamic*]
Aggressive: [true*, false]
Cycles: [auto, max, fixed*, ignore]
Limit: 7000
Limit Maximum FPS:
  - Enable: [true*, false]
  - Input: 12
Sound:
  - Mixing Rate: [8000, 11025, 16000, 22050, 32000, 44100] Hz
  - Sound Blaster: [sb1, sb2, sbpro1, sbpro2, sb16, gb, none]
  - port 220, irq 7, dma 1, 5
Adlib (auto):
  - Enable: [true*, false]
	- Gravis, port 240, irq 5, dma 3: [true*, false]
Enable Mouse (Shake inside screen to initialise): [true*, false]

//Advanced Settings (subject to change)
Cmd line args: input
Sound block: [256, 512, 1024, 2048*, 4096, 8192]
Js buffer: [256, 512, 1024, 2048*, 4096, 8192]

Pre-buffer: 40
Modfactor: -1
*/

class Dosbox {
  constructor(options) {
    this.__options = options;
    this.canvas = options.canvas;

    this.preRun = [];
    this.postRun = [];
    this.totalDependencies = 0;

    // 4:3 Aspect Ratio
    // FIXME 이걸 사용하면 무조건 1:1 사이즈가 되어버림
    // this.forcedAspectRatio = 1.3333333333333333;

    // 마우스 커서 락
    this.elementPointerLock = false;
    this.noInitialRun = false;

    if (this.__options.engine.match('.sync')) {
      this.locateFile = (memFileName) => {
        const zip = app.readZip(`./bin/memory.${this.__options.engine.split('.')[0]}.zip`);
        app.writeFile(`./${app.name}/${memFileName}`, zip.file(memFileName).asNodeBuffer());
        return `${app.homePath}/${app.name}/${memFileName}`;
      };
    }
  }

  print(...text) {
    this.__options.print(text.join(' '));
  }

  printErr(...text) {
    console.warn(text.join(' '));
    // this.__options.error(text.join(' '));
  }

  dimensionsUpdate(w, h) {
    console.log('game.dimensionsUpdate', w, h);
    this.__options.resize(w, h);
  }

  setWindowTitle(title) {
    this.__options.stat(title);
  }

  setStatus(text) {
    if (text === this.setStatus.text) return;
    const m = text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
    const now = Date.now();

    // if this is a progress update, skip it if too soon
    if (m && now - Date.now() < 30) return;

    if (m) {
      text = m[1];
      console.log('spinner show', 'value:', m[2], 'max:', m[4]);
    } else {
      console.log('spinner hidden');
    }
    // console.info(text);
  }

  monitorRunDependencies(left) {
    this.totalDependencies = Math.max(this.totalDependencies, left);

    const status = left
      ? `Preparing... (${this.totalDependencies - left}/${this.totalDependencies})`
      : 'All downloads complete.';

    this.setStatus(status);
  }
}

class Mount {
  constructor(module, game, options) {
    this.path = game.path;
    this.executable = game.exe;

    this.module = module;
    this.options = options;
    this.context = `/home/web_user/${this.executable}`;

    if (this.module.calledRun) {
      this.read();
    } else {
      this.module.preRun.push(this.read.bind(this));
    }

    this.module.arguments = ['-conf', './dosbox.conf'];
    if (this.executable) {
      this.module.arguments.push(this.executable);
    } else {
      this.module.arguments.push('/game/');
    }
  }

  read() {
    this.module.addRunDependency(`datafile_/home/web_user/${this.executable}`);

    if (!this.module.preloadResults) this.module.preloadResults = {};
    this.module.preloadResults[this.path] = { fromCache: false };

    let data = {};
    if (this.path) {
      data = app.readZip(this.path);
    }

    if (this.unzip(data, 'game')) {
      this.configure();

      // if using Gravis Ultra Sound
      this.ultrasnd();
      this.utils();

      this.options.success();
    } else {
      this.options.error();
    }

    this.module.removeRunDependency(`datafile_/home/web_user/${this.executable}`);
  }

  configure() {
    const byteArray = app.readFile(`./${app.name}/dosbox.conf`);
    this.fetch('dosbox.conf', byteArray);
  }

  utils() {
    this.module.addRunDependency(`datafile_/home/web_user/game/UTILS`);

    const data = app.readZip('./bin/UTILS.zip');
    this.unzip(data, 'game/UTILS');
    this.module.removeRunDependency(`datafile_/home/web_user/game/UTILS`);
  }

  ultrasnd() {
    if (!app.readConf('gus').gus) return;

    this.module.addRunDependency(`datafile_/home/web_user/game/ULTRASND`);
    const data = app.readZip('./bin/ULTRASND.zip');
    this.unzip(data, 'game/ULTRASND');
    this.module.removeRunDependency(`datafile_/home/web_user/game/ULTRASND`);
  }

  unzip(zip, parent) {
    const paths = {};

    if (parent) {
      this.module.FS_createFolder('/', parent, true, true);
      paths[parent] = {};
    }

    for (let name in zip.files) {
      const file = zip.file(name);
      name = `${parent}/${name}`;
      const stat = app.pathParse(name);

      if (stat.dir && !paths[stat.dir]) {
        paths[stat.dir] = stat;
        const par = stat.dir.split('/');
        const dir = par.pop();
        try {
          this.module.FS_createFolder(`/${par.join('/')}`, dir, true, true);
        } catch (e) {
          return false;
        }
      }

      if (file) {
        this.module.print('extract', name, file.size);
        const byteArray = file.asUint8Array();
        this.fetch(name, byteArray);
      }
    }

    return true;
  }

  fetch(name, byteArray) {
    const isAudio = 0;

    this.module.addRunDependency(`fp ${name}`);
    this.module.FS_createPreloadedFile(name, null, byteArray, true, true, () => {
      this.module.removeRunDependency(`fp ${name}`);
    }, () => {
      if (isAudio) {
        this.module.removeRunDependency(`fp ${name}`);
      } else {
        this.module.printErr(`Fetching file ${name} failed`);
      }
    }, false, true);
  }
}

class UI {
  constructor(options) {
    this.nav = options.$nav;
    this.div = options.$div;

    this.canvas = this.div.find('canvas');
    this.loader = this.div.next('.gamebox-loader');
    this.message = this.loader.find('.gamebox-loader-message');

    this.context = this.canvas[0].getContext('2d');
  }

  showLoader() {
    this.nav.hide();
    this.loader.show();
    this.message.html('');
  }

  updateMessage(message, type) {
    if (type !== undefined) {
      this.updateMessage('&nbsp;');
    }

    this.message
      .append(`<p class="${type || ''}">${message}</p>`)
      .scrollTop(this.message[0].scrollHeight);
  }

  loadError(msg) {
    this.nav.filter('.enter').show();
    this.updateMessage(msg || 'Unknown Error', 'err');
    setTimeout(() => this.hideLoader(), 2000);
  }

  hideLoader() {
    this.loader.hide();
  }

  showNav() {
    this.nav.filter('.enter').show();
    this.context.clearRect(0, 0, this.canvas[0].width, this.canvas[0].height);
  }
}

class Emulator {
  constructor(options) {
    this.exe = options.exe;
    this.path = options.path;

    this.onrun = options.onrun;
    this.onexit = options.onexit;
    this.onerror = options.onerror;

    this.api = {};
    this.paused = false;

    this.ui = new UI(options);
    this.module = new Dosbox({
      canvas: this.ui.canvas[0],
      stat: options.onstat,
      error: options.onerror,
      resize: options.onresize,
      engine: options.engine,
      print: this.ui.updateMessage.bind(this.ui)
    });

    this.ui.showLoader();
    this.downloadScript();
  }

  cmd(cmd, state) {
    try {
      if (!this.api[cmd]) {
        this.api[cmd] = this.module.cwrap(cmd, '', ['number']); // ccall
      }
      this.api[cmd](state);
    } catch (err) {
      console.log('Unable to change ' + cmd, err);
    }
  }

  mount() {
    return new Mount(this.module, {
      exe: this.exe,
      path: this.path
    }, {
      success: () => {
        this.ui.updateMessage(`Launching ${this.exe || 'Prompt'}`, 'info');
        setTimeout(() => {
          if (this.onrun) {
            this.onrun();
          }

          this.ui.hideLoader();
        }, 2000);
      },

      error: () => {
        this.onerror(`Extract Error! Unable to mount.`);
      }
    });
  }

  exit() {
    // TODO noExitRuntime 플래그가 왜 활성화 되는지 확인
    try {
      this.module.noExitRuntime = false;
      this.module.exit(1);
    } catch (err) {
      if (err && err.constructor && err.constructor.name !== 'ExitStatus') {
        console.warn(err, err.stack);
      }
    }
  }

  error(msg) {
    if (this.onerror) {
      this.onerror();
    }

    if (this.onexit) {
      this.onexit();
    }

    this.ui.loadError(msg);
  }

  requestFullScreen() {
    if (this.module.requestFullScreen) {
      return this.module.requestFullScreen(true, false);
    }
  }

  downloadScript() {
    this.module.setStatus('Loading JS-DOSBox');
    this.ui.updateMessage('Loading JS-DOSBox...');

    this.mount();
    this.module = require(`./dosbox.${this.module.__options.engine}`)(this.module);

    this.module.addOnExit && this.module.addOnExit(() => {
      this.ui.showNav();

      if (this.onexit) {
        this.onexit();
      }
    });
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.module.pauseMainLoop();
    } else {
      this.module.resumeMainLoop();
    }
  }
}

module.exports = Emulator;
