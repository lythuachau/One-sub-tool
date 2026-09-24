/**
 * Core processing utilities for video/audio processing
 */

import { callGeminiApi, getProcessingForceStopped } from '../../services/geminiService';
import { splitVideoOnServer } from '../videoSplitter';
import { getVideoDuration, getMaxSegmentDurationSeconds } from '../durationUtils';
import { processSegment } from '../../services/segmentProcessingService';
import { getCacheIdForMedia } from './cacheUtils';
import { createSegmentStatusUpdater, formatTime } from './segmentUtils';
import { analyzeVideoAndWaitForUserChoice } from './analysisUtils';
import { setCurrentCacheId as setRulesCacheId, setTranscriptionRules } from '../transcriptionRulesStore';
import { setCurrentCacheId as setSubtitlesCacheId } from '../userSubtitlesStore';
import { API_BASE_URL } from '../../config';
import { getGeminiErrorMessage } from '../../services/gemini/errorUtils';
import {
  getSubtitleEngine,
  normalizeGeminiSubtitles,
  transcribeWithWhisper
} from '../../services/subtitleEngineService';

const processGeminiMedia = async (mediaFile, onStatusUpdate, t, options, duration) => {
  const subtitles = await callGeminiApi(mediaFile, 'file-upload', options);
  return normalizeGeminiSubtitles(mediaFile, subtitles, duration, (status) => {
    onStatusUpdate({
      ...status,
      message: t('output.timestampNormalizationComplete', status.message)
    });
  });
};

/**
 * Apply default settings when video analysis is disabled or fails
 * This ensures the system uses the user's default preset and settings
 */
const applyDefaultSettings = () => {
  // Clear any session-specific settings to ensure we use user's defaults
  sessionStorage.removeItem('current_session_prompt');
  sessionStorage.removeItem('current_session_preset_id');

  // Clear any existing transcription rules to use defaults
  setTranscriptionRules(null);

  console.log('Applied default settings - using user\'s default preset and transcription settings');
};

/**
 * Process a short video/audio file (shorter than max segment duration)
 * @param {File} mediaFile - The media file
 * @param {Function} onStatusUpdate - Callback for status updates
 * @param {Function} t - Translation function
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} - Array of subtitle objects
 */
export const processShortMedia = async (mediaFile, onStatusUpdate, t, options = {}) => {
  const { userProvidedSubtitles } = options;
  const isAudio = mediaFile.type.startsWith('audio/');

  if (getSubtitleEngine() === 'whisper') {
    return transcribeWithWhisper(mediaFile, {}, onStatusUpdate);
  }

  const useVideoAnalysis = !isAudio && localStorage.getItem('use_video_analysis') !== 'false';
  const skipAnalysis = !!userProvidedSubtitles || !useVideoAnalysis;

  if (skipAnalysis) {
    if (userProvidedSubtitles) {
      onStatusUpdate({
        message: t('output.processingWithCustomSubtitles', 'Processing video with your provided subtitles...'),
        type: 'loading'
      });
    } else {
      applyDefaultSettings();
      onStatusUpdate({
        message: t('output.processingWithoutAnalysis', 'Processing with the original media...'),
        type: 'loading'
      });
    }

    return processGeminiMedia(mediaFile, onStatusUpdate, t, { userProvidedSubtitles }, await getVideoDuration(mediaFile));
  }

  try {
    await analyzeVideoAndWaitForUserChoice(mediaFile, onStatusUpdate, t);
    return processGeminiMedia(mediaFile, onStatusUpdate, t, { userProvidedSubtitles }, await getVideoDuration(mediaFile));
  } catch (analysisError) {
    if (analysisError.name === 'AbortError' || getProcessingForceStopped()) {
      throw analysisError;
    }
    console.error('Error analyzing original video:', analysisError);
    applyDefaultSettings();
    onStatusUpdate({
      message: `${t('output.analysisError', 'Video analysis failed, proceeding with default settings.')} ${getGeminiErrorMessage(analysisError, t)}`,
      type: 'warning'
    });
    return processGeminiMedia(mediaFile, onStatusUpdate, t, { userProvidedSubtitles }, await getVideoDuration(mediaFile));
  }
};

