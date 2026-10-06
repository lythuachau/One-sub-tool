import { adaptiveTimingFields, assertAdaptiveReady } from '../utils/adaptiveDubbing';
/**
 * Service for managing aligned narration audio
 */
import { SERVER_URL } from '../config';
import { getNarrationOptimizationConfig } from '../utils/narrationOptimization';

// Cache for the aligned narration audio
let alignedNarrationCache = {
  blob: null,
  url: null,
  timestamp: null,
  subtitleTimestamps: {} // Store timestamps of subtitles to detect changes
};

// Audio element for playback
let alignedAudioElement = null;

/**
 * Generate aligned narration audio and store it in cache
 * @param {Array} generationResults - Array of narration results
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<string>} - URL to the aligned audio
 */
export const generateAlignedNarration = async (generationResults, onProgress = null) => {
  if (!generationResults || generationResults.length === 0) {
    console.error('No narration results to generate aligned audio');
    return null;
  }

  try {
    // Show progress if callback provided
    if (onProgress) {
      onProgress({ status: 'preparing', message: 'Preparing aligned narration...' });
    }

    // Prepare the data for the aligned narration
    assertAdaptiveReady(generationResults);
    const narrationData = generationResults
      .filter(result => result.success && (result.filename || result.audioData))
      .map(result => {
        // Ensure we have valid timing information
        const start = typeof result.start === 'number' ? result.start : 0;
        const end = typeof result.end === 'number' ? result.end : (start + 5); // Default 5 seconds if no end time

        // Create a narration data object with common properties
        const narration = {
          subtitle_id: result.subtitle_id,
          method: result.method,
          start: start,
          end: end,
          text: result.text || '',
          ...adaptiveTimingFields(result)
        };

        // Add either filename or audioData depending on what's available
        if (result.filename) {
          narration.filename = result.filename;
        }
        if (result.audioData) {
          narration.audioData = result.audioData;
          narration.mimeType = result.mimeType;
          narration.sampleRate = result.sampleRate;
        }

        return narration;
      });

    // Log the timing information for debugging
    // Commented out to avoid unused variable warnings
    /*
    narrationData.forEach(item => {
      const sourceType = item.filename ? 'F5-TTS' : (item.audioData ? 'Gemini' : 'Unknown');
    });
    */

    // Sort by start time to ensure correct order (more reliable than subtitle ID)
    narrationData.sort((a, b) => a.start - b.start);

    // No need to validate or adjust narration durations
    // Use the exact timing from the subtitles



    // Store subtitle timestamps to detect changes
    const newSubtitleTimestamps = {};
    narrationData.forEach(item => {
      newSubtitleTimestamps[item.subtitle_id] = {
        start: item.start,
        end: item.end
      };
    });

    // Check if we have a forceRegenerate flag in the narrationData
    const forceRegenerate = narrationData.some(item => item.forceRegenerate === true);

    // If forceRegenerate is true, skip the cache check and always regenerate
    if (forceRegenerate) {

    }
    // Otherwise, check if we already have a cached version with the same timestamps
    else if (alignedNarrationCache.url && alignedNarrationCache.subtitleTimestamps) {
      const hasChanged = Object.keys(newSubtitleTimestamps).some(id => {
        const oldTimestamp = alignedNarrationCache.subtitleTimestamps[id];
        const newTimestamp = newSubtitleTimestamps[id];

        // If we don't have this subtitle in the cache, or the timestamps have changed
        return !oldTimestamp ||
               oldTimestamp.start !== newTimestamp.start ||
               oldTimestamp.end !== newTimestamp.end;
      });

      if (!hasChanged) {
        // Check if any narration has a retriedAt timestamp that's newer than our cache timestamp
        const hasRetriedNarration = narrationData.some(item =>
          item.retriedAt && (!alignedNarrationCache.timestamp || item.retriedAt > alignedNarrationCache.timestamp)
        );

        if (hasRetriedNarration) {

        } else {

          if (onProgress) {
            onProgress({ status: 'complete', message: 'Using cached aligned narration' });
          }
          return alignedNarrationCache.url;
        }
      }
    }

    if (onProgress) {
      onProgress({ status: 'generating', message: 'Generating aligned narration...' });
    }

    // Create a download link
    const downloadUrl = `${SERVER_URL}/api/narration/download-aligned`;

    // Use fetch API to download the file


    // Declare response variable outside the try block so it's accessible later
    let response;

    try {
      response = await fetch(downloadUrl, {
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'audio/wav'
        },
        body: JSON.stringify({
          narrations: narrationData,
          optimization: getNarrationOptimizationConfig()
        })
      });

      // Check for audio alignment notification after successful response
      if (response.ok) {
        // Import and check for duration notification
        const { checkAudioAlignmentFromResponse } = await import('../utils/audioAlignmentNotification.js');
        checkAudioAlignmentFromResponse(response);
      }

      // Check if the response is successful
      if (!response.ok) {
        console.error(`Failed to download aligned audio: ${response.statusText}`);

        // Force reset the cache to ensure we don't use stale data
        alignedNarrationCache = {
          blob: null,
          url: null,
          timestamp: null,
          subtitleTimestamps: {}
        };

        if (alignedAudioElement) {
          alignedAudioElement.src = '';
          alignedAudioElement = null;
        }

        throw new Error(`Failed to download aligned audio: ${response.statusText}`);
      }
    } catch (fetchError) {
      console.error('Error fetching aligned audio:', fetchError);

      // Force reset the cache to ensure we don't use stale data
      alignedNarrationCache = {
        blob: null,
        url: null,
        timestamp: null,
        subtitleTimestamps: {}
      };

      if (alignedAudioElement) {
        alignedAudioElement.src = '';
        alignedAudioElement = null;
      }

      throw fetchError;
    }

    // Get the blob from the response (response is now defined in the try block)
    let blob;
    try {
      blob = await response.blob();
    } catch (blobError) {
      console.error('Error getting blob from response:', blobError);

      // Force reset the cache to ensure we don't use stale data
      alignedNarrationCache = {
        blob: null,
        url: null,
        timestamp: null,
        subtitleTimestamps: {}
      };

      if (alignedAudioElement) {
        alignedAudioElement.src = '';
        alignedAudioElement = null;
      }

      throw new Error('Failed to get audio data from response');
    }

    // Verify that the blob is valid
    if (!blob || blob.size === 0) {
      throw new Error('Received empty audio data from server');
    }



    // Always completely reset the audio element and cache when generating new audio
    // This ensures we don't use stale data


    // Reset the audio element
    if (alignedAudioElement) {
      try {
        alignedAudioElement.pause();
        alignedAudioElement.src = '';
        alignedAudioElement = null;
      } catch (e) {
        console.warn('Error resetting audio element:', e);
      }
    }

    // Revoke any existing URL
    if (alignedNarrationCache.url) {
      try {
        URL.revokeObjectURL(alignedNarrationCache.url);

      } catch (e) {
        console.warn('Error revoking previous object URL:', e);
      }
    }

    // Create a new URL for the blob
    const url = URL.createObjectURL(blob);


    // Update the cache
    alignedNarrationCache = {
      blob,
      url,
      timestamp: Date.now(),
      subtitleTimestamps: newSubtitleTimestamps
    };



    // Log the cache state for debugging


    // Always update the audio element with the new URL

    try {
      // If the audio element doesn't exist, create it
      if (!alignedAudioElement) {
        alignedAudioElement = new Audio();
        alignedAudioElement.preload = 'auto';
        alignedAudioElement.crossOrigin = 'anonymous';
      } else {
        // If it exists, pause it first
        alignedAudioElement.pause();
      }

      // Always update the source to the new URL
      alignedAudioElement.src = url;
      alignedAudioElement.load();

    } catch (error) {
      console.error('Error updating audio element:', error);
      // Try to recreate the audio element if updating fails
      try {
        alignedAudioElement = new Audio();
        alignedAudioElement.preload = 'auto';
        alignedAudioElement.crossOrigin = 'anonymous';
        alignedAudioElement.src = url;
        alignedAudioElement.load();

      } catch (recreateError) {
        console.error('Failed to recreate audio element:', recreateError);
        // Continue even if there's an error, as we can try to create the audio element later
      }
    }

    if (onProgress) {
      onProgress({ status: 'complete', message: 'Aligned narration ready' });
    }

    return url;
  } catch (error) {
    console.error('Error generating aligned narration:', error);
    if (onProgress) {
      onProgress({ status: 'error', message: `Error: ${error.message}` });
    }
    return null;
  }
};

