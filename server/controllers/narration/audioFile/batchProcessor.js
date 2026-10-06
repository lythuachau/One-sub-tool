/**
 * Module for batch processing of audio segments
 * Handles large numbers of audio segments by splitting them into batches
 * Uses bounded, single-pass tempo adjustment without truncating speech
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getFfmpegPath } = require('../../../services/shared/ffmpegUtils');

// Import directory paths
const { TEMP_AUDIO_DIR } = require('../directoryManager');

// Import media duration utility
const { getMediaDuration } = require('../../../services/videoProcessing/durationUtils');

const analyzeAndAdjustSegments = async (audioSegments) => {
  const measured = [];
  for (const segment of audioSegments || []) {
    measured.push({ ...segment, actualDuration: await getMediaDuration(segment.path) });
  }
  const { planNaturalTiming } = require('./naturalTimingPlanner');
  const planned = planNaturalTiming(measured);
  const unresolved = planned.filter(segment => segment.overflowMs > 20);
  console.log('[TTS TIMING]', JSON.stringify(planned.map(s => ({
    id: s.subtitle_id, duration: s.actualDuration, available: s.availableDuration,
    tempo: s.tempo, overflowMs: s.overflowMs
  }))));
  if (unresolved.length) {
    const error = new Error('TTS vượt thời lượng ở câu ' + unresolved.map(s =>
      String(s.subtitle_id) + ' (dư ' + s.overflowMs + ' ms)').join(', ')
      + '. Hãy rút gọn lời rồi tạo lại thuyết minh; tốc độ được giới hạn 1.12x để giữ giọng tự nhiên.');
    error.status = 422;
    error.code = 'TTS_TIMING_REVIEW_REQUIRED';
    error.segments = unresolved.map(s => ({ id: s.subtitle_id, overflowMs: s.overflowMs, requiredTempo: s.requiredTempo }));
    throw error;
  }
  return planned;
};
const processBatch = async (audioSegments, outputPath, batchIndex, totalDuration, smartOverlapResolution = true, preserveSpeech = true) => {

  // Plan before mixing; the route plans globally across batch boundaries.
  let segmentsToProcess = audioSegments;
  if (smartOverlapResolution && audioSegments.length > 0) {
    try {
      // Fit clips before building the delayed audio mix
      segmentsToProcess = await analyzeAndAdjustSegments(audioSegments, preserveSpeech);
    } catch (error) {
      console.error(`Error during TTS alignment: ${error.message}`);
      throw error;
    }
  }

  // Create a temporary directory for the filter complex file
  const tempDir = path.join(TEMP_AUDIO_DIR);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Create a filter complex for precise audio placement
  let filterComplex = '';
  let amixInputs = []; // Will hold the names of the delayed streams like [a0], [a1], ...

  // Process each audio segment for the filter complex
  segmentsToProcess.forEach((segment, index) => {
    // Calculate delay in milliseconds for the current segment
    const delayMs = Math.round(segment.start * 1000);

    // Log the delay being applied for each segment with enhanced information
    let adjustmentInfo = '';
    if (segment.shiftAmount) {
      const direction = segment.shiftAmount > 0 ? 'right' : 'left';
      const strategy = segment.adjustmentStrategy || 'push-right';
      adjustmentInfo = ` (adjusted ${Math.abs(segment.shiftAmount).toFixed(2)}s ${direction} via ${strategy})`;
    }

    // Add final timing adjustment info
    let finalTimingInfo = '';
    if (segment.finalTimingAdjustment) {
      finalTimingInfo = ` + ${segment.finalTimingAdjustment.toFixed(2)}s earlier`;
    }

    const isGrouped = segment.isGrouped ? ` (grouped subtitle with ${segment.original_ids?.length || 0} original IDs)` : '';
    console.log(`[SERVER] Segment ${segment.subtitle_id}: Applying delay of ${delayMs}ms${adjustmentInfo}${finalTimingInfo}${isGrouped}`);

    // Use `index + 1` because input [0] is anullsrc
    const inputIndex = index + 1;
    const delayedStreamName = `a${index}`; // Name for the output stream of this filter chain part

    // Apply resampling and delay to the correct input stream
    // Output this processed stream as [a<index>] (e.g., [a0], [a1], ...)
    // Keep the generated TTS level unchanged, matching version 1 overlay behavior
    filterComplex += `[${inputIndex}]aresample=44100,atempo=${(segment.tempo || 1).toFixed(5)},adelay=${delayMs}|${delayMs},volume=1.0[${delayedStreamName}]; `;
    amixInputs.push(`[${delayedStreamName}]`); // Add the delayed stream name to the list for amix
  });

  // Combine all delayed audio streams
  if (segmentsToProcess.length > 0) {
    if (segmentsToProcess.length === 1) {
      // If there's only one segment, just map it directly to output
      filterComplex += `${amixInputs[0]}asetpts=PTS-STARTPTS[aout]`;
    } else {
      // For multiple segments, use amix with normalize=0 to prevent volume reduction during overlaps
      // This is the key setting that ensures overlapping segments maintain their volume
      filterComplex += `${amixInputs.join('')}amix=inputs=${segmentsToProcess.length}:dropout_transition=0:normalize=0[aout]`;
    }
  } else {
    // If there are no audio segments, the output is just the silent track
    filterComplex = '[0:a]acopy[aout]'; // Map the anullsrc input directly
  }

  // Create a temporary file for the filter complex to avoid command line length limitations
  const timestamp = Date.now();
  const filterComplexFilename = `filter_complex_batch${batchIndex}_${timestamp}.txt`;
  const filterComplexPath = path.join(tempDir, filterComplexFilename);

  // Write the filter complex to a file
  fs.writeFileSync(filterComplexPath, filterComplex);


  // Build the ffmpeg command arguments as an array
  // Input [0] is the silent anullsrc base track.
  // Inputs [1], [2], ... are the actual audio files.

  // Start with the base arguments
  const ffmpegArgs = [
    '-f', 'lavfi',
    '-i', `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${totalDuration}`
  ];

  // Add each audio file as an input
  segmentsToProcess.forEach(segment => {
    ffmpegArgs.push('-i', segment.path);
  });

  // Add the filter complex script and output options
  ffmpegArgs.push(
    '-filter_complex_script', filterComplexPath,
    '-map', '[aout]',
    '-c:a', 'pcm_s16le',
    '-ar', '44100',
    '-y',
    outputPath
  );



  // Execute the ffmpeg command using spawn
  await new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

    let stdoutData = '';
    let stderrData = '';

    ffmpegProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdoutData += chunk;
      // Log progress indicators
      if (chunk.includes('size=')) {
        process.stdout.write('.');
      }
    });

    ffmpegProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderrData += chunk;
      // Log progress indicators
      if (chunk.includes('size=')) {
        process.stdout.write('.');
      }
    });

    ffmpegProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`ffmpeg process exited with code ${code}`);
        console.error(`stderr: ${stderrData.substring(0, 500)}${stderrData.length > 500 ? '...' : ''}`);
        reject(new Error(`ffmpeg process failed with code ${code}`));
        return;
      }

      // Log only snippets of potentially long stdout/stderr



      // Clean up the filter complex file
      try {
        if (fs.existsSync(filterComplexPath)) {
          fs.unlinkSync(filterComplexPath);

        }
      } catch (cleanupError) {
        console.error(`Error cleaning up filter complex file: ${cleanupError.message}`);
      }

      resolve(outputPath);
    });

    ffmpegProcess.on('error', (err) => {
      console.error(`Error spawning ffmpeg process: ${err.message}`);
      reject(err);
    });
  });

  return outputPath;
};

/**
 * Concatenate multiple audio files into a single file
 *
 * @param {Array<string>} inputFiles - Array of input file paths
 * @param {string} outputPath - Path to save the concatenated file
 * @returns {Promise<string>} - Path to the concatenated file
 */
