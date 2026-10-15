/**
 * Script to install yt-dlp in the virtual environment using uv
 * Enhanced with retry logic and better error handling
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Import our logging utility
const { Logger } = require('./utils/logger');
const logger = new Logger({
    verbose: process.env.VERBOSE === 'true',
    quiet: process.env.QUIET === 'true'
});

// Define the virtual environment directory
const VENV_DIR = '.venv';
const isWindows = os.platform() === 'win32';
const venvBinDir = isWindows ? 'Scripts' : 'bin';
const ytdlpPath = path.join(process.cwd(), VENV_DIR, venvBinDir, isWindows ? 'yt-dlp.exe' : 'yt-dlp');

// Helper function to execute commands with retries
function executeWithRetry(command, options = {}, maxRetries = 3) {
  let retries = 0;
  let lastError = null;

  while (retries < maxRetries) {
    try {
      logger.command(command);
      const env = { ...process.env, UV_HTTP_TIMEOUT: '300', ...options.env }; // 5 minutes timeout
      execSync(command, { stdio: logger.verboseMode ? 'inherit' : 'ignore', env, ...options });
      return true; // Success
    } catch (error) {
      lastError = error;
      retries++;
      if (logger.verboseMode) {
        logger.warning(`Attempt ${retries}/${maxRetries} failed: ${error.message}`);
      }

      if (retries < maxRetries) {
        const waitTime = retries * 2000; // Exponential backoff: 2s, 4s, 6s...
        logger.progress(`Waiting ${waitTime/1000} seconds before retrying...`);
        try {
          execSync(`sleep ${waitTime/1000}`, { stdio: 'ignore' });
        } catch (e) {
          // On Windows, sleep is not available, use a timeout instead
          const startTime = Date.now();
          while (Date.now() - startTime < waitTime) {
            // Wait
          }
        }
      }
    }
  }

  throw lastError || new Error(`Failed after ${maxRetries} attempts`);
}

// Create virtual environment if it doesn't exist
logger.checking('virtual environment');
if (!fs.existsSync(VENV_DIR)) {
  logger.warning('Virtual environment not found. Creating one...');
  try {
    executeWithRetry('uv venv');
    logger.success('Virtual environment created');
  } catch (error) {
    logger.warning(`Error creating virtual environment: ${error.message}`);
    logger.progress('Trying alternative method...');

    try {
      // Try with python -m venv as fallback
      executeWithRetry('python -m venv .venv');
      logger.success('Virtual environment created using python -m venv');
    } catch (fallbackError) {
      logger.error('All attempts to create virtual environment failed');
      logger.error(`Last error: ${fallbackError.message}`);
      process.exit(1);
    }
  }
}

// Install or update yt-dlp
logger.checking('if yt-dlp is already installed');
if (fs.existsSync(ytdlpPath)) {
  logger.found('yt-dlp is already installed');

  // Try to update it
  logger.progress('Updating yt-dlp to the latest version');
  try {
    executeWithRetry('uv pip install --python .venv --upgrade yt-dlp');
    logger.success('yt-dlp updated successfully');
  } catch (error) {
    logger.warning(`Error updating yt-dlp: ${error.message}`);
    logger.info('Continuing with the existing version');
  }
} else {
  logger.installing('yt-dlp');
  try {
    executeWithRetry('uv pip install --python .venv yt-dlp');
    logger.success('yt-dlp installed successfully');
  } catch (error) {
    logger.warning(`Error installing yt-dlp with uv: ${error.message}`);
    logger.progress('Trying alternative installation method...');

    try {
      // Try with pip as fallback
      if (isWindows) {
        executeWithRetry(`${VENV_DIR}\\${venvBinDir}\\pip install yt-dlp`);
      } else {
        executeWithRetry(`./${VENV_DIR}/${venvBinDir}/pip install yt-dlp`);
      }
      logger.success('yt-dlp installed successfully using pip');
    } catch (fallbackError) {
      logger.error('All attempts to install yt-dlp failed');
      logger.error(`Last error: ${fallbackError.message}`);
      logger.error('YouTube video downloads will not work without yt-dlp');
      process.exit(1);
    }
  }
}

// Verify the installation
logger.progress('Verifying yt-dlp installation');
try {
  if (isWindows) {
    // On Windows, we need to use the full path to the executable
    const output = execSync(`"${ytdlpPath}" --version`).toString().trim();
    logger.success(`yt-dlp version ${output} is installed and working`);
  } else {
    // On Unix-like systems, we can use the command directly if the venv is activated
    const output = execSync(`${ytdlpPath} --version`).toString().trim();
    logger.success(`yt-dlp version ${output} is installed and working`);
  }
} catch (error) {
  logger.warning(`Error verifying yt-dlp installation: ${error.message}`);
  logger.progress('Attempting to fix the installation...');

  try {
    // Try reinstalling
    if (isWindows) {
      executeWithRetry(`${VENV_DIR}\\${venvBinDir}\\pip uninstall -y yt-dlp`);
      executeWithRetry(`${VENV_DIR}\\${venvBinDir}\\pip install yt-dlp`);
    } else {
      executeWithRetry(`./${VENV_DIR}/${venvBinDir}/pip uninstall -y yt-dlp`);
      executeWithRetry(`./${VENV_DIR}/${venvBinDir}/pip install yt-dlp`);
    }

    // Verify again
    const output = isWindows
      ? execSync(`"${ytdlpPath}" --version`).toString().trim()
      : execSync(`${ytdlpPath} --version`).toString().trim();
    logger.success(`yt-dlp version ${output} is now installed and working`);
  } catch (reinstallError) {
    logger.error(`Failed to fix yt-dlp installation: ${reinstallError.message}`);
    logger.warning('YouTube video downloads may not work properly');
    // Continue execution but warn the user
  }
}

logger.newLine();
logger.success('yt-dlp setup completed!');
logger.info('You can now use yt-dlp for YouTube video downloads.');
logger.info('If you encounter any issues with video downloads, try running:');
logger.info('npm run install:yt-dlp');
