/**
 * Module for batch processing of audio segments
 * Handles large numbers of audio segments by splitting them into batches
 * Uses the version 1 narration timing rules for fitting and overlap resolution
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getFfmpegPath } = require('../../../services/shared/ffmpegUtils');

// Import directory paths
const { TEMP_AUDIO_DIR } = require('../directoryManager');

// Import media duration utility
const { getMediaDuration } = require('../../../services/videoProcessing/durationUtils');

const VERSION1_MIN_TEMPO = 0.75;
const VERSION1_INITIAL_MAX_TEMPO = 1.55;
const VERSION1_OVERLAP_MAX_TEMPO = 1.85;
const VERSION1_OVERLAP_GAP_MS = 50;
const VERSION1_MIN_SLOT_MS = 200;
const VERSION1_OVERLAP_RETIME_THRESHOLD = 1.08;
const VERSION1_FADE_MAX_MS = 70;

/**
 * Find blank spaces (gaps) between segments where we can potentially move segments
 * @param {Array} segments - Array of segments with timing information
 * @returns {Array} - Array of blank spaces with start and end times
 */
const findBlankSpaces = (segments) => {
  const blankSpaces = [];

  // Sort segments by start time
  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sortedSegments.length - 1; i++) {
    const currentSegment = sortedSegments[i];
    const nextSegment = sortedSegments[i + 1];

    // Calculate the effective end time (allowing 0.2s overlap at the end)
    const currentEffectiveEnd = currentSegment.naturalEnd - 0.2;

    // Check if there's a gap between current segment's effective end and next segment's start
    if (nextSegment.start > currentEffectiveEnd) {
      const gapStart = currentEffectiveEnd;
      const gapEnd = nextSegment.start;
      const gapDuration = gapEnd - gapStart;

      if (gapDuration > 0.1) { // Only consider gaps larger than 0.1s
        blankSpaces.push({
          start: gapStart,
          end: gapEnd,
          duration: gapDuration,
          afterSegmentId: currentSegment.subtitle_id,
          beforeSegmentId: nextSegment.subtitle_id
        });
      }
    }
  }

  return blankSpaces;
};

/**
 * Calculate distributed shifting across multiple blank spaces with gradual decrease
 * @param {Array} segmentsToShift - The segments that need to be shifted (current and following)
 * @param {Array} blankSpaces - Available blank spaces to the left
 * @param {number} requiredShift - How much shift is needed to avoid overlap
 * @returns {Object} - Object with distributed shift amounts and strategy info
 */
const calculateDistributedGroupShift = (segmentsToShift, blankSpaces, requiredShift) => {
  if (blankSpaces.length === 0) {
    return { totalShiftAmount: 0, strategy: 'push-right', canUseBlankSpaces: false, distributedShifts: [] };
  }

  // Find up to 5 blank spaces to the left, sorted by distance from the first segment (nearest first)
  const usableBlankSpaces = blankSpaces
    .filter(space => space.end <= segmentsToShift[0].start)
    .map(space => ({
      ...space,
      distanceFromSegment: segmentsToShift[0].start - space.end,
      maxUsableSpace: Math.min(space.duration - 0.1, segmentsToShift[0].start - space.start)
    }))
    .sort((a, b) => a.distanceFromSegment - b.distanceFromSegment) // Nearest first
    .slice(0, 5); // Take up to 5 blank spaces

  if (usableBlankSpaces.length === 0) {
    return { totalShiftAmount: 0, strategy: 'push-right', canUseBlankSpaces: false, distributedShifts: [] };
  }

  // Calculate total available space across all usable blank spaces
  const totalAvailableSpace = usableBlankSpaces.reduce((sum, space) => sum + space.maxUsableSpace, 0);

  if (totalAvailableSpace < 0.1) {
    return { totalShiftAmount: 0, strategy: 'push-right', canUseBlankSpaces: false, distributedShifts: [] };
  }

  // Calculate how much we can actually shift (limited by available space and required shift)
  const actualShiftAmount = Math.min(requiredShift, totalAvailableSpace);

  // Distribute the shift across blank spaces with gradual decrease (giảm dần)
  // Nearest space gets the most shift, furthest gets the least
  const distributedShifts = [];
  let remainingShift = actualShiftAmount;

  // Create a decreasing weight system: nearest = 1.0, next = 0.8, next = 0.6, etc.
  const weights = usableBlankSpaces.map((_, index) => Math.max(0.2, 1.0 - (index * 0.2)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  for (let i = 0; i < usableBlankSpaces.length && remainingShift > 0.05; i++) {
    const space = usableBlankSpaces[i];
    const weight = weights[i];

    // Calculate this space's share of the total shift (proportional to weight)
    const proposedShift = (actualShiftAmount * weight) / totalWeight;

    // Limit by space availability and remaining shift
    const actualSpaceShift = Math.min(
      proposedShift,
      space.maxUsableSpace,
      remainingShift
    );

    if (actualSpaceShift > 0.05) { // Only use shifts larger than 0.05s
      distributedShifts.push({
        blankSpace: space,
        shiftAmount: actualSpaceShift,
        weight: weight,
        segmentRange: i === 0 ? 'all' : `from-${i}`
      });
      remainingShift -= actualSpaceShift;
    }
  }

  const totalShiftAchieved = distributedShifts.reduce((sum, shift) => sum + shift.shiftAmount, 0);

  if (totalShiftAchieved > 0.1) {
    return {
      totalShiftAmount: totalShiftAchieved,
      strategy: `distributed-shift-across-${distributedShifts.length}-spaces`,
      canUseBlankSpaces: true,
      distributedShifts: distributedShifts,
      totalAvailableSpace: totalAvailableSpace
    };
  }

  return { totalShiftAmount: 0, strategy: 'push-right', canUseBlankSpaces: false, distributedShifts: [] };
};

/**
 * Analyze audio segments and adjust their timing to avoid overlaps
 * This creates a more natural narration by ensuring segments don't talk over each other
 *
 * Version 1 timing rules:
 * 1. Fit each clip to its subtitle slot between 0.75x and 1.55x.
 * 2. Reserve a 50ms gap before the next subtitle.
 * 3. Resolve remaining overlap up to 1.85x, then trim with a short fade.
 *
 * @param {Array} audioSegments - Array of audio segments to analyze
 * @returns {Promise<Array>} - Array of adjusted audio segments
 */
const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const process = spawn(getFfmpegPath(), args);
  let stderr = '';
  process.stderr.on('data', data => { stderr += data.toString(); });
  process.on('error', reject);
  process.on('close', code => {
    if (code === 0) resolve();
    else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
  });
});

