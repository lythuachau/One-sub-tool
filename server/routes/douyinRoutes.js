/**
 * API routes for Douyin video operations
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { VIDEOS_DIR } = require('../config');
const { downloadDouyinVideoWithRetry } = require('../services/douyin');
const { downloadDouyinWithEvilApi } = require('../services/douyin/evilApiDownloader');
const { resolveDouyinTarget } = require('../services/douyin/nativeDownloader');
const { getDownloadProgress } = require('../services/shared/progressTracker');
const {
  isVideoSourceMatch,
  writeVideoSourceMetadata,
  quarantineStaleVideoArtifact
} = require('../services/shared/videoSourceMetadata');

/**
 * POST /api/download-douyin-video - Download a Douyin video
 */
router.post('/download-douyin-video', async (req, res) => {
  const { videoId, url, quality = '360p', useCookies = false } = req.body;



  if (!videoId || !url) {
    return res.status(400).json({ error: 'Video ID and URL are required' });
  }

  const requestedVideoId = String(videoId);
  let canonicalVideoId = requestedVideoId;
  let videoPath = path.join(VIDEOS_DIR, `${canonicalVideoId}.mp4`);

  try {
    const target = await resolveDouyinTarget(url);
    canonicalVideoId = String(target.videoId);
    videoPath = path.join(VIDEOS_DIR, `${canonicalVideoId}.mp4`);

    // A cache hit is valid only when its sidecar proves the same source URL.
    if (fs.existsSync(videoPath) && await isVideoSourceMatch(videoPath, {
      videoId: canonicalVideoId,
      sourceUrl: url
    })) {
      return res.json({
        success: true,
        message: 'Video already downloaded',
        videoId: canonicalVideoId,
        requestedVideoId,
        url: `/videos/${canonicalVideoId}.mp4`
      });
    }

    if (fs.existsSync(videoPath)) {
      await quarantineStaleVideoArtifact(videoPath, 'source-mismatch');
    }

    try {
      const evilResult = await downloadDouyinWithEvilApi(target.resolvedUrl, canonicalVideoId);
      if (fs.existsSync(evilResult.path)) {
        if (evilResult.path !== videoPath) {
          await fs.promises.rm(videoPath, { force: true });
          await fs.promises.rename(evilResult.path, videoPath);
          evilResult.path = videoPath;
          evilResult.filename = `${canonicalVideoId}.mp4`;
        }
        await writeVideoSourceMetadata({
          videoPath: evilResult.path,
          videoId: canonicalVideoId,
          sourceUrl: url,
          method: evilResult.method,
          resolvedVideoId: evilResult.resolvedVideoId,
          resolvedSourceUrl: evilResult.resolvedSourceUrl,
          title: evilResult.title
        });
        return res.json({
          success: true,
          message: 'Video downloaded successfully with Douyin_TikTok_Download_API',
          videoId: canonicalVideoId,
          requestedVideoId,
          url: `/videos/${encodeURIComponent(evilResult.filename)}`,
          method: evilResult.method,
          resolvedVideoId: evilResult.resolvedVideoId,
          resolvedSourceUrl: evilResult.resolvedSourceUrl
        });
      }
    } catch (evilError) {
      console.warn(`[DOUYIN] Douyin_TikTok_Download_API failed for ${canonicalVideoId}: ${evilError.message}`);
    }

    // Download the video using yt-dlp with retry and fallback
    const result = await downloadDouyinVideoWithRetry(canonicalVideoId, target.resolvedUrl, quality, useCookies);

    // Check if the file was created successfully
    if (fs.existsSync(videoPath)) {
      await writeVideoSourceMetadata({
        videoPath,
        videoId: canonicalVideoId,
        sourceUrl: url,
        resolvedSourceUrl: target.resolvedUrl,
        resolvedVideoId: canonicalVideoId,
        method: result.method || 'douyin'
      });

      return res.json({
        success: true,
        message: result.message || 'Video downloaded successfully',
        videoId: canonicalVideoId,
        requestedVideoId,
        url: `/videos/${canonicalVideoId}.mp4`,
        method: result.method
      });
    } else {
      throw new Error('Download completed but video file was not found');
    }
  } catch (error) {
    console.error('Error downloading Douyin video:', error);

    // Clean up any partial file
    try {
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    } catch (e) {
      console.error('Error cleaning up incomplete file:', e);
    }

    // Provide a more user-friendly error message
    let errorMessage = 'Failed to download Douyin video';
    let details = error.message;

    if (error.message.includes('region-restricted')) {
      // This is already a formatted message from our TikTokDien approach
      errorMessage = 'This Douyin video is region-restricted';
      details = 'Douyin videos are only accessible from within China. You need to use a VPN with a Chinese server to access Douyin content.';
    } else if (error.message.includes('HTTP Error') || error.message.includes('Expecting value') || error.message.includes('Could not get direct video URL')) {
      errorMessage = 'Douyin API access restricted';
      details = 'Douyin restricts API access from outside China. You need to use a VPN with a Chinese server to download Douyin videos.';
    } else if (error.message.includes('private')) {
      errorMessage = 'This Douyin video is private';
      details = 'The video is not publicly accessible.';
    } else if (error.message.includes('deleted')) {
      errorMessage = 'This Douyin video has been deleted';
      details = 'The video is no longer available on Douyin.';
    } else if (error.message.includes('invalid') || error.message.includes('Invalid URL format')) {
      errorMessage = 'Invalid Douyin URL';
      details = 'Please check the URL and try again.';
    } else if (error.message.includes('TikTokDien extractor failed')) {
      errorMessage = 'TikTokDien extractor failed';
      details = 'The TikTokDien approach failed to download the video. This is likely due to regional restrictions.';
    }

    return res.status(500).json({
      error: errorMessage,
      details: details
    });
  }
});

/**
 * GET /api/douyin-download-progress/:videoId - Get download progress for a Douyin video
 */
router.get('/douyin-download-progress/:videoId', (req, res) => {
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
    console.error('Error getting Douyin download progress:', error);
    res.status(500).json({
      error: 'Failed to get download progress',
      details: error.message
    });
  }
});

/**
 * POST /api/cancel-douyin-download/:videoId - Cancel an ongoing Douyin download
 */
router.post('/cancel-douyin-download/:videoId', (req, res) => {
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

/**
 * GET /api/douyin-video-exists/:videoId - Check if a Douyin video exists
 */
router.get('/douyin-video-exists/:videoId', (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }

  const videoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

  // Check if video exists
  if (fs.existsSync(videoPath)) {
    return res.json({
      exists: true,
      url: `/videos/${videoId}.mp4`
    });
  } else {
    return res.json({
      exists: false
    });
  }
});

module.exports = router;
