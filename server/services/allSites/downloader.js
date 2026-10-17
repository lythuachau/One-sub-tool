const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { VIDEOS_DIR } = require('../../config');
const { publishVideoFile } = require('../../utils/fileOperations');
const { getYtDlpPath, getYtDlpArgs } = require('../shared/ytdlpUtils');
const { validateVideoArtifact } = require('../douyin/videoArtifactValidator');
const { buildDownloadPlans, getHeightLimit, isBilibiliUrl } = require('./formatPolicy');
const { setDownloadProgress, updateProgressFromYtdlpOutput } = require('../shared/progressTracker');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

async function removeAttemptArtifacts(videoId) {
  const prefix = `${videoId}.temp.`;
  const exactTempName = `${videoId}.temp.mp4`;
  const entries = await fs.promises.readdir(VIDEOS_DIR, { withFileTypes: true }).catch(() => []);
  const paths = entries
    .filter(entry => entry.isFile() && (entry.name === exactTempName || entry.name.startsWith(prefix)))
    .map(entry => path.join(VIDEOS_DIR, entry.name));

  await Promise.all(paths.map(filePath => fs.promises.unlink(filePath).catch(error => {
    if (error.code !== 'ENOENT') console.warn(`[allSites] Could not remove partial download ${path.basename(filePath)}: ${error.message}`);
  })));
}

function getDiagnosticExcerpt(output) {
  const lines = output
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .split(/[\r\n]+/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('[debug]') && !/https?:\/\//i.test(line));
  const usefulLines = lines.filter(line => !/^(?:File ".*", line \d+|Traceback|return error\(|error=IDENTITY|self\.trouble\(|self\.error_callback\()/i.test(line));
  const actionableLines = usefulLines.filter(line => /(?:Got error:\s*\d+ bytes read|HTTP Error|^ERROR:\s+\S|timed out|incomplete)/i.test(line));
  const selectedLines = (actionableLines.length ? actionableLines : usefulLines)
    .slice(-4);

  return selectedLines
    .join(' | ')
    .slice(-2000);
}

function getPythonPath() {
  const pythonDirectory = process.platform === 'win32' ? 'Scripts' : 'bin';
  const pythonExecutable = process.platform === 'win32' ? 'python.exe' : 'python';
  const pythonPath = path.join(process.cwd(), '.venv', pythonDirectory, pythonExecutable);
  return fs.existsSync(pythonPath) ? pythonPath : null;
}

function runYtDlpAttempt({ videoId, videoURL, quality, useCookies, plan }) {
  const ytDlpPath = getYtDlpPath();
  const tempPath = path.join(VIDEOS_DIR, `${videoId}.temp.mp4`);
  const pythonPath = plan.bilibiliMirrors ? getPythonPath() : null;
  const command = pythonPath || ytDlpPath;
  const args = pythonPath
    ? [
        path.join(__dirname, 'bilibiliMirrorDownloader.py'),
        '--url', videoURL,
        '--format', plan.format,
        '--output', tempPath,
        '--shared-args', JSON.stringify(getYtDlpArgs(useCookies))
      ]
    : [
        ...getYtDlpArgs(useCookies),
        ...plan.args,
        '--verbose',
        '--format', plan.format,
        '--merge-output-format', 'mp4',
        '--output', tempPath,
        '--force-overwrites',
        '--no-check-certificate',
        '--user-agent', USER_AGENT,
        videoURL
      ];

  console.log(`[allSites] Starting ${plan.name} (${quality}); format=${plan.format}`);

  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const child = spawn(command, args, { windowsHide: true });
    const appendOutput = data => {
      const chunk = data.toString();
      output = `${output}${chunk}`.slice(-30000);
      updateProgressFromYtdlpOutput(videoId, chunk);
    };

    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);
    child.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('close', async code => {
      if (settled) return;
      settled = true;

      if (code !== 0) {
        const details = getDiagnosticExcerpt(output);
        reject(new Error(`${plan.name} failed with exit code ${code}${details ? `: ${details}` : ''}`));
        return;
      }

      try {
        const validation = await validateVideoArtifact(tempPath, { requireAudio: true });
        if (!validation.valid) {
          throw new Error(`Downloaded artifact failed validation: ${validation.reason}`);
        }

        const outputPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);
        await publishVideoFile(tempPath, outputPath);

        const finalValidation = await validateVideoArtifact(outputPath, { requireAudio: true });
        if (!finalValidation.valid) {
          await fs.promises.unlink(outputPath).catch(() => {});
          throw new Error(`Published video failed validation: ${finalValidation.reason}`);
        }

        resolve({
          success: true,
          path: outputPath,
          message: `Video downloaded and validated (${plan.name})`,
          method: plan.name,
          size: finalValidation.size
        });
        setDownloadProgress(videoId, 100, 'completed');
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function downloadVideoWithRetry(videoId, videoURL, quality = '360p', useCookies = false) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(videoId || ''))) {
    throw new Error('Invalid video ID');
  }

  setDownloadProgress(videoId, 0, 'downloading');
  const plans = buildDownloadPlans(videoURL, quality);
  if (isBilibiliUrl(videoURL)) {
    const height = getHeightLimit(quality);
    plans.unshift({
      name: 'bilibili-backup-cdn-range-download',
      format: `bestvideo[height<=${height}][vcodec^=av01]+bestaudio[abr<=70]/bestvideo[height<=${height}]+bestaudio[abr<=70]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
      args: [],
      bilibiliMirrors: true
    });
  }
  const failures = [];

  for (const plan of plans) {
    await removeAttemptArtifacts(videoId);
    try {
      return await runYtDlpAttempt({ videoId, videoURL, quality, useCookies, plan });
    } catch (error) {
      failures.push(`${plan.name}: ${error.message}`);
      console.error(`[allSites] ${plan.name} failed: ${error.message}`);
      await removeAttemptArtifacts(videoId);
    }
  }

  const error = new Error(`All ${plans.length} bounded download attempts failed. ${failures.join(' | ')}`);
  setDownloadProgress(videoId, 0, 'error', { error: error.message });
  throw error;
}

module.exports = {
  downloadVideoWithRetry,
  getDiagnosticExcerpt
};