const concatenateAudioFiles = async (inputFiles, outputPath) => {


  // Create a temporary file list for ffmpeg
  const tempDir = path.join(TEMP_AUDIO_DIR);
  const timestamp = Date.now();
  const fileListPath = path.join(tempDir, `concat_list_${timestamp}.txt`);

  // Write the file list
  const fileListContent = inputFiles.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(fileListPath, fileListContent);

  // Build the ffmpeg command arguments
  const ffmpegArgs = [
    '-f', 'concat',
    '-safe', '0',
    '-i', fileListPath,
    '-c', 'copy',
    '-y',
    outputPath
  ];

  // Execute the ffmpeg command
  await new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

    let stdoutData = '';
    let stderrData = '';

    ffmpegProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    ffmpegProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    ffmpegProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`ffmpeg concat process exited with code ${code}`);
        console.error(`stderr: ${stderrData}`);
        reject(new Error(`ffmpeg concat process failed with code ${code}`));
        return;
      }



      // Clean up the file list
      try {
        if (fs.existsSync(fileListPath)) {
          fs.unlinkSync(fileListPath);

        }
      } catch (cleanupError) {
        console.error(`Error cleaning up file list: ${cleanupError.message}`);
      }

      resolve(outputPath);
    });

    ffmpegProcess.on('error', (err) => {
      console.error(`Error spawning ffmpeg concat process: ${err.message}`);
      reject(err);
    });
  });

  return outputPath;
};

module.exports = {
  processBatch,
  concatenateAudioFiles,
  analyzeAndAdjustSegments
};
