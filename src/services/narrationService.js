/**
 * Narration service for F5-TTS integration
 */

import { API_BASE_URL, SERVER_URL } from '../config';

/**
 * Convert a Blob to base64 string
 * @param {Blob} blob - The blob to convert
 * @returns {Promise<string>} - Base64 string
 */
// This function is currently unused but kept for future reference
/*
const blobToBase64 = (blob) => {
  return new Promise((resolve, reject) => {
    if (!blob || blob.size === 0) {
      console.error('Invalid blob provided to blobToBase64:', blob);
      reject(new Error('Invalid or empty blob'));
      return;
    }



    const reader = new FileReader();

    reader.onloadend = () => {
      try {
        if (!reader.result) {
          console.error('FileReader result is empty');
          reject(new Error('FileReader result is empty'));
          return;
        }

        // Log the first few characters of the result to help with debugging


        // Check if the result contains a comma (data URL format)
        if (reader.result.indexOf(',') === -1) {
          console.error('FileReader result is not in expected format');
          reject(new Error('FileReader result is not in expected format'));
          return;
        }

        // Remove the data URL prefix (e.g., 'data:audio/wav;base64,')
        const base64String = reader.result.split(',')[1];

        if (!base64String) {
          console.error('Failed to extract base64 data from FileReader result');
          reject(new Error('Failed to extract base64 data'));
          return;
        }


        resolve(base64String);
      } catch (error) {
        console.error('Error in FileReader onloadend:', error);
        reject(error);
      }
    };

    reader.onerror = (error) => {
      console.error('FileReader error:', error);
      reject(error);
    };

    try {
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Error calling readAsDataURL:', error);
      reject(error);
    }
  });
};
*/

// Removed API_BASE_URL logging

/**
 * Check if the narration service is available - DRASTICALLY SIMPLIFIED VERSION
 * @returns {Promise<Object>} - Status response
 */
