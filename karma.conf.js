// Karma configuration for Angular tests + coverage gates on critical paths.
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      jasmine: {},
      clearContext: false,
    },
    jasmineHtmlReporter: { suppressAll: true },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/udonarium'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }, { type: 'lcovonly' }],
      check: {
        global: {
          // Soft global floor — most specs are smoke "should create".
          statements: 5,
          lines: 5,
          branches: 0,
          functions: 5,
        },
        each: {
          // Critical regression paths must stay reasonably covered when edited.
          overrides: {
            '**/clue-link.ts': {
              statements: 50,
              lines: 50,
              functions: 40,
              branches: 30,
            },
            '**/push-pin.util.ts': {
              statements: 40,
              lines: 40,
              functions: 30,
              branches: 20,
            },
            '**/folder-backup-layout.ts': {
              statements: 40,
              lines: 40,
              functions: 30,
              branches: 20,
            },
            '**/save-xml-remap.util.ts': {
              statements: 40,
              lines: 40,
              functions: 30,
              branches: 20,
            },
            '**/mask-appearance.ts': {
              statements: 30,
              lines: 30,
              functions: 30,
              branches: 20,
            },
          },
          // Exclude Angular components / huge services from per-file gates.
          excludes: [
            '**/node_modules/**',
            '**/*.spec.ts',
            '**/testing/**',
            '**/component/**',
            '**/directive/**',
            '**/pipe/**',
          ],
        },
      },
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['Chrome'],
    customLaunchers: {
      ChromeHeadlessCI: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu'],
      },
    },
    restartOnFileChange: true,
  });
};
