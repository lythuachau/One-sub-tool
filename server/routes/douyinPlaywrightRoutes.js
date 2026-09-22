/**
 * API routes for Playwright-based Douyin downloading
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { VIDEOS_DIR } = require('../config');
const { downloadDouyinVideo, getAvailableQualities } = require('../services/douyin/playwrightDownloader');
const {
  downloadDouyinVideoYtDlp,
  downloadDouyinVideoFallback,
  downloadDouyinVideoShortUrlFallback,
  downloadDouyinVideoSimpleFallback
} = require('../services/douyin/downloader');
const { downloadDouyinNative } = require('../services/douyin/nativeDownloader');
const { getDownloadProgress } = require('../services/shared/progressTracker');

// Track active downloads to prevent duplicates
const activeDownloads = new Map();

// Track completed downloads with their actual filenames
const completedDownloads = new Map();
const failedDownloads = new Map();

const toPublicPath = filename => `/videos/${encodeURIComponent(filename)}`;

const summarizeError = error => String(error?.message || error || 'Unknown error')
  .replace(/\s+/g, ' ')
  .slice(0, 600);

async function tryNonBrowserDownload(videoId, url, quality, useCookies) {
  const failures = [];

  try {
    const result = await downloadDouyinNative(url, videoId);
    return {
      ...result,
      filename: result.filename || path.basename(result.path),
      publicPath: toPublicPath(result.filename || path.basename(result.path)),
      failures
    };
  } catch (error) {
    const detail = summarizeError(error);
    failures.push({ method: 'douyin-native', error: detail });
    console.warn(`[DOUYIN] Native resolver failed for ${videoId}: ${detail}`);
  }

  const ytDlpStrategies = [
    ['yt-dlp', () => downloadDouyinVideoYtDlp(videoId, url, quality, useCookies)],
    ['yt-dlp-fallback', () => downloadDouyinVideoFallback(videoId, url, quality, useCookies)],
    ...(url.includes('v.douyin.com')
      ? [['yt-dlp-short-url', () => downloadDouyinVideoShortUrlFallback(videoId, url, quality, useCookies)]]
      : []),
    ['yt-dlp-basic', () => downloadDouyinVideoSimpleFallback(videoId, url, quality, useCookies)]
  ];

  for (const [method, download] of ytDlpStrategies) {
    try {
      const result = await download();
      const filename = path.basename(result.path);
      const stats = await fs.promises.stat(result.path);
      if (stats.size < 100 * 1024) throw new Error(`Downloaded file is too small (${stats.size} bytes)`);
      return {
        ...result,
        method,
        filename,
        publicPath: toPublicPath(filename),
        failures
      };
    } catch (error) {
      const detail = summarizeError(error);
      failures.push({ method, error: detail });
      console.warn(`[DOUYIN] ${method} failed for ${videoId}: ${detail}`);
    }
  }

  return { failures };
}

/**
 * POST /api/download-douyin-playwright - Download Douyin video using Playwright
 */
router.post('/download-douyin-playwright', async (req, res) => {
  const { videoId, url, quality = '720p', forceRefresh = false, useCookies = false } = req.body;

  if (!videoId || !url) {
    return res.status(400).json({
      success: false,
      error: 'Video ID and URL are required'
    });
  }

  try {
    console.log(`[DOUYIN-PLAYWRIGHT] Processing download: ${videoId} - ${url}`);

    // Check if download is already in progress
    if (activeDownloads.has(videoId) && !forceRefresh) {
      console.log(`[DOUYIN-PLAYWRIGHT] Download already in progress for: ${videoId}`);
      return res.json({
        success: true,
        message: 'Download already in progress',
        videoId,
        inProgress: true
      });
    }

    failedDownloads.delete(videoId);

    // Check if file already exists and is not a force refresh
    // Look for files that start with the videoId (since actual filename includes title)
    let existingFile = null;
    if (fs.existsSync(VIDEOS_DIR)) {
      const files = fs.readdirSync(VIDEOS_DIR);
      existingFile = files.find(file =>
        (file === `${videoId}.mp4` || file.startsWith(`${videoId}_`)) && file.endsWith('.mp4')
      );
    }

    if (existingFile && !forceRefresh) {
      console.log(`[DOUYIN-PLAYWRIGHT] File already exists: ${existingFile}`);
      const existingPath = path.join(VIDEOS_DIR, existingFile);
      return res.json({
        success: true,
        message: 'Video already downloaded',
        videoId,
        filename: existingFile,
        path: toPublicPath(existingFile),
        alreadyExists: true,
        completed: true,
        method: 'cached'
      });
    }

    // Resolve ordinary Douyin links without starting a browser. Playwright is
    // kept as the final fallback for links requiring JavaScript or cookies.
    const localResult = await tryNonBrowserDownload(videoId, url, quality, useCookies);
    if (localResult.path) {
      return res.json({
        success: true,
        message: 'Video downloaded without a browser',
        videoId,
        filename: localResult.filename,
        path: localResult.publicPath,
        completed: true,
        method: localResult.method,
        fallbackAttempts: localResult.failures
      });
    }

    // Mark download as active
    activeDownloads.set(videoId, {
      url,
      quality,
      startTime: Date.now(),
      useCookies,
      fallbackAttempts: localResult.failures
    });

    // Start the download process
    console.log(`[DOUYIN-PLAYWRIGHT] Starting Playwright download for: ${videoId}`);

    // Return immediately to client for polling
    res.json({
      success: true,
      message: 'Download started',
      videoId,
      inProgress: true
    });

    // Start download in background
    (async () => {
      try {
        // Perform the actual download
        const downloadedPath = await downloadDouyinVideo(url, videoId, quality, useCookies);

        // Get the filename from the downloaded path
        const filename = path.basename(downloadedPath);

        console.log(`[DOUYIN-PLAYWRIGHT] Download completed: ${filename}`);

        // Store completed download info for progress polling
        completedDownloads.set(videoId, {
          filename,
          path: downloadedPath,
          url: toPublicPath(filename),
          completedAt: Date.now()
        });
        failedDownloads.delete(videoId);

        // Clean up active downloads tracking
        activeDownloads.delete(videoId);

      } catch (downloadError) {
        console.error(`[DOUYIN-PLAYWRIGHT] Download failed for ${videoId}:`, downloadError);

        // Clean up tracking
        const downloadState = activeDownloads.get(videoId);
        activeDownloads.delete(videoId);
        completedDownloads.delete(videoId);
        const attempts = [
          ...(downloadState?.fallbackAttempts || []),
          { method: 'playwright', error: summarizeError(downloadError) }
        ];
        failedDownloads.set(videoId, {
          error: `Douyin download failed: ${attempts.map(item => `${item.method}: ${item.error}`).join(' | ')}`.slice(0, 2400),
          attempts
        });
      }
    })(); // End of async IIFE

  } catch (error) {
    // Clean up active downloads tracking
    activeDownloads.delete(videoId);
    
    console.error('[DOUYIN-PLAYWRIGHT] Error processing download:', error);
    
    // Only send error response if we haven't already responded
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to download video'
      });
    }
  }
});

