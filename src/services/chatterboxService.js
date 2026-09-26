/**
 * Service for interacting with the OmniVoice TTS adapter.
 */

// Import centralized React configuration
import { API_URLS } from '../config/appConfig';

const OMNIVOICE_API_BASE_URL = API_URLS.OMNIVOICE || API_URLS.CHATTERBOX;
const CHATTERBOX_API_BASE_URL = OMNIVOICE_API_BASE_URL;
const SERVER_API_BASE_URL = API_URLS.BACKEND;

// Track if the OmniVoice service has been successfully initialized
let chatterboxServiceInitialized = false;

/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Check server health to see if OmniVoice service should be running
 * @returns {Promise<{shouldBeRunning: boolean, message?: string}>}
 */
const checkServerChatterboxStatus = async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

    const response = await fetch(`${SERVER_API_BASE_URL}/api/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        shouldBeRunning: false,
        message: 'Server health check failed'
      };
    }

    const healthData = await response.json();
    const chatterboxRunning = healthData.services?.chatterbox?.running || healthData.services?.omnivoice?.running || false;

    return {
      shouldBeRunning: chatterboxRunning,
      message: chatterboxRunning ?
        'OmniVoice service should be running' :
        'OmniVoice service not started (use npm run dev:cuda)'
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        shouldBeRunning: false,
        message: 'Server health check timeout'
      };
    }

    return {
      shouldBeRunning: false,
      message: `Server health check error: ${error.message}`
    };
  }
};

/**
 * Single attempt to check OmniVoice API availability
 * @returns {Promise<{available: boolean, message?: string}>}
 */
export const checkChatterboxAvailabilitySingle = async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(`${CHATTERBOX_API_BASE_URL}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        available: false,
        message: `OmniVoice API returned status ${response.status}`
      };
    }

    const healthData = await response.json();

    // The adapter can load its model lazily on wake-up.
    if (!healthData.available && !healthData.models_loaded?.tts) {
      return {
        available: false,
        ready: false,
        loading: Boolean(healthData.loading),
        state: healthData.state || healthData.model_state || 'unavailable',
        initialization_error: healthData.initialization_error || null,
        message: healthData.initialization_error || 'OmniVoice package is not installed'
      };
    }

    const ready = healthData.ready ?? healthData.models_loaded?.tts ?? false;
    chatterboxServiceInitialized = Boolean(ready);

    return {
      available: Boolean(healthData.available),
      ready: Boolean(ready),
      loading: Boolean(healthData.loading),
      state: healthData.state || healthData.model_state || (ready ? 'ready' : 'starting'),
      needsWakeUp: Boolean(healthData.available && !ready),
      device: healthData.device,
      models: healthData.models_loaded,
      initialization_error: healthData.initialization_error || null,
      message: ready ? undefined : 'OmniVoice service is running; model is not loaded yet.'
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        available: false,
        message: 'OmniVoice API timeout - service may not be running'
      };
    }

    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      return {
        available: false,
        message: 'OmniVoice API is not running. Please start the narration services.'
      };
    }

    return {
      available: false,
      message: `OmniVoice API error: ${error.message}`
    };
  }
};

/**
 * Wake up the OmniVoice service by calling the wake-up endpoint
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export const wakeUpChatterboxService = async () => {
  try {
    console.log('🔧 Attempting to wake up OmniVoice service...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout for model loading

    const response = await fetch(`${CHATTERBOX_API_BASE_URL}/wake-up`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        message: `Failed to wake up OmniVoice service: ${response.status}`
      };
    }

    const result = await response.json();
    console.log('✅ OmniVoice service wake-up response:', result.status);

    return {
      success: true,
      ready: Boolean(result.ready ?? result.models_loaded?.tts ?? true),
      models: result.models_loaded,
      message: result.message || 'OmniVoice service awakened successfully'
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        success: false,
        message: 'OmniVoice service wake-up timeout - model may be loading'
      };
    }

    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      return {
        success: false,
        message: 'OmniVoice API is not running. Please start the service with "npm run dev:cuda".'
      };
    }

    console.error('❌ Error waking up Chatterbox service:', error);
    return {
      success: false,
      message: `Error waking up OmniVoice service: ${error.message}`
    };
  }
};

/**
 * Check if OmniVoice API is available with retry logic and wake-up capability
 * @param {number} maxAttempts - Maximum number of attempts (default: 5)
 * @param {number} delayMs - Delay between attempts in milliseconds (default: 2000)
 * @param {boolean} attemptWakeUp - Whether to attempt waking up the service if not running (default: true)
 * @returns {Promise<{available: boolean, message?: string}>}
 */
