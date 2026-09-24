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
  validateVideoArtifact,
  quarantineInvalidArtifact
} = require('../services/douyin/videoArtifactValidator');
const {
  downloadDouyinVideoYtDlp,
  downloadDouyinVideoFallback,
  downloadDouyinVideoShortUrlFallback,
  downloadDouyinVideoSimpleFallback
} = require('../services/douyin/downloader');
const { downloadDouyinNative, resolveDouyinTarget } = require('../services/douyin/nativeDownloader');
const { downloadDouyinWithEvilApi } = require('../services/douyin/evilApiDownloader');
const { getDownloadProgress } = require('../services/shared/progressTracker');
const {
  normalizeSourceUrl,
  isVideoSourceMatch,
  writeVideoSourceMetadata,
  quarantineStaleVideoArtifact
} = require('../services/shared/videoSourceMetadata');

// Track active downloads to prevent duplicates
const activeDownloads = new Map();

// Track completed downloads with their actual filenames
const completedDownloads = new Map();
const failedDownloads = new Map();
const videoIdAliases = new Map();

const canonicalVideoIdFor = videoId => videoIdAliases.get(String(videoId)) || String(videoId);

const toPublicPath = filename => `/videos/${encodeURIComponent(filename)}`;

const summarizeError = error => String(error?.message || error || 'Unknown error')
  .replace(/\s+/g, ' ')
  .slice(0, 600);

const isAccessFailure = error => /403|forbidden|private|deleted|fresh cookies|unavailable|region-restricted/i.test(error);

async function verifyDownloadedArtifact(filePath, method) {
  const validation = await validateVideoArtifact(filePath);
  if (validation.valid) return validation;

  await quarantineInvalidArtifact(filePath, validation.reason);
  throw new Error(`${method} produced an invalid video: ${validation.reason}`);
}

async function quarantineAttemptFiles(videoId) {
  const candidates = [
    path.join(VIDEOS_DIR, `${videoId}.mp4`),
    path.join(VIDEOS_DIR, `${videoId}.mp4.part`),
    path.join(VIDEOS_DIR, `${videoId}.webm`),
    path.join(VIDEOS_DIR, `${videoId}.mkv`)
  ];
  await Promise.all(candidates.map(async file => {
    const validation = await validateVideoArtifact(file);
    if (!validation.valid) await quarantineInvalidArtifact(file, validation.reason || 'failed-download');
  }));
}

async function tryNonBrowserDownload(videoId, url, quality, useCookies) {
  const failures = [];

  try {
    const result = await downloadDouyinWithEvilApi(url, videoId, quality);
    await verifyDownloadedArtifact(result.path, 'douyin-tiktok-download-api');
    return {
      ...result,
      filename: result.filename || path.basename(result.path),
      publicPath: toPublicPath(result.filename || path.basename(result.path)),
      failures
    };
  } catch (error) {
    await quarantineAttemptFiles(videoId);
    const detail = summarizeError(error);
    failures.push({ method: 'douyin-tiktok-download-api', error: detail });
    console.warn(`[DOUYIN] Evil API resolver failed for ${videoId}: ${detail}`);
  }

  try {
    const result = await downloadDouyinNative(url, videoId);
    await verifyDownloadedArtifact(result.path, 'douyin-native');
    return {
      ...result,
      filename: result.filename || path.basename(result.path),
      publicPath: toPublicPath(result.filename || path.basename(result.path)),
      failures
    };
  } catch (error) {
    await quarantineAttemptFiles(videoId);
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
      await verifyDownloadedArtifact(result.path, method);
      return {
        ...result,
        method,
        filename,
        publicPath: toPublicPath(filename),
        failures
      };
    } catch (error) {
      await quarantineAttemptFiles(videoId);
      const detail = summarizeError(error);
      failures.push({ method, error: detail });
      console.warn(`[DOUYIN] ${method} failed for ${videoId}: ${detail}`);
      if (isAccessFailure(detail)) break;
    }
  }

  return { failures };
}

/**
 * POST /api/download-douyin-playwright - Download Douyin video using Playwright
 */