/**
 * GET /api/douyin-playwright-download/:filename - Download completed Douyin video file
 */
router.get('/douyin-playwright-download/:filename', (req, res) => {
  const { filename } = req.params;

  if (!filename) {
    return res.status(400).json({
      success: false,
      error: 'Filename is required'
    });
  }

  try {
    const filePath = path.join(VIDEOS_DIR, filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Set headers to force download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('[DOUYIN-PLAYWRIGHT] Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Error streaming file'
        });
      }
    });

  } catch (error) {
    console.error('[DOUYIN-PLAYWRIGHT] Download error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/douyin-playwright-progress/:videoId - Get download progress
 */
router.get('/douyin-playwright-progress/:videoId', (req, res) => {
  const { videoId } = req.params;
  
  try {
    const progressInfo = getDownloadProgress(videoId);
    const isActive = activeDownloads.has(videoId);
    const completedInfo = completedDownloads.get(videoId);
    const failedInfo = failedDownloads.get(videoId);

    // Extract progress percentage from progress info object
    const progressPercentage = progressInfo?.progress || 0;

    // Check if download is completed
    const isCompleted = !!completedInfo && !isActive;

    // If completed, verify file still exists
    let fileExists = false;
    if (completedInfo) {
      const fullPath = path.join(VIDEOS_DIR, completedInfo.filename);
      fileExists = fs.existsSync(fullPath);
    }

    res.json({
      success: true,
      videoId,
      progress: progressPercentage,
      isActive,
      completed: isCompleted && fileExists,
      filename: completedInfo?.filename || null,
      path: (isCompleted && fileExists) ? completedInfo.url : null,
      error: failedInfo?.error || null,
      fallbackAttempts: failedInfo?.attempts || []
    });
    
  } catch (error) {
    console.error('[DOUYIN-PLAYWRIGHT] Error getting progress:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get download progress'
    });
  }
});

/**
 * POST /api/scan-douyin-playwright-qualities - Scan available qualities using Playwright
 */
router.post('/scan-douyin-playwright-qualities', async (req, res) => {
  const { url, useCookies = false } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }

  try {
    console.log(`[DOUYIN-PLAYWRIGHT] Scanning qualities for: ${url}`);
    
    const qualities = await getAvailableQualities(url, useCookies);
    
    res.json({
      success: true,
      qualities,
      message: `Found ${qualities.length} available qualities`
    });
    
  } catch (error) {
    console.error('[DOUYIN-PLAYWRIGHT] Error scanning qualities:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to scan video qualities'
    });
  }
});

/**
 * GET /api/douyin-playwright-status - Get service status
 */
router.get('/douyin-playwright-status', (req, res) => {
  res.json({
    success: true,
    service: 'Douyin Playwright Downloader',
    activeDownloads: activeDownloads.size,
    activeVideoIds: Array.from(activeDownloads.keys())
  });
});

/**
 * DELETE /api/douyin-playwright-cancel/:videoId - Cancel active download
 */
router.delete('/douyin-playwright-cancel/:videoId', (req, res) => {
  const { videoId } = req.params;
  
  try {
    if (activeDownloads.has(videoId)) {
      activeDownloads.delete(videoId);
      console.log(`[DOUYIN-PLAYWRIGHT] Cancelled download: ${videoId}`);
      
      res.json({
        success: true,
        message: `Download cancelled for ${videoId}`
      });
    } else {
      res.status(404).json({
        success: false,
        error: `No active download found for ${videoId}`
      });
    }
    
  } catch (error) {
    console.error('[DOUYIN-PLAYWRIGHT] Error cancelling download:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel download'
    });
  }
});

module.exports = router;
