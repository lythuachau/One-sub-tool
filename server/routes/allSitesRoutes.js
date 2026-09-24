/**
 * API routes for generic video URL operations using yt-dlp
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { VIDEOS_DIR } = require('../config');
const { downloadVideoWithRetry } = require('../services/allSites/downloader');
const { getDownloadProgress } = require('../services/shared/progressTracker');
const {
  isVideoSourceMatch,
  writeVideoSourceMetadata,
  quarantineStaleVideoArtifact
} = require('../services/shared/videoSourceMetadata');

/**
 * POST /api/download-generic-video - Download a video from any supported site
 */
router.post('/download-generic-video', async (req, res) => {
  const { videoId, url, quality = '360p', useCookies = false } = req.body;



  if (!videoId || !url) {
    return res.status(400).json({ error: 'Video ID and URL are required' });
  }

  const videoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

  // A cache hit is valid only when its sidecar proves the same source URL.
  if (fs.existsSync(videoPath) && await isVideoSourceMatch(videoPath, { videoId, sourceUrl: url })) {
    return res.json({
      success: true,
      message: 'Video already downloaded',
      url: `/videos/${videoId}.mp4`
    });
  }

  if (fs.existsSync(videoPath)) {
    await quarantineStaleVideoArtifact(videoPath, 'source-mismatch');
  }

  try {
    // Download the video using yt-dlp with retry and fallback
    const result = await downloadVideoWithRetry(videoId, url, quality, useCookies);

    // Check if the file was created successfully
    if (fs.existsSync(videoPath)) {
      await writeVideoSourceMetadata({
        videoPath,
        videoId,
        sourceUrl: url,
        method: result.method || 'generic'
      });

      return res.json({
        success: true,
        message: result.message || 'Video downloaded successfully',
        url: `/videos/${videoId}.mp4`,
        method: result.method
      });
    } else {
      throw new Error('Download completed but video file was not found');
    }
  } catch (error) {
    console.error('Error downloading video:', error);

    // Clean up any partial file
    try {
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
      const tempPath = path.join(VIDEOS_DIR, `${videoId}.temp.mp4`);
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (e) {
      console.error('Error cleaning up incomplete file:', e);
    }

    return res.status(500).json({
      error: 'Failed to download video',
      details: error.message
    });
  }
});

/**
 * GET /api/generic-download-progress/:videoId - Get download progress for a generic video
 */
router.get('/generic-download-progress/:videoId', (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }

  try {
    const progress = getDownloadProgress(videoId);
    res.json({
      success: true,
      videoId: videoId,
      progress: progress.progress,
      status: progress.status,
      timestamp: progress.timestamp
    });
  } catch (error) {
    console.error('Error getting generic download progress:', error);
    res.status(500).json({
      error: 'Failed to get download progress',
      details: error.message
    });
  }
});

/**
 * POST /api/cancel-generic-download/:videoId - Cancel an ongoing generic video download
 */
router.post('/cancel-generic-download/:videoId', (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }



  // Currently, we don't have a way to cancel an ongoing yt-dlp process
  // But we can return success to let the client know we received the request
  return res.json({
    success: true,
    message: 'Cancel request received'
  });
});

module.exports = router;
