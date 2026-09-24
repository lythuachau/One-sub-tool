/**
 * Directory management and utility functions for narration
 */

const path = require('path');
const fs = require('fs');

// Import narration directory from config
const { NARRATION_DIR } = require('../../config');

// Directories - use only root directory
const REFERENCE_AUDIO_DIR = path.join(NARRATION_DIR, 'reference');
const OUTPUT_AUDIO_DIR = path.join(NARRATION_DIR, 'output');
const TEMP_AUDIO_DIR = path.join(NARRATION_DIR, 'temp');

/**
 * Get the directory path for a specific subtitle ID
 * @param {string|number} subtitle_id - The subtitle ID
 * @returns {string} - The directory path for the subtitle ID
 */
const normalizeScope = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[-_.]+|[-_.]+$/g, '');
};

const getSubtitleDirectory = (subtitle_id, generationId = '') => {
  const scope = normalizeScope(generationId);
  const root = scope ? path.join(OUTPUT_AUDIO_DIR, scope) : OUTPUT_AUDIO_DIR;
  return path.join(root, `subtitle_${subtitle_id}`);
};

/**
 * Ensure a subtitle-specific directory exists
 * @param {string|number} subtitle_id - The subtitle ID
 * @returns {string} - The directory path that was created
 */
const ensureSubtitleDirectory = (subtitle_id, generationId = '') => {
  const subtitleDir = getSubtitleDirectory(subtitle_id, generationId);
  if (!fs.existsSync(subtitleDir)) {
    fs.mkdirSync(subtitleDir, { recursive: true });
  }
  return subtitleDir;
};

/**
 * Clear all narration output files
 */
const clearNarrationOutputFiles = () => {
  if (fs.existsSync(OUTPUT_AUDIO_DIR)) {
    const outputItems = fs.readdirSync(OUTPUT_AUDIO_DIR);
    let deletedCount = 0;

    outputItems.forEach(item => {
      const itemPath = path.join(OUTPUT_AUDIO_DIR, item);
      try {
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
          fs.rmSync(itemPath, { recursive: true, force: true });
          deletedCount++;
        } else {
          // For files in the root output directory (legacy files)
          fs.unlinkSync(itemPath);
          deletedCount++;
        }
      } catch (error) {
        console.error(`Error deleting item ${itemPath}:`, error);
      }
    });
  }
};

/**
 * Ensure narration directories exist
 */
const ensureNarrationDirectories = () => {
  if (!fs.existsSync(NARRATION_DIR)) {
    fs.mkdirSync(NARRATION_DIR, { recursive: true });
  }

  if (!fs.existsSync(REFERENCE_AUDIO_DIR)) {
    fs.mkdirSync(REFERENCE_AUDIO_DIR, { recursive: true });
  }

  if (!fs.existsSync(OUTPUT_AUDIO_DIR)) {
    fs.mkdirSync(OUTPUT_AUDIO_DIR, { recursive: true });
  }

  if (!fs.existsSync(TEMP_AUDIO_DIR)) {
    fs.mkdirSync(TEMP_AUDIO_DIR, { recursive: true });
  }
};

/**
 * Clean up old subtitle directories when using grouped narrations
 * This removes directories for subtitle IDs that are not used in the grouped narrations
 * @param {Array} groupedSubtitles - Array of grouped subtitle objects with subtitle_id
 */
const cleanupOldSubtitleDirectories = (groupedSubtitles) => {
  try {
    if (!groupedSubtitles || groupedSubtitles.length === 0) {
      console.log('No grouped subtitles provided for cleanup');
      return;
    }

    // Get all existing subtitle directories
    if (!fs.existsSync(OUTPUT_AUDIO_DIR)) {
      return;
    }

    const existingItems = fs.readdirSync(OUTPUT_AUDIO_DIR);
    const existingSubtitleDirs = existingItems.filter(item => {
      const itemPath = path.join(OUTPUT_AUDIO_DIR, item);
      return fs.statSync(itemPath).isDirectory() && item.startsWith('subtitle_');
    });

    // Extract subtitle IDs that should be kept (from grouped narrations)
    const usedSubtitleIds = new Set();
    groupedSubtitles.forEach(subtitle => {
      const id = subtitle.subtitle_id || subtitle.id;
      if (id) {
        usedSubtitleIds.add(id.toString());
      }
    });

    console.log(`Cleanup: Found ${existingSubtitleDirs.length} existing subtitle directories`);
    console.log(`Cleanup: Keeping directories for subtitle IDs: ${Array.from(usedSubtitleIds).join(', ')}`);

    // Remove directories for subtitle IDs that are not used in grouped narrations
    let deletedCount = 0;
    existingSubtitleDirs.forEach(dirName => {
      // Extract subtitle ID from directory name (e.g., "subtitle_5" -> "5")
      const match = dirName.match(/^subtitle_(\d+)$/);
      if (match) {
        const subtitleId = match[1];
        if (!usedSubtitleIds.has(subtitleId)) {
          const dirPath = path.join(OUTPUT_AUDIO_DIR, dirName);
          try {
            // Delete all files in the directory first
            const files = fs.readdirSync(dirPath);
            files.forEach(file => {
              fs.unlinkSync(path.join(dirPath, file));
            });
            // Then remove the directory
            fs.rmdirSync(dirPath);
            console.log(`Cleanup: Deleted unused subtitle directory: ${dirName}`);
            deletedCount++;
          } catch (error) {
            console.error(`Cleanup: Error deleting directory ${dirName}:`, error);
          }
        }
      }
    });

    console.log(`Cleanup: Deleted ${deletedCount} unused subtitle directories`);
  } catch (error) {
    console.error('Error during subtitle directory cleanup:', error);
  }
};

/**
 * Clear narration output files endpoint handler
 */
const clearOutput = (_, res) => {
  try {
    clearNarrationOutputFiles();
    res.json({ success: true, message: 'Narration output files cleared successfully' });
  } catch (error) {
    console.error('Error clearing narration output files:', error);
    res.status(500).json({ success: false, error: 'Failed to clear narration output files' });
  }
};

module.exports = {
  REFERENCE_AUDIO_DIR,
  OUTPUT_AUDIO_DIR,
  TEMP_AUDIO_DIR,
  getSubtitleDirectory,
  ensureSubtitleDirectory,
  clearNarrationOutputFiles,
  ensureNarrationDirectories,
  clearOutput,
  cleanupOldSubtitleDirectories
};
