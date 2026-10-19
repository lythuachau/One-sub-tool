const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const { OUTPUT_AUDIO_DIR, TEMP_AUDIO_DIR } = require('../directoryManager');
const { resolveOutputAudioPath } = require('./audioArtifactSafety');

const downloadAllAudio = async (req, res) => {
  let zipPath;

  try {
    const { filenames } = req.body || {};
    if (!Array.isArray(filenames) || filenames.length === 0 ||
        filenames.some(filename => typeof filename !== 'string' || !filename.trim())) {
      return res.status(400).json({ error: 'A non-empty filenames array is required' });
    }

    const uniqueFilenames = [...new Set(filenames)];
    const audioFiles = [];
    const unavailableFiles = [];
    const outputRoot = path.resolve(OUTPUT_AUDIO_DIR);

    for (const filename of uniqueFilenames) {
      let filePath;
      try {
        filePath = resolveOutputAudioPath(filename);
      } catch {
        return res.status(400).json({ error: `Invalid narration filename: ${filename}` });
      }

      const stats = await fs.promises.stat(filePath).catch(() => null);
      if (!stats?.isFile() || stats.size === 0) {
        unavailableFiles.push(filename);
        continue;
      }

      audioFiles.push({
        filePath,
        archivePath: path.relative(outputRoot, filePath).split(path.sep).join('/')
      });
    }

    if (unavailableFiles.length > 0) {
      const listedFiles = unavailableFiles.slice(0, 5).join(', ');
      const remainingFiles = unavailableFiles.length > 5 ? ` (+${unavailableFiles.length - 5} more)` : '';
      return res.status(404).json({
        error: `Audio files are missing or empty: ${listedFiles}${remainingFiles}`,
        unavailableFiles
      });
    }

    if (audioFiles.length === 0) {
      return res.status(404).json({ error: 'No valid audio files found' });
    }

    await fs.promises.mkdir(TEMP_AUDIO_DIR, { recursive: true });
    zipPath = path.join(TEMP_AUDIO_DIR, `narration_audio_${Date.now()}_${process.pid}.zip`);

    const archive = new AdmZip();
    audioFiles.forEach(({ filePath, archivePath }) => {
      const directory = path.posix.dirname(archivePath);
      archive.addLocalFile(
        filePath,
        directory === '.' ? '' : directory,
        path.posix.basename(archivePath)
      );
    });

    await archive.writeZipPromise(zipPath);
    const zipStats = await fs.promises.stat(zipPath);
    if (zipStats.size === 0) throw new Error('Created ZIP archive is empty');

    const zipFilename = path.basename(zipPath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    res.sendFile(zipPath, error => {
      fs.promises.unlink(zipPath).catch(cleanupError => {
        console.error(`Could not remove temporary ZIP: ${cleanupError.message}`);
      });

      if (error) {
        console.error(`Failed to send narration ZIP: ${error.message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: `Failed to send ZIP archive: ${error.message}` });
        }
      }
    });
  } catch (error) {
    console.error('Error creating narration ZIP:', error);
    if (zipPath) {
      await fs.promises.unlink(zipPath).catch(() => {});
    }
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to create ZIP archive: ${error.message}` });
    }
  }
};

module.exports = {
  downloadAllAudio
};
