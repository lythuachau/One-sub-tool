/**
 * Playwright-based Douyin downloader
 * Uses browser automation to extract video URLs and download videos
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { VIDEOS_DIR } = require('../../config');
const { setDownloadProgress } = require('../shared/progressTracker');
const { getFfmpegPath } = require('../shared/ffmpegUtils');
const { validateVideoArtifact } = require('./videoArtifactValidator');
const { resolveDouyinTarget, extractVideoId } = require('./nativeDownloader');

const MEDIA_URL_PATTERN = /(?:douyinvod|video\/tos|mime_type=(?:video|audio)|media-(?:video|audio)|\.(?:mp4|m4a|webm)(?:[?&]|$))/i;
const NAVIGATION_TIMEOUT_MS = 30000;
const LOAD_TIMEOUT_MS = 20000;
const EXTRACTION_TIMEOUT_MS = 90000;
const VIDEO_SELECTOR_TIMEOUT_MS = 15000;

function normalizeExtractedVideoUrl(videoUrl) {
  if (typeof videoUrl !== 'string') return '';

  const normalized = videoUrl
    .trim()
    .replace(/\\(["'])/g, '$1')
    .replace(/[\\]+$/, '');

  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function parseTotalSize(headers) {
  const contentRange = headers['content-range'] || '';
  const rangeMatch = contentRange.match(/\/(\d+)$/);
  if (rangeMatch) return Number(rangeMatch[1]);
  return Number(headers['content-length'] || 0);
}

function classifyMediaUrl(url, contentType = '', resourceType = '') {
  if (contentType.startsWith('audio/') || /media-audio|mime_type=audio|[?&](?:media_)?type=audio/i.test(url)) return 'audio';
  if (contentType.startsWith('video/') || resourceType === 'media' || /media-video|mime_type=video|video\/tos/i.test(url)) return 'video';
  return 'progressive';
}

function mediaScore(candidate) {
  let score = 0;
  if (candidate.contentType.startsWith('video/')) score += 80;
  if (candidate.resourceType === 'media') score += 60;
  if (MEDIA_URL_PATTERN.test(candidate.url)) score += 80;
  if (candidate.kind === 'video') score += 160;
  if (candidate.kind === 'audio') score += 140;
  score += Math.min(100, Math.round(candidate.totalSize / (1024 * 1024)));
  const bitrate = Number(new URL(candidate.url).searchParams.get('br') || 0);
  score += Math.min(100, Math.round(bitrate / 20));
  return score;
}

function createMediaCollector(page, expectedVideoId = '') {
  const candidates = new Map();
  let targetVerified = false;

  page.on('response', response => {
    try {
      const url = normalizeExtractedVideoUrl(response.url());
      if (!url || ![200, 206].includes(response.status())) return;

      const headers = response.headers();
      const contentType = String(headers['content-type'] || '').toLowerCase();
      const resourceType = response.request().resourceType();
      const isMediaContent = contentType.startsWith('video/') || contentType.startsWith('audio/');
      const isMediaResource = resourceType === 'media';
      if (!isMediaContent && !isMediaResource && !MEDIA_URL_PATTERN.test(url)) return;

      const requestHeaders = response.request().headers();
      const referer = String(requestHeaders.referer || headers.referer || '');
      const pageUrl = page.url();
      const identityMatch = Boolean(expectedVideoId) && [url, referer, pageUrl]
        .some(value => String(value).includes(expectedVideoId));
      const candidate = {
        url,
        kind: classifyMediaUrl(url, contentType, resourceType),
        contentType,
        resourceType,
        totalSize: parseTotalSize(headers),
        requestHeaders,
        targetMatched: targetVerified && (identityMatch || extractVideoId(pageUrl) === expectedVideoId)
      };
      candidate.score = mediaScore(candidate);

      const existing = candidates.get(url);
      if (!existing || candidate.score > existing.score || candidate.totalSize > existing.totalSize) {
        candidates.set(url, candidate);
      }
    } catch {
      // Ignore unrelated or malformed network responses.
    }
  });

  return {
    clear() {
      candidates.clear();
    },
    markTargetVerified() {
      targetVerified = true;
    },
    getCandidates() {
      return Array.from(candidates.values()).sort((left, right) => right.score - left.score);
    }
  };
}

function cookieHeader(cookies) {
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

async function closeBrowserSession(session) {
  if (!session) return;
  try {
    await session.page?.close();
  } catch (error) {
    console.warn('[PlaywrightDouyin] Page cleanup warning:', error.message);
  }
  try {
    await session.context?.clearCookies();
  } catch (error) {
    console.warn('[PlaywrightDouyin] Cookie cleanup warning:', error.message);
  }
  try {
    await session.context?.close();
  } catch (error) {
    console.warn('[PlaywrightDouyin] Context cleanup warning:', error.message);
  }
  try {
    await session.browser?.close();
  } catch (error) {
    console.warn('[PlaywrightDouyin] Browser cleanup warning:', error.message);
  }
  console.log('[PlaywrightDouyin] Ephemeral Chromium session closed; cache and cookies discarded');
}

/**
 */