/**
 * Get the aligned narration audio element
 * @returns {HTMLAudioElement} - Audio element
 */
export const getAlignedAudioElement = () => {
  // Use the window cache instead of the local cache
  const cache = window.alignedNarrationCache || alignedNarrationCache;

  // Check if we have a URL in the cache
  console.log('🔍 Service: Checking cache URL...', cache.url);
  console.log('🔍 Service: Using cache:', cache === window.alignedNarrationCache ? 'window' : 'local');
  if (!cache.url) {
    console.error('❌ Service: No URL in cache, returning null');
    console.log('🔍 Service: Cache contents:', cache);
    return null;
  }
  console.log('✅ Service: Cache URL found, proceeding...');

  // Check if we need to create or update the audio element
  // Don't log every time this function is called to reduce console spam

  try {
    // If we already have an audio element, check if it's valid and has the correct source
    if (alignedAudioElement) {
      // If the URL has changed or the audio element has no source, update it
      if (alignedAudioElement.src !== cache.url) {


        try {
          // Pause first to avoid any playback issues during source change
          alignedAudioElement.pause();

          // Update source and reload
          alignedAudioElement.src = cache.url;
          alignedAudioElement.load();

          // Reset any custom properties
          alignedAudioElement._customSeeking = false;


        } catch (updateError) {
          console.error('Error updating audio element source:', updateError);

          // If updating fails, recreate the audio element
          alignedAudioElement = null;
        }
      }
    }

    // If we don't have an audio element or it was nullified due to an error, create a new one
    if (!alignedAudioElement) {


      // Create a new audio element
      alignedAudioElement = new Audio();

      // Set audio properties for better performance
      alignedAudioElement.preload = 'auto';
      alignedAudioElement.crossOrigin = 'anonymous'; // Helps with CORS issues

      // Add comprehensive error handling
      alignedAudioElement.onerror = () => {
        const errorMessage = alignedAudioElement?.error
          ? `Code: ${alignedAudioElement.error.code}, Message: ${alignedAudioElement.error.message}`
          : 'unknown error';
        console.error('Error with aligned narration audio:', errorMessage);

        // Try to recover by reloading
        setTimeout(() => {

          if (alignedNarrationCache.url && alignedAudioElement) {
            alignedAudioElement.src = alignedNarrationCache.url;
            alignedAudioElement.load();
          }
        }, 1000);
      };

      // Add stalled and waiting event handlers
      alignedAudioElement.onstalled = () => {
        console.warn('Audio playback stalled, attempting to resume');
        if (alignedAudioElement) {
          alignedAudioElement.load();
        }
      };

      alignedAudioElement.onwaiting = () => {

      };

      // Add successful load handler
      alignedAudioElement.oncanplaythrough = () => {

      };

      // Set the source and load
      alignedAudioElement.src = cache.url;
      alignedAudioElement.load();


    }
  } catch (error) {
    console.error('Error creating/updating audio element:', error);
    return null;
  }

  return alignedAudioElement;
};

