/**
 * Playwright-based Douyin downloader
 * Uses browser automation to extract video URLs and download videos
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { VIDEOS_DIR } = require('../../config');
const { setDownloadProgress } = require('../shared/progressTracker');

function normalizeExtractedVideoUrl(videoUrl) {
  if (typeof videoUrl !== 'string') return '';

  const normalized = videoUrl
    .trim()
    .replace(/\\(["'])/g, '$1')
    .replace(/[\\]+$/, '');

  try {
    return new URL(normalized).toString();
  } catch {
    return '';
  }
}

/**
 */
async function getBrowserInstance() {
  console.log('[PlaywrightDouyin] Launching ephemeral Chromium session...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor'
    ]
  });

  // A non-persistent context keeps cookies, cache and storage in memory only.
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    serviceWorkers: 'block',
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    }
  });

  return { browser, context };
}

/**
 * Extract video information from Douyin URL
 * @param {string} douyinUrl - The Douyin video URL
 * @param {boolean} useCookies - Whether to use browser cookies (for future implementation)
 * @returns {Promise<Object>} - Video information including download URLs
 */
async function extractVideoInfo(douyinUrl, useCookies = false) {
  const { browser, context } = await getBrowserInstance();
  const page = await context.newPage();
  
  try {
    console.log('[PlaywrightDouyin] Navigating to:', douyinUrl);

    // Set additional page properties to avoid detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    // Navigate to the Douyin URL with multiple fallback strategies
    try {
      await page.goto(douyinUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
    } catch (timeoutError) {
      console.log('[PlaywrightDouyin] First navigation attempt timed out, trying with load event...');
      await page.goto(douyinUrl, {
        waitUntil: 'load',
        timeout: 45000
      });
    }

    // Wait for the page to load and close any login panels
    await page.waitForTimeout(5000);
    
    // Try to close login panel if it exists
    try {
      const loginPanel = page.locator('#douyin_login_comp_tab_panel');
      if (await loginPanel.isVisible()) {
        console.log('[PlaywrightDouyin] Closing login panel...');
        await loginPanel.getByRole('img').nth(1).click();
        await page.waitForTimeout(1000);
      }
    } catch (error) {
      console.log('[PlaywrightDouyin] No login panel to close or failed to close:', error.message);
    }
    
    // Wait for page content to load with multiple strategies
    let videoFound = false;
    const videoSelectors = [
      'video',
      '[data-e2e="feed-video"] video',
      '.video-player video',
      'video[src]',
      'video source'
    ];

    // Try different video selectors
    for (const selector of videoSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 8000 });
        videoFound = true;
        break;
      } catch (error) {
        // Continue to next selector
      }
    }

    if (!videoFound) {
      // Check if page loaded at all
      const pageContent = await page.content();
      if (!pageContent.includes('video') && !pageContent.includes('mp4')) {
        throw new Error('No video content found on page');
      }
    }

    // Wait for video metadata to load (with fallback)
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video && (video.videoWidth > 0 || video.duration > 0 || video.src);
    }, { timeout: 8000 }).catch(() => {
      // Proceed with available data
    });

    // Extract video information with fallbacks
    const videoInfo = await page.evaluate(() => {
      // Try multiple ways to find video elements
      let videos = document.querySelectorAll('video');
      if (videos.length === 0) {
        // Try more specific selectors
        videos = document.querySelectorAll('[data-e2e="feed-video"] video, .video-player video');
      }

      if (videos.length === 0) {
        // Look for video URLs in the page
        const pageText = document.documentElement.innerHTML;
        const mp4Matches = pageText.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/g);

        if (mp4Matches && mp4Matches.length > 0) {
          return {
            title: (document.title || 'Douyin Video').replace(/[^\w\s-]/g, '').trim(),
            videoId: window.location.pathname.split('/').pop() || Date.now().toString(),
            currentSrc: mp4Matches[0],
            sources: mp4Matches.map(url => ({ src: url, type: 'video/mp4' })),
            duration: 0,
            videoWidth: 720,  // Default dimensions
            videoHeight: 1280,
            sourcesCount: mp4Matches.length
          };
        }

        throw new Error('No video elements or sources found');
      }

      const video = videos[0];
      const sources = Array.from(video.querySelectorAll('source')).map(source => ({
        src: source.src,
        type: source.type || 'video/mp4'
      }));

      // If no sources in video element, check video.src
      if (sources.length === 0 && video.src) {
        sources.push({ src: video.src, type: 'video/mp4' });
      }

      // Get video metadata with fallbacks
      const title = document.title || 'Douyin Video';
      const videoId = window.location.pathname.split('/').pop() || Date.now().toString();

      // Get dimensions with fallbacks
      let videoWidth = video.videoWidth || 0;
      let videoHeight = video.videoHeight || 0;

      // If dimensions not available, try to get from CSS or attributes
      if (videoWidth === 0 || videoHeight === 0) {
        const computedStyle = window.getComputedStyle(video);
        videoWidth = parseInt(computedStyle.width) || 720;
        videoHeight = parseInt(computedStyle.height) || 1280;
      }

      return {
        title: title.replace(/[^\w\s-]/g, '').trim(),
        videoId,
        currentSrc: video.currentSrc || video.src,
        sources,
        duration: video.duration || 0,
        videoWidth,
        videoHeight,
        sourcesCount: sources.length
      };
    });
    
    videoInfo.currentSrc = normalizeExtractedVideoUrl(videoInfo.currentSrc);
    videoInfo.sources = videoInfo.sources
      .map(source => ({ ...source, src: normalizeExtractedVideoUrl(source.src) }))
      .filter(source => source.src);

    console.log('[PlaywrightDouyin] Extracted video info:', {
      title: videoInfo.title,
      videoId: videoInfo.videoId,
      sourcesCount: videoInfo.sources.length,
      duration: videoInfo.duration
    });
    
    return videoInfo;
    
  } catch (error) {
    console.error('[PlaywrightDouyin] Error extracting video info:', error);
    throw error;
  } finally {
    try {
      await page.close();
    } catch (closeError) {
      console.warn('[PlaywrightDouyin] Page cleanup warning:', closeError.message);
    }
    try {
      await context.clearCookies();
    } catch (clearError) {
      console.warn('[PlaywrightDouyin] Cookie cleanup warning:', clearError.message);
    }
    try {
      await context.close();
    } finally {
      await browser.close();
    }
    console.log('[PlaywrightDouyin] Ephemeral Chromium session closed; cache and cookies discarded');
  }
}

