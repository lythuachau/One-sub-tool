const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { VIDEOS_DIR } = require('../config');
const { getYtDlpPath, getYtDlpArgs } = require('../services/shared/ytdlpUtils');
const { setDownloadProgress, getDownloadProgress } = require('../services/shared/progressTracker');
const { updateProgressFromYtdlpOutput } = require('../services/shared/progressTracker');
const { downloadVideoWithRetry } = require('../services/allSites/downloader');
const { isBilibiliUrl } = require('../services/allSites/formatPolicy');

// Track active downloads to prevent duplicates
const activeDownloads = new Map();

// Track active file operations to prevent race conditions
const activeFileOperations = new Set();

// Track active yt-dlp processes to prevent multiple spawns
const activeYtdlpProcesses = new Map();

/**
 * POST /api/download-only - Download video or audio only
 */
router.post('/download-only', async (req, res) => {
  const { url, type, quality, source, useCookies = false } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'Video URL is required'
    });
  }

  if (!type || !['video', 'audio'].includes(type)) {
    return res.status(400).json({
      success: false,
      error: 'Type must be either "video" or "audio"'
    });
  }

  try {
    console.log(`[DOWNLOAD-ONLY] Starting ${type} download:`, { url, type, quality, source });

    // Create a unique key for this download request
    const downloadKey = `${url}_${type}_${quality || 'default'}`;

    // Check if this exact download is already in progress
    if (activeDownloads.has(downloadKey)) {
      const existingVideoId = activeDownloads.get(downloadKey);
      console.log(`[DOWNLOAD-ONLY] DUPLICATE DOWNLOAD DETECTED! Returning existing videoId: ${existingVideoId}`);
      return res.json({
        success: true,
        videoId: existingVideoId,
        message: 'Download already in progress',
        isDuplicate: true
      });
    }

    // Generate unique video ID for progress tracking
    const timestamp = Date.now();
    const videoId = `download_${type}_${timestamp}`;

    // Register this download to prevent duplicates
    activeDownloads.set(downloadKey, videoId);
    console.log(`[DOWNLOAD-ONLY] Registered download: ${downloadKey} -> ${videoId}`);

    // Generate output filename
    const extension = type === 'video' ? 'mp4' : 'mp3';
    const outputFilename = `${videoId}.${extension}`;
    const outputPath = path.join(VIDEOS_DIR, outputFilename);

    // Check if this exact file is already being created (race condition protection)
    if (activeFileOperations.has(outputPath)) {
      console.log(`[DOWNLOAD-ONLY] File operation already in progress: ${outputPath}`);
      return res.json({
        success: false,
        error: 'File operation already in progress',
        videoId: videoId
      });
    }

    // Check if file already exists
    if (fs.existsSync(outputPath)) {
      console.log(`[DOWNLOAD-ONLY] File already exists: ${outputPath}`);
      return res.json({
        success: true,
        videoId: videoId,
        message: 'File already exists',
        filename: outputFilename,
        isExisting: true
      });
    }

    // Lock this file operation
    activeFileOperations.add(outputPath);
    console.log(`[DOWNLOAD-ONLY] Locked file operation: ${outputPath}`);

    // Check if yt-dlp process is already running for this exact command
    const processKey = `${url}_${type}_${quality || 'default'}`;
    if (activeYtdlpProcesses.has(processKey)) {
      console.log(`[DOWNLOAD-ONLY] yt-dlp process already running for: ${processKey}`);
      activeFileOperations.delete(outputPath);
      return res.json({
        success: false,
        error: 'Download process already running',
        videoId: videoId
      });
    }

    // Lock the yt-dlp process
    activeYtdlpProcesses.set(processKey, videoId);
    console.log(`[DOWNLOAD-ONLY] Locked yt-dlp process: ${processKey} -> ${videoId}`);

    // Ensure videos directory exists
    if (!fs.existsSync(VIDEOS_DIR)) {
      fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    }

    // Remove existing file if it exists
    if (fs.existsSync(outputPath)) {
      console.log(`[DOWNLOAD-ONLY] Removing existing file: ${outputPath}`);
      fs.unlinkSync(outputPath);
    }

    // Start download process asynchronously and consume failures so a failed download
    // cannot become an unhandled rejection that terminates the backend process.
    downloadMediaAsync(url, outputPath, type, quality, videoId, useCookies).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[DOWNLOAD-ONLY] Background download failed for ${videoId}:`, message);
      setDownloadProgress(videoId, 0, 'error', { error: message });
      activeDownloads.delete(downloadKey);
      activeFileOperations.delete(outputPath);
      activeYtdlpProcesses.delete(processKey);
    });

    res.json({
      success: true,
      videoId: videoId,
      message: `${type} download started`,
      downloadUrl: `/videos/${outputFilename}`,
      filename: outputFilename
    });

  } catch (error) {
    console.error('[DOWNLOAD-ONLY] Error starting download:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start download'
    });
  }
});

/**
 * GET /api/download-only-progress/:videoId - Get download progress
 */
router.get('/download-only-progress/:videoId', async (req, res) => {
  const { videoId } = req.params;

  try {
    const progress = getDownloadProgress(videoId);

    res.json({
      success: true,
      progress: progress.progress || 0,
      status: progress.status || 'unknown',
      error: progress.error || null
    });
  } catch (error) {
    console.error('[DOWNLOAD-ONLY] Error getting progress:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get download progress'
    });
  }
});

/**
 * GET /api/download-only-file/:videoId - Download the completed file
 */
router.get('/download-only-file/:videoId', (req, res) => {
  const { videoId } = req.params;

  try {
    // Determine file extension based on videoId
    const isAudio = videoId.includes('download_audio_');
    const extension = isAudio ? 'mp3' : 'mp4';
    const filename = `${videoId}.${extension}`;
    const filePath = path.join(VIDEOS_DIR, filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Set headers for file download
    const stats = fs.statSync(filePath);
    const mimeType = isAudio ? 'audio/mpeg' : 'video/mp4';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('[DOWNLOAD-ONLY] Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Error streaming file'
        });
      }
    });

  } catch (error) {
    console.error('[DOWNLOAD-ONLY] Error serving download:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to serve download'
    });
  }
});

/**
 * Async function to download media (video or audio)
 */
async function downloadMediaAsync(url, outputPath, type, quality, videoId, useCookies = false) {
  return new Promise((resolve, reject) => {
    if (type === 'video' && isBilibiliUrl(url)) {
      downloadVideoWithRetry(videoId, url, quality, useCookies)
        .then(() => {
          setDownloadProgress(videoId, 100, 'completed');
          const downloadKey = `${url}_${type}_${quality || 'default'}`;
          activeDownloads.delete(downloadKey);
          activeFileOperations.delete(outputPath);
          activeYtdlpProcesses.delete(downloadKey);
          try {
            const { broadcastProgress } = require('../services/shared/progressWebSocket');
            broadcastProgress(videoId, 100, 'completed', 'download');
          } catch (error) {
            // WebSocket module might not be initialized yet.
          }
          resolve();
        })
        .catch(error => {
          const message = error instanceof Error ? error.message : String(error);
          setDownloadProgress(videoId, 0, 'error', { error: message });
          reject(error);
        });
      return;
    }

    const ytDlpPath = getYtDlpPath();
    
    // Initialize progress tracking
    setDownloadProgress(videoId, 0, 'downloading');

    let args;
    if (type === 'video') {
      // Video download with quality - use the same logic as qualityScanner.js
      let formatSelector;
      if (quality) {
        const height = quality.replace('p', '');

        // Use the same format selection logic as the working qualityScanner
        if (url.includes('tiktok.com') || url.includes('douyin.com')) {
          // For TikTok/Douyin, use simple format to avoid compatibility issues
          formatSelector = `best[height<=${height}]`;
        } else {
          // For other sites (YouTube, etc.), use complex format for better quality
          formatSelector = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;
        }
      } else {
        // Default to best quality if no specific quality requested
        formatSelector = 'best[ext=mp4]/best';
      }

      args = [
        ...getYtDlpArgs(useCookies),
        '--format', formatSelector,
        '--merge-output-format', 'mp4',
        '--output', outputPath,
        '--no-playlist',
        '--progress',
        '--newline',
        '--force-overwrites',
        url
      ];
    } else {
      // Audio download
      args = [
        ...getYtDlpArgs(useCookies),
        '--format', 'bestaudio/best',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '192K',
        '--output', outputPath.replace('.mp3', '.%(ext)s'),
        '--no-playlist',
        '--progress',
        '--newline',
        '--force-overwrites',
        url
      ];
    }

    console.log(`[DOWNLOAD-ONLY] Starting yt-dlp with args:`, args);

    // FINAL CHECK: Ensure no other process is writing to this exact file
    try {
      // Try to open the file exclusively to check if it's being written to
      const fd = fs.openSync(outputPath, 'wx');
      fs.closeSync(fd);
      fs.unlinkSync(outputPath); // Remove the test file
    } catch (error) {
      if (error.code === 'EEXIST') {
        console.log(`[DOWNLOAD-ONLY] CRITICAL: File is being written by another process: ${outputPath}`);
        activeDownloads.delete(downloadKey);
        activeFileOperations.delete(outputPath);
        activeYtdlpProcesses.delete(processKey);
        return res.json({
          success: false,
          error: 'File is being written by another process',
          videoId: videoId
        });
      }
    }

    const ytdlpProcess = spawn(ytDlpPath, args);
    let stderr = '';

    ytdlpProcess.stdout.on('data', (data) => {
      const output = data.toString();
      
      // Update progress tracking
      updateProgressFromYtdlpOutput(videoId, output);
      
      // Log progress lines
      if (output.includes('%') || output.includes('download')) {
        console.log(`[DOWNLOAD-ONLY] Progress for ${videoId}:`, output.trim());
      }
    });

    ytdlpProcess.stderr.on('data', (data) => {
      const errorOutput = data.toString();
      stderr += errorOutput;
      console.error(`[DOWNLOAD-ONLY] yt-dlp stderr:`, errorOutput);

      // Try to extract progress from stderr as well
      const progressMatch = errorOutput.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        if (progress >= 0 && progress <= 100) {
          setDownloadProgress(videoId, progress, 'downloading');
          
          try {
            const { broadcastProgress } = require('../services/shared/progressWebSocket');
            broadcastProgress(videoId, progress, 'downloading', 'download');
          } catch (error) {
            // WebSocket module might not be initialized yet
          }
        }
      }
    });

    ytdlpProcess.on('close', (code) => {
      // Clean up the active download tracking
      const cleanupKey = `${url}_${type}_${quality || 'default'}`;
      activeDownloads.delete(cleanupKey);
      console.log(`[DOWNLOAD-ONLY] Cleaned up download tracking for: ${cleanupKey}`);

      // Clean up the file operation lock
      activeFileOperations.delete(outputPath);
      console.log(`[DOWNLOAD-ONLY] Released file operation lock: ${outputPath}`);

      // Clean up the yt-dlp process lock
      const processKey = `${url}_${type}_${quality || 'default'}`;
      activeYtdlpProcesses.delete(processKey);
      console.log(`[DOWNLOAD-ONLY] Released yt-dlp process lock: ${processKey}`);

      if (code === 0) {
        console.log(`[DOWNLOAD-ONLY] Download completed successfully for ${videoId}`);
        setDownloadProgress(videoId, 100, 'completed');

        try {
          const { broadcastProgress } = require('../services/shared/progressWebSocket');
          broadcastProgress(videoId, 100, 'completed', 'download');
        } catch (error) {
          // WebSocket module might not be initialized yet
        }

        resolve();
      } else {
        console.error(`[DOWNLOAD-ONLY] Download failed for ${videoId} with code ${code}:`, stderr);
        setDownloadProgress(videoId, 0, 'error');

        try {
          const { broadcastProgress } = require('../services/shared/progressWebSocket');
          broadcastProgress(videoId, 0, 'error', 'download');
        } catch (error) {
          // WebSocket module might not be initialized yet
        }

        // Provide more user-friendly error messages
        let errorMessage = stderr;
        if (stderr.includes('Requested format is not available')) {
          errorMessage = `The requested quality (${quality || 'default'}) is not available for this video. Please try a different quality.`;
        } else if (stderr.includes('Video unavailable')) {
          errorMessage = 'This video is unavailable or has been removed.';
        } else if (stderr.includes('Private video')) {
          errorMessage = 'This video is private and cannot be downloaded.';
        } else if (stderr.includes('Sign in to confirm your age')) {
          errorMessage = 'This video requires age verification and cannot be downloaded.';
        }

        reject(new Error(errorMessage));
      }
    });

    ytdlpProcess.on('error', (error) => {
      console.error(`[DOWNLOAD-ONLY] Process error for ${videoId}:`, error);
      setDownloadProgress(videoId, 0, 'error');
      
      try {
        const { broadcastProgress } = require('../services/shared/progressWebSocket');
        broadcastProgress(videoId, 0, 'error', 'download');
      } catch (wsError) {
        // WebSocket module might not be initialized yet
      }
      
      reject(error);
    });

    // Set timeout to prevent hanging (increased due to cookie extraction time)
    setTimeout(() => {
      ytdlpProcess.kill();
      setDownloadProgress(videoId, 0, 'error');
      reject(new Error('Download timeout'));
    }, 600000); // 10 minute timeout
  });
}

module.exports = router;
