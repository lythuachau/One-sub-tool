/**
 * Module for aligning audio segments with precise timing
 * Includes batch processing to handle large numbers of segments
 * Uses version 1 narration timing and overlap rules
 */

const path = require('path');
const fs = require('fs');

// Import directory paths
const { OUTPUT_AUDIO_DIR, TEMP_AUDIO_DIR } = require('../directoryManager');

// Import batch processing functions
const { processBatch, concatenateAudioFiles } = require('./batchProcessor');

// Import duration utility
const { getMediaDuration } = require('../../../services/videoProcessing/durationUtils');

// Maximum number of segments to process in a single batch
const MAX_SEGMENTS_PER_BATCH = 200;

const resolveNarrationPath = (filename) => {
  const root = path.resolve(OUTPUT_AUDIO_DIR);
  const resolved = path.resolve(root, String(filename || '').replace(/[\\/]+/g, path.sep));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid narration filename');
  }
  return resolved;
};

/**
 * Download aligned narration audio (one file)
 *
 * This function handles both F5-TTS and Gemini narrations in the same way,
 * ensuring consistent alignment and playback in the video player.
 *
 * Audio processing fits each clip to its subtitle slot, reserves a 50ms gap,
 * applies the version 1 overlap speed and fade limits, then mixes without a
 * per-segment volume boost.
 *
 * For large numbers of segments, the function splits them into batches to avoid
 * ENAMETOOLONG errors when the FFmpeg command becomes too long.
 */
