const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { chromium } = require('playwright');
const { VIDEOS_DIR } = require('../../config');
const { pythonExecutable } = require('../../utils/pythonRuntime');
const { setDownloadProgress } = require('../shared/progressTracker');
const { resolveDouyinTarget } = require('./nativeDownloader');

const RESOLVER_SCRIPT = path.join(__dirname, 'evil_vendor', 'resolver.py');
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const RESOLVER_TIMEOUT_MS = 45000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const safeTitle = value => String(value || 'douyin_video')
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 60) || 'douyin_video';

function runResolver(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, [RESOLVER_SCRIPT], {
      cwd: path.dirname(RESOLVER_SCRIPT),
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Evil resolver timed out after ${RESOLVER_TIMEOUT_MS}ms`));
    }, RESOLVER_TIMEOUT_MS);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => finish(reject, error));
    child.on('close', code => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      let payload = null;
      try {
        payload = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
      } catch {
        payload = null;
      }
      if (code === 0 && payload && !payload.error) {
        finish(resolve, payload);
        return;
      }
      const detail = payload?.error || stderr.trim() || `exit code ${code}`;
      finish(reject, new Error(detail.slice(0, 700)));
    });
    child.stdin.end(JSON.stringify(input));
  });
}

async function captureEphemeralIdentity(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: DEFAULT_USER_AGENT });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(700);
    const cookies = await context.cookies('https://www.douyin.com');
    return {
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => DEFAULT_USER_AGENT),
      cookies: Object.fromEntries(cookies.map(cookie => [cookie.name, cookie.value]))
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function resolveWithEvilApi(url, videoId) {
  let canonicalUrl = url;
  let canonicalVideoId = String(videoId || '');
  if (!/^\d+$/.test(canonicalVideoId)) {
    const target = await resolveDouyinTarget(url);
    canonicalUrl = target.resolvedUrl;
    canonicalVideoId = String(target.videoId);
  }

  let identity = { userAgent: DEFAULT_USER_AGENT, cookies: {} };
  if (process.env.DOUYIN_EVIL_CAPTURE_COOKIES !== 'false') {
    identity = await captureEphemeralIdentity(canonicalUrl).catch(error => {
      console.warn(`[DOUYIN-EVIL] Ephemeral identity unavailable: ${error.message}`);
      return identity;
    });
  }
  return runResolver({ url: canonicalUrl, videoId: canonicalVideoId, ...identity });
}

async function downloadMedia(mediaUrl, outputPath, videoId, cookies = {}) {
  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
    Referer: 'https://www.douyin.com/',
    Accept: '*/*'
  };
  const cookieHeader = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ');
  if (cookieHeader) headers.Cookie = cookieHeader;
  const response = await fetch(mediaUrl, { headers, redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Douyin media HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_DOWNLOAD_BYTES) throw new Error('Douyin video exceeds the download size limit');
  const tempPath = `${outputPath}.evil.tmp`;
  await fs.promises.rm(tempPath, { force: true });
  let received = 0;
  const source = Readable.fromWeb(response.body).on('data', chunk => {
    received += chunk.length;
    if (received > MAX_DOWNLOAD_BYTES) source.destroy(new Error('Douyin video exceeds the download size limit'));
    if (contentLength > 0) setDownloadProgress(videoId, 45 + Math.min(50, Math.round((received / contentLength) * 50)));
  });
  try {
    await pipeline(source, fs.createWriteStream(tempPath));
    const stats = await fs.promises.stat(tempPath);
    if (stats.size < 100 * 1024) throw new Error(`Douyin video is too small (${stats.size} bytes)`);
    await fs.promises.rename(tempPath, outputPath);
    setDownloadProgress(videoId, 100);
    return stats.size;
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true });
    throw error;
  }
}

async function downloadDouyinWithEvilApi(url, requestedVideoId) {
  const resolved = await resolveWithEvilApi(url, requestedVideoId);
  const canonicalVideoId = String(resolved.videoId || requestedVideoId || '');
  const filename = `${canonicalVideoId}_${safeTitle(resolved.title)}.mp4`;
  const outputPath = path.join(VIDEOS_DIR, filename);
  setDownloadProgress(canonicalVideoId, 45);
  const streams = (resolved.streams || []).filter(item => item && item.watermark === false && item.url);
  if (!streams.length) throw new Error('Evil resolver returned no clean video stream');
  let size;
  let lastError;
  for (const stream of streams) {
    const urls = [stream.url, ...(stream.urls || [])].filter((value, index, values) => value && values.indexOf(value) === index);
    for (const mediaUrl of urls) {
      try {
        size = await downloadMedia(mediaUrl, outputPath, canonicalVideoId);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (size) break;
  }
  if (!size) throw lastError || new Error('Evil resolver media mirrors are unavailable');
  return {
    success: true,
    path: outputPath,
    filename,
    method: 'douyin-tiktok-download-api',
    resolvedVideoId: resolved.videoId,
    resolvedSourceUrl: resolved.canonicalUrl,
    title: resolved.title,
    size
  };
}

module.exports = { downloadDouyinWithEvilApi, resolveWithEvilApi };
