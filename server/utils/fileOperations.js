/**
 * Safe file operations utilities
 * These utilities help avoid EPERM errors on Windows by using copy-then-delete instead of rename
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

/**
 * Safely move a file by copying it and then deleting the original
 * This avoids EPERM errors on Windows that can occur with rename operations
 * 
 * @param {string} sourcePath - Path to the source file
 * @param {string} destPath - Path to the destination file
 * @returns {Promise<void>} - Promise that resolves when the operation is complete
 */
const safeMoveFile = async (sourcePath, destPath) => {
  try {
    // Make sure the destination directory exists
    const destDir = path.dirname(destPath);
    await fsPromises.mkdir(destDir, { recursive: true });
    
    // Copy the file
    await fsPromises.copyFile(sourcePath, destPath);
    
    // Delete the original file
    try {
      await fsPromises.unlink(sourcePath);
    } catch (deleteError) {
      console.warn(`Warning: Could not delete original file ${sourcePath} after copying: ${deleteError.message}`);
      // Continue anyway since the copy was successful
    }
    
    return destPath;
  } catch (error) {
    console.error(`Error in safeMoveFile from ${sourcePath} to ${destPath}:`, error);
    throw error;
  }
};

/**
 * Synchronous version of safeMoveFile
 * 
 * @param {string} sourcePath - Path to the source file
 * @param {string} destPath - Path to the destination file
 * @returns {string} - Path to the destination file
 */
const safeMoveFileSync = (sourcePath, destPath) => {
  try {
    // Make sure the destination directory exists
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    // Copy the file
    fs.copyFileSync(sourcePath, destPath);
    
    // Delete the original file
    try {
      fs.unlinkSync(sourcePath);
    } catch (deleteError) {
      console.warn(`Warning: Could not delete original file ${sourcePath} after copying: ${deleteError.message}`);
      // Continue anyway since the copy was successful
    }
    
    return destPath;
  } catch (error) {
    console.error(`Error in safeMoveFileSync from ${sourcePath} to ${destPath}:`, error);
    throw error;
  }
};

const publishVideoFile = async (sourcePath, destPath) => {
  const stagingPath = `${destPath}.${require('crypto').randomUUID()}.pending`;
  await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
  try {
    await fsPromises.copyFile(sourcePath, stagingPath, fs.constants.COPYFILE_EXCL);
    const stat = await fsPromises.stat(stagingPath);
    if (!stat.size) throw new Error('Downloaded video is empty');
    for (let attempt = 0; ; attempt++) {
      try {
        await fsPromises.rename(stagingPath, destPath);
        break;
      } catch (error) {
        if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt >= 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    await fsPromises.unlink(sourcePath).catch(error => console.warn(`Temporary video cleanup: ${error.message}`));
    return destPath;
  } finally {
    await fsPromises.unlink(stagingPath).catch(error => {
      if (error.code !== 'ENOENT') console.warn(`Video staging cleanup: ${error.message}`);
    });
  }
};

module.exports = {
  publishVideoFile,
  safeMoveFile,
  safeMoveFileSync
};