const downloadAlignedAudio = async (req, res) => {


  // Define variables at the top level so they're available in the catch block
  let outputPath;
  let audioSegments = [];
  let tempDir;
  let timestamp;
  let batchFiles = [];

  try {
    // Get the narration data from the request body
    const { narrations } = req.body;


    if (!narrations || narrations.length === 0) {

      return res.status(400).json({ error: 'No narrations provided' });
    }

    // Sort narrations by start time to ensure correct order
    narrations.sort((a, b) => a.start - b.start);

    // Create a temporary directory for the aligned audio files
    tempDir = path.join(TEMP_AUDIO_DIR);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Create the output file path
    timestamp = Date.now();
    const outputFilename = `aligned_narration_${timestamp}.wav`;
    outputPath = path.join(tempDir, outputFilename);

    // Reset the audioSegments array
    audioSegments = [];

    // Narrations will be processed below

    for (const narration of narrations) {
      // Handle both F5-TTS and Gemini narrations
      // F5-TTS narrations have a filename property
      // Gemini narrations might have audioData property (base64 encoded audio)
      if (narration.filename) {
        // First, try the filename as provided
        let filePath = resolveNarrationPath(narration.filename);
        console.log(`Checking for audio file: ${filePath}`);

        // List the contents of the subtitle directory to help debug
        const subtitleDir = path.dirname(filePath);
        try {
          if (fs.existsSync(subtitleDir)) {
            const dirContents = fs.readdirSync(subtitleDir);
            console.log(`Contents of ${subtitleDir}:`, dirContents);

            // If the file doesn't exist but we have a pattern like "subtitle_X/f5tts_1.wav",
            // try looking for "subtitle_X/1.wav" instead
            if (!fs.existsSync(filePath) && narration.filename.includes('f5tts_1.wav')) {
              const alternativeFilename = narration.filename.replace('f5tts_1.wav', '1.wav');
              const alternativePath = resolveNarrationPath(alternativeFilename);

              console.log(`Trying alternative path: ${alternativePath}`);

              if (fs.existsSync(alternativePath)) {
                console.log(`Found file at alternative path: ${alternativePath}`);
                filePath = alternativePath;
                narration.filename = alternativeFilename;
              }
            }
          } else {
            console.log(`Subtitle directory does not exist: ${subtitleDir}`);
          }
        } catch (dirError) {
          console.error(`Error listing directory: ${dirError.message}`);
        }

        if (!fs.existsSync(filePath)) {
          console.error(`Audio file not found: ${filePath}`);

          // Try to find the file with a different naming pattern
          // Sometimes F5-TTS files might be named differently
          const subtitleDir = path.dirname(filePath);

          if (fs.existsSync(subtitleDir)) {
            // Check if there are any audio files in the directory (wav or mp3)
            const files = fs.readdirSync(subtitleDir);
            const audioFiles = files.filter(file => file.endsWith('.wav') || file.endsWith('.mp3'));

            if (audioFiles.length > 0) {
              console.log(`Found alternative audio files in ${subtitleDir}:`, audioFiles);

              // Use the first audio file as an alternative
              const alternativeFilePath = path.join(subtitleDir, audioFiles[0]);
              console.log(`Using alternative file: ${alternativeFilePath}`);

              // Update the narration object with the new filename
              narration.filename = `${path.basename(subtitleDir)}/${audioFiles[0]}`;

              // Ensure we have valid timing information
              const start = typeof narration.start === 'number' ? narration.start : 0;
              const end = typeof narration.end === 'number' ? narration.end : (start + 5); // Default 5 seconds if no end time

              // Check if this is a grouped subtitle
              const isGrouped = narration.original_ids && narration.original_ids.length > 1;

              // Continue with the updated filename
              audioSegments.push({
                path: alternativeFilePath,
                start: start,
                end: end,
                subtitle_id: narration.subtitle_id,
                original_ids: narration.original_ids,
                type: 'file',
                isGrouped: isGrouped
              });

              // Skip the error and continue processing
              continue;
            }
          }

          // If no alternative found, skip this narration instead of failing
          console.warn(`Audio file not found, skipping: ${narration.filename}`);
          console.warn(`Expected path: ${filePath}`);
          console.warn(`Subtitle directory exists: ${fs.existsSync(subtitleDir)}`);
          console.warn(`Subtitle directory: ${subtitleDir}`);
          console.log(`Skipping missing narration for subtitle_id: ${narration.subtitle_id}`);

          // Continue with the next narration instead of returning an error
          continue;
        }
      } else if (!narration.audioData) {
        // If neither filename nor audioData is present, skip this narration
        console.warn(`No audio data or filename for narration with subtitle ID: ${narration.subtitle_id}, skipping`);
        continue;
      }

      // Check file size to ensure it's a valid audio file (only for file-based narrations)
      if (narration.filename) {
        const filePath = resolveNarrationPath(narration.filename);
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {

          return res.status(400).json({ error: `Audio file is empty: ${narration.filename}` });
        }
      }

      // Ensure we have valid timing information
      const start = typeof narration.start === 'number' ? narration.start : 0;
      const end = typeof narration.end === 'number' ? narration.end : (start + 5); // Default 5 seconds if no end time

      // Ensure each segment has a reasonable duration
      const duration = end - start;
      if (duration <= 0) {

        return res.status(400).json({ error: `Invalid duration for audio file: ${narration.filename}` });
      }

      // Check if this is a grouped subtitle
      const isGrouped = narration.original_ids && narration.original_ids.length > 1;
      if (isGrouped) {
        console.log(`Processing grouped subtitle ${narration.subtitle_id} with ${narration.original_ids.length} original subtitles`);
      }

      // For file-based narrations (F5-TTS or Gemini)
      if (narration.filename) {
        const filePath = resolveNarrationPath(narration.filename);
        audioSegments.push({
          path: filePath,
          start: start,
          end: end,
          subtitle_id: narration.subtitle_id,
          original_ids: narration.original_ids, // Include original_ids for grouped subtitles
          type: 'file',
          isGrouped: isGrouped
        });
      }
      // For base64-encoded narrations (Gemini)
      else if (narration.audioData) {
        // Create a temporary file for the base64 audio data
        const tempFilename = `temp_gemini_${narration.subtitle_id}_${Date.now()}.wav`;
        const tempFilePath = path.join(TEMP_AUDIO_DIR, tempFilename);

        // Ensure the temp directory exists
        if (!fs.existsSync(TEMP_AUDIO_DIR)) {
          fs.mkdirSync(TEMP_AUDIO_DIR, { recursive: true });
        }

        // Decode and write the base64 audio data to a temporary file
        try {
          // Extract the base64 data (remove data URL prefix if present)
          let base64Data = narration.audioData;
          if (base64Data.includes(',')) {
            base64Data = base64Data.split(',')[1];
          }

          // Write the decoded data to a file
          fs.writeFileSync(tempFilePath, Buffer.from(base64Data, 'base64'));

          // Add to our segments list
          audioSegments.push({
            path: tempFilePath,
            start: start,
            end: end,
            subtitle_id: narration.subtitle_id,
            original_ids: narration.original_ids, // Include original_ids for grouped subtitles
            type: 'temp',
            isGrouped: isGrouped,
            tempFile: tempFilePath // Track for cleanup later
          });
        } catch (error) {
          console.error(`Error processing base64 audio data for ${isGrouped ? 'grouped ' : ''}subtitle ${narration.subtitle_id}:`, error);
          return res.status(500).json({ error: `Failed to process audio data for subtitle ${narration.subtitle_id}` });
        }
      }
    }

    // Check if we have any audio segments to process
    if (audioSegments.length === 0) {
      console.warn('No valid audio segments found for aligned narration generation');
      return res.status(400).json({
        error: 'No valid audio files found for aligned narration generation',
        details: {
          total_narrations: narrations.length,
          processed_segments: 0,
          message: 'All narration files were missing or invalid. Please ensure narrations are generated successfully before creating aligned audio.'
        }
      });
    }

    console.log(`Successfully processed ${audioSegments.length} audio segments out of ${narrations.length} narrations`);

    // Sort segments by start time (redundant if narrations already sorted, but safe)
    audioSegments.sort((a, b) => a.start - b.start);

    // Find the total duration needed (end time of the last adjusted segment)
    // Use the adjusted segments to get the actual final duration
    const totalDuration = audioSegments.length > 0
      ? Math.max(...audioSegments.map(s => s.naturalEnd || (s.start + s.actualDuration) || s.end)) + 1 // Add 1 second buffer for FFmpeg processing
      : 1; // Default to 1 second if no segments




    // Check if we need to use batch processing
    if (audioSegments.length > MAX_SEGMENTS_PER_BATCH) {


      // Split the segments into batches
      const batches = [];
      for (let i = 0; i < audioSegments.length; i += MAX_SEGMENTS_PER_BATCH) {
        batches.push(audioSegments.slice(i, i + MAX_SEGMENTS_PER_BATCH));
      }



      // Process each batch
      for (let i = 0; i < batches.length; i++) {
        const batchOutputPath = path.join(tempDir, `batch_${i}_${timestamp}.wav`);

        // Process the batch
        await processBatch(batches[i], batchOutputPath, i, totalDuration);

        // Add the batch output file to the list of files to concatenate
        batchFiles.push(batchOutputPath);
      }

      // Concatenate the batch files
      await concatenateAudioFiles(batchFiles, outputPath);

      // Clean up the batch files
      for (const batchFile of batchFiles) {
        try {
          if (fs.existsSync(batchFile)) {
            fs.unlinkSync(batchFile);

          }
        } catch (cleanupError) {
          console.error(`Error cleaning up batch file: ${cleanupError.message}`);
        }
      }
    } else {
      // For smaller numbers of segments, process them all at once

      await processBatch(audioSegments, outputPath, 0, totalDuration);
    }

    // Check if the output file was created
    if (!fs.existsSync(outputPath)) {
      console.error(`Output file was not created: ${outputPath}`);
      return res.status(500).json({ error: 'Failed to create aligned audio file' });
    }

    // Check if the output file has content
    const outputStats = fs.statSync(outputPath);
    if (outputStats.size === 0) {
      console.error(`Output file is empty: ${outputPath}`);
      // Attempt cleanup even on error
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) { console.error('Error cleaned up empty output file:', e); }
      return res.status(500).json({ error: 'Created aligned audio file is empty' });
    }

    // Calculate duration information for notification check
    const firstSubtitleStart = 0; // Always start from 0 instead of first subtitle start
    const lastSubtitleEnd = Math.max(...narrations.map(n => n.end || 0));
    const expectedDuration = lastSubtitleEnd - firstSubtitleStart;

    // Get REAL duration from the actual generated audio file using FFmpeg
    let actualDuration = 0;
    let durationDifference = 0;

    try {
      console.log(`[SERVER] Getting real duration from generated audio file: ${outputPath}`);
      const actualDurationResult = await getMediaDuration(outputPath);
      actualDuration = actualDurationResult;
      durationDifference = actualDuration - expectedDuration;

      console.log(`[SERVER] Duration calculation for notification:`);
      console.log(`[SERVER]   Original subtitle range: ${firstSubtitleStart.toFixed(2)}s to ${lastSubtitleEnd.toFixed(2)}s`);
      console.log(`[SERVER]   Expected duration: ${expectedDuration.toFixed(2)}s`);
      console.log(`[SERVER]   REAL audio file duration: ${actualDuration.toFixed(2)}s (measured from file)`);
      console.log(`[SERVER]   Duration difference: ${durationDifference.toFixed(2)}s`);

      if (durationDifference > 3) {
        console.log(`[SERVER]   ⚠️  Duration difference > 3s - notification will be triggered`);
      } else {
        console.log(`[SERVER]   ✅ Duration difference <= 3s - no notification needed`);
      }
    } catch (error) {
      console.error(`[SERVER] Error getting real audio duration: ${error.message}`);
      // Fallback to 0 difference if we can't measure
      actualDuration = expectedDuration;
      durationDifference = 0;
    }

    // Set the appropriate headers
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename=${outputFilename}`);

    // Add duration information to headers for frontend notification
    res.setHeader('X-Duration-Difference', durationDifference.toFixed(2));
    res.setHeader('X-Expected-Duration', expectedDuration.toFixed(2));
    res.setHeader('X-Actual-Duration', actualDuration.toFixed(2));

    // Expose custom headers to frontend
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Duration-Difference, X-Expected-Duration, X-Actual-Duration');

    // Send the file
    res.sendFile(outputPath, (err) => {
      if (err) {
        console.error(`Error sending file: ${err.message}`);
        // Don't send another response if headers are already sent
        if (!res.headersSent) {
          res.status(500).json({ error: `Failed to send audio file: ${err.message}` });
        }
      } else {

      }

      // Clean up the temporary files AFTER sending is complete or failed
      try {
        // Clean up the output file
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);

        }

        // Clean up any temporary files created for base64 audio data
        for (const segment of audioSegments) {
          if (segment.type === 'temp' && segment.tempFile && fs.existsSync(segment.tempFile)) {
            fs.unlinkSync(segment.tempFile);

          }
        }
      } catch (cleanupError) {
        console.error(`Error cleaning up temporary files: ${cleanupError.message}`);
      }
    });
  } catch (error) {
    console.error('Error creating aligned audio file:', error);

    // Clean up any temporary files that might have been created
    try {
      // Clean up the output file if it exists
      if (outputPath && fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);

      }

      // Clean up any batch files
      if (batchFiles && batchFiles.length > 0) {
        for (const batchFile of batchFiles) {
          if (fs.existsSync(batchFile)) {
            fs.unlinkSync(batchFile);

          }
        }
      }

      // Clean up any temporary files created for base64 audio data
      if (audioSegments) {
        for (const segment of audioSegments) {
          if (segment.type === 'temp' && segment.tempFile && fs.existsSync(segment.tempFile)) {
            fs.unlinkSync(segment.tempFile);

          }
        }
      }
    } catch (cleanupError) {
      console.error(`Error cleaning up temporary files after error: ${cleanupError.message}`);
    }

    // Ensure response is sent even if error happens before sending file
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to create aligned audio file: ${error.message}` });
    }
  }
};

module.exports = {
  downloadAlignedAudio
};