export const checkChatterboxAvailability = async (maxAttempts = 5, delayMs = 2000, attemptWakeUp = true) => {
  // First, try to connect directly to see if service is already running
  let directCheck = await checkChatterboxAvailabilitySingle();
  if (directCheck.available && directCheck.ready) {
    return directCheck;
  }

  if (directCheck.available && !attemptWakeUp) {
    return directCheck;
  }

  // A running service can still need to load the model on first use.
  if (attemptWakeUp) {
    console.log('🔧 OmniVoice model is not ready, attempting to wake up service...');
    const wakeUpResult = await wakeUpChatterboxService();

    if (!wakeUpResult.success) {
      // If wake-up failed, return the error immediately
      return {
        available: false,
        message: wakeUpResult.message || 'Failed to wake up Chatterbox service'
      };
    }

    // Wake-up was successful, now try to connect
    console.log('⏳ Wake-up successful, verifying service availability...');
  } else {
    // If wake-up is disabled, check server status first
    const serverStatus = await checkServerChatterboxStatus();
    if (!serverStatus.shouldBeRunning) {
      return {
        available: false,
        message: serverStatus.message || 'Chatterbox service not started (use npm run dev:cuda)'
      };
    }
  }

  // If server says it should be running, try to connect to the actual API
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await checkChatterboxAvailabilitySingle();

      // If successful, return immediately
      if (result.available && result.ready) {
        return result;
      }

      // Store the error for potential final return
      lastError = result;

      // If this is the last attempt, don't wait
      if (attempt === maxAttempts) {
        break;
      }

      // Wait before next attempt
      await sleep(delayMs);

    } catch (error) {
      lastError = {
        available: false,
        message: `Chatterbox API error: ${error.message}`
      };

      // If this is the last attempt, don't wait
      if (attempt === maxAttempts) {
        break;
      }

      // Wait before next attempt
      await sleep(delayMs);
    }
  }

  // Return the last error if all attempts failed
  return lastError || {
    available: false,
    message: 'Chatterbox API is not available after multiple attempts'
  };
};

/**
 * Generate speech using Chatterbox TTS
 * @param {string} text - Text to synthesize
 * @param {number} exaggeration - Emotional intensity (0.25-2.0)
 * @param {number} cfgWeight - CFG/Pace control (0.0-1.0)
 * @param {File|null} voiceFile - Voice reference file for clone mode
 * @param {string|null} voiceFilePath - Voice reference file path for clone mode
 * @param {string} referenceText - Optional reference transcript
 * @param {'reference'|'design'|'auto'} voiceMode - OmniVoice generation mode
 * @param {string} instruct - Voice design instruction
 * @param {string|null} language - Target language code
 * @returns {Promise<Blob>} - Audio blob
 */
