// api/eva.js -> proxy to alfred.js
const mod = require('./alfred.js');
const handler = mod.default || mod;
module.exports = (req, res) => handler(req, res);
if (mod.config) module.exports.config = mod.config;
