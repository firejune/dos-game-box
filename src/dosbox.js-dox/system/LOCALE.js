'use strict';

const LOCALE = {
  curr: 0,
  check: locale => {
    if (locale) locale = Module.Pointer_stringify(locale);
    return locale === 'C' || locale === 'POSIX' || !locale;
  }
};

module.exports = LOCALE;