async function getBrowserInstance({ headless = true } = {}) {
  console.log(`[PlaywrightDouyin] Launching ephemeral Chromium session (${headless ? 'headless' : 'interactive'})...`);
  const browser = await chromium.launch({
    headless,
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

function createVerificationError(message) {
  const error = new Error(message);
  error.code = 'DOUYIN_VERIFICATION_REQUIRED';
  return error;
}

async function isVerificationPage(page) {
  const currentUrl = page.url();
  if (/captcha|verify|passport|login/i.test(currentUrl)) return true;
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    return /验证码|安全验证|完成验证|登录后观看|扫码登录|captcha|verify/i.test(text);
  }).catch(() => false);
}

async function waitForTargetPage(page, expectedVideoId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (extractVideoId(page.url()) === expectedVideoId) return;
    await page.waitForTimeout(1000);
  }
  throw createVerificationError(`Douyin verification did not reach target video ${expectedVideoId}`);
}

async function extractVideoInfo(douyinUrl, useCookies = false, keepSession = false, options = {}) {
  const expectedVideoId = String(options.expectedVideoId || '');
  const interactiveVerification = Boolean(options.interactiveVerification);
  const headless = options.headless !== false;
  const { browser, context } = await getBrowserInstance({ headless });
  const page = await context.newPage();
  const mediaCollector = createMediaCollector(page, expectedVideoId);
  let retainSession = false;
  const maximumExtractionTime = headless ? EXTRACTION_TIMEOUT_MS : 180000;
  const extractionTimeout = setTimeout(() => page.close().catch(() => {}), maximumExtractionTime);

  try {
    console.log('[PlaywrightDouyin] Navigating to target:', { douyinUrl, expectedVideoId, headless });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    let navigationResponse;
    try {
      navigationResponse = await page.goto(douyinUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS
      });
    } catch (navigationError) {
      if (extractVideoId(page.url()) !== expectedVideoId) {
        try {
          navigationResponse = await page.goto(douyinUrl, {
            waitUntil: 'commit',
            timeout: LOAD_TIMEOUT_MS
          });
        } catch (fallbackError) {
          if (extractVideoId(page.url()) !== expectedVideoId) throw fallbackError;
        }
      } else {
        console.log(`[PlaywrightDouyin] Navigation event timed out after target ${expectedVideoId} was reached; continuing extraction`);
      }
    }

    if (navigationResponse && navigationResponse.status() >= 400) {
      throw new Error(`Douyin page returned HTTP ${navigationResponse.status()}`);
    }

    await page.waitForTimeout(2500);
    const requiresVerification = await isVerificationPage(page);
    if (requiresVerification || extractVideoId(page.url()) !== expectedVideoId) {
      if (!interactiveVerification || headless) {
        throw createVerificationError(`Douyin verification is required for target video ${expectedVideoId}`);
      }
      console.log(`[PlaywrightDouyin] Waiting for interactive verification of ${expectedVideoId}`);
      await waitForTargetPage(page, expectedVideoId);
    }

    const resolvedVideoId = extractVideoId(page.url());
    if (!resolvedVideoId || resolvedVideoId !== expectedVideoId) {
      throw new Error(`Douyin target mismatch: expected ${expectedVideoId}, got ${resolvedVideoId || 'unknown'}`);
    }

    mediaCollector.clear();
    mediaCollector.markTargetVerified();
    await page.waitForSelector('video', { state: 'attached', timeout: VIDEO_SELECTOR_TIMEOUT_MS });
    const videoInfo = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video'));
      const video = videos
        .map(candidate => ({ candidate, bounds: candidate.getBoundingClientRect() }))
        .filter(item => item.bounds.width > 0 && item.bounds.height > 0)
        .sort((left, right) => (right.bounds.width * right.bounds.height) - (left.bounds.width * left.bounds.height))[0]?.candidate;
      if (!video) throw new Error('Target video element not found');

      video.muted = true;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});

      const sources = Array.from(video.querySelectorAll('source')).map(source => ({
        src: source.src,
        type: source.type || 'video/mp4'
      }));
      if (sources.length === 0 && video.src) sources.push({ src: video.src, type: 'video/mp4' });
      const bounds = video.getBoundingClientRect();
      return {
        title: (document.title || 'Douyin Video').trim(),
        currentSrc: video.currentSrc || video.src,
        sources,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        videoWidth: video.videoWidth || Math.round(bounds.width) || 720,
        videoHeight: video.videoHeight || Math.round(bounds.height) || 1280
      };
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (mediaCollector.getCandidates().some(candidate => candidate.targetMatched && candidate.kind !== 'audio')) break;
      await page.waitForTimeout(1000);
    }

    const usesBlobSource = String(videoInfo.currentSrc || '').startsWith('blob:');
    videoInfo.currentSrc = normalizeExtractedVideoUrl(videoInfo.currentSrc);
    videoInfo.sources = videoInfo.sources
      .map(source => ({ ...source, src: normalizeExtractedVideoUrl(source.src) }))
      .filter(source => source.src);
    videoInfo.mediaCandidates = mediaCollector.getCandidates().filter(candidate => candidate.targetMatched);
    videoInfo.videoId = resolvedVideoId;
    videoInfo.resolvedSourceUrl = page.url();
    videoInfo.targetVerified = true;
    videoInfo.usesBlobSource = usesBlobSource;

    if (!videoInfo.currentSrc) {
      videoInfo.currentSrc = videoInfo.mediaCandidates.find(candidate => candidate.kind !== 'audio')?.url || '';
    }
    if (!videoInfo.currentSrc && videoInfo.mediaCandidates.length === 0) {
      throw new Error('No downloadable media belonging to the verified Douyin target was captured');
    }

    console.log('[PlaywrightDouyin] Target extraction completed:', {
      requestedVideoId: expectedVideoId,
      resolvedVideoId,
      resolvedSourceUrl: videoInfo.resolvedSourceUrl,
      matchedCandidates: videoInfo.mediaCandidates.length,
      usesBlobSource
    });

    if (keepSession) {
      retainSession = true;
      videoInfo.session = { browser, context, page };
    }
    return videoInfo;
  } catch (error) {
    console.error('[PlaywrightDouyin] Target extraction failed:', {
      requestedVideoId: expectedVideoId,
      pageUrl: page.isClosed() ? 'closed' : page.url(),
      code: error.code || 'EXTRACTION_FAILED',
      error: error.message
    });
    throw error;
  } finally {
    clearTimeout(extractionTimeout);
    if (!retainSession) await closeBrowserSession({ browser, context, page });
  }
}