/**
 * Play aligned narration at the specified time
 * @param {number} currentTime - Current video time
 * @param {boolean} isPlaying - Whether the video is playing
 * @returns {boolean} - Whether playback was successful
 */
export const playAlignedNarration = (currentTime, isPlaying) => {


  // Try to get the audio element
  const audio = getAlignedAudioElement();

  // If no audio element is available, try to create one if we have a URL
  if (!audio) {
    if (alignedNarrationCache.url) {
      console.warn('No audio element available for aligned narration, attempting to create one');

      // Try to create a new audio element
      try {
        alignedAudioElement = new Audio();
        alignedAudioElement.preload = 'auto';
        alignedAudioElement.crossOrigin = 'anonymous';
        alignedAudioElement.src = alignedNarrationCache.url;
        alignedAudioElement.load();


        // Add basic event listeners for debugging


        alignedAudioElement.onerror = () => {
          const errorMessage = alignedAudioElement?.error
            ? `Code: ${alignedAudioElement.error.code}, Message: ${alignedAudioElement.error.message}`
            : 'unknown error';
          console.error('Error with aligned narration audio:', errorMessage);
        };

        // Call this function again with the new audio element
        return playAlignedNarration(currentTime, isPlaying);
      } catch (error) {
        console.error('Failed to create new audio element for aligned narration:', error);
        return false;
      }
    } else {
      console.warn('No audio element or URL available for aligned narration');
      return false;
    }
  }

  try {
    // More robust approach with less frequent seeking
    if (currentTime >= 0) {
      // Only update currentTime if it's significantly different to avoid unnecessary seeking
      // Increased threshold to reduce seeking frequency
      const timeDifference = Math.abs(audio.currentTime - currentTime);
      const seekThreshold = 0.3; // Reduced threshold for more accurate sync

      // Log the current state for debugging, but only for significant differences
      // to reduce console spam during normal playback
      if (timeDifference > 0.5) {

      }

      // Only seek if the time difference is significant or we're in a paused state
      // This reduces the number of seek operations during normal playback
      // Increased threshold to further reduce seeking frequency
      if (timeDifference > seekThreshold || !isPlaying) {
        // Don't log every seek during normal playback to reduce console spam
        if (timeDifference > 1.0 || !isPlaying) {

        }

        // Set a flag to track our custom seeking state
        // Use a different name to avoid conflict with the built-in seeking property
        audio._customSeeking = true;

        // Use a try-catch specifically for the seeking operation
        try {
          // Ensure the time is within the valid range for the audio
          const safeTime = Math.max(0, currentTime);
          audio.currentTime = safeTime;

          // Log the actual time after seeking for debugging

        } catch (seekError) {
          console.error('Error seeking aligned narration:', seekError);
          // If seeking fails, try to recover by reloading the audio
          if (alignedNarrationCache.url) {

            audio.src = alignedNarrationCache.url;
            audio.load();
            // After loading, try to set the time and play state again
            setTimeout(() => {
              try {
                audio.currentTime = currentTime;
                if (isPlaying) audio.play();
              } catch (e) {
                console.error('Recovery attempt failed:', e);
              }
            }, 100);
          }
        }
      }
    }

    // Handle play/pause state
    if (isPlaying && audio.paused) {


      // Add a small delay before playing if we just performed a seek
      // This helps avoid playback issues after seeking
      if (audio._customSeeking) {
        setTimeout(() => {
          // Don't log this common event to reduce console spam
          audio.play().catch(error => {
            console.error('Error playing aligned narration:', error);

            // Try to recover by reloading and playing again
            if (alignedNarrationCache.url) {

              audio.src = alignedNarrationCache.url;
              audio.load();
              setTimeout(() => {
                try {
                  audio.currentTime = currentTime;
                  audio.play();
                } catch (e) {
                  console.error('Recovery attempt failed:', e);
                }
              }, 100);
            }
          });
          audio._customSeeking = false;
        }, 50);
      } else {
        audio.play().catch(error => {
          console.error('Error playing aligned narration:', error);

          // Try to recover by reloading and playing again
          if (alignedNarrationCache.url) {

            audio.src = alignedNarrationCache.url;
            audio.load();
            setTimeout(() => {
              try {
                audio.currentTime = currentTime;
                audio.play();
              } catch (e) {
                console.error('Recovery attempt failed:', e);
              }
            }, 100);
          }
        });
      }
    } else if (!isPlaying && !audio.paused) {

      audio.pause();
    } else if (isPlaying && !audio.paused) {
      // Already playing, no need to log this common case
      // This happens frequently during normal playback
    }
  } catch (error) {
    console.error('Error in playAlignedNarration:', error);
    return false;
  }

  // If we got here, playback was successful
  return true;
};

