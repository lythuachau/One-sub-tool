const path = require('path');
const { PORTS } = require('../config');
const catalog = require('./asrCatalog');

const projectRoot = path.resolve(__dirname, '..', '..');

const ENGINES = [
  {
    id: 'parakeet',
    label: 'NVIDIA Parakeet',
    port: PORTS.PARAKEET,
    entryFile: path.join(projectRoot, 'parakeet_wrapper', 'app.py'),
    health: { path: '/health', isReady: (status) => status === 200 },
  },
  ...catalog.engineDefs(),
];

module.exports = { ENGINES };