export const checkNarrationStatusWithRetry = async () => {
  // Completely simplified version with no retries to eliminate logs
  try {
    // First check if Express server is available
    try {
      const healthResponse = await fetch(`${API_BASE_URL}/health`, {
        mode: 'cors',
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!healthResponse.ok) {
        return {
          available: false,
          error: "Express server is not available",
          message: "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."
        };
      }
    } catch (error) {
      return {
        available: false,
        error: "Express server is not available",
        message: "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."
      };
    }

    // Single attempt to check narration service
    const response = await fetch(`${API_BASE_URL}/narration/status`, {
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return {
        available: false,
        error: `Server returned ${response.status}`,
        message: "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."
      };
    }

    const data = await response.json();
    if (!data.available && !data.message) {
      data.message = data.initialization_error || "Cài VieNeu-TTS và OmniVoice rồi khởi động lại dịch vụ thuyết minh.";
    }
    return data;
  } catch (error) {
    return {
      available: false,
      error: error.message,
      message: "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."
    };
  }
};

/**
 * Check if the narration service is available (simple version without retries)
 * @returns {Promise<Object>} - Status response
 */
export const checkNarrationStatus = async () => {
  // First, check if the Express server is available
  try {
    const healthResponse = await fetch(`${API_BASE_URL}/health`, {
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });
    if (!healthResponse.ok) {
      // If the Express server is not available, don't even try to check narration service
      return {
        available: false,
        error: "Express server is not available",
        message: "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."
      };
    }
  } catch (error) {
    // Express server is not available
    return {
      available: false,
      error: "Express server is not available",
      message: "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."
    };
  }

  // Now check the narration service
  try {
    const response = await fetch(`${API_BASE_URL}/narration/status`, {
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // Using hardcoded Vietnamese message here because i18n context is not available in this service
      // This message matches the translation key 'serviceUnavailableMessage'
      return {
        available: false,
        error: `Server returned ${response.status}`,
        message: "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."
      };
    }

    const data = await response.json();
    if (!data.available && !data.message) {
      data.message = data.initialization_error || "Cài VieNeu-TTS và OmniVoice rồi khởi động lại dịch vụ thuyết minh.";
    }
    return data;
  } catch (error) {
    // Using hardcoded Vietnamese message here because i18n context is not available in this service
    // This message matches the translation key 'serviceUnavailableMessage'
    return {
      available: false,
      error: error.message,
      message: "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."
    };
  }
};

export const getVieNeuVoices = async () => {
  const response = await fetch(`${API_BASE_URL}/narration/voices`, {
    method: 'GET',
    mode: 'cors',
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`VieNeu voice list returned ${response.status}`);
  }

  return response.json();
};

export const previewVieNeuSpeech = async ({
  text,
  voice,
  referenceAudio,
  referenceText = '',
  speechRate
}) => {
  const response = await fetch(`${API_BASE_URL}/narration/preview`, {
    method: 'POST',
    mode: 'cors',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'audio/wav'
    },
    body: JSON.stringify({
      text,
      reference_audio: referenceAudio?.filepath || referenceAudio?.path || referenceAudio?.filename || null,
      reference_text: referenceText,
      settings: {
        voice: voice || undefined,
        speechRate: speechRate ? Number(speechRate) : undefined
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `VieNeu preview returned ${response.status}`);
  }

  return new Blob([await response.arrayBuffer()], {
    type: response.headers.get('content-type') || 'audio/wav'
  });
};

/**
 * Upload a reference audio file
 * @param {File} file - Audio file to upload
 * @param {string} referenceText - Optional reference text for the audio
 * @returns {Promise<Object>} - Upload response
 */
export const uploadReferenceAudio = async (file, referenceText = '') => {
  try {
    const formData = new FormData();
    formData.append('file', file);

    if (referenceText) {
      formData.append('reference_text', referenceText);
    }

    const response = await fetch(`${API_BASE_URL}/narration/upload-reference`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      await response.text(); // Read the response body to avoid memory leaks
      throw new Error('Server returned non-JSON response');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    throw error;
  }
};

/**
 * Save recorded audio as reference
 * @param {Blob} audioBlob - Recorded audio blob
 * @param {string} referenceText - Optional reference text for the audio
 * @returns {Promise<Object>} - Upload response
 */
export const saveRecordedAudio = async (audioBlob, referenceText = '') => {
  try {
    // Use the original blob directly with FormData
    const formData = new FormData();

    // Make sure we have a proper filename with extension
    formData.append('audio_data', audioBlob, 'recorded_audio.wav');

    // Add reference text if provided
    formData.append('reference_text', referenceText || '');

    // Add a flag to indicate whether to perform transcription
    // If referenceText is empty, we want to transcribe
    const shouldTranscribe = !referenceText;
    formData.append('transcribe', shouldTranscribe.toString());

    const response = await fetch(`${API_BASE_URL}/narration/record-reference`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      await response.text(); // Read the response body to avoid memory leaks
      throw new Error('Server returned non-JSON response');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    throw error;
  }
};

/**
 * Extract audio segment from video
 * @param {string} videoPath - Path to the video file
 * @param {number|string} startTime - Start time in seconds or "HH:MM:SS" format
 * @param {number|string} endTime - End time in seconds or "HH:MM:SS" format
 * @returns {Promise<Object>} - Extraction response
 */
export const extractAudioSegment = async (videoPath, startTime, endTime) => {
  try {
    const response = await fetch(`${API_BASE_URL}/narration/extract-segment`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        video_path: videoPath,
        start_time: startTime,
        end_time: endTime,
        transcribe: true  // Always request transcription for extracted segments
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      await response.text(); // Read the response body to avoid memory leaks
      throw new Error('Server returned non-JSON response');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    throw error;
  }
};

// Create a global AbortController for narration generation
let narrationAbortController = null;

// Flag to track if the narration service has been initialized
let narrationServiceInitialized = false;

/**
 * Cancel ongoing narration generation
 * @returns {boolean} - Whether cancellation was successful
 */
export const cancelNarrationGeneration = () => {
  if (narrationAbortController) {
    // Removed cancellation logging
    narrationAbortController.abort();
    narrationAbortController = null;
    return true;
  }
  return false;
};

/**
 * Clear all narration output files for fresh generation
 * @returns {Promise<boolean>} - Whether clearing was successful
 */
export const clearNarrationOutput = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/narration/clear-output`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // Removed error logging
      return false;
    }

    // Just consume the response to avoid memory leaks, but don't store it
    await response.json();
    return true;
  } catch (error) {
    // Removed error logging
    return false;
  }
};

/**
 * Generate narration for subtitles with streaming response
 * @param {string} referenceAudio - Path to reference audio file
 * @param {string} referenceText - Reference text for the audio
 * @param {Array} subtitles - Array of subtitle objects
 * @param {Object} settings - Advanced settings for narration generation
 * @param {Function} onProgress - Callback for progress updates
 * @param {Function} onResult - Callback for each result
 * @param {Function} onError - Callback for errors
 * @param {Function} onComplete - Callback for completion
 * @returns {Promise<Object>} - Generation response
 */
export const generateNarration = async (
  referenceAudio,
  referenceText,
  subtitles,
  settings = {},
  onProgress = () => {},
  onResult = () => {},
  onError = () => {},
  onComplete = () => {}
) => {
  try {
    const generationId = settings?.generationId || `generation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const generationSettings = { ...settings, generationId };

    // Check if we should skip clearing the output directory
    // This is used for retrying a single narration to avoid deleting all other narrations
    const skipClearOutput = generationSettings.skipClearOutput === true;

    if (!skipClearOutput) {
      // Clear all narration output files before generating new ones
      await clearNarrationOutput();
    }

    // Initial progress message for waking up the server - only on first run
    // Using hardcoded Vietnamese messages here because i18n context is not available in this service
    // These messages match the translation keys 'initializingService' and 'preparingNarration'
    if (!narrationServiceInitialized) {
      onProgress("Đang đánh thức server thuyết minh cho lần đầu chạy...");
    } else {
      onProgress("Đang chuẩn bị tạo thuyết minh...");
    }
    // Create a new AbortController for this request
    narrationAbortController = new AbortController();
    const signal = narrationAbortController.signal;

    // Create a fetch request with streaming response
    const response = await fetch(`${API_BASE_URL}/narration/generate`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        reference_audio: referenceAudio,
        reference_text: referenceText,
        subtitles: subtitles,
        settings: generationSettings
      }),
      signal // Add the abort signal to the fetch request
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    // Check if the response is a stream
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
      // Handle streaming response

      // Create a reader for the response body
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const results = [];

      // Process the stream
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Decode the chunk and add it to the buffer
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Process complete events in the buffer
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep the last incomplete event in the buffer

        for (const event of events) {
          if (event.trim() && event.startsWith('data: ')) {
            try {
              // Parse the JSON data
              let data;
              try {
                data = JSON.parse(event.substring(6));
              } catch (parseError) {
                continue;
              }

              // Handle different event types
              if (!data || !data.type) {
                continue;
              }

              try {
                switch (data.type) {
                  case 'progress':
                    if (data.message) {
                      // Pass all available progress information to the callback
                      onProgress(
                        data.message,
                        data.current || 0,
                        data.total || 0,
                        data.subtitle_id,
                        data.subtitle_text
                      );
                    }
                    break;

                  case 'result':
                    if (data.result) {
                      // Add the result to our results array
                      results.push(data.result);

                      // Call onResult to immediately update the UI with this result
                      // This ensures each result is shown as soon as it's received
                      onResult(data.result, data.progress || results.length, data.total || 0);
                    }
                    break;

                  case 'error':
                    if (data.result) {
                      onError(data.result);
                    } else if (data.error) {
                      onError(data.error);
                      // If this is a model initialization error, stop processing
                      if (data.error.includes('F5-TTS model initialization failed') ||
                          data.error.includes('Error initializing F5-TTS') ||
                          data.error.includes('Model is not available')) {
                        return { success: false, error: data.error };
                      }
                    } else {
                      onError('Unknown error occurred');
                    }
                    break;

                  case 'complete':
                    // Mark the narration service as initialized
                    narrationServiceInitialized = true;
                    onComplete(data.results || results);
                    return { success: true, results: data.results || results };

                  default:
                    // Handle unknown event types
                    console.warn(`Unknown event type received: ${data.type}`);
                    break;
                }
              } catch (eventError) {
                // Silently handle event errors
              }
            } catch (error) {
              // Silently handle parsing errors
            }
          }
        }
      }

      // If we get here, the stream ended without a complete event
      onComplete(results);
      return { success: true, results };
    } else if (contentType && contentType.includes('application/json')) {
      // Handle regular JSON response (fallback)
      const data = await response.json();

      if (data.results) {
        // Call onResult for each result
        data.results.forEach((result, index) => {
          onResult(result, index + 1, data.results.length);
        });

        // Mark the narration service as initialized
        narrationServiceInitialized = true;

        // Call onComplete with all results
        onComplete(data.results);
      }

      return data;
    } else {
      // Handle unexpected content type
      await response.text(); // Read the response body to avoid memory leaks
      throw new Error(`Unexpected content type: ${contentType}`);
    }
  } catch (error) {
    // Clean up the AbortController
    narrationAbortController = null;

    // Check if this is an abort error
    if (error.name === 'AbortError') {
      const cancelError = new Error('Narration generation cancelled by user');
      cancelError.cancelled = true;
      onError(cancelError);
      return { success: false, cancelled: true, error: 'Cancelled by user' };
    }

    // Handle other errors
    onError(error);
    throw error;
  }
};

/**
 * Get audio file URL
 * @param {string} filename - Audio filename or path (can include subtitle directory)
 * @returns {string} - Audio file URL
 */
export const getAudioUrl = (filename) => {
  if (!filename) return '';

  // Handle both legacy filenames and new directory structure
  // The filename might already include the subtitle directory path
  return `${SERVER_URL}/api/narration/audio/${filename}`;
};

/**
 * Get list of example audio files
 * @returns {Promise<Object>} - List of example audio files
 */
export const getExampleAudioList = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/narration/example-audio`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include'
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    throw error;
  }
};

/**
 * Upload example audio as reference
 * @param {string} filename - Example audio filename
 * @returns {Promise<Object>} - Upload response
 */
export const uploadExampleAudio = async (filename) => {
  try {
    const response = await fetch(`${API_BASE_URL}/narration/upload-example-audio`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ filename })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      await response.text(); // Read the response body to avoid memory leaks
      throw new Error('Server returned non-JSON response');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    throw error;
  }
};