export const generateChatterboxSpeech = async (
  text,
  exaggeration = 0.5,
  cfgWeight = 0.5,
  voiceFile = null,
  voiceFilePath = null,
  referenceText = '',
  voiceMode = 'reference',
  instruct = '',
  language = null
) => {
  try {
    const mode = voiceMode || 'reference';
    if (mode === 'reference' && !voiceFile && !voiceFilePath) {
      throw new Error('Reference audio is required for OmniVoice clone mode');
    }
    if (mode === 'design' && !instruct.trim()) {
      throw new Error('Voice design instructions are required for OmniVoice design mode');
    }

    const url = `${CHATTERBOX_API_BASE_URL}/tts/generate`;
    const createFormData = (file = null) => {
      const formData = new FormData();
      formData.append('text', text);
      formData.append('voice_mode', mode);
      formData.append('exaggeration', exaggeration.toString());
      formData.append('cfg_weight', cfgWeight.toString());
      if (language) formData.append('language', language);
      if (mode === 'reference') {
        if (referenceText) formData.append('ref_text', referenceText);
        if (file) formData.append('voice_file', file);
      }
      if (mode === 'design') formData.append('instruct', instruct.trim());
      return formData;
    };

    let body;

    if (mode === 'reference' && voiceFilePath) {
      // Convert file path to actual file by fetching it from the server
      try {
        console.log('Converting reference audio path for OmniVoice:', voiceFilePath);

        // Create a URL to fetch the file from the server
        // The file path is typically something like: /path/to/reference_audio/filename.wav
        // We need to convert it to a server URL
        const filename = voiceFilePath.split(/[/\\]/).pop(); // Get filename from path
        const fileUrl = `${SERVER_API_BASE_URL}/api/narration/reference-audio/${filename}`;

        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch reference audio file: ${response.status}`);
        }

        const blob = await response.blob();
        const file = new File([blob], filename, { type: 'audio/wav' });

        body = createFormData(file);

        console.log('Successfully converted file path to file for Chatterbox API');
      } catch (error) {
        console.error('Error converting file path to file:', error);
        throw new Error(`Failed to convert reference audio file: ${error.message}`);
      }
    } else if (mode === 'reference' && voiceFile) {
      body = createFormData(voiceFile);
    } else {
      body = createFormData();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

    const response = await fetch(url, {
      method: 'POST',
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OmniVoice API error: ${response.status} - ${errorText}`);
    }

    // Return the audio blob
    return await response.blob();
  } catch (error) {
    console.error('Error generating Chatterbox speech:', error);

    if (error.name === 'AbortError') {
      throw new Error('OmniVoice generation timeout - text may be too long');
    }

    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      throw new Error('OmniVoice API is not running. Please start the narration services.');
    }

    throw error;
  }
};

/**
 * Convert voice using Chatterbox VC
 * @param {File} inputAudio - Input audio file to convert
 * @param {File} targetVoice - Target voice reference file
 * @returns {Promise<Blob>} - Converted audio blob
 */
export const convertChatterboxVoice = async (inputAudio, targetVoice) => {
  try {
    const formData = new FormData();
    formData.append('input_audio', inputAudio);
    formData.append('target_voice', targetVoice);

    const response = await fetch(`${CHATTERBOX_API_BASE_URL}/vc/convert`, {
      method: 'POST',
      body: formData,
      // Add timeout for voice conversion
      signal: AbortSignal.timeout(120000), // 2 minute timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chatterbox VC error: ${response.status} - ${errorText}`);
    }

    // Return the converted audio blob
    return await response.blob();
  } catch (error) {
    console.error('Error converting voice with Chatterbox:', error);
    
    if (error.name === 'TimeoutError') {
      throw new Error('Chatterbox voice conversion timeout');
    }
    
    throw error;
  }
};

/**
 * Get Chatterbox API health status
 * @returns {Promise<Object>} - Health status object
 */
export const getChatterboxHealth = async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${CHATTERBOX_API_BASE_URL}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('OmniVoice health check timeout');
    }

    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      throw new Error('OmniVoice API is not running');
    }

    throw error;
  }
};

export const getOmniVoiceDesignOptions = async () => {
  const response = await fetch(`${CHATTERBOX_API_BASE_URL}/voice-design/options`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`OmniVoice design options returned ${response.status}`);
  }

  return response.json();
};

/**
 * Check if Chatterbox service has been initialized
 * @returns {boolean} - Whether the service has been initialized
 */
export const isChatterboxServiceInitialized = () => {
  return chatterboxServiceInitialized;
};

/**
 * Reset Chatterbox service initialization status
 * Used for testing or when service needs to be re-initialized
 */
export const resetChatterboxServiceInitialization = () => {
  chatterboxServiceInitialized = false;
};

/**
 * Quick check if Chatterbox should be available based on server configuration
 * This provides immediate feedback without API calls, similar to F5-TTS
 * @returns {Promise<{available: boolean, message?: string}>}
 */
export const checkChatterboxShouldBeAvailable = async () => {
  return await checkServerChatterboxStatus();
};

export const checkOmniVoiceAvailabilitySingle = checkChatterboxAvailabilitySingle;
export const checkOmniVoiceAvailability = checkChatterboxAvailability;
export const wakeUpOmniVoiceService = wakeUpChatterboxService;
export const generateOmniVoiceSpeech = generateChatterboxSpeech;
export const convertOmniVoiceVoice = convertChatterboxVoice;
export const getOmniVoiceHealth = getChatterboxHealth;
export const isOmniVoiceServiceInitialized = isChatterboxServiceInitialized;
export const resetOmniVoiceServiceInitialization = resetChatterboxServiceInitialization;
