/**
 * Utility functions for downloading and handling YouTube videos
 */

import progressWebSocketClient from './progressWebSocketClient';

// Global download queue to track video download status
const downloadQueue = {};

// Track active download intervals for cancellation
const activeDownloadIntervals = {};

// Server URL for the local YouTube download server - using unified port configuration
const SERVER_URL = 'http://localhost:3031'; // Backend server port

/**
 * Starts downloading a YouTube video to the local videos folder
 * This allows starting the download process in parallel with other operations
 * @param {string} youtubeUrl - The YouTube video URL
 * @param {boolean} forceRefresh - Force a fresh download even if the video exists in cache
 * @param {boolean} useCookies - Whether to use browser cookies for authentication
 * @returns {string} - The video ID that can be used to check download status
 */
export const startYoutubeVideoDownload = (youtubeUrl, forceRefresh = false, useCookies = true) => {
  console.log(`[startYoutubeVideoDownload] Called with URL: ${youtubeUrl}, forceRefresh: ${forceRefresh}`);
  const videoId = extractYoutubeVideoId(youtubeUrl);
  console.log(`[startYoutubeVideoDownload] Extracted videoId: ${videoId}`);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  // Check if already in the queue and not forcing refresh
  if (downloadQueue[videoId] && !forceRefresh) {
    return videoId;
  }

  // Initialize download queue entry
  downloadQueue[videoId] = {
    status: 'checking',
    progress: 0,
    url: null,
    error: null,
    forceRefresh: forceRefresh // Store the forceRefresh flag
  };

  // Start the download process asynchronously
  (async () => {
    console.log(`[startYoutubeVideoDownload] Starting async download process for ${videoId}`);
    try {


      // Check if the video already exists on the server (unless forceRefresh is true)
      if (!downloadQueue[videoId].forceRefresh) {
        console.log(`[startYoutubeVideoDownload] Checking if ${videoId} already exists`);
        const checkResponse = await fetch(`${SERVER_URL}/api/video-exists/${videoId}?url=${encodeURIComponent(youtubeUrl)}`);
        const checkData = await checkResponse.json();
        console.log(`[startYoutubeVideoDownload] Video exists check for ${videoId}:`, checkData);

        if (checkData.exists) {
          // Video already exists, no need to download
          console.log(`[startYoutubeVideoDownload] Video ${videoId} already exists, setting URL: ${SERVER_URL}${checkData.url}`);
          downloadQueue[videoId].status = 'completed';
          downloadQueue[videoId].progress = 100;
          downloadQueue[videoId].url = `${SERVER_URL}${checkData.url}`;
          console.log(`[startYoutubeVideoDownload] Download queue after setting URL:`, downloadQueue[videoId]);
          return;
        }
      } else {
        console.log(`[startYoutubeVideoDownload] Force refresh enabled for ${videoId}, skipping exists check`);
      }

      // If not, start the download
      downloadQueue[videoId].status = 'downloading';
      downloadQueue[videoId].progress = 10;



      // Request server to download the video with audio prioritized
      console.log(`[startYoutubeVideoDownload] Making HTTP API call for ${videoId}`);

      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000); // 15 minute timeout

      const downloadResponse = await fetch(`${SERVER_URL}/api/download-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId,
          sourceUrl: youtubeUrl,
          forceRefresh: downloadQueue[videoId].forceRefresh, // Pass the forceRefresh flag to the server
          useCookies: useCookies // Pass the cookie setting to the server
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      console.log(`[startYoutubeVideoDownload] HTTP API call completed for ${videoId}, status: ${downloadResponse.status}`);



      if (!downloadResponse.ok) {
        const errorData = await downloadResponse.json();
        throw new Error(errorData.error || 'Failed to download video');
      }

      const downloadData = await downloadResponse.json();
      console.log(`[startYoutubeVideoDownload] HTTP API response for ${videoId}:`, downloadData);

      // Update queue entry with success
      downloadQueue[videoId].status = 'completed';
      downloadQueue[videoId].progress = 100;
      downloadQueue[videoId].url = `${SERVER_URL}${downloadData.url}`;
      console.log(`[startYoutubeVideoDownload] Set URL for ${videoId}: ${downloadQueue[videoId].url}`);


    } catch (error) {
      console.error(`[startYoutubeVideoDownload] Error in background download process for ${videoId}:`, error);
      downloadQueue[videoId].status = 'error';
      downloadQueue[videoId].error = error.message;
    }
  })();

  return videoId;
};

/**
 * Checks the status of a YouTube video download
 * @param {string} videoId - The YouTube video ID
 * @returns {Object} - Status object with properties: status, progress, url, error
 */
export const checkDownloadStatus = (videoId) => {
  if (!downloadQueue[videoId]) {
    console.log(`[checkDownloadStatus] ${videoId} not in queue`);
    // Not in queue, check if it might exist on server directly
    return {
      status: 'checking',
      progress: 0,
      url: null,
      error: null
    };
  }

  const status = downloadQueue[videoId];
  console.log(`[checkDownloadStatus] ${videoId}: status=${status.status}, progress=${status.progress}, url=${status.url}`);
  return status;
};

/**
 * Downloads a YouTube video and waits for completion
 * @param {string} youtubeUrl - The YouTube video URL
 * @param {Function} onProgress - Progress callback (0-100)
 * @param {boolean} forceRefresh - Force a fresh download even if the video exists in cache
 * @param {boolean} useCookies - Whether to use browser cookies for authentication
 * @returns {Promise<string>} - A promise that resolves to a video URL
 */
export const downloadYoutubeVideo = async (youtubeUrl, onProgress = () => {}, forceRefresh = false, useCookies = true) => {
  // If forceRefresh is true, remove any existing download from the queue
  const videoId = extractYoutubeVideoId(youtubeUrl);

  if (forceRefresh && downloadQueue[videoId]) {

    delete downloadQueue[videoId];
  }

  // Start the download process
  startYoutubeVideoDownload(youtubeUrl, forceRefresh, useCookies);

  // Store the original URL and cookie setting for potential redownload
  const originalUrl = youtubeUrl;
  const originalUseCookies = useCookies;



  // Subscribe to real-time progress updates via WebSocket
  let progressSubscribed = false;

  const subscribeToProgress = async () => {
    if (!progressSubscribed) {
      try {
        await progressWebSocketClient.subscribe(videoId, (progressData) => {
          // Update local progress with real-time server progress
          if (downloadQueue[videoId]) {
            // Preserve the URL when updating from WebSocket
            const existingUrl = downloadQueue[videoId].url;
            downloadQueue[videoId].progress = progressData.progress;
            downloadQueue[videoId].status = progressData.status;
            if (progressData.error) {
              downloadQueue[videoId].error = progressData.error;
            }
            // Restore the URL if it was previously set
            if (existingUrl && !downloadQueue[videoId].url) {
              downloadQueue[videoId].url = existingUrl;
            }
            // If download is completed and we don't have a URL, construct it
            if (progressData.status === 'completed' && !downloadQueue[videoId].url) {
              downloadQueue[videoId].url = `${SERVER_URL}/videos/${videoId}.mp4`;
              console.log(`[WebSocket] Set URL for completed download ${videoId}: ${downloadQueue[videoId].url}`);
            }
          }
          onProgress(progressData.progress);

          console.log(`[WebSocket] ${videoId}: ${progressData.progress}% (${progressData.phase || 'unknown'})`);
        });
        progressSubscribed = true;
        console.log(`Subscribed to WebSocket progress for ${videoId}`);
      } catch (error) {
        console.warn('Failed to subscribe to WebSocket progress:', error);
        // Will fall back to polling
      }
    }
  };

  // Poll for completion with WebSocket enhancement
  return new Promise((resolve, reject) => {
    let attempts = 0;
    // No maximum attempts - we'll wait indefinitely

    const checkInterval = setInterval(async () => {
      const status = checkDownloadStatus(videoId);

      // Subscribe to WebSocket progress if downloading and not already subscribed
      if (status.status === 'downloading' && !progressSubscribed) {
        await subscribeToProgress();
      }

      // Always report current progress (WebSocket updates will override this)
      onProgress(status.progress);

      if (status.status === 'completed') {
        console.log(`[downloadYoutubeVideo] Download completed for ${videoId}, URL: ${status.url}`);
        // Check if the video URL is valid by making a HEAD request
        try {
          const checkResponse = await fetch(status.url, { method: 'HEAD' });
          if (!checkResponse.ok) {
            // Video file doesn't exist anymore, restart the download silently

            clearInterval(checkInterval);

            // Remove the video from the download queue
            delete downloadQueue[videoId];

            // Restart the download process
            const newVideoId = startYoutubeVideoDownload(originalUrl, false, originalUseCookies);

            // Set up a new interval to check the download status
            let newProgressSubscribed = false;

            const subscribeToNewProgress = async () => {
              if (!newProgressSubscribed) {
                try {
                  await progressWebSocketClient.subscribe(newVideoId, (progressData) => {
                    onProgress(progressData.progress);
                    console.log(`[WebSocket Restart] ${newVideoId}: ${progressData.progress}% (${progressData.phase || 'unknown'})`);
                  });
                  newProgressSubscribed = true;
                } catch (error) {
                  console.warn('Failed to subscribe to WebSocket progress for restarted download:', error);
                }
              }
            };

            const newCheckInterval = setInterval(async () => {
              const newStatus = checkDownloadStatus(newVideoId);

              // Subscribe to WebSocket progress if downloading and not already subscribed
              if (newStatus.status === 'downloading' && !newProgressSubscribed) {
                await subscribeToNewProgress();
              }

              onProgress(newStatus.progress);

              if (newStatus.status === 'completed') {
                clearInterval(newCheckInterval);
                // Unsubscribe from WebSocket progress
                if (newProgressSubscribed) {
                  progressWebSocketClient.unsubscribe(newVideoId);
                }
                resolve(newStatus.url);
              } else if (newStatus.status === 'error') {
                clearInterval(newCheckInterval);
                // Unsubscribe from WebSocket progress
                if (newProgressSubscribed) {
                  progressWebSocketClient.unsubscribe(newVideoId);
                }
                reject(new Error(newStatus.error || 'Unknown download error'));
              }
            }, 500);

            return;
          }
        } catch (error) {
          console.warn('Error checking video existence with HEAD request:', error);
          // Continue with the resolve anyway, the App.js error handling will catch any issues
        }

        clearInterval(checkInterval);
        // Unsubscribe from WebSocket progress
        if (progressSubscribed) {
          progressWebSocketClient.unsubscribe(videoId);
        }
        resolve(status.url);
      } else if (status.status === 'error') {
        clearInterval(checkInterval);
        // Unsubscribe from WebSocket progress
        if (progressSubscribed) {
          progressWebSocketClient.unsubscribe(videoId);
        }
        reject(new Error(status.error || 'Unknown download error'));
      } else if (status.status === 'checking') {
        // Check if the video exists on the server
        try {
          const checkResponse = await fetch(`${SERVER_URL}/api/video-exists/${videoId}?url=${encodeURIComponent(originalUrl)}`);
          const checkData = await checkResponse.json();

          if (checkData.exists) {
            // Video exists, update status and resolve
            downloadQueue[videoId] = {
              status: 'completed',
              progress: 100,
              url: `${SERVER_URL}${checkData.url}`,
              error: null
            };
            clearInterval(checkInterval);
            // Unsubscribe from WebSocket progress
            if (progressSubscribed) {
              progressWebSocketClient.unsubscribe(videoId);
            }
            resolve(`${SERVER_URL}${checkData.url}`);
            return;
          }
        } catch (error) {
          console.warn('Error checking video existence:', error);
        }
      }

      // Increment attempts counter (for logging purposes)
      ++attempts;

      // Log every 30 seconds to show we're still waiting
      if (attempts % 60 === 0) {

      }
    }, 500);
    // Store the interval for potential cancellation
    activeDownloadIntervals[videoId] = checkInterval;
  });
};

/**
 * Cancels an ongoing YouTube video download
 * @param {string} videoId - The video ID to cancel
 * @returns {boolean} - True if the download was cancelled, false if it wasn't found
 */
export const cancelYoutubeVideoDownload = (videoId) => {
  // Check if the video is in the download queue
  if (!downloadQueue[videoId]) {

    return false;
  }

  // Clear any active interval for this download
  if (activeDownloadIntervals[videoId]) {
    clearInterval(activeDownloadIntervals[videoId]);
    delete activeDownloadIntervals[videoId];
  }

  // Try to cancel the download on the server
  fetch(`${SERVER_URL}/api/cancel-download/${videoId}`, { method: 'POST' })
    .then(response => response.json())
    .then(data => {

    })
    .catch(error => {
      console.error('Error cancelling download on server:', error);
    });

  // Update the download queue entry
  downloadQueue[videoId].status = 'cancelled';
  downloadQueue[videoId].error = 'Download cancelled by user';


  return true;
};

/**
 * Extract YouTube video ID from various YouTube URL formats
 * @param {string} url - The YouTube URL
 * @returns {string|null} - The video ID or null if invalid
 */
export const extractYoutubeVideoId = (url) => {
  if (!url) return null;

  // Handle both youtube.com and youtu.be formats
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7] && match[7].length === 11) ? match[7] : null;
};
