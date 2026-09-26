const http = require('http');
const fs = require('fs');
const path = require('path');
const { trackProcess } = require('../server/utils/portManager');
const { PORTS } = require('../server/config');
const { markStartupPhase } = require('../server/utils/startupMetrics');

const buildDirectory = path.join(__dirname, '..', 'build');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

if (!fs.existsSync(path.join(buildDirectory, 'index.html'))) {
  console.error('❌ Production frontend build is missing. Run npm run build first.');
  process.exit(1);
}

const server = http.createServer((request, response) => {
  const requestedPath = decodeURIComponent((request.url || '/').split('?')[0]);
  const candidate = path.resolve(buildDirectory, `.${requestedPath}`);
  const safePath = candidate.startsWith(path.resolve(buildDirectory)) ? candidate : path.join(buildDirectory, 'index.html');
  const filePath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
    ? safePath
    : path.join(buildDirectory, 'index.html');

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Frontend asset could not be loaded');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    });
    response.end(data);
  });
});

server.listen(PORTS.FRONTEND, '0.0.0.0', () => {
  trackProcess(PORTS.FRONTEND, process.pid, 'React Production Frontend');
  markStartupPhase('frontend_ready', { mode: 'production', port: PORTS.FRONTEND });
  console.log(`🌐 Production frontend running on port ${PORTS.FRONTEND}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