/**
 * Set the volume of the aligned narration
 * @param {number} volume - Volume level (0-1)
 */
export const setAlignedNarrationVolume = (volume) => {
  // Only try to get the audio element if we have a URL in the cache
  // This prevents unnecessary warning logs when no aligned narration is available
  if (alignedNarrationCache.url) {
    const audio = getAlignedAudioElement();
    if (audio) {
      audio.volume = volume;
    }
  }
};

/**
 * Reset the aligned narration audio element
 * This forces the audio element to be recreated on the next request
 */
export const resetAlignedAudioElement = () => {
  if (alignedAudioElement) {

    try {
      alignedAudioElement.pause();
      alignedAudioElement.src = '';
      alignedAudioElement = null;
    } catch (e) {
      console.warn('Error resetting audio element:', e);
    }
  }
};

/**
 * Force reset the aligned narration cache and audio element
 * Call this when you need to completely clear the cache and start fresh
 */
export const resetAlignedNarration = () => {
  console.log('Resetting aligned narration completely');

  // Clean up the audio element
  if (alignedAudioElement) {
    try {
      // First pause playback
      alignedAudioElement.pause();

      // Remove all event listeners to prevent memory leaks
      alignedAudioElement.oncanplaythrough = null;
      alignedAudioElement.onerror = null;
      alignedAudioElement.onstalled = null;
      alignedAudioElement.onwaiting = null;
      alignedAudioElement.onplay = null;
      alignedAudioElement.onpause = null;
      alignedAudioElement.ontimeupdate = null;
      alignedAudioElement.onseeking = null;
      alignedAudioElement.onseeked = null;

      // Clear the source
      alignedAudioElement.src = '';
      alignedAudioElement.load();

      console.log('Successfully cleaned up existing audio element');
    } catch (e) {
      console.warn('Error cleaning up audio element during reset:', e);
    }
    alignedAudioElement = null;
  }

  // Revoke any existing URL
  if (alignedNarrationCache.url) {
    try {
      URL.revokeObjectURL(alignedNarrationCache.url);
      console.log('Successfully revoked previous object URL');
    } catch (e) {
      console.warn('Error revoking URL during reset:', e);
    }
  }

  // Reset the cache
  alignedNarrationCache = {
    blob: null,
    url: null,
    timestamp: null,
    subtitleTimestamps: {}
  };

  console.log('Aligned narration cache has been reset');
};