const changeTempoFile = async (source, destination, tempo) => {
  await runFfmpeg([
    '-y', '-v', 'error', '-i', source,
    '-filter:a', `atempo=${tempo.toFixed(5)}`,
    '-c:a', 'pcm_s16le', '-ar', '44100', destination
  ]);
  return destination;
};

const trimAndFadeFile = async (source, destination, duration) => {
  const fadeDuration = Math.min(VERSION1_FADE_MAX_MS / 1000, Math.max(0.02, duration / 5));
  const fadeStart = Math.max(0, duration - fadeDuration);
  await runFfmpeg([
    '-y', '-v', 'error', '-i', source,
    '-filter:a', `atrim=duration=${duration.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart.toFixed(4)}:d=${fadeDuration.toFixed(4)}`,
    '-c:a', 'pcm_s16le', '-ar', '44100', destination
  ]);
  return destination;
};

const analyzeAndAdjustSegments = async (audioSegments) => {
  if (!audioSegments || audioSegments.length === 0) {
    return audioSegments || [];
  }

  const sorted = [...audioSegments].sort((a, b) => a.start - b.start);
  const fitted = [];
  let initialSpeedups = 0;
  let overlapSpeedups = 0;
  let faded = 0;

  for (let index = 0; index < sorted.length; index++) {
    const segment = { ...sorted[index] };
    const rawDuration = await getMediaDuration(segment.path);
    const subtitleDuration = Math.max(0.35, (segment.end ?? segment.start) - segment.start);
    const initialTempo = Math.min(VERSION1_INITIAL_MAX_TEMPO, Math.max(VERSION1_MIN_TEMPO, rawDuration / subtitleDuration));
    if (rawDuration > 0.05 && Math.abs(initialTempo - 1) >= 0.02) {
      const destination = path.join(TEMP_AUDIO_DIR, `legacy_fit_${Date.now()}_${index}.wav`);
      await changeTempoFile(segment.path, destination, initialTempo);
      segment.path = destination;
      initialSpeedups++;
    }
    segment.actualDuration = await getMediaDuration(segment.path);
    segment.naturalEnd = segment.start + segment.actualDuration;
    fitted.push(segment);
  }

  for (let index = 0; index < fitted.length - 1; index++) {
    const current = fitted[index];
    const next = fitted[index + 1];
    const slotMs = Math.max(VERSION1_MIN_SLOT_MS, Math.round((next.start - current.start) * 1000) - VERSION1_OVERLAP_GAP_MS);
    let audioDurationMs = current.actualDuration * 1000;
    if (audioDurationMs <= slotMs) {
      continue;
    }

    const overlapTempo = Math.min(VERSION1_OVERLAP_MAX_TEMPO, audioDurationMs / slotMs);
    if (overlapTempo >= VERSION1_OVERLAP_RETIME_THRESHOLD) {
      const destination = path.join(TEMP_AUDIO_DIR, `legacy_overlap_${Date.now()}_${index}.wav`);
      await changeTempoFile(current.path, destination, overlapTempo);
      current.path = destination;
      current.actualDuration = await getMediaDuration(destination);
      current.naturalEnd = current.start + current.actualDuration;
      audioDurationMs = current.actualDuration * 1000;
      overlapSpeedups++;
    }

    if (audioDurationMs > slotMs) {
      const destination = path.join(TEMP_AUDIO_DIR, `legacy_fade_${Date.now()}_${index}.wav`);
      await trimAndFadeFile(current.path, destination, slotMs / 1000);
      current.path = destination;
      current.actualDuration = await getMediaDuration(destination);
      current.naturalEnd = current.start + current.actualDuration;
      faded++;
    }
  }

  console.log(`Legacy TTS alignment: initial speedups=${initialSpeedups}, overlap speedups=${overlapSpeedups}, fades=${faded}`);
  return fitted;
};
const processBatch = async (audioSegments, outputPath, batchIndex, totalDuration, smartOverlapResolution = true) => {

  // Apply version 1 fitting and overlap resolution if enabled
  let segmentsToProcess = audioSegments;
  if (smartOverlapResolution && audioSegments.length > 1) {
    try {
      // Fit clips before building the delayed audio mix
      segmentsToProcess = await analyzeAndAdjustSegments(audioSegments);
    } catch (error) {
      console.error(`Error during legacy TTS alignment: ${error.message}`);
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
    filterComplex += `[${inputIndex}]aresample=44100,adelay=${delayMs}|${delayMs},volume=1.0[${delayedStreamName}]; `;
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
