const fs = require('fs');
const path = require('path');

const METADATA_SUFFIX = '.source.json';

function normalizeSourceUrl(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) return '';

  const value = sourceUrl.trim();
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/[\\/]+$/, '');
  }
}

function metadataPathForVideo(videoPath) {
  return `${videoPath}${METADATA_SUFFIX}`;
}

async function readVideoSourceMetadata(videoPath) {
  try {
    const content = await fs.promises.readFile(metadataPathForVideo(videoPath), 'utf8');
    const metadata = JSON.parse(content);
    return metadata && typeof metadata === 'object' ? metadata : null;
  } catch {
    return null;
  }
}

async function isVideoSourceMatch(videoPath, { videoId, sourceUrl }) {
  if (!videoId || !sourceUrl) return false;
  const metadata = await readVideoSourceMetadata(videoPath);
  return Boolean(
    metadata &&
    metadata.videoId === String(videoId) &&
    metadata.normalizedSourceUrl === normalizeSourceUrl(sourceUrl)
  );
}

async function writeVideoSourceMetadata({
  videoPath,
  videoId,
  sourceUrl,
  method = 'download',
  resolvedVideoId = null,
  resolvedSourceUrl = null,
  title = ''
}) {
  if (!videoPath || !videoId || !sourceUrl) {
    throw new Error('Video metadata requires videoPath, videoId and sourceUrl');
  }

  const metadataPath = metadataPathForVideo(videoPath);
  const stats = await fs.promises.stat(videoPath);
  const metadata = {
    schemaVersion: 1,
    videoId: String(videoId),
    sourceUrl: String(sourceUrl),
    normalizedSourceUrl: normalizeSourceUrl(sourceUrl),
    resolvedVideoId: resolvedVideoId ? String(resolvedVideoId) : null,
    resolvedSourceUrl: resolvedSourceUrl ? String(resolvedSourceUrl) : null,
    normalizedResolvedSourceUrl: resolvedSourceUrl ? normalizeSourceUrl(resolvedSourceUrl) : null,
    title: String(title || ''),
    filename: path.basename(videoPath),
    method,
    size: stats.size,
    downloadedAt: new Date().toISOString()
  };
  const temporaryPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`;

  await fs.promises.writeFile(temporaryPath, JSON.stringify(metadata, null, 2), 'utf8');
  await fs.promises.rename(temporaryPath, metadataPath);
  return metadata;
}

async function quarantineStaleVideoArtifact(videoPath, reason = 'source-mismatch') {
  if (!videoPath) return null;
  const suffix = `.stale-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const staleVideoPath = `${videoPath}${suffix}`;
  const metadataPath = metadataPathForVideo(videoPath);
  const staleMetadataPath = `${metadataPath}${suffix}`;

  try {
    await fs.promises.rename(videoPath, staleVideoPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }

  try {
    await fs.promises.rename(metadataPath, staleMetadataPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[VIDEO-METADATA] Could not move sidecar for ${path.basename(videoPath)}: ${error.message}`);
    }
  }

  console.warn(`[VIDEO-METADATA] Quarantined ${path.basename(videoPath)} (${reason})`);
  return staleVideoPath;
}

module.exports = {
  METADATA_SUFFIX,
  normalizeSourceUrl,
  metadataPathForVideo,
  readVideoSourceMetadata,
  isVideoSourceMatch,
  writeVideoSourceMetadata,
  quarantineStaleVideoArtifact
};