/**
 * Download video from extracted URL
 * @param {string} videoUrl - Direct video URL
 * @param {string} outputPath - Output file path
 * @param {string} videoId - Video ID for progress tracking
 * @returns {Promise<string>} - Path to downloaded file
 */
async function downloadVideoFromUrl(videoUrl, outputPath, videoId) {
  return new Promise((resolve, reject) => {
    const normalizedVideoUrl = normalizeExtractedVideoUrl(videoUrl);
    if (!normalizedVideoUrl) {
      reject(new Error('Extracted video URL is invalid'));
      return;
    }

    console.log('[PlaywrightDouyin] Starting download from:', normalizedVideoUrl);
    
    const protocol = normalizedVideoUrl.startsWith('https:') ? https : http;
    const file = fs.createWriteStream(outputPath);
    
    const request = protocol.get(normalizedVideoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        'Referer': 'https://www.douyin.com/',
        'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        file.write(chunk);
        
        if (totalSize > 0) {
          const progress = Math.round((downloadedSize / totalSize) * 100);
          setDownloadProgress(videoId, progress);
        }
      });
      
      response.on('end', () => {
        file.end();
        setDownloadProgress(videoId, 100);
        console.log('[PlaywrightDouyin] Download completed:', outputPath);
        resolve(outputPath);
      });
      
      response.on('error', (error) => {
        file.destroy();
        fs.unlink(outputPath, () => {}); // Clean up partial file
        reject(error);
      });
    });
    
    request.on('error', (error) => {
      file.destroy();
      fs.unlink(outputPath, () => {}); // Clean up partial file
      reject(error);
    });
    
    request.setTimeout(60000, () => {
      request.destroy();
      file.destroy();
      fs.unlink(outputPath, () => {}); // Clean up partial file
      reject(new Error('Download timeout'));
    });
  });
}