// Make resetAlignedNarration available globally for direct access from event handlers
window.resetAlignedNarration = resetAlignedNarration;

// Add an event listener for subtitle timing changes
window.addEventListener('subtitle-timing-changed', (event) => {
  console.log('Subtitle timing changed event received:', event.detail);

  // Reset the aligned narration cache to force regeneration
  resetAlignedNarration();

  // Log that the cache was reset
  console.log('Aligned narration cache reset due to subtitle grouping change');
});

/**
 * Clean up aligned narration resources
 * @param {boolean} preserveAudioElement - Whether to preserve the audio element for reuse
 * @param {boolean} preserveCache - Whether to preserve the cache (URL and blob)
 */
export const cleanupAlignedNarration = (preserveAudioElement = false, preserveCache = false) => {
  // ALWAYS preserve both audio element and cache during normal operation
  // Only clean up when explicitly told not to preserve (like when unmounting)
  preserveAudioElement = true;
  preserveCache = true;

  // Skip cleanup entirely during normal operation to avoid stuttering and console spam
  if (alignedAudioElement || !alignedNarrationCache.url) {
    // Don't log anything to avoid console spam
    return;
  }

  // Only log in development mode to reduce console spam
  if (process.env.NODE_ENV === 'development') {

  }

  // Store the current cache if we're preserving it
  const oldCache = preserveCache ? { ...alignedNarrationCache } : null;

  // Properly clean up the audio element
  if (alignedAudioElement) {
    try {
      // First pause playback
      alignedAudioElement.pause();

      // Remove all event listeners to prevent memory leaks
      alignedAudioElement.oncanplaythrough = null;
      alignedAudioElement.onerror = null;
      alignedAudioElement.onstalled = null;
      alignedAudioElement.onwaiting = null;
      alignedAudioElement.onplay = null;
      alignedAudioElement.onpause = null;
      alignedAudioElement.ontimeupdate = null;
      alignedAudioElement.onseeking = null;
      alignedAudioElement.onseeked = null;

      // Only clear the source if we're not preserving the cache
      if (!preserveCache) {
        alignedAudioElement.src = '';
        alignedAudioElement.load();
      }
    } catch (e) {
      // Only log in development mode
      if (process.env.NODE_ENV === 'development') {
        console.warn('Error during audio cleanup:', e);
      }
    }
  }

  // Revoke the URL to free up memory, but only if we're not preserving the cache
  if (!preserveCache && alignedNarrationCache.url) {
    try {
      URL.revokeObjectURL(alignedNarrationCache.url);
      // Only log in development mode
      if (process.env.NODE_ENV === 'development') {

      }
    } catch (e) {
      // Only log in development mode
      if (process.env.NODE_ENV === 'development') {
        console.warn('Error revoking object URL:', e);
      }
    }
  }

  // Reset the cache, but restore it if we're preserving it
  if (preserveCache && oldCache) {
    // Keep the existing cache
    // Only log in development mode
    if (process.env.NODE_ENV === 'development') {

    }
  } else {
    // Reset the cache
    alignedNarrationCache = {
      blob: null,
      url: null,
      timestamp: null,
      subtitleTimestamps: {}
    };
  }

  // Only clear the audio element reference if we're not preserving it
  if (!preserveAudioElement) {
    alignedAudioElement = null;
  }

  // Only log in development mode
  if (process.env.NODE_ENV === 'development') {

  }
};

/**
 * Check if aligned narration is available
 * @returns {boolean} - Whether aligned narration is available
 */
export const isAlignedNarrationAvailable = () => {
  const isAvailable = !!alignedNarrationCache.url;
  // Only log in development mode to reduce console spam
  if (process.env.NODE_ENV === 'development') {

  }
  return isAvailable;
};

/**
 * Get the URL of the aligned narration
 * @returns {string|null} - URL to the aligned audio or null if not available
 */
export const getAlignedNarrationUrl = () => {
  return alignedNarrationCache.url;
};
