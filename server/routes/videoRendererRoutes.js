const express = require('express');
const {
  ensureRenderer,
  getRendererStatus,
  stopRenderer,
  rendererUrl
} = require('../services/videoRendererManager');

const router = express.Router();

router.get('/health', async (req, res) => {
  const status = await getRendererStatus();
  res.status(status.running ? 200 : 503).json(status);
});

router.post('/ensure', async (req, res) => {
  try {
    const status = await ensureRenderer();
    res.json({ success: true, rendererUrl, ...status });
  } catch (error) {
    console.error('[VIDEO-RENDERER] Startup failed:', error.message);
    const status = await getRendererStatus();
    res.status(503).json({
      success: false,
      code: 'VIDEO_RENDERER_UNAVAILABLE',
      error: error.message,
      ...status
    });
  }
});

router.post('/stop', async (req, res) => {
  await stopRenderer();
  res.json({ success: true });
});

module.exports = router;
