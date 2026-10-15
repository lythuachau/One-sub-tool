/**
 * YouTube downloader using yt-dlp command line tool
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { publishVideoFile } = require('../../utils/fileOperations');
const { getYtDlpPath, getYtDlpArgs } = require('../shared/ytdlpUtils');
const {
  getDownloadProgress,
  setDownloadProgress,
  updateProgressFromYtdlpOutput
} = require('../shared/progressTracker');



/**
 * Download YouTube video using yt-dlp command line tool
 * @param {string} videoURL - YouTube video URL
 * @param {string} outputPath - Path to save the video
 * @param {string} quality - Desired video quality (e.g., '144p', '360p', '720p')
 * @param {string} videoId - Video ID for progress tracking (optional)
 * @param {boolean} useCookies - Whether to use browser cookies for authentication
 * @returns {Promise<boolean>} - Success status
 */
async function downloadWithYtdlp(videoURL, outputPath, quality = '360p', videoId = null, useCookies = true) {
  return new Promise((resolve, reject) => {
    // Declare timeout variable for cleanup
    let downloadTimeout;

    // Convert quality string to resolution for yt-dlp
    let resolution;
    switch (quality) {
      case '144p': resolution = '144'; break;
      case '240p': resolution = '240'; break;
      case '360p': resolution = '360'; break;
      case '480p': resolution = '480'; break;
      case '720p': resolution = '720'; break;
      case '1080p': resolution = '1080'; break;
      default: resolution = '360'; // Default to 360p
    }



    // Create a temporary directory for the download
    const tempDir = path.dirname(outputPath);
    const tempFilename = `${path.basename(outputPath, '.mp4')}.ytdlp.mp4`;
    const tempPath = path.join(tempDir, tempFilename);

    // Get yt-dlp path using shared utility
    const ytdlpCommand = getYtDlpPath();



    // Initialize progress tracking if videoId is provided
    if (videoId) {
      setDownloadProgress(videoId, 0, 'starting');
    }

    // Build the yt-dlp command arguments with conditional cookie support
    const args = [
      ...getYtDlpArgs(useCookies),
      videoURL,
      '-f', `bestvideo[height<=${resolution}]+bestaudio/best[height<=${resolution}]`,
      '-o', tempPath,
      '--no-playlist',
      '--merge-output-format', 'mp4',
      '--progress',  // Enable progress reporting
      '--newline',   // Force newlines for better parsing
      '--no-post-overwrites',
      '--js-runtimes', `node:${process.execPath}`
    ];

    console.log(`[ytdlpDownloader] Running yt-dlp with args:`, args);



    // Spawn the yt-dlp process
    const ytdlpProcess = spawn(ytdlpCommand, args);

    let stdoutData = '';
    let stderrData = '';

    ytdlpProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdoutData += output;

      // Log merge-related messages for debugging
      if (output.includes('Merging') || output.includes('merger') || output.includes('ffmpeg')) {
        console.log(`[yt-dlp merge] ${output.trim()}`);
      }

      // Parse progress information if videoId is provided
      if (videoId) {
        updateProgressFromYtdlpOutput(videoId, output);
      }
    });

    ytdlpProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderrData += output;
      console.error(`[yt-dlp error] ${output.trim()}`);

      // Log merge-related messages for debugging
      if (output.includes('Merging') || output.includes('merger') || output.includes('ffmpeg')) {
        console.log(`[yt-dlp merge] ${output.trim()}`);
      }
    });

    ytdlpProcess.on('close', (code) => {
      clearTimeout(downloadTimeout);
      console.log(`[ytdlpDownloader] Process closed with code: ${code} for video: ${videoId || 'unknown'}`);
      if (code === 0) {
        // Success - move the file to the final location
        try {
          console.log(`[ytdlpDownloader] Checking for file: ${tempPath}`);
          // Check if the file exists
          if (fs.existsSync(tempPath)) {
            console.log(`[ytdlpDownloader] File exists, publishing output for: ${videoId}`);
            // Completion is acknowledged by the download route after publication.
            if (videoId) {
              setDownloadProgress(videoId, 99, 'downloading');
            }

            // Publish only a fully copied file.
            publishVideoFile(tempPath, outputPath)
              .then(() => {
                resolve(true);
              })
              .catch((err) => {
                if (videoId) {
                  setDownloadProgress(videoId, 0, 'error');
                }
                console.error(`Error moving yt-dlp downloaded file: ${err.message}`);
                reject(err);
              });
          } else {
            if (videoId) {
              setDownloadProgress(videoId, 0, 'error');
            }
            console.error(`yt-dlp process completed but file not found: ${tempPath}`);
            reject(new Error('yt-dlp process completed but file not found'));
          }
        } catch (error) {
          if (videoId) {
            setDownloadProgress(videoId, 0, 'error');
          }
          console.error(`Error moving yt-dlp downloaded file: ${error.message}`);
          reject(error);
        }
      } else {
        // Process failed
        if (videoId) {
          setDownloadProgress(videoId, 0, 'error');
        }
        console.error(`yt-dlp process exited with code ${code}`);
        reject(new Error(`yt-dlp process failed with code ${code}: ${stderrData}`));
      }
    });

    ytdlpProcess.on('error', (error) => {
      clearTimeout(downloadTimeout);
      if (videoId) {
        setDownloadProgress(videoId, 0, 'error');
      }
      console.error(`Error spawning yt-dlp process: ${error.message}`);

      // If the error is ENOENT (command not found), provide a more helpful message
      if (error.code === 'ENOENT') {
        console.error(`yt-dlp command not found. Make sure yt-dlp is installed in the virtual environment.`);
        reject(new Error('yt-dlp command not found. Please install yt-dlp using "uv pip install yt-dlp"'));
      } else {
        reject(error);
      }
    });

    // Set timeout to prevent hanging (especially important with cookie extraction)
    downloadTimeout = setTimeout(() => {
      console.error(`[ytdlpDownloader] Download timeout for ${videoId || 'unknown'}`);
      ytdlpProcess.kill();
      if (videoId) {
        setDownloadProgress(videoId, 0, 'error');
      }
      reject(new Error('Download timeout - process took too long'));
    }, 600000); // 10 minute timeout (increased due to cookie extraction time)
  });
}

module.exports = {
  downloadWithYtdlp,
  getDownloadProgress
};