/**
 * Main download function
 * @param {string} douyinUrl - Douyin video URL
 * @param {string} videoId - Video ID for tracking
 * @param {string} quality - Quality setting (for future use)
 * @param {boolean} useCookies - Whether to use browser cookies
 * @returns {Promise<string>} - Path to downloaded video
 */
async function downloadDouyinVideo(douyinUrl, videoId, quality = '720p', useCookies = false) {
  try {
    console.log('[PlaywrightDouyin] Starting download process for:', douyinUrl);
    
    // Ensure videos directory exists
    if (!fs.existsSync(VIDEOS_DIR)) {
      fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    }
    
    setDownloadProgress(videoId, 10);

    // Extract video information
    const videoInfo = await extractVideoInfo(douyinUrl, useCookies);
    setDownloadProgress(videoId, 30);
    
    // Choose the best available video URL
    let videoUrl = videoInfo.currentSrc;
    if (videoInfo.sources.length > 0) {
      // Prefer the first source URL as it's usually the highest quality
      videoUrl = videoInfo.sources[0].src;
    }
    
    if (!videoUrl) {
      throw new Error('No video URL found');
    }
    
    setDownloadProgress(videoId, 40);
    
    // Generate output filename
    const sanitizedTitle = videoInfo.title.replace(/[^\w\s-]/g, '').substring(0, 50);
    const filename = `${videoId}_${sanitizedTitle || 'douyin_video'}.mp4`;
    const outputPath = path.join(VIDEOS_DIR, filename);
    
    // Download the video
    await downloadVideoFromUrl(videoUrl, outputPath, videoId);
    
    console.log('[PlaywrightDouyin] Download completed successfully:', filename);
    return outputPath;
    
  } catch (error) {
    console.error('[PlaywrightDouyin] Download failed:', error);
    throw error;
  }
}

/**
 * Get available video qualities (for compatibility with quality scanner)
 * @param {string} douyinUrl - Douyin video URL
 * @param {boolean} useCookies - Whether to use browser cookies
 * @returns {Promise<Array>} - Array of available qualities
 */
async function getAvailableQualities(douyinUrl, useCookies = false) {
  try {
    const videoInfo = await extractVideoInfo(douyinUrl, useCookies);



    const qualities = [];

    // Determine quality based on video dimensions
    const height = videoInfo.videoHeight || 720;
    const width = videoInfo.videoWidth || 1280;

    // Add quality options based on actual video dimensions
    if (height >= 1080) {
      qualities.push({
        quality: '1080p',
        height: 1080,
        width: Math.round(width * (1080 / height)),
        format: 'mp4',
        label: '1080p HD'
      });
    }

    if (height >= 720) {
      qualities.push({
        quality: '720p',
        height: 720,
        width: Math.round(width * (720 / height)),
        format: 'mp4',
        label: '720p HD'
      });
    }

    if (height >= 480) {
      qualities.push({
        quality: '480p',
        height: 480,
        width: Math.round(width * (480 / height)),
        format: 'mp4',
        label: '480p'
      });
    }

    // Always include the original quality
    qualities.push({
      quality: 'original',
      height: height,
      width: width,
      format: 'mp4',
      label: `${height}p Original`
    });

    // If no standard qualities were added, add a default
    if (qualities.length === 1) {
      qualities.unshift({
        quality: 'default',
        height: height,
        width: width,
        format: 'mp4',
        label: `${height}p`
      });
    }


    return qualities;

  } catch (error) {
    console.error('[PlaywrightDouyin] Error getting qualities:', error);
    // Return a default quality if extraction fails
    return [{
      quality: 'default',
      height: 720,
      width: 1280,
      format: 'mp4',
      label: '720p Default'
    }];
  }
}

/**
 * Cleanup browser resources
 */
async function cleanup() {
  // Browser sessions are scoped to extractVideoInfo and closed immediately.
}

// Cleanup on process exit
process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

module.exports = {
  downloadDouyinVideo,
  extractVideoInfo,
  getAvailableQualities,
  cleanup
};
