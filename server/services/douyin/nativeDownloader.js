const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { VIDEOS_DIR } = require('../../config');
const { setDownloadProgress } = require('../shared/progressTracker');

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const MAX_NATIVE_BYTES = 200 * 1024 * 1024;

const requestHeaders = {
  'User-Agent': USER_AGENT,
  Referer: 'https://www.douyin.com/',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

const mediaHeaders = {
  'User-Agent': USER_AGENT,
  Referer: 'https://www.douyin.com/',
  Accept: '*/*'
};

function unescapeUrl(value) {
  return value
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
}

function preferNoWatermark(url) {
  return url.replace('/playwm/', '/play/');
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    const pathMatch = parsed.pathname.match(/\/video\/(\d+)/);
    if (pathMatch) return pathMatch[1];
    const modalId = parsed.searchParams.get('modal_id');
    return /^\d+$/.test(modalId || '') ? modalId : null;
  } catch {
    return null;
  }
}

async function expandShortLink(url) {
  const response = await fetch(url, {
    headers: requestHeaders,
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`Douyin short link HTTP ${response.status}`);
  return response.url || url;
}

async function resolveDouyinTarget(inputUrl) {
  const resolvedUrl = /v\.douyin\.com/i.test(inputUrl)
    ? await expandShortLink(inputUrl)
    : inputUrl;
  const videoId = extractVideoId(resolvedUrl) || extractVideoId(inputUrl);

  if (!videoId) {
    throw new Error('Douyin redirect did not resolve to a video page');
  }

  return { inputUrl, resolvedUrl, videoId };
}

function parseRouterData(html) {
  const match = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!match?.[1]) throw new Error('Douyin share page missing _ROUTER_DATA');
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error('Douyin share page contains invalid metadata');
  }
}

function findTargetItem(node, videoId) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (getItemVideoId(item) === videoId) return item;
      const found = findTargetItem(item, videoId);
      if (found) return found;
    }
    return null;
  }

  if (getItemVideoId(node) === videoId && node.video) return node;

  for (const value of Object.values(node)) {
    const found = findTargetItem(value, videoId);
    if (found) return found;
  }
  return null;
}

function getItemVideoId(item) {
  return String(item?.aweme_id || item?.awemeId || item?.item_id || item?.id || '');
}

function pickPlayUrl(item) {
  const video = item?.video;
  if (!video || typeof video !== 'object') return null;

  const candidates = [video.play_addr, video.play_addr_h264, video.download_addr, video.playAddr];
  if (Array.isArray(video.bit_rate)) {
    for (const bitRate of video.bit_rate) {
      if (bitRate && typeof bitRate === 'object') candidates.push(bitRate.play_addr);
    }
  }

  for (const candidate of candidates) {
    const urls = candidate && typeof candidate === 'object' ? candidate.url_list : null;
    if (!Array.isArray(urls)) continue;
    const url = urls.find(value => typeof value === 'string' && value.startsWith('http'));
    if (url) return preferNoWatermark(unescapeUrl(url));
  }
  return null;
}

function safeTitle(value) {
  return String(value || 'douyin_video')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'douyin_video';
}

async function resolveDouyinMedia(inputUrl) {
  const target = await resolveDouyinTarget(inputUrl);
  const { videoId } = target;

  const shareUrl = `https://www.iesdouyin.com/share/video/${videoId}/`;
  const response = await fetch(shareUrl, {
    headers: { ...requestHeaders, Referer: 'https://www.douyin.com/' },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`Douyin share page HTTP ${response.status}`);

  const router = parseRouterData(await response.text());
  const item = findTargetItem(router, videoId);
  if (!item) throw new Error('Douyin video metadata not found (private or deleted?)');

  const mediaUrl = pickPlayUrl(item);
  if (!mediaUrl) throw new Error('Douyin play address not found');

  return {
    videoId,
    resolvedUrl: target.resolvedUrl,
    mediaUrl,
    title: typeof item.desc === 'string' ? item.desc : ''
  };
}

async function fetchMediaResponse(mediaUrl) {
  let response = await fetch(preferNoWatermark(mediaUrl), {
    headers: mediaHeaders,
    redirect: 'follow'
  });

  if (!response.ok && mediaUrl.includes('/play/')) {
    response = await fetch(mediaUrl.replace('/play/', '/playwm/'), {
      headers: mediaHeaders,
      redirect: 'follow'
    });
  }

  if (!response.ok || !response.body) {
    throw new Error(`Douyin media HTTP ${response.status}`);
  }
  return response;
}

async function downloadDouyinNative(url, requestedVideoId) {
  const resolved = await resolveDouyinMedia(url);
  const videoId = requestedVideoId || resolved.videoId;
  const filename = `${videoId}_${safeTitle(resolved.title)}.mp4`;
  const outputPath = path.join(VIDEOS_DIR, filename);
  const tempPath = `${outputPath}.native.tmp`;
  const response = await fetchMediaResponse(resolved.mediaUrl);
  const contentLength = Number(response.headers.get('content-length') || 0);

  if (contentLength > MAX_NATIVE_BYTES) throw new Error('Douyin video exceeds the native download size limit');

  setDownloadProgress(videoId, 45);
  let received = 0;
  const progressStream = new Readable({
    read() {}
  });
  const reader = response.body.getReader();
  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_NATIVE_BYTES) throw new Error('Douyin video exceeds the native download size limit');
        progressStream.push(Buffer.from(value));
        if (contentLength > 0) setDownloadProgress(videoId, 45 + Math.min(50, Math.round((received / contentLength) * 50)));
      }
      progressStream.push(null);
    } catch (error) {
      progressStream.destroy(error);
    }
  };

  await fs.promises.rm(tempPath, { force: true });
  try {
    await Promise.all([pump(), pipeline(progressStream, fs.createWriteStream(tempPath))]);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true });
    throw error;
  }

  const stats = await fs.promises.stat(tempPath);
  if (stats.size < 100 * 1024) {
    await fs.promises.rm(tempPath, { force: true });
    throw new Error(`Douyin native download is too small (${stats.size} bytes)`);
  }

  await fs.promises.rename(tempPath, outputPath);
  setDownloadProgress(videoId, 100);
  return {
    success: true,
    path: outputPath,
    filename,
    method: 'douyin-native',
    resolvedVideoId: resolved.videoId,
    resolvedSourceUrl: resolved.resolvedUrl,
    title: resolved.title,
    size: stats.size
  };
}

module.exports = {
  downloadDouyinNative,
  resolveDouyinMedia,
  resolveDouyinTarget,
  extractVideoId
};
