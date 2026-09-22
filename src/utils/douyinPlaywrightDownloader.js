/**
 * Frontend utility for Playwright-based Douyin downloading
 * Integrates with existing cookie and quality scanning logic
 */

// Use unified port configuration - backend is on port 3031
const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:3031';

// Download queue to track active downloads
const downloadQueue = {};

/**
 * Download Douyin video using Playwright
 * @param {string} douyinUrl - The Douyin video URL
 * @param {Function} progressCallback - Callback function for progress updates
 * @returns {Promise<string>} - URL to the downloaded video
 */
export const downloadDouyinVideoPlaywright = async (douyinUrl, progressCallback = () => {}) => {
  try {
    console.log('[DouyinPlaywright] Starting download for:', douyinUrl);

    // Use consistent video ID for caching (same as other Douyin methods)
    const { extractDouyinVideoId } = await import('./douyinDownloader');
    const videoId = extractDouyinVideoId(douyinUrl);

    if (!videoId) {
      throw new Error('Could not extract video ID from Douyin URL');
    }

    // Check if already downloading
    if (downloadQueue[videoId]) {
      console.log('[DouyinPlaywright] Download already in progress for:', videoId);
      return downloadQueue[videoId].promise;
    }

    // Initialize download queue entry first
    downloadQueue[videoId] = {
      status: 'starting',
      progress: 0,
      promise: null, // Will be set after promise creation
      url: douyinUrl
    };

    // Create download promise
    const downloadPromise = new Promise(async (resolve, reject) => {
      try {

        // Get quality setting from localStorage (default to 720p)
        const quality = localStorage.getItem('optimized_resolution') || '720p';
        const useCookies = localStorage.getItem('use_cookies_for_download') === 'true';

        console.log('[DouyinPlaywright] Starting download with settings:', { quality, useCookies });

        // Start the download
        const downloadResponse = await fetch(`${SERVER_URL}/api/download-douyin-playwright`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoId,
            url: douyinUrl,
            quality,
            useCookies
          }),
        });

        if (!downloadResponse.ok) {
          const errorData = await downloadResponse.json();
          throw new Error(errorData.error || 'Failed to start download');
        }

        const result = await downloadResponse.json();
        console.log('[DouyinPlaywright] Download started:', result);

        // Native and yt-dlp strategies may finish before the polling phase.
        if (result.alreadyExists || result.completed) {
          downloadQueue[videoId].status = 'completed';
          downloadQueue[videoId].progress = 100;
          progressCallback(100);
          
          const videoUrl = `${SERVER_URL}${result.path}`;
          downloadQueue[videoId].method = result.method || 'download';
          console.log('[DouyinPlaywright] Download completed:', videoUrl, result.method || 'download');
          resolve(videoUrl);
          return;
        }

        // Start polling for progress
        downloadQueue[videoId].status = 'downloading';
        const pollInterval = setInterval(async () => {
          try {
            const progressResponse = await fetch(`${SERVER_URL}/api/douyin-playwright-progress/${videoId}`);
            
            if (!progressResponse.ok) {
              console.error('[DouyinPlaywright] Failed to get progress');
              return;
            }

            const progressData = await progressResponse.json();
            console.log('[DouyinPlaywright] Progress update:', progressData);

            if (progressData.success) {
              const currentProgress = progressData.progress || 0;
              downloadQueue[videoId].progress = currentProgress;
              progressCallback(currentProgress);

              // Check if download is completed
              if (progressData.completed && progressData.path) {
                clearInterval(pollInterval);
                downloadQueue[videoId].status = 'completed';
                downloadQueue[videoId].progress = 100;
                progressCallback(100);

                const videoUrl = `${SERVER_URL}${progressData.path}`;
                console.log('[DouyinPlaywright] Download completed:', videoUrl);
                resolve(videoUrl);
                return;
              }

              // Check if download failed (no longer active but not completed)
              if (!progressData.isActive && !progressData.completed) {
                clearInterval(pollInterval);
                downloadQueue[videoId].status = 'failed';
                const detail = progressData.error || 'Download failed';
                console.error('[DouyinPlaywright] Download failed - no longer active:', detail);
                reject(new Error(detail));
                return;
              }
            }
          } catch (error) {
            console.error('[DouyinPlaywright] Error polling progress:', error);
          }
        }, 2000); // Poll every 2 seconds

        // Set timeout for download (5 minutes)
        setTimeout(() => {
          if (downloadQueue[videoId]?.status === 'downloading') {
            clearInterval(pollInterval);
            downloadQueue[videoId].status = 'timeout';
            console.error('[DouyinPlaywright] Download timeout');
            reject(new Error('Download timeout'));
          }
        }, 300000); // 5 minutes

      } catch (error) {
        downloadQueue[videoId].status = 'failed';
        console.error('[DouyinPlaywright] Download error:', error);
        reject(error);
      }
    });

    // Set the promise reference after creation
    downloadQueue[videoId].promise = downloadPromise;
    return downloadPromise;

  } catch (error) {
    console.error('[DouyinPlaywright] Error starting download:', error);
    throw error;
  }
};

