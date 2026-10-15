/**
 * Shared progress tracking system for all video downloads
 */

// Global progress tracking for downloads
const downloadProgress = new Map();

// Track download phases for better progress calculation
const downloadPhases = new Map();

/**
 * Get download progress for a video
 * @param {string} videoId - Video ID
 * @returns {Object} - Progress information
 */
function getDownloadProgress(videoId) {
  return downloadProgress.get(videoId) || { progress: 0, status: 'unknown' };
}

/**
 * Set download progress for a video
 * @param {string} videoId - Video ID
 * @param {number} progress - Progress percentage (0-100)
 * @param {string} status - Download status
 */
function setDownloadProgress(videoId, progress, status = 'downloading') {
  console.log(`[setDownloadProgress] ${videoId}: ${progress}% - ${status}`);
  downloadProgress.set(videoId, { progress, status, timestamp: Date.now() });
}

/**
 * Clear download progress for a video
 * @param {string} videoId - Video ID
 */
function clearDownloadProgress(videoId) {
  downloadProgress.delete(videoId);
}

/**
 * Parse yt-dlp progress output with detailed phase detection
 * @param {string} output - Raw output from yt-dlp
 * @returns {Object|null} - Parsed progress info or null
 */
function parseYtdlpProgress(output) {
  // yt-dlp progress format: [download]  45.2% of 123.45MiB at 1.23MiB/s ETA 00:30
  const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
  if (progressMatch) {
    const progress = parseFloat(progressMatch[1]);

    // Detect download phase with improved detection
    let phase = 'video'; // Default to video for first download

    // Check for explicit format indicators
    if (output.includes('video only') || output.includes('bestvideo')) {
      phase = 'video';
    } else if (output.includes('audio only') || output.includes('bestaudio')) {
      phase = 'audio';
    } else if (output.includes('Merging formats') || output.includes('[Merger]')) {
      phase = 'merge';
    } else {
      // Try to detect based on file extension or format codes
      if (output.match(/\.(m4a|mp3|aac|opus|webm)[\s\]]/)) {
        phase = 'audio';
      } else if (output.match(/\.(mp4|mkv|webm|avi)[\s\]]/)) {
        phase = 'video';
      }
      // If we can't determine, keep default 'video'
    }

    return {
      progress: progress,
      status: 'downloading',
      phase: phase,
      rawOutput: output.trim()
    };
  }

  // Check for completion (including merge completion)
  if (output.includes('[download] 100%') ||
      output.includes('has already been downloaded') ||
      output.includes('Deleting original file') ||
      output.includes('merger complete') ||
      (output.includes('[Merger]') && output.includes('100%'))) {
    return {
      progress: 99,
      status: 'downloading',
      phase: 'merge'
    };
  }

  // Check for merge operations (in progress)
  if (output.includes('[Merger]') || output.includes('Merging formats')) {
    return {
      progress: 95, // Assume 95% when merging
      status: 'downloading',
      phase: 'merge'
    };
  }

  return null;
}

/**
 * Calculate overall progress for dual-phase downloads (video + audio)
 * @param {string} videoId - Video ID
 * @param {number} currentProgress - Current phase progress (0-100)
 * @param {string} phase - Current phase (video, audio, merge)
 * @returns {number} - Overall progress (0-100)
 */
function calculateOverallProgress(videoId, currentProgress, phase) {
  if (!downloadPhases.has(videoId)) {
    downloadPhases.set(videoId, {
      videoComplete: false,
      audioComplete: false,
      currentPhase: phase
    });
  }

  const phases = downloadPhases.get(videoId);
  phases.currentPhase = phase;

  // Handle different phases
  if (phase === 'video') {
    // First phase: video download (0-50% of total)
    return Math.round(currentProgress * 0.5);
  } else if (phase === 'audio') {
    // Second phase: audio download (50-90% of total)
    phases.videoComplete = true;
    return Math.round(50 + (currentProgress * 0.4));
  } else if (phase === 'merge') {
    // Final phase: merging (90-100% of total)
    phases.videoComplete = true;
    phases.audioComplete = true;
    return Math.round(90 + (currentProgress * 0.1));
  } else if (phase === 'completed') {
    // Completed
    downloadPhases.delete(videoId);
    return 100;
  } else {
    // Unknown phase, use raw progress
    return currentProgress;
  }
}

/**
 * Update progress from yt-dlp output with WebSocket broadcasting
 * @param {string} videoId - Video ID
 * @param {string} output - Raw output from yt-dlp
 */
function updateProgressFromYtdlpOutput(videoId, output) {
  if (!videoId) return;

  const progressInfo = parseYtdlpProgress(output);
  if (progressInfo) {
    // Use raw progress directly - no normalization
    const rawProgress = progressInfo.progress;

    setDownloadProgress(videoId, rawProgress, progressInfo.status);

    // Broadcast to WebSocket clients
    try {
      const { broadcastProgress } = require('./progressWebSocket');
      broadcastProgress(videoId, rawProgress, progressInfo.status, progressInfo.phase);
    } catch (error) {
      // WebSocket module might not be initialized yet, that's okay
    }

    console.log(`[yt-dlp progress] ${videoId}: ${rawProgress}% (${progressInfo.phase || 'unknown'} - raw progress)`);
  }
}

module.exports = {
  getDownloadProgress,
  setDownloadProgress,
  clearDownloadProgress,
  parseYtdlpProgress,
  updateProgressFromYtdlpOutput
};
