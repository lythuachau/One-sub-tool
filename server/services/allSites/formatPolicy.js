const QUALITY_HEIGHTS = {
  '144p': 144,
  '240p': 240,
  '360p': 360,
  '480p': 480,
  '720p': 720,
  '1080p': 1080
};

function getHeightLimit(quality) {
  return QUALITY_HEIGHTS[quality] || QUALITY_HEIGHTS['360p'];
}

function isBilibiliUrl(videoURL) {
  try {
    const hostname = new URL(videoURL).hostname.toLowerCase();
    return hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com');
  } catch {
    return false;
  }
}

function isShortVideoUrl(videoURL) {
  try {
    const hostname = new URL(videoURL).hostname.toLowerCase();
    return hostname.includes('tiktok.com') || hostname.includes('douyin.com');
  } catch {
    return false;
  }
}

function buildDownloadPlans(videoURL, quality = '360p') {
  const height = getHeightLimit(quality);
  const isShortVideo = isShortVideoUrl(videoURL);

  if (isBilibiliUrl(videoURL)) {
    const retryArgs = ['--retries', '3', '--fragment-retries', '3'];
    const chunkRetryArgs = [
      ...retryArgs,
      '--http-chunk-size', '10M',
      '--retry-sleep', 'http:2'
    ];
    const dashFormat = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;
    return [
      {
        name: 'bilibili-dash-primary',
        format: dashFormat,
        args: retryArgs
      },
      {
        name: 'bilibili-dash-chunked-retry',
        format: dashFormat,
        args: chunkRetryArgs
      },
      {
        name: 'bilibili-dash-hevc-fallback',
        format: `bestvideo[height<=${height}][vcodec^=hev1]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
        args: chunkRetryArgs
      }
    ];
  }

  if (isShortVideo) {
    return [
      {
        name: 'short-video-primary',
        format: `best[height<=${height}]`,
        args: []
      },
      {
        name: 'short-video-mp4-fallback',
        format: `best[height<=${height}][ext=mp4]/best[height<=${height}]`,
        args: []
      }
    ];
  }

  return [
    {
      name: 'generic-dash-primary',
      format: `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
      args: []
    },
    {
      name: 'generic-mp4-fallback',
      format: `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
      args: []
    }
  ];
}

module.exports = {
  QUALITY_HEIGHTS,
  getHeightLimit,
  isBilibiliUrl,
  buildDownloadPlans
};
