import globals from 'globals';

export default [
  { ignores: ['public/precache-manifest.js', 'test-results/**', 'playwright-report/**'] },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker }
  },
  {
    files: ['scripts/**/*.mjs', 'functions/command-parser.mjs', 'test/**/*.js', 'playwright.config.js'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    files: ['functions/index.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node }
  },
  { rules: { 'no-undef': 'error' } }
];
