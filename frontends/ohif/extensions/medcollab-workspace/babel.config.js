// This extension's Jest run loads this file (Babel resolves `babel.config.js`
// relative to the extension workspace, and babel-jest points `root` here).
// Extend the repo config, but drop the explicitly-forced
// `@babel/plugin-transform-regenerator` from its `test` env:
//
// - Jest transforms for the running Node version (see the `preset-env` targets
//   in the root `env.test`), so async functions need no regenerator down-leveling.
// - Babel 7.29.7's regenerator plugin crashes on an optional catch binding
//   (`catch {}`) inside an async function: its emitter reads `handler.param.name`
//   without a null check. `prepareToLeave`, `scheduleLease` and `dispose` use
//   that syntax, so the whole adapter suite failed to transform. Removing the
//   redundant plugin keeps every other test-env preset/plugin as-is without
//   touching the shared root Babel config.
const root = require('../../babel.config.js');

const isRegenerator = plugin =>
  (Array.isArray(plugin) ? plugin[0] : plugin) === '@babel/plugin-transform-regenerator';

module.exports = {
  ...root,
  env: {
    ...root.env,
    test: {
      ...root.env.test,
      plugins: (root.env.test.plugins || []).filter(plugin => !isRegenerator(plugin)),
    },
  },
};
