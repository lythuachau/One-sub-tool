/**
 * Module for serving audio files from narration directories
 */

const path = require('path');
const fs = require('fs');

// Import directory paths
const { REFERENCE_AUDIO_DIR, OUTPUT_AUDIO_DIR, TEMP_AUDIO_DIR } = require('../directoryManager');

/**
 * Serve audio file from narration directories
 */
const serveAudioFile = (req, res) => {
  try {
    // Get the filename from the request parameters
    const { filename } = req.params;

    console.log(`[DEBUG] Serving audio file: ${filename}`);

    if (!filename) {
      console.error('No filename provided');
      return res.status(400).json({ error: 'No filename provided' });
    }

    const normalizedFilename = filename.replace(/\\/g, '/');
    if (path.isAbsolute(normalizedFilename) || normalizedFilename.split('/').includes('..')) {
      return res.status(400).json({ error: 'Invalid audio filename' });
    }

    // Check if the filename includes a path separator (new structure)
    if (filename.includes(path.sep) || filename.includes('/')) {
      console.log(`[DEBUG] Handling path with separators: ${filename}`);

      // Handle new directory structure (subtitle_id/number.wav)
      // Always use forward slashes for URL paths, then convert to OS-specific path
      const parts = filename.split('/');

      // Log the parts for debugging
      console.log(`[DEBUG] Path parts: ${JSON.stringify(parts)}`);

      // If we have exactly 2 parts (subtitle_ID/number.wav), handle it as our new structure
      if (parts.length === 2 && parts[0].startsWith('subtitle_')) {
        const subtitleDir = parts[0];
        const audioFile = parts[1];

        const outputPath = path.join(OUTPUT_AUDIO_DIR, subtitleDir, audioFile);

        console.log(`[DEBUG] Checking new structure path: ${outputPath}`);

        if (fs.existsSync(outputPath)) {
          console.log(`[DEBUG] Found file at new structure path: ${outputPath}`);
          return res.sendFile(outputPath, { headers: { 'Content-Type': 'audio/wav' } });
        } else {
          console.log(`[DEBUG] File not found at new structure path: ${outputPath}`);

          // Try with a different case (Windows is case-insensitive but URLs might be case-sensitive)
          const files = fs.readdirSync(path.join(OUTPUT_AUDIO_DIR, subtitleDir));
          console.log(`[DEBUG] Files in ${subtitleDir}: ${JSON.stringify(files)}`);

          // Try to find a case-insensitive match
          const matchingFile = files.find(file => file.toLowerCase() === audioFile.toLowerCase());
          if (matchingFile) {
            const caseCorrectedPath = path.join(OUTPUT_AUDIO_DIR, subtitleDir, matchingFile);
            console.log(`[DEBUG] Found case-insensitive match: ${caseCorrectedPath}`);
            return res.sendFile(caseCorrectedPath, { headers: { 'Content-Type': 'audio/wav' } });
          }
        }
      } else {
        // Handle other path formats
        const normalizedPath = filename.replace(/\//g, path.sep); // Normalize path separators
        const outputPath = path.join(OUTPUT_AUDIO_DIR, normalizedPath);

        console.log(`[DEBUG] Checking alternative path structure: ${outputPath}`);

        if (fs.existsSync(outputPath)) {
          console.log(`[DEBUG] Found file at alternative path: ${outputPath}`);
          return res.sendFile(outputPath, { headers: { 'Content-Type': 'audio/wav' } });
        } else {
          console.log(`[DEBUG] File not found at alternative path: ${outputPath}`);
        }
      }
    } else {
      // Legacy path handling - check in root directories

      // Check if the file is in the output directory
      const outputPath = path.join(OUTPUT_AUDIO_DIR, filename);
      console.log(`[DEBUG] Checking legacy output path: ${outputPath}`);

      if (fs.existsSync(outputPath)) {
        console.log(`[DEBUG] Found file at legacy output path: ${outputPath}`);
        return res.sendFile(outputPath, { headers: { 'Content-Type': 'audio/wav' } });
      }

      // Check if the file is in the reference directory
      const referencePath = path.join(REFERENCE_AUDIO_DIR, filename);
      console.log(`[DEBUG] Checking reference path: ${referencePath}`);

      if (fs.existsSync(referencePath)) {
        console.log(`[DEBUG] Found file at reference path: ${referencePath}`);
        return res.sendFile(referencePath, { headers: { 'Content-Type': 'audio/wav' } });
      }

      // Check if the file is in the temp directory
      const tempPath = path.join(TEMP_AUDIO_DIR, filename);
      console.log(`[DEBUG] Checking temp path: ${tempPath}`);

      if (fs.existsSync(tempPath)) {
        console.log(`[DEBUG] Found file at temp path: ${tempPath}`);
        return res.sendFile(tempPath, { headers: { 'Content-Type': 'audio/wav' } });
      }

      // If we get here, try to find the file in any subtitle directory
      try {
        const subtitleDirs = fs.readdirSync(OUTPUT_AUDIO_DIR)
          .filter(item => item.startsWith('subtitle_') &&
                  fs.statSync(path.join(OUTPUT_AUDIO_DIR, item)).isDirectory());

        console.log(`[DEBUG] Searching in subtitle directories: ${subtitleDirs.join(', ')}`);

        // Look for a file with the same name in any subtitle directory
        for (const dir of subtitleDirs) {
          const dirPath = path.join(OUTPUT_AUDIO_DIR, dir);
          const files = fs.readdirSync(dirPath);

          // If the filename is a number (like "4.wav"), look for it
          if (/^\d+\.wav$/.test(filename)) {
            if (files.includes(filename)) {
              const foundPath = path.join(dirPath, filename);
              console.log(`[DEBUG] Found file in subtitle directory: ${foundPath}`);
              return res.sendFile(foundPath, { headers: { 'Content-Type': 'audio/wav' } });
            }
          }
        }
      } catch (err) {
        console.error(`[DEBUG] Error searching subtitle directories: ${err.message}`);
      }
    }

    // If the file is not found in any directory
    console.error(`Audio file not found: ${filename}`);

    // Try to list the contents of the output directory to help with debugging
    try {
      console.log(`[DEBUG] Contents of OUTPUT_AUDIO_DIR (${OUTPUT_AUDIO_DIR}):`);
      const outputDirContents = fs.readdirSync(OUTPUT_AUDIO_DIR);
      console.log(outputDirContents);

      // Check if there are any subtitle directories
      const subtitleDirs = outputDirContents.filter(item =>
        item.startsWith('subtitle_') &&
        fs.statSync(path.join(OUTPUT_AUDIO_DIR, item)).isDirectory()
      );

      if (subtitleDirs.length > 0) {
        console.log(`[DEBUG] Found subtitle directories: ${subtitleDirs.join(', ')}`);

        // Check the contents of the first few subtitle directories
        for (let i = 0; i < Math.min(3, subtitleDirs.length); i++) {
          const dirPath = path.join(OUTPUT_AUDIO_DIR, subtitleDirs[i]);
          console.log(`[DEBUG] Contents of ${dirPath}:`);
          console.log(fs.readdirSync(dirPath));
        }
      }
    } catch (err) {
      console.error(`[DEBUG] Error listing directory contents: ${err.message}`);
    }

    return res.status(404).json({ error: 'Audio file not found' });
  } catch (error) {
    console.error('Error serving audio file:', error);
    return res.status(500).json({ error: `Failed to serve audio file: ${error.message}` });
  }
};

module.exports = {
  serveAudioFile
};
