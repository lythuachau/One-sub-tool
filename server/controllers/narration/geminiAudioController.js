/**
 * Controller for audio processing (Gemini and F5-TTS)
 */

const path = require('path');
const fs = require('fs');

// Import directory paths and functions
const {
  resolveOutputAudioPath,
  withAudioFileLock,
  validateWavBuffer,
  validateAudioFile,
  writeBufferAtomically
} = require('./audioFile/audioArtifactSafety');
const { isGenerationCancelled } = require('../../services/omnivoiceCancellation');

/**
 * Save audio data to disk (common function for both Gemini and F5-TTS)
 * @param {Object} options - Options for saving audio
 * @param {string} options.audioData - Base64 encoded audio data
 * @param {string|number} options.subtitle_id - Subtitle ID
 * @param {number} options.sampleRate - Sample rate of the audio
 * @param {string} options.mimeType - MIME type of the audio
 * @param {string} options.prefix - Prefix for the filename (e.g., 'gemini' or 'f5tts')
 * @param {string} options.generationId - Generation scope used to isolate artifacts
 * @returns {Promise<Object>} - Result object with filename and success status
 */
const saveAudioToFile = async (options) => {
  const { audioData, subtitle_id, sampleRate = 24000, prefix = '', generationId = '', isCancelled } = options;

  if (!audioData || subtitle_id === undefined || subtitle_id === null || subtitle_id === '') {
    throw new Error('Missing required data (audioData or subtitle_id)');
  }

  const subtitleId = String(subtitle_id).trim();
  if (!subtitleId || subtitleId === '.' || subtitleId === '..' || /[\\/]/.test(subtitleId)) {
    throw new Error('Invalid subtitle_id');
  }

  const base64Data = typeof audioData === 'string' && audioData.includes(',')
    ? audioData.slice(audioData.indexOf(',') + 1)
    : audioData;
  const audioBuffer = Buffer.isBuffer(base64Data) ? base64Data : Buffer.from(base64Data, 'base64');
  if (audioBuffer.length === 0) throw new Error('TTS returned empty audio data');

  const actualSampleRate = Number(sampleRate) > 0 ? Math.round(Number(sampleRate)) : 24000;
  if (audioBuffer.length > 0xffffffff - 44) throw new Error('TTS audio data exceeds the supported WAV size');
  const hasWavContainer = audioBuffer.toString('ascii', 0, 4) === 'RIFF'
    && audioBuffer.toString('ascii', 8, 12) === 'WAVE';
  if (audioBuffer.toString('ascii', 0, 4) === 'RIFF' && !hasWavContainer) {
    throw new Error('TTS returned a malformed WAV container');
  }

  const wavBuffer = hasWavContainer
    ? audioBuffer
    : Buffer.concat([createWavHeader(audioBuffer.length, actualSampleRate), audioBuffer]);
  validateWavBuffer(wavBuffer);

  const generationScope = String(generationId || '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  const filename = prefix ? `${prefix}_1.wav` : '1.wav';
  const relativeFilename = `${generationScope ? `${generationScope}/` : ''}subtitle_${subtitleId}/${filename}`;
  const outputPath = resolveOutputAudioPath(relativeFilename);
  const backupPath = path.join(path.dirname(outputPath), `backup_${path.basename(outputPath)}`);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  return withAudioFileLock(outputPath, async () => {
    if (isCancelled?.()) throw new Error('Narration generation cancelled before saving audio');
    if (fs.existsSync(outputPath)) console.log(`Replacing narration atomically: ${outputPath}`);

    const stats = await writeBufferAtomically(outputPath, wavBuffer, async temporaryPath => {
      validateWavBuffer(await fs.promises.readFile(temporaryPath));
      await validateAudioFile(temporaryPath);
      if (isCancelled?.()) throw new Error('Narration generation cancelled before saving audio');
    });

    await fs.promises.rm(backupPath, { force: true }).catch(error => {
      console.warn(`[NarrationAudio] Could not clear stale speed backup ${backupPath}: ${error.message}`);
    });

    return {
      success: true,
      filename: relativeFilename,
      subtitle_id,
      sampleRate: actualSampleRate,
      size: stats.size
    };
  });
};

/**
 * Save Gemini audio data to disk (HTTP endpoint handler)
 */
const saveGeminiAudio = async (req, res) => {
  try {
    const { audioData, subtitle_id, sampleRate, mimeType, generation_id } = req.body;

    if (!audioData || !subtitle_id) {
      console.error('Missing required data');
      return res.status(400).json({ error: 'Missing required data (audioData or subtitle_id)' });
    }

    try {
      const result = await saveAudioToFile({
        audioData,
        subtitle_id,
        sampleRate,
        mimeType,
        generationId: generation_id,
        prefix: '' // Use empty prefix like F5-TTS and Chatterbox for consistent naming
      });

      res.json(result);
    } catch (error) {
      console.error(`Error saving Gemini audio: ${error.message}`);
      res.status(500).json({ error: `Error saving Gemini audio: ${error.message}` });
    }
  } catch (error) {
    console.error('Error processing Gemini audio:', error);
    res.status(500).json({ error: 'Error processing Gemini audio' });
  }
};

/**
 * Save F5-TTS audio data to disk (HTTP endpoint handler)
 */
const saveF5TTSAudio = async (req, res) => {
  try {
    const { audioData, subtitle_id, sampleRate, mimeType, generation_id } = req.body;

    if (!audioData || !subtitle_id) {
      console.error('Missing required data');
      return res.status(400).json({ error: 'Missing required data (audioData or subtitle_id)' });
    }

    try {
      // Use empty prefix to generate filenames like "1.wav" instead of "f5tts_1.wav"
      // This matches the expected pattern in alignAudio.js
      const result = await saveAudioToFile({
        audioData,
        subtitle_id,
        sampleRate,
        mimeType,
        generationId: generation_id,
        prefix: '' // Empty prefix for consistent naming with what's expected
      });

      res.json(result);
    } catch (error) {
      console.error(`Error saving F5-TTS audio: ${error.message}`);
      res.status(500).json({ error: `Error saving F5-TTS audio: ${error.message}` });
    }
  } catch (error) {
    console.error('Error processing F5-TTS audio:', error);
    res.status(500).json({ error: 'Error processing F5-TTS audio' });
  }
};

/**
 * Save Chatterbox audio data to disk (HTTP endpoint handler)
 */
const saveChatterboxAudio = async (req, res) => {
  try {
    const { audioData, subtitle_id, sampleRate, mimeType, generation_id } = req.body;

    if (isGenerationCancelled(generation_id)) {
      return res.status(409).json({ cancelled: true, generation_id });
    }

    if (!audioData || subtitle_id === undefined || subtitle_id === null) {
      console.error('Missing required data');
      return res.status(400).json({ error: 'Missing required data (audioData or subtitle_id)' });
    }

    try {
      const result = await saveAudioToFile({
        audioData,
        subtitle_id,
        sampleRate,
        mimeType,
        generationId: generation_id,
        prefix: '',
        isCancelled: () => isGenerationCancelled(generation_id)
      });

      if (isGenerationCancelled(generation_id)) {
        return res.status(409).json({ cancelled: true, generation_id });
      }
      res.json(result);
    } catch (error) {
      if (isGenerationCancelled(generation_id)) {
        return res.status(409).json({ cancelled: true, generation_id });
      }
      console.error(`Error saving Chatterbox audio: ${error.message}`);
      res.status(500).json({ error: `Error saving Chatterbox audio: ${error.message}` });
    }
  } catch (error) {
    console.error('Error processing Chatterbox audio:', error);
    res.status(500).json({ error: 'Error processing Chatterbox audio' });
  }
};

const saveVieNeuAudio = saveF5TTSAudio;
const saveOmniVoiceAudio = saveChatterboxAudio;

/**
 * Create a WAV header for PCM audio data
 * @param {number} dataLength - Length of the PCM data in bytes
 * @param {number} sampleRate - Sample rate of the audio (default: 24000)
 * @returns {Buffer} - WAV header as a Buffer
 */
const createWavHeader = (dataLength, sampleRate = 24000) => {
  // Gemini returns 16-bit PCM data, mono channel
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;

  // Create WAV header (44 bytes)
  const header = Buffer.alloc(44);

  // "RIFF" chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4); // Chunk size (file size - 8)
  header.write('WAVE', 8);

  // "fmt " sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1 size (16 for PCM)
  header.writeUInt16LE(1, 20); // Audio format (1 for PCM)
  header.writeUInt16LE(numChannels, 22); // Number of channels
  header.writeUInt32LE(sampleRate, 24); // Sample rate
  header.writeUInt32LE(byteRate, 28); // Byte rate
  header.writeUInt16LE(blockAlign, 32); // Block align
  header.writeUInt16LE(bitsPerSample, 34); // Bits per sample

  // "data" sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40); // Subchunk2 size (data size)

  console.log(`[DEBUG] Created WAV header for ${dataLength} bytes of PCM data, sample rate: ${sampleRate}`);

  return header;
};

module.exports = {
  saveGeminiAudio,
  saveF5TTSAudio,
  saveVieNeuAudio,
  saveChatterboxAudio,
  saveOmniVoiceAudio,
  createWavHeader,
  saveAudioToFile
};