/**
 * Download video from extracted URL
 * @param {string} videoUrl - Direct video URL
 * @param {string} outputPath - Output file path
 * @param {string} videoId - Video ID for progress tracking
 * @returns {Promise<string>} - Path to downloaded file
 */
async function downloadVideoFromUrl(videoUrl, outputPath, videoId, options = {}) {
  return new Promise((resolve, reject) => {
    const normalizedVideoUrl = normalizeExtractedVideoUrl(videoUrl);
    if (!normalizedVideoUrl) {
      reject(new Error('Extracted media URL is missing or uses an unsupported blob: protocol'));
      return;
    }

    console.log('[PlaywrightDouyin] Starting download from:', normalizedVideoUrl);

    const temporaryPath = `${outputPath}.part`;
    const protocol = normalizedVideoUrl.startsWith('https:') ? https : http;
    const capturedHeaders = options.headers || {};
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      Referer: 'https://www.douyin.com/',
      Accept: '*/*',
    };
    for (const key of ['user-agent', 'referer', 'accept', 'accept-language', 'origin']) {
      const value = capturedHeaders[key] || capturedHeaders[key[0].toUpperCase() + key.slice(1)];
      if (value) headers[key] = value;
    }
    headers['Accept-Encoding'] = 'identity';
    if (options.cookieHeader) headers.Cookie = options.cookieHeader;
    delete headers.host;
    delete headers['content-length'];
    delete headers.range;
    delete headers.Range;

    fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    const request = protocol.get(normalizedVideoUrl, {
      headers
    }, (response) => {
      if (![200, 206].includes(response.statusCode)) {
        response.resume();
        reject(new Error(`Media HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const totalSize = parseTotalSize(response.headers);
      let downloadedSize = 0;

      response.on('data', chunk => {
        downloadedSize += chunk.length;
        if (totalSize > 0) {
          const progress = Math.min(99, Math.round((downloadedSize / totalSize) * 100));
          setDownloadProgress(videoId, progress);
        }
      });

      pipeline(response, fs.createWriteStream(temporaryPath))
        .then(async () => {
          const stats = await fs.promises.stat(temporaryPath);
          if (stats.size < 1024) throw new Error(`Downloaded media is too small (${stats.size} bytes)`);
          await fs.promises.rm(outputPath, { force: true });
          await fs.promises.rename(temporaryPath, outputPath);
          setDownloadProgress(videoId, 100);
          console.log('[PlaywrightDouyin] Download completed:', outputPath);
          resolve(outputPath);
        })
        .catch(async error => {
          await fs.promises.rm(temporaryPath, { force: true });
          reject(error);
        });
    });

    request.on('error', (error) => {
      fs.promises.rm(temporaryPath, { force: true }).finally(() => reject(error));
    });

    request.setTimeout(60000, () => {
      request.destroy();
      fs.promises.rm(temporaryPath, { force: true }).finally(() => reject(new Error('Media download timeout')));
    });
  });
}

function mergeMediaFiles(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    const temporaryPath = `${outputPath}.merge.part.mp4`;
    const ffmpeg = spawn(getFfmpegPath(), [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-i', audioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c', 'copy',
      '-shortest',
      temporaryPath
    ], { windowsHide: true });
    let stderr = '';
    ffmpeg.stderr.on('data', chunk => { stderr += chunk.toString(); });
    ffmpeg.on('error', async error => {
      await fs.promises.rm(temporaryPath, { force: true });
      reject(error);
    });
    ffmpeg.on('close', async code => {
      if (code !== 0) {
        await fs.promises.rm(temporaryPath, { force: true });
        reject(new Error(`FFmpeg media merge failed: ${stderr.trim() || `exit code ${code}`}`));
        return;
      }
      try {
        await fs.promises.rm(outputPath, { force: true });
        await fs.promises.rename(temporaryPath, outputPath);
        resolve(outputPath);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Main download function
 * @param {string} douyinUrl - Douyin video URL
 * @param {string} videoId - Video ID for tracking
 * @param {string} quality - Quality setting (for future use)
 * @param {boolean} useCookies - Whether to use browser cookies
 * @returns {Promise<Object>} - Download result and verified source identity
 */
async function downloadDouyinVideo(douyinUrl, videoId, quality = '720p', useCookies = false, options = {}) {
  let session;
  const temporaryFiles = [];
  try {
    const target = await resolveDouyinTarget(douyinUrl);
    console.log('[PlaywrightDouyin] Resolved requested target:', {
      requestedVideoId: videoId,
      resolvedVideoId: target.videoId,
      requestedUrl: douyinUrl,
      resolvedUrl: target.resolvedUrl
    });
    
    // Ensure videos directory exists
    if (!fs.existsSync(VIDEOS_DIR)) {
      fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    }
    
    setDownloadProgress(videoId, 10);

    let videoInfo;
    try {
      videoInfo = await extractVideoInfo(target.resolvedUrl, useCookies, true, {
        expectedVideoId: target.videoId,
        headless: true
      });
    } catch (error) {
      if (!options.interactiveVerification) throw error;
      console.warn(`[PlaywrightDouyin] Headless extraction failed; opening ephemeral interactive Chromium: ${error.message}`);
      videoInfo = await extractVideoInfo(target.resolvedUrl, useCookies, true, {
        expectedVideoId: target.videoId,
        interactiveVerification: true,
        headless: false
      });
    }
    session = videoInfo.session;
    setDownloadProgress(videoId, 30);

    const cookieHeaderValue = cookieHeader(await session.context.cookies());
    const candidates = videoInfo.mediaCandidates || [];
    const videoCandidate = candidates.find(candidate => candidate.kind === 'video')
      || candidates.find(candidate => candidate.kind === 'progressive')
      || (videoInfo.sources[0]?.src ? { url: videoInfo.sources[0].src, requestHeaders: {} } : null)
      || (videoInfo.currentSrc ? { url: videoInfo.currentSrc, requestHeaders: {} } : null);
    const audioCandidate = candidates.find(candidate => candidate.kind === 'audio');

    if (!videoCandidate?.url) {
      throw new Error(videoInfo.usesBlobSource
        ? 'Douyin exposed a blob media URL but no downloadable HTTP media response was captured'
        : 'No downloadable Douyin media URL was found');
    }

    setDownloadProgress(videoId, 40);

    // Generate output filename
    const sanitizedTitle = videoInfo.title.replace(/[^\w\s-]/g, '').substring(0, 50);
    const filename = `${videoId}_${sanitizedTitle || 'douyin_video'}.mp4`;
    const outputPath = path.join(VIDEOS_DIR, filename);

    if (!audioCandidate || audioCandidate.url === videoCandidate.url) {
      await downloadVideoFromUrl(videoCandidate.url, outputPath, videoId, {
        headers: videoCandidate.requestHeaders,
        cookieHeader: cookieHeaderValue
      });
    } else {
      const videoPath = `${outputPath}.video.part`;
      const audioPath = `${outputPath}.audio.part`;
      temporaryFiles.push(videoPath, audioPath);
      await downloadVideoFromUrl(videoCandidate.url, videoPath, videoId, {
        headers: videoCandidate.requestHeaders,
        cookieHeader: cookieHeaderValue
      });
      setDownloadProgress(videoId, 72);
      await downloadVideoFromUrl(audioCandidate.url, audioPath, videoId, {
        headers: audioCandidate.requestHeaders,
        cookieHeader: cookieHeaderValue
      });
      setDownloadProgress(videoId, 88);
      await mergeMediaFiles(videoPath, audioPath, outputPath);
    }

    const validation = await validateVideoArtifact(outputPath);
    if (!validation.valid) {
      await fs.promises.rename(outputPath, `${outputPath}.invalid-${Date.now()}`).catch(() => {});
      throw new Error(`Playwright produced an invalid video: ${validation.reason}`);
    }
    
    console.log('[PlaywrightDouyin] Download completed successfully:', {
      filename,
      requestedVideoId: videoId,
      resolvedVideoId: videoInfo.videoId
    });
    return {
      path: outputPath,
      filename,
      method: 'playwright',
      resolvedVideoId: videoInfo.videoId,
      resolvedSourceUrl: videoInfo.resolvedSourceUrl,
      title: videoInfo.title
    };
    
  } catch (error) {
    console.error('[PlaywrightDouyin] Download failed:', error);
    throw error;
  } finally {
    await Promise.all(temporaryFiles.map(file => fs.promises.rm(file, { force: true }).catch(() => {})));
    await closeBrowserSession(session);
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
    const target = await resolveDouyinTarget(douyinUrl);
    const videoInfo = await extractVideoInfo(target.resolvedUrl, useCookies, false, {
      expectedVideoId: target.videoId,
      headless: true
    });



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