/**
 * Get available video qualities using Playwright
 * @param {string} douyinUrl - The Douyin video URL
 * @returns {Promise<Array>} - Array of available quality options
 */
export const scanDouyinQualitiesPlaywright = async (douyinUrl) => {
  try {
    const useCookies = localStorage.getItem('use_cookies_for_download') === 'true';

    const response = await fetch(`${SERVER_URL}/api/scan-douyin-playwright-qualities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: douyinUrl,
        useCookies
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to scan qualities');
    }

    const result = await response.json();
    return result.qualities || [];

  } catch (error) {
    console.error('[DouyinPlaywright] Error scanning qualities:', error);
    throw error;
  }
};

/**
 * Cancel an active download
 * @param {string} videoId - The video ID to cancel
 * @returns {Promise<boolean>} - Success status
 */
export const cancelDouyinDownloadPlaywright = async (videoId) => {
  try {
    console.log('[DouyinPlaywright] Cancelling download:', videoId);

    const response = await fetch(`${SERVER_URL}/api/douyin-playwright-cancel/${videoId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[DouyinPlaywright] Failed to cancel download:', errorData.error);
      return false;
    }

    // Clean up local tracking
    if (downloadQueue[videoId]) {
      downloadQueue[videoId].status = 'cancelled';
      delete downloadQueue[videoId];
    }

    console.log('[DouyinPlaywright] Download cancelled successfully');
    return true;

  } catch (error) {
    console.error('[DouyinPlaywright] Error cancelling download:', error);
    return false;
  }
};

/**
 * Get download status
 * @param {string} videoId - The video ID
 * @returns {Object} - Download status information
 */
export const getDownloadStatus = (videoId) => {
  return downloadQueue[videoId] || { status: 'not_found', progress: 0 };
};

/**
 * Get service status
 * @returns {Promise<Object>} - Service status information
 */
export const getPlaywrightServiceStatus = async () => {
  try {
    const response = await fetch(`${SERVER_URL}/api/douyin-playwright-status`);
    
    if (!response.ok) {
      throw new Error('Failed to get service status');
    }

    return await response.json();

  } catch (error) {
    console.error('[DouyinPlaywright] Error getting service status:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Check if a URL is a valid Douyin URL
 * @param {string} url - URL to check
 * @returns {boolean} - Whether the URL is a valid Douyin URL
 */
export const isValidDouyinUrl = (url) => {
  const douyinRegex = /^(https?:\/\/)?(www\.|v\.)?douyin\.com\/(video\/\d+|[a-zA-Z0-9]+\/?)/;
  return douyinRegex.test(url);
};

export default {
  downloadDouyinVideoPlaywright,
  scanDouyinQualitiesPlaywright,
  cancelDouyinDownloadPlaywright,
  getDownloadStatus,
  getPlaywrightServiceStatus,
  isValidDouyinUrl
};
