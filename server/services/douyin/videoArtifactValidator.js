const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getFfprobePath } = require('../shared/ffmpegUtils');

const MIN_VIDEO_BYTES = 100 * 1024;
const DEFAULT_PROBE_TIMEOUT_MS = 15000;

function probeVideo(filePath, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const probe = spawn(getFfprobePath(), [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    const timeout = setTimeout(() => {
      probe.kill();
      finish(reject, new Error(`FFprobe timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    probe.stdout.on('data', data => { stdout += data.toString(); });
    probe.stderr.on('data', data => { stderr += data.toString(); });
    probe.on('error', error => finish(reject, error));
    probe.on('close', code => {
      if (code !== 0) {
        finish(reject, new Error(`FFprobe exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        finish(resolve, JSON.parse(stdout));
      } catch (error) {
        finish(reject, new Error(`FFprobe returned invalid JSON: ${error.message}`));
      }
    });
  });
}

async function validateVideoArtifact(filePath, options = {}) {
  const { requireAudio = false, minBytes = MIN_VIDEO_BYTES } = options;
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { valid: false, reason: 'Artifact path is missing', path: filePath || null };
  }
  const absolutePath = path.resolve(filePath);
  let stats;

  try {
    stats = await fs.promises.stat(absolutePath);
  } catch (error) {
    return { valid: false, reason: `File is missing: ${error.message}`, path: absolutePath };
  }

  if (!stats.isFile()) {
    return { valid: false, reason: 'Path is not a regular file', path: absolutePath, size: stats.size };
  }
  if (stats.size < minBytes) {
    return { valid: false, reason: `File is too small (${stats.size} bytes)`, path: absolutePath, size: stats.size };
  }

  try {
    const metadata = await probeVideo(absolutePath);
    const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
    const videoStream = streams.find(stream => stream.codec_type === 'video');
    const audioStream = streams.find(stream => stream.codec_type === 'audio');
    const duration = Number.parseFloat(metadata.format?.duration || videoStream?.duration || 0);

    if (!videoStream) {
      return { valid: false, reason: 'No video stream found', path: absolutePath, size: stats.size };
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      return { valid: false, reason: 'Video duration is invalid', path: absolutePath, size: stats.size };
    }
    if (requireAudio && !audioStream) {
      return { valid: false, reason: 'Required audio stream is missing', path: absolutePath, size: stats.size };
    }

    return {
      valid: true,
      path: absolutePath,
      size: stats.size,
      duration,
      hasVideo: true,
      hasAudio: Boolean(audioStream),
      videoCodec: videoStream.codec_name || null,
      audioCodec: audioStream?.codec_name || null
    };
  } catch (error) {
    return { valid: false, reason: error.message, path: absolutePath, size: stats.size };
  }
}

async function quarantineInvalidArtifact(filePath, reason = 'invalid-artifact') {
  const absolutePath = path.resolve(filePath);
  try {
    await fs.promises.access(absolutePath, fs.constants.F_OK);
  } catch {
    return null;
  }

  const quarantinePath = `${absolutePath}.invalid-${Date.now()}`;
  try {
    await fs.promises.rename(absolutePath, quarantinePath);
    console.warn(`[DouyinArtifact] Quarantined invalid artifact: ${absolutePath} (${reason})`);
    return quarantinePath;
  } catch (error) {
    console.warn(`[DouyinArtifact] Failed to quarantine invalid artifact ${absolutePath}: ${error.message}`);
    return null;
  }
}

module.exports = {
  MIN_VIDEO_BYTES,
  probeVideo,
  validateVideoArtifact,
  quarantineInvalidArtifact
};