/**
 * Process a long video/audio file by splitting it into segments
 * @param {File} mediaFile - The media file
 * @param {Function} onStatusUpdate - Callback for status updates
 * @param {Function} t - Translation function
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} - Array of subtitle objects
 */
export const processLongVideo = async (mediaFile, onStatusUpdate, t, options = {}) => {
  // Extract options
  const { userProvidedSubtitles } = options;

  if (getSubtitleEngine() === 'whisper') {
    localStorage.setItem('video_processing_in_progress', 'true');
    try {
      return await transcribeWithWhisper(mediaFile, {}, onStatusUpdate);
    } finally {
      localStorage.removeItem('video_processing_in_progress');
    }
  }

  // Set cache ID for the current video
  const cacheId = getCacheIdForMedia(mediaFile);
  if (cacheId) {
    // Set cache ID for both stores
    setRulesCacheId(cacheId);
    setSubtitlesCacheId(cacheId);

  }

  // Set processing flag to indicate we're working on a video
  localStorage.setItem('video_processing_in_progress', 'true');


  // Determine if this is a video or audio file based on MIME type
  const isAudio = mediaFile.type.startsWith('audio/');
  const mediaType = isAudio ? 'audio' : 'video';

  // Get the current model (for logging purposes)
  // const currentModel = localStorage.getItem('gemini_model') || 'gemini-2.0-flash';


  // Create an array to track segment status
  const segmentStatusArray = [];
  const updateSegmentStatus = createSegmentStatusUpdater(segmentStatusArray, t);

  try {
    // Get media duration
    const duration = await getVideoDuration(mediaFile);


    // If media is shorter than the maximum segment duration, process it directly
    if (duration <= getMaxSegmentDurationSeconds()) {
      return await processShortMedia(mediaFile, onStatusUpdate, t, options);
    }

    // Calculate number of segments
    const numSegments = Math.ceil(duration / getMaxSegmentDurationSeconds());


    // Initialize segment status array with pending status
    for (let i = 0; i < numSegments; i++) {
      // Calculate theoretical time range for initial display
      const startTime = i * getMaxSegmentDurationSeconds();
      const endTime = Math.min((i + 1) * getMaxSegmentDurationSeconds(), duration);
      const timeRange = `${formatTime(startTime)} - ${formatTime(endTime)}`;

      updateSegmentStatus(i, 'pending', t('output.pendingProcessing', 'Waiting to be processed...'), timeRange);
    }

    // Notify user about long media processing
    onStatusUpdate({
      message: isAudio
        ? t('output.longAudioProcessing', 'Processing audio longer than 30 minutes. This may take a while...')
        : t('output.longVideoProcessing', 'Processing video longer than 30 minutes. This may take a while...'),
      type: 'loading'
    });

    // Use server-side splitting to physically split the media into segments

    onStatusUpdate({
      message: isAudio
        ? t('output.serverSplittingAudio', 'Uploading and splitting audio on server...')
        : t('output.serverSplitting', 'Uploading and splitting video on server...'),
      type: 'loading'
    });

    const useVideoAnalysis = !userProvidedSubtitles && !isAudio && localStorage.getItem('use_video_analysis') !== 'false';
    if (useVideoAnalysis) {
      try {
        await analyzeVideoAndWaitForUserChoice(mediaFile, onStatusUpdate, t);
        onStatusUpdate({
          message: t('output.preparingSplitting', 'Preparing to split video into segments...'),
          type: 'loading'
        });
      } catch (error) {
        if (error.name === 'AbortError' || getProcessingForceStopped()) {
          throw error;
        }
        console.error('Error analyzing original video:', error);
        applyDefaultSettings();
        onStatusUpdate({
          message: `${t('output.analysisError', 'Video analysis failed, proceeding with default settings.')} ${getGeminiErrorMessage(error, t)}`,
          type: 'warning'
        });
      }
    } else if (userProvidedSubtitles) {
      onStatusUpdate({
        message: t('output.processingWithCustomSubtitles', 'Processing video with your provided subtitles...'),
        type: 'loading'
      });
    } else {
      applyDefaultSettings();
      onStatusUpdate({
        message: t('output.processingWithoutAnalysis', 'Processing with the original media...'),
        type: 'loading'
      });
    }

    // Upload the media to the server and split it into segments
    const splitResult = await splitVideoOnServer(
      mediaFile,
      getMaxSegmentDurationSeconds(),
      (progress, message) => {
        onStatusUpdate({
          message: `${message} (${progress}%)`,
          type: 'loading'
        });
      },
      true
    );

    // Clear the processing flag now that splitting is complete
    localStorage.removeItem('video_processing_in_progress');



    // Store the split result in localStorage for later use
    localStorage.setItem('split_result', JSON.stringify(splitResult));

    // Process all segments in parallel
    const segments = splitResult.segments;

    // Dispatch event with segments for potential retries later
    const segmentsEvent = new CustomEvent('videoSegmentsUpdate', {
      detail: segments
    });
    window.dispatchEvent(segmentsEvent);

    // Process all segments in parallel
    onStatusUpdate({
      message: t('output.processingInParallel', 'Processing in parallel...'),
      type: 'loading'
    });

    // Create an array to hold the processing promises for each segment
    const segmentPromises = segments.map(async (segment, i) => {
      const segmentIndex = i;

      // ALWAYS use the actual start time from the segment if available
      // This is critical for correct subtitle stitching with stream-copy segments
      const startTime = segment.startTime !== undefined ? segment.startTime : segmentIndex * getMaxSegmentDurationSeconds();
      const segmentDuration = segment.duration !== undefined ? segment.duration : getMaxSegmentDurationSeconds();
      const endTime = startTime + segmentDuration;
      const timeRange = `${formatTime(startTime)} - ${formatTime(endTime)}`;

      // Debug: Log segment timing information
      console.log(`[SEGMENT-${segmentIndex}] startTime: ${segment.startTime}, duration: ${segment.duration}, calculated timeRange: ${timeRange}`);

      // Log detailed information about this segment's timing



      // Log if we're using user-provided subtitles
      if (userProvidedSubtitles) {

      }

      // Compare actual start time with theoretical start time if needed
      // if (segment.startTime !== undefined) {
      //   const theoreticalStart = segmentIndex * getMaxSegmentDurationSeconds();
      // }

      // Update the segment status with time range
      updateSegmentStatus(i, 'pending', t('output.pendingProcessing', 'Waiting to be processed...'), timeRange);

      // Generate cache ID for this segment
      const segmentCacheId = `segment_${segment.name}`;

      try {
        // First check if we have this segment cached
        updateSegmentStatus(i, 'loading', t('output.checkingCache', 'Checking cache...'));
        const response = await fetch(`${API_BASE_URL}/subtitle-exists/${segmentCacheId}`);
        const data = await response.json();

        if (data.exists && !userProvidedSubtitles) {
          // Only use cache if we don't have user-provided subtitles


          // Make sure to pass the translation function properly
          // This is the key fix for the internationalization issue
          updateSegmentStatus(i, 'cached', t('output.loadedFromCache', 'Loaded from cache'), timeRange);

          // Return the cached subtitles with adjusted timestamps
          return data.subtitles.map(subtitle => ({
            ...subtitle,
            start: subtitle.start + startTime,
            end: subtitle.end + startTime
          }));
        } else if (userProvidedSubtitles && data.exists) {

        }

        // If not cached, process the segment
        updateSegmentStatus(i, 'loading', t('output.processing', 'Processing...'), timeRange);

        // Determine if this is a video or audio file
        const isAudio = mediaFile.type.startsWith('audio/');
        const mediaType = isAudio ? 'audio' : 'video';

        // Pass userProvidedSubtitles to processSegment if available
        if (userProvidedSubtitles) {

        }

        // Get the total duration of the video
        const totalDuration = await getVideoDuration(mediaFile);


        // Pass userProvidedSubtitles and totalDuration to processSegment
        const result = await processSegment(segment, segmentIndex, startTime, segmentCacheId, onStatusUpdate, t, mediaType, {
          userProvidedSubtitles,
          totalDuration
        });
        updateSegmentStatus(i, 'success', t('output.processingComplete', 'Processing complete'), timeRange);
        return result;
      } catch (error) {
        console.error(`Error processing segment ${i+1}:`, error);
        // Check if this is an overload error
        if (error.isOverloaded || (error.message && (
            error.message.includes('503') ||
            error.message.includes('Service Unavailable') ||
            error.message.includes('overloaded') ||
            error.message.includes('UNAVAILABLE') ||
            error.message.includes('Status code: 503')
        ))) {
            // Check if this is specifically a 503 error for more specific messaging
            const is503Error = error.message && (
                error.message.includes('503') ||
                error.message.includes('Status code: 503')
            );

            const errorMessage = is503Error
                ? t('errors.geminiServiceUnavailable', 'Gemini is currently overloaded, please wait and try again later (error code 503)')
                : t('errors.geminiOverloaded', 'Mô hình đang quá tải. Vui lòng thử lại sau.');

            // Make sure to pass the timeRange parameter
            updateSegmentStatus(i, 'overloaded', errorMessage, t, timeRange);
        } else {
            updateSegmentStatus(i, 'error', error.message || t('output.processingFailed', 'Processing failed'), t, timeRange);
        }
        throw error; // Re-throw to be caught by Promise.allSettled
      }
    });

    // Wait for all segment processing to complete (even if some fail)
    const results = await Promise.allSettled(segmentPromises);

    if (getProcessingForceStopped()) {
      localStorage.removeItem('video_processing_in_progress');
      throw new DOMException('Subtitle processing was cancelled', 'AbortError');
    }

    // Collect all successful results
    const allSubtitles = [];
    let hasFailures = false;

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        // Add successful subtitles to the combined results
        allSubtitles.push(...result.value);
      } else {
        // Log the error for failed segments
        console.error(`Segment ${i+1} failed:`, result.reason);
        hasFailures = true;
      }
    });

    // Warn the user if some segments failed
    if (hasFailures) {
      onStatusUpdate({
        message: t('output.someSegmentsFailed', 'Some segments failed to process. The subtitles may be incomplete.'),
        type: 'warning'
      });
    }

    // Sort subtitles by start time
    allSubtitles.sort((a, b) => a.start - b.start);

    // Renumber IDs
    allSubtitles.forEach((subtitle, index) => {
      subtitle.id = index + 1;
    });

    return allSubtitles;
  } catch (error) {
    if (error.name === 'AbortError' || getProcessingForceStopped()) {
      localStorage.removeItem('video_processing_in_progress');
      throw error;
    }
    console.error(`Error processing long ${mediaType}:`, error);

    // Clear the processing flag on error
    localStorage.removeItem('video_processing_in_progress');

    // Provide more helpful error messages for common issues
    if (error.message && error.message.includes('timeout')) {
      throw new Error(`${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} upload timed out. This may be due to the large file size. Please try a smaller or lower quality ${mediaType}.`);
    } else if (error.message && error.message.includes('ffmpeg')) {
      throw new Error(`Error splitting ${mediaType}: ` + error.message);
    } else {
      throw error;
    }
  }
};

/**
 * Alias for processLongVideo to maintain backward compatibility
 * @param {File} mediaFile - The media file (video or audio)
 * @param {Function} onStatusUpdate - Callback for status updates
 * @param {Function} t - Translation function
 * @returns {Promise<Array>} - Array of subtitle objects
 */
export const processLongMedia = processLongVideo;