router.post('/download-douyin-playwright', async (req, res) => {
  const {
    videoId,
    url,
    quality = '720p',
    forceRefresh = false,
    useCookies = false,
    interactiveVerification = true
  } = req.body;

  if (!videoId || !url) {
    return res.status(400).json({
      success: false,
      error: 'Video ID and URL are required'
    });
  }

  const requestedVideoId = String(videoId);

  try {
    const target = await resolveDouyinTarget(url);
    const canonicalVideoId = String(target.videoId);
    videoIdAliases.set(requestedVideoId, canonicalVideoId);
    console.log(`[DOUYIN-PLAYWRIGHT] Processing download: ${requestedVideoId} -> ${canonicalVideoId} - ${url}`);

    // Check if download is already in progress
    if (activeDownloads.has(canonicalVideoId) && !forceRefresh) {
      const activeDownload = activeDownloads.get(canonicalVideoId);
      if (normalizeSourceUrl(activeDownload.url) !== normalizeSourceUrl(url)) {
        return res.status(409).json({
          success: false,
          error: 'A different source URL is already downloading for this video ID'
        });
      }
      console.log(`[DOUYIN-PLAYWRIGHT] Download already in progress for: ${canonicalVideoId}`);
      return res.json({
        success: true,
        message: 'Download already in progress',
        videoId: canonicalVideoId,
        requestedVideoId,
        inProgress: true
      });
    }

    failedDownloads.delete(canonicalVideoId);

    // Check if file already exists and is not a force refresh. A filename or
    // videoId alone is not enough to identify a valid cache entry.
    // Look for files that start with the videoId (since actual filename includes title)
    let existingFile = null;
    if (fs.existsSync(VIDEOS_DIR)) {
      const files = fs.readdirSync(VIDEOS_DIR).filter(file =>
        (file === `${canonicalVideoId}.mp4` || file.startsWith(`${canonicalVideoId}_`)) && file.endsWith('.mp4')
      );
      for (const file of files) {
        const candidatePath = path.join(VIDEOS_DIR, file);
        const validation = await validateVideoArtifact(candidatePath);
        if (!validation.valid) {
          await quarantineInvalidArtifact(candidatePath, validation.reason);
          continue;
        }

        const matchesSource = await isVideoSourceMatch(candidatePath, {
          videoId: canonicalVideoId,
          sourceUrl: url
        });
        if (matchesSource && !forceRefresh) {
          existingFile = file;
          break;
        }

        await quarantineStaleVideoArtifact(candidatePath, forceRefresh ? 'force-refresh' : 'source-mismatch');
      }
    }

    if (existingFile && !forceRefresh) {
      console.log(`[DOUYIN-PLAYWRIGHT] File already exists: ${existingFile}`);
      const existingPath = path.join(VIDEOS_DIR, existingFile);
      return res.json({
        success: true,
        message: 'Video already downloaded',
        videoId: canonicalVideoId,
        requestedVideoId,
        filename: existingFile,
        path: toPublicPath(existingFile),
        alreadyExists: true,
        completed: true,
        method: 'cached'
      });
    }

    console.log('[DOUYIN-PLAYWRIGHT] Verified source identity:', {
      requestedVideoId,
      resolvedVideoId: canonicalVideoId,
      requestedUrl: url,
      resolvedUrl: target.resolvedUrl
    });

    const localResult = await tryNonBrowserDownload(canonicalVideoId, target.resolvedUrl, quality, useCookies);
    localResult.resolvedVideoId = localResult.resolvedVideoId || canonicalVideoId;
    localResult.resolvedSourceUrl = localResult.resolvedSourceUrl || target.resolvedUrl;
    if (localResult.path) {
      await writeVideoSourceMetadata({
        videoPath: localResult.path,
        videoId: canonicalVideoId,
        sourceUrl: url,
        method: localResult.method || 'download',
        resolvedVideoId: localResult.resolvedVideoId,
        resolvedSourceUrl: localResult.resolvedSourceUrl,
        title: localResult.title
      });
      return res.json({
        success: true,
        message: 'Video downloaded without a browser',
        videoId: canonicalVideoId,
        requestedVideoId,
        filename: localResult.filename,
        path: localResult.publicPath,
        completed: true,
        method: localResult.method,
        resolvedVideoId: localResult.resolvedVideoId || null,
        resolvedSourceUrl: localResult.resolvedSourceUrl || null,
        fallbackAttempts: localResult.failures
      });
    }

    // Mark download as active
    activeDownloads.set(canonicalVideoId, {
      url,
      quality,
      startTime: Date.now(),
      useCookies,
      interactiveVerification,
      fallbackAttempts: localResult.failures
    });

    // Start the download process
    console.log(`[DOUYIN-PLAYWRIGHT] Starting Playwright download for: ${canonicalVideoId}`);

    // Return immediately to client for polling
    res.json({
      success: true,
      message: 'Download started',
      videoId: canonicalVideoId,
      requestedVideoId,
      inProgress: true
    });

    // Start download in background
    (async () => {
      try {
        // Perform the actual download
        const downloadResult = await downloadDouyinVideo(target.resolvedUrl, canonicalVideoId, quality, useCookies, {
          interactiveVerification
        });
        const downloadedPath = downloadResult.path;

        await verifyDownloadedArtifact(downloadedPath, 'playwright');

        // Get the filename from the downloaded path
        const filename = path.basename(downloadedPath);
        await writeVideoSourceMetadata({
          videoPath: downloadedPath,
          videoId: canonicalVideoId,
          sourceUrl: url,
          method: 'playwright',
          resolvedVideoId: downloadResult.resolvedVideoId,
          resolvedSourceUrl: downloadResult.resolvedSourceUrl,
          title: downloadResult.title
        });

        console.log(`[DOUYIN-PLAYWRIGHT] Download completed: ${filename}`);

        // Store completed download info for progress polling
        completedDownloads.set(canonicalVideoId, {
          filename,
          path: downloadedPath,
          url: toPublicPath(filename),
          resolvedVideoId: downloadResult.resolvedVideoId,
          resolvedSourceUrl: downloadResult.resolvedSourceUrl,
          completedAt: Date.now()
        });
        failedDownloads.delete(canonicalVideoId);

        // Clean up active downloads tracking
        activeDownloads.delete(canonicalVideoId);

      } catch (downloadError) {
        console.error(`[DOUYIN-PLAYWRIGHT] Download failed for ${canonicalVideoId}:`, downloadError);

        // Clean up tracking
        const downloadState = activeDownloads.get(canonicalVideoId);
        activeDownloads.delete(canonicalVideoId);
        completedDownloads.delete(canonicalVideoId);
        const attempts = [
          ...(downloadState?.fallbackAttempts || []),
          { method: 'playwright', error: summarizeError(downloadError) }
        ];
        failedDownloads.set(canonicalVideoId, {
          error: `Douyin download failed: ${attempts.map(item => `${item.method}: ${item.error}`).join(' | ')}`.slice(0, 2400),
          attempts
        });
      }
    })(); // End of async IIFE

  } catch (error) {
    // Clean up active downloads tracking
    activeDownloads.delete(canonicalVideoIdFor(videoId));
    
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
router.get('/douyin-playwright-download/:filename', async (req, res) => {
  const { filename } = req.params;

  if (!filename) {
    return res.status(400).json({
      success: false,
      error: 'Filename is required'
    });
  }

  try {
    const filePath = path.join(VIDEOS_DIR, filename);

    const validation = await validateVideoArtifact(filePath);
    if (!validation.valid) {
      await quarantineInvalidArtifact(filePath, validation.reason);
      return res.status(404).json({
        success: false,
        error: 'Video file is missing or invalid'
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
router.get('/douyin-playwright-progress/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const canonicalVideoId = canonicalVideoIdFor(videoId);
  
  try {
    const progressInfo = getDownloadProgress(canonicalVideoId);
    const isActive = activeDownloads.has(canonicalVideoId);
    const completedInfo = completedDownloads.get(canonicalVideoId);
    const failedInfo = failedDownloads.get(canonicalVideoId);

    // Extract progress percentage from progress info object
    const progressPercentage = progressInfo?.progress || 0;

    // Check if download is completed
    const isCompleted = !!completedInfo && !isActive;

    // If completed, verify file still exists
    let fileExists = false;
    if (completedInfo) {
      const fullPath = path.join(VIDEOS_DIR, completedInfo.filename);
      fileExists = (await validateVideoArtifact(fullPath)).valid;
      if (!fileExists) {
        await quarantineInvalidArtifact(fullPath, 'completed-artifact-invalid');
        completedDownloads.delete(canonicalVideoId);
      }
    }

    res.json({
      success: true,
      videoId: canonicalVideoId,
      requestedVideoId: videoId,
      progress: progressPercentage,
      isActive,
      completed: isCompleted && fileExists,
      filename: completedInfo?.filename || null,
      path: (isCompleted && fileExists) ? completedInfo.url : null,
      resolvedVideoId: completedInfo?.resolvedVideoId || null,
      resolvedSourceUrl: completedInfo?.resolvedSourceUrl || null,
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
  const canonicalVideoId = canonicalVideoIdFor(videoId);
  
  try {
    if (activeDownloads.has(canonicalVideoId)) {
      activeDownloads.delete(canonicalVideoId);
      console.log(`[DOUYIN-PLAYWRIGHT] Cancelled download: ${canonicalVideoId}`);
      
      res.json({
        success: true,
        message: `Download cancelled for ${canonicalVideoId}`
      });
    } else {
      res.status(404).json({
        success: false,
        error: `No active download found for ${canonicalVideoId}`
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
