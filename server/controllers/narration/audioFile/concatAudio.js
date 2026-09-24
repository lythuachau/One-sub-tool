const fs = require('fs');
const path = require('path');
const { concatenateAudioFiles } = require('./batchProcessor');
const { OUTPUT_AUDIO_DIR, ensureSubtitleDirectory } = require('../directoryManager');

const resolveOutputFile = (filename) => {
  const root = path.resolve(OUTPUT_AUDIO_DIR);
  const resolved = path.resolve(root, String(filename || ''));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Audio filename is outside the narration output directory');
  }
  return resolved;
};

const concatenateNarrationAudio = async (req, res) => {
  try {
    const { filenames, subtitle_id: subtitleId, generation_id: generationId } = req.body || {};
    if (!Array.isArray(filenames) || filenames.length < 2 || subtitleId === undefined || !generationId) {
      return res.status(400).json({ success: false, error: 'filenames, subtitle_id and generation_id are required' });
    }

    const inputFiles = filenames.map(resolveOutputFile);
    if (inputFiles.some((file) => !fs.existsSync(file))) {
      return res.status(404).json({ success: false, error: 'One or more narration parts were not found' });
    }

    const subtitleDirectory = ensureSubtitleDirectory(subtitleId, generationId);
    const outputFilename = `combined_${Date.now()}.wav`;
    const outputPath = path.join(subtitleDirectory, outputFilename);
    await concatenateAudioFiles(inputFiles, outputPath);

    const filename = path.relative(OUTPUT_AUDIO_DIR, outputPath).split(path.sep).join('/');
    return res.json({ success: true, filename });
  } catch (error) {
    console.error('Error concatenating narration audio:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { concatenateNarrationAudio };
