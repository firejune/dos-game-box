DOS Games Emulator
==========
DOSGameBox provides javascript API to easily run DOS programs and games in browser. This API allows to run unmodified versions of DOS programs, in other words you can run DOS binary in browser.

### Install dependencies

```
$ npm install
```

### Run app

```
$ npm start
```

### Package app

Builds app binaries for OS X, Linux, and Windows.

```
$ npm run build
```

To build for one platform:

```
$ npm run build -- [platform] [optional arguments...]
```

Where `[platform]` is `darwin`, `linux`, `win32`, or `all` (default).

The following optional arguments are available:

- `--sign` - Sign the application (OS X, Windows)
- `--package=[type]` - Package single output type.
   - `deb` - Debian package
   - `zip` - Linux zip file
   - `dmg` - OS X disk image
   - `exe` - Windows installer
   - `portable` - Windows portable app
   - `all` - All platforms (default)

- `--arch=[type]` - CPU type.
   - `x64` - x64 architecture
   - `x86` - x86 architecture
   - `all` - All CPU architecture (default)

Note: Even with the `--package` option, the auto-update files (.nupkg for Windows, *-darwin.zip for OS X) will always be produced.

#### Windows build notes

To package the Windows app from non-Windows platforms, [Wine](https://www.winehq.org/) needs
to be installed.

On OS X, first install [XQuartz](http://www.xquartz.org/), then run:

```
brew install wine
brew install mono
```

(Requires the [Homebrew](http://brew.sh/) package manager.)

## Powered by
- [DOSBox](https://www.dosbox.com/) is an open source DOS emulator designed for running old games.
- [em-dosbox](https://github.com/dreamlayers/em-dosbox) is a version of DOSBox which can be compiled with Emscripten to run in a web browser. It allows running old DOS games and other DOS programs in a web browser.
- [Emscripten](https://github.com/kripken/emscripten) is a C/C++ compiler to javascript

### See Also...
---
- [Boxer](http://boxerapp.com/) - The DOS game emulator that’s fit for your Mac.
- [AnyToISO](http://www.crystalidea.com/anytoiso) - Open/Extract/Convert to ISO, Extract ISO, Make ISO
- [Best Old Games](http://www.bestoldgames.net/eng/) - a site that offers the old games for free download. 
- [DOPEROMS - DOS](http://doperoms.com/roms/Dos.html) - The ROM Archive
- [v86](http://copy.sh/v86/) - x86 virtualization in JavaScript, running in your browser and NodeJS
