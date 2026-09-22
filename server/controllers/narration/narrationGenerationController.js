/**
 * Controller for narration generation and status
 */

// Import narration service client
const narrationServiceClient = require('../../services/narrationServiceClient');

// Import directory manager
const { clearNarrationOutputFiles } = require('./directoryManager');

/**
 * Generate narration
 */
const generateNarration = async (req, res) => {


  // Check if we should skip clearing the output directory
  // This is used for retrying a single narration to avoid deleting all other narrations
  const skipClearOutput = req.body.settings && req.body.settings.skipClearOutput === true;

  if (!skipClearOutput) {
    // Clear all existing narration output files for fresh generation

    clearNarrationOutputFiles();
  } else {

  }

  try {
    const { reference_audio, reference_text, subtitles, settings } = req.body;





    // Check if the narration service is available
    const serviceStatus = await narrationServiceClient.checkService(20, 10000);

    if (!serviceStatus.available) {

      return res.status(503).json({
        success: false,
        error: serviceStatus.message || 'VieNeu-TTS service is not available. Install the TTS engines and restart the narration services.'
      });
    }

    // Generate narration using the service client
    try {
      const result = await narrationServiceClient.generateNarration(
        reference_audio,
        reference_text,
        subtitles,
        settings || {},
        res // Pass response object for streaming support
      );

      // If the result is null, it means we're handling streaming in the client
      if (result !== null) {
        return res.json(result);
      }
      // Otherwise, the response is being handled by the streaming logic
    } catch (error) {
      // Removed error logging
      return res.status(503).json({
        success: false,
        error: `Error connecting to narration service: ${error.message}. Please restart the application with npm run dev:cuda.`
      });
    }
  } catch (error) {
    console.error('Error generating narration:', error);
    res.status(500).json({ error: `Error generating narration: ${error.message}` });
  }
};

/**
 * Get narration service status
 */
const getNarrationStatus = async (req, res) => {
  // Check the narration service with multiple attempts
  const serviceStatus = await narrationServiceClient.checkService(20, 10000);

  // Store the status for other parts of the application
  req.app.set('narrationServiceRunning', serviceStatus.available);
  req.app.set('narrationServiceDevice', serviceStatus.device);
  req.app.set('narrationServiceGpuInfo', serviceStatus.gpu_info);

  res.json({
    available: serviceStatus.available,
    ready: serviceStatus.ready,
    engine: serviceStatus.engine || 'vieneu',
    initialization_error: serviceStatus.initialization_error || null,
    message: serviceStatus.message || null,
    models: serviceStatus.models || {},
    device: serviceStatus.device,
    source: serviceStatus.available ? 'actual' : 'none',
    actualPort: narrationServiceClient.getNarrationPort(),
    gpu_info: serviceStatus.gpu_info
  });
};

module.exports = {
  generateNarration,
  getNarrationStatus
};
