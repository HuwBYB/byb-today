// api/eva.js
const mod = require('./alfred.js');              // load Alfred handler
const handler = mod.default || mod;              // support CJS or ESM builds

module.exports = (req, res) => handler(req, res);

// If alfred.js exports a config (e.g. { runtime: 'edge' }), forward it too:
if (mod.config) module.exports.config = mod.config;
