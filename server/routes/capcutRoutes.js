const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const root = path.resolve(__dirname, '../..');
const python = path.join(root, '.venv-capcut', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
let busy = false;

function execute(req, res, action) {
  if (!fs.existsSync(python)) return res.status(503).json({ error: 'Run npm run setup:capcut first' });
  if (busy) return res.status(429).json({ error: 'CapCut đang xử lý một yêu cầu khác. Hãy chờ rồi thử lại.' });
  const { text, voice } = req.body || {};
  const verifyRequest = action === 'verify';
  const invalidText = typeof text !== 'string' || !text.trim() || text.length > (verifyRequest ? 500 : 5000);
  if (action === 'synthesize' && (invalidText || typeof voice !== 'string')) {
    return res.status(400).json({ error: 'Văn bản hoặc giọng CapCut không hợp lệ' });
  }
  if (verifyRequest && (typeof voice !== 'string' || (typeof text === 'string' && text.length > 500))) {
    return res.status(400).json({ error: 'Giọng hoặc nội dung kiểm tra CapCut không hợp lệ' });
  }
  busy = true;
  const child = spawn(python, [path.join(root, 'server/tts_service/capcut_worker.py')], {
    cwd: root, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let output = '';
  let stderr = '';
  let finished = false;
  const cleanup = () => { clearTimeout(timer); busy = false; finished = true; };
  const timer = setTimeout(() => {
    child.kill();
    if (!res.destroyed) res.status(504).json({ error: 'CapCut quá thời gian xử lý. Có thể thử lại.' });
  }, 240000);
  res.on('close', () => { if (!finished) child.kill(); });
  child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 2000000) child.kill(); });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
    if (stderr.length > 12000) stderr = stderr.slice(-12000);
  });
  child.stdin.on('error', () => {});
  child.on('error', () => {
    cleanup();
    if (!res.destroyed && !res.headersSent) res.status(503).json({ error: 'CapCut worker failed to start' });
  });
  child.on('close', code => {
    cleanup();
    if (res.destroyed || res.headersSent) return;
    if (stderr.trim()) console.warn(`[capcut] worker stderr:\n${stderr.trim()}`);
    try {
      const result = JSON.parse(output.trim());
      const status = code === 0 ? 200 : result.code === '40402004' ? 422 : 502;
      res.status(status).json(result);
    } catch {
      res.status(502).json({ error: 'CapCut worker returned an invalid result' });
    }
  });
  child.stdin.end(JSON.stringify({
    action,
    text,
    voice,
    include_unverified: String(req.query?.includeUnverified || '') === 'true',
  }));
}

router.get('/voices', (req, res) => execute(req, res, 'voices'));
router.post('/synthesize', express.json({ limit: '32kb' }), (req, res) => execute(req, res, 'synthesize'));
router.post('/verify', express.json({ limit: '8kb' }), (req, res) => execute(req, res, 'verify'));
module.exports = router;
