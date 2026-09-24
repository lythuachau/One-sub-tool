import { useState, useCallback, useEffect } from 'react';
import { callGeminiApi, setProcessingForceStopped, getProcessingForceStopped } from '../services/geminiService';
import { preloadYouTubeVideo } from '../utils/videoPreloader';
import { generateFileCacheId } from '../utils/cacheUtils';
import { extractYoutubeVideoId } from '../utils/videoDownloader';
import { getVideoDuration, processLongVideo, retrySegmentProcessing } from '../utils/videoProcessor';
import { setCurrentCacheId as setRulesCacheId } from '../utils/transcriptionRulesStore';
import { setCurrentCacheId as setSubtitlesCacheId } from '../utils/userSubtitlesStore';
import { getSubtitleEngine, transcribeWithWhisper } from '../services/subtitleEngineService';
import { getGeminiErrorMessage as getGeminiStatusMessage } from '../services/gemini/errorUtils';

/**
 * Generate a consistent cache ID from any video URL
 * @param {string} url - Video URL
 * @returns {string|null} - Consistent cache ID
 */
const generateUrlBasedCacheId = async (url) => {
    if (!url) return null;

    try {
        // YouTube URLs
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            return extractYoutubeVideoId(url);
        }

        // Douyin URLs
        if (url.includes('douyin.com')) {
            const { extractDouyinVideoId } = await import('../utils/douyinDownloader');
            return extractDouyinVideoId(url);
        }

        // All other sites - generate consistent ID from URL structure
        const urlObj = new URL(url);
        const domain = urlObj.hostname.replace('www.', '');
        const path = urlObj.pathname.replace(/\//g, '_');
        const query = urlObj.search.replace(/[^a-zA-Z0-9]/g, '_');
        const baseId = `${domain}${path}${query}`.replace(/[^a-zA-Z0-9]/g, '_');
        const cleanId = baseId.replace(/_+/g, '_').replace(/^_|_$/g, '');
        return `site_${cleanId}`;

    } catch (error) {
        console.error('Error generating URL-based cache ID:', error);
        return null;
    }
};

export const useSubtitles = (t) => {
    const [subtitlesData, setSubtitlesData] = useState(null);
    const [status, setStatus] = useState({ message: '', type: '' });
    const [isGenerating, setIsGenerating] = useState(false);
    const [retryingSegments, setRetryingSegments] = useState([]);

    // Listen for abort events
    useEffect(() => {
        const handleAbort = () => {
            // Reset generating state
            setIsGenerating(false);
            // Reset retrying segments
            setRetryingSegments([]);
            localStorage.removeItem('video_processing_in_progress');
            localStorage.removeItem('show_video_analysis');
            localStorage.removeItem('video_analysis_timestamp');
            // Update status
            setStatus({ message: t('output.requestsAborted', 'All Gemini requests have been aborted'), type: 'info' });
        };

        // Add event listener
        window.addEventListener('gemini-requests-aborted', handleAbort);

        // Clean up
        return () => {
            window.removeEventListener('gemini-requests-aborted', handleAbort);
        };
    }, [t]);

    // Function to update segment status and dispatch event
    const updateSegmentsStatus = useCallback((segments) => {
        // Dispatch custom event with segment status
        const event = new CustomEvent('segmentStatusUpdate', { detail: segments });
        window.dispatchEvent(event);
    }, []);

    const checkCachedSubtitles = async (cacheId, currentVideoUrl = null) => {
        try {
            const response = await fetch(`http://localhost:3031/api/subtitle-exists/${cacheId}`);
            const data = await response.json();

            if (!data.exists) {
                return null;
            }

            // If we have a current video URL, validate that the cache belongs to this URL
            if (currentVideoUrl && data.metadata && data.metadata.sourceUrl) {
                if (data.metadata.sourceUrl !== currentVideoUrl) {
                    console.log(`[Cache] Cache ID collision detected. Cache for ${data.metadata.sourceUrl}, current: ${currentVideoUrl}`);
                    return null; // Cache belongs to different video
                }
            }

            return data.subtitles;
        } catch (error) {
            console.error('Error checking subtitle cache:', error);
            return null;
        }
    };

    const saveSubtitlesToCache = async (cacheId, subtitles) => {
        try {
            // Include source URL metadata for validation
            const currentVideoUrl = localStorage.getItem('current_video_url');
            const metadata = currentVideoUrl ? { sourceUrl: currentVideoUrl } : {};

            const response = await fetch('http://localhost:3031/api/save-subtitles', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    cacheId,
                    subtitles,
                    metadata
                })
            });

            const result = await response.json();
            if (!result.success) {
                console.error('Failed to save subtitles to cache:', result.error);
            }
        } catch (error) {
            console.error('Error saving subtitles to cache:', error);
        }
    };

    const generateSubtitles = useCallback(async (input, inputType, apiKeysSet, options = {}) => {
        // Extract options
        const { userProvidedSubtitles } = options;
        const subtitleEngine = getSubtitleEngine();
        if (subtitleEngine === 'gemini' && !apiKeysSet.gemini) {
            setStatus({ message: t('errors.apiKeyRequired'), type: 'error' });
            return false;
        }

        // Reset the force stop flag when starting a new generation
        setProcessingForceStopped(false);

        setIsGenerating(true);
        setStatus({ message: t('output.processingVideo'), type: 'loading' });
        setSubtitlesData(null);

        try {
            let cacheId = null;

            // Check if this is a URL-based input (either direct URL or downloaded video)
            const currentVideoUrl = localStorage.getItem('current_video_url');

            if (inputType === 'youtube' || currentVideoUrl) {
                // Use unified URL-based caching for all video URLs
                const urlToUse = inputType === 'youtube' ? input : currentVideoUrl;
                cacheId = await generateUrlBasedCacheId(urlToUse);

                // Preload YouTube videos
                if (urlToUse && (urlToUse.includes('youtube.com') || urlToUse.includes('youtu.be'))) {
                    preloadYouTubeVideo(urlToUse);
                }

                // Set cache ID for both stores
                setRulesCacheId(cacheId);
                setSubtitlesCacheId(cacheId);

            } else if (inputType === 'file-upload') {
                // For actual file uploads (not downloaded videos), use file-based cache ID
                cacheId = await generateFileCacheId(input);

                // Store the cache ID in localStorage for later use (e.g., saving edited subtitles)
                localStorage.setItem('current_file_cache_id', cacheId);

                // Set cache ID for both stores
                setRulesCacheId(cacheId);
                setSubtitlesCacheId(cacheId);


                // Check if this is a video file and get its duration
                if (input.type.startsWith('video/')) {
                    try {
                        const duration = await getVideoDuration(input);
                        // eslint-disable-next-line no-unused-vars
                        const durationMinutes = Math.floor(duration / 60);

                        // If video is longer than 30 minutes, show warning and use special processing
                        if (durationMinutes > 30) {
                            setStatus({
                                message: t('output.longVideoWarning', 'You uploaded a {{duration}} minute video. Processing can be longer than usual due to multiple Gemini calls.', { duration: durationMinutes }),
                                type: 'loading'
                            });
                        }
                    } catch (error) {
                        console.warn('Error getting video duration:', error);
                    }
                }
            }

            if (cacheId && subtitleEngine === 'whisper') {
                cacheId = `${cacheId}_whisper`;
                if (inputType === 'file-upload') localStorage.setItem('current_file_cache_id', cacheId);
                setRulesCacheId(cacheId);
                setSubtitlesCacheId(cacheId);
            }

            // Check cache with URL validation
            if (cacheId) {
                const cachedSubtitles = await checkCachedSubtitles(cacheId, currentVideoUrl);
                if (cachedSubtitles) {
                    setSubtitlesData(cachedSubtitles);
                    // Use the translation key directly to ensure it's properly translated
                    setStatus({
                        message: t('output.subtitlesLoadedFromCache', 'Subtitles loaded from cache!'),
                        type: 'success',
                        translationKey: 'output.subtitlesLoadedFromCache' // Add a translation key for reference
                    });
                    setIsGenerating(false);
                    return true;
                }
            }

            // Generate new subtitles
            let subtitles;

            // Check if this is a long media file (video or audio) that needs special processing
            if (input.type && (input.type.startsWith('video/') || input.type.startsWith('audio/'))) {
                try {
                    const duration = await getVideoDuration(input);
                    // eslint-disable-next-line no-unused-vars
                    const durationMinutes = Math.floor(duration / 60);

                    // Determine if this is a video or audio file
                    const isAudio = input.type.startsWith('audio/');
                    // eslint-disable-next-line no-unused-vars
                    const mediaType = isAudio ? 'audio' : 'video';

                    // Debug log to see the media duration


                    // Always use segmentation for media files
                    // Process long media file by splitting it into segments
                    subtitles = await processLongVideo(input, setStatus, t, { userProvidedSubtitles });
                } catch (error) {
                    if (error.name === 'AbortError' || getProcessingForceStopped()) {
                        throw error;
                    }
                    console.error('Error checking media duration:', error);
                    // Fallback to normal processing
                    subtitles = subtitleEngine === 'whisper'
                        ? await transcribeWithWhisper(input, {}, setStatus)
                        : await callGeminiApi(input, inputType, { userProvidedSubtitles });
                }
            } else {
                // Normal processing for YouTube
                if (subtitleEngine === 'whisper') {
                    throw new Error('Whisper requires a local video or audio file.');
                }
                subtitles = await callGeminiApi(input, inputType, { userProvidedSubtitles });
            }

            setSubtitlesData(subtitles);

            // Cache the results
            if (cacheId && subtitles && subtitles.length > 0) {
                await saveSubtitlesToCache(cacheId, subtitles);
            }

            // Check if using a strong model (Gemini 2.5 Pro or Gemini 2.0 Flash Thinking)
            const currentModel = localStorage.getItem('gemini_model') || 'gemini-flash-latest';
            const strongModels = ['gemini-2.5-pro', 'gemini-2.0-flash-thinking-exp-01-21'];
            const isUsingStrongModel = strongModels.includes(currentModel);

            // Show different success message based on model
            if (isUsingStrongModel && (!subtitles || subtitles.length === 0)) {
                setStatus({ message: t('output.strongModelSuccess'), type: 'warning' });
            } else {
                setStatus({ message: t('output.generationSuccess'), type: 'success' });
            }
            return true;
        } catch (error) {
            console.error('Error generating subtitles:', error);
            if (error.name === 'AbortError' || getProcessingForceStopped()) {
                localStorage.removeItem('video_processing_in_progress');
                setStatus({ message: t('output.requestsAborted', 'Processing was stopped.'), type: 'info' });
                return false;
            }
            const categorizedError = getGeminiStatusMessage(error, t, { fallbackToRaw: false });
            if (categorizedError) {
                setStatus({ message: categorizedError, type: 'error' });
                return false;
            }
            try {
                // Check for specific Gemini API errors
                if (error.message && (
                    (error.message.includes('503') && error.message.includes('Service Unavailable')) ||
                    error.message.includes('The model is overloaded')
                )) {
                    // Use specific 503 error message if it's a 503 error
                    const is503Error = error.message.includes('503');
                    const errorMessage = is503Error
                        ? t('errors.geminiServiceUnavailable', 'Gemini is temporarily unavailable (503). Wait and retry later.')
                        : t('errors.geminiOverloaded', 'Gemini is temporarily overloaded. Wait and retry later.');
                    setStatus({ message: errorMessage, type: 'error' });
                } else if (error.message && error.message.includes('token') && error.message.includes('exceeds the maximum')) {
                    setStatus({ message: t('errors.tokenLimitExceeded'), type: 'error' });
                } else if (error.message && error.message.includes('File size') && error.message.includes('exceeds the recommended maximum')) {
                    // Extract file size and max size from error message
                    const sizeMatch = error.message.match(/(\d+)MB\) exceeds the recommended maximum of (\d+)MB/);
                    if (sizeMatch && sizeMatch.length >= 3) {
                        const size = sizeMatch[1];
                        const maxSize = sizeMatch[2];
                        setStatus({
                            message: t('errors.fileSizeTooLarge', 'File size ({{size}}MB) exceeds the recommended maximum of {{maxSize}}MB. Please use a smaller file or lower quality video.', { size, maxSize }),
                            type: 'error'
                        });
                    } else {
                        setStatus({ message: error.message, type: 'error' });
                    }
                } else {
                    const errorData = JSON.parse(error.message);
                    if (errorData.type === 'unrecognized_format') {
                        setStatus({
                            message: `${errorData.message}\n\nRaw text from Gemini:\n${errorData.rawText}`,
                            type: 'error'
                        });
                    } else {
                        setStatus({ message: `Error: ${error.message}`, type: 'error' });
                    }
                }
            } catch {
                // Check for specific Gemini API errors in the catch block too
                if (error.message && (
                    (error.message.includes('503') && error.message.includes('Service Unavailable')) ||
                    error.message.includes('The model is overloaded')
                )) {
                    // Use specific 503 error message if it's a 503 error
                    const is503Error = error.message.includes('503');
                    const errorMessage = is503Error
                        ? t('errors.geminiServiceUnavailable', 'Gemini is temporarily unavailable (503). Wait and retry later.')
                        : t('errors.geminiOverloaded', 'Gemini is temporarily overloaded. Wait and retry later.');
                    setStatus({ message: errorMessage, type: 'error' });
                } else if (error.message && error.message.includes('token') && error.message.includes('exceeds the maximum')) {
                    setStatus({ message: t('errors.tokenLimitExceeded'), type: 'error' });
                } else if (error.message && error.message.includes('File size') && error.message.includes('exceeds the recommended maximum')) {
                    // Extract file size and max size from error message
                    const sizeMatch = error.message.match(/(\d+)MB\) exceeds the recommended maximum of (\d+)MB/);
                    if (sizeMatch && sizeMatch.length >= 3) {
                        const size = sizeMatch[1];
                        const maxSize = sizeMatch[2];
                        setStatus({
                            message: t('errors.fileSizeTooLarge', 'File size ({{size}}MB) exceeds the recommended maximum of {{maxSize}}MB. Please use a smaller file or lower quality video.', { size, maxSize }),
                            type: 'error'
                        });
                    } else {
                        setStatus({ message: error.message, type: 'error' });
                    }
                } else {
                    setStatus({ message: `Error: ${error.message}`, type: 'error' });
                }
            }
            return false;
        } finally {
            setIsGenerating(false);
        }
    }, [t]);

    const retryGeneration = useCallback(async (input, inputType, apiKeysSet, options = {}) => {
        // Extract options
        const { userProvidedSubtitles } = options;
        const subtitleEngine = getSubtitleEngine();
        if (subtitleEngine === 'gemini' && !apiKeysSet.gemini) {
            setStatus({ message: t('errors.apiKeyRequired'), type: 'error' });
            return false;
        }

        // Reset the force stop flag when retrying generation
        setProcessingForceStopped(false);

        setIsGenerating(true);
        setStatus({ message: 'Retrying request to Gemini. This may take a few minutes...', type: 'loading' });

        try {
            let subtitles;

            // Check if this is a long media file (video or audio) that needs special processing
            if (input.type && (input.type.startsWith('video/') || input.type.startsWith('audio/'))) {
                try {
                    const duration = await getVideoDuration(input);
                    // eslint-disable-next-line no-unused-vars
                    const durationMinutes = Math.floor(duration / 60);

                    // Determine if this is a video or audio file
                    const isAudio = input.type.startsWith('audio/');
                    // eslint-disable-next-line no-unused-vars
                    const mediaType = isAudio ? 'audio' : 'video';

                    // Debug log to see the media duration


                    // Always use segmentation for media files to match generateSubtitles behavior
                    // Process long media file by splitting it into segments
                    subtitles = await processLongVideo(input, setStatus, t, { userProvidedSubtitles });
                } catch (error) {
                    if (error.name === 'AbortError' || getProcessingForceStopped()) {
                        throw error;
                    }
                    console.error('Error checking media duration:', error);
                    // Fallback to normal processing
                    subtitles = subtitleEngine === 'whisper'
                        ? await transcribeWithWhisper(input, {}, setStatus)
                        : await callGeminiApi(input, inputType, { userProvidedSubtitles });
                }
            } else {
                // Normal processing for YouTube
                if (subtitleEngine === 'whisper') {
                    throw new Error('Whisper requires a local video or audio file.');
                }
                subtitles = await callGeminiApi(input, inputType, { userProvidedSubtitles });
            }

            setSubtitlesData(subtitles);

            // Cache the new results using unified approach
            const currentVideoUrl = localStorage.getItem('current_video_url');
            let cacheId = null;

            if (inputType === 'youtube' || currentVideoUrl) {
                // Use unified URL-based caching
                const urlToUse = inputType === 'youtube' ? input : currentVideoUrl;
                cacheId = await generateUrlBasedCacheId(urlToUse);

                if (cacheId && subtitles && subtitles.length > 0) {
                    await saveSubtitlesToCache(cacheId, subtitles);
                }

                // Set cache ID for both stores
                setRulesCacheId(cacheId);
                setSubtitlesCacheId(cacheId);

            } else if (inputType === 'file-upload') {
                // For actual file uploads, use file-based cache ID
                cacheId = await generateFileCacheId(input);
                if (subtitleEngine === 'whisper') cacheId = `${cacheId}_whisper`;
                localStorage.setItem('current_file_cache_id', cacheId);

                if (cacheId && subtitles && subtitles.length > 0) {
                    await saveSubtitlesToCache(cacheId, subtitles);
                }

                // Set cache ID for both stores
                setRulesCacheId(cacheId);
                setSubtitlesCacheId(cacheId);

            }

            // Check if using a strong model (Gemini 2.5 Pro or Gemini 2.0 Flash Thinking)
            const currentModel = localStorage.getItem('gemini_model') || 'gemini-flash-latest';
            const strongModels = ['gemini-2.5-pro', 'gemini-2.0-flash-thinking-exp-01-21'];
            const isUsingStrongModel = strongModels.includes(currentModel);

            // Show different success message based on model
            if (isUsingStrongModel && (!subtitles || subtitles.length === 0)) {
                setStatus({ message: t('output.strongModelSuccess'), type: 'warning' });
            } else {
                setStatus({ message: t('output.generationSuccess'), type: 'success' });
            }
            return true;
        } catch (error) {
            console.error('Error regenerating subtitles:', error);
            if (error.name === 'AbortError' || getProcessingForceStopped()) {
                localStorage.removeItem('video_processing_in_progress');
                setStatus({ message: t('output.requestsAborted', 'Processing was stopped.'), type: 'info' });
                return false;
            }

            const categorizedError = getGeminiStatusMessage(error, t, { fallbackToRaw: false });
            if (categorizedError) {
                setStatus({ message: categorizedError, type: 'error' });
                return false;
            }

            // Check for specific Gemini API errors
            if (error.message && (
                (error.message.includes('503') && error.message.includes('Service Unavailable')) ||
                error.message.includes('The model is overloaded')
            )) {
                // Use specific 503 error message if it's a 503 error
                const is503Error = error.message.includes('503');
                const errorMessage = is503Error
                    ? t('errors.geminiServiceUnavailable', 'Gemini is temporarily unavailable (503). Wait and retry later.')
                    : t('errors.geminiOverloaded', 'Gemini is temporarily overloaded. Wait and retry later.');
                setStatus({ message: errorMessage, type: 'error' });
            } else if (error.message && error.message.includes('token') && error.message.includes('exceeds the maximum')) {
                setStatus({ message: t('errors.tokenLimitExceeded'), type: 'error' });
            } else if (error.message && error.message.includes('File size') && error.message.includes('exceeds the recommended maximum')) {
                // Extract file size and max size from error message
                const sizeMatch = error.message.match(/(\d+)MB\) exceeds the recommended maximum of (\d+)MB/);
                if (sizeMatch && sizeMatch.length >= 3) {
                    const size = sizeMatch[1];
                    const maxSize = sizeMatch[2];
                    setStatus({
                        message: t('errors.fileSizeTooLarge', 'File size ({{size}}MB) exceeds the recommended maximum of {{maxSize}}MB. Please use a smaller file or lower quality video.', { size, maxSize }),
                        type: 'error'
                    });
                } else {
                    setStatus({ message: error.message, type: 'error' });
                }
            } else {
                setStatus({ message: `Error: ${error.message}`, type: 'error' });
            }
            return false;
        } finally {
            setIsGenerating(false);
        }
    }, [t]);

    // State to track which segments are currently being retried is defined at the top of the hook

    // Function to retry a specific segment
    const retrySegment = useCallback(async (segmentIndex, segments, options = {}) => {
        // Extract options
        const { userProvidedSubtitles, modelId } = options;

        if (modelId) {
            console.log(`[RetrySegment] Using custom model for segment ${segmentIndex + 1}: ${modelId}`);
        } else {
            console.log(`[RetrySegment] Using default model for segment ${segmentIndex + 1}`);
        }

        // Get the most up-to-date subtitles data
        // This is important because the subtitles might have been saved just before this function is called
        let currentSubtitles;

        // Try to get the current cache ID using unified approach
        const currentVideoUrl = localStorage.getItem('current_video_url');
        const currentFileUrl = localStorage.getItem('current_file_url');
        let cacheId = null;

        if (currentVideoUrl) {
            // For any video URL, use unified URL-based caching
            cacheId = await generateUrlBasedCacheId(currentVideoUrl);
        } else if (currentFileUrl) {
            // For uploaded files, the cacheId is already stored
            cacheId = localStorage.getItem('current_file_cache_id');
        }

        if (cacheId) {
            try {
                // Try to get the latest subtitles from cache with URL validation
                const currentVideoUrl = localStorage.getItem('current_video_url');
                const cachedSubtitles = await checkCachedSubtitles(cacheId, currentVideoUrl);
                if (cachedSubtitles) {

                    currentSubtitles = cachedSubtitles;
                } else {
                    // Fall back to current state if cache retrieval fails
                    currentSubtitles = subtitlesData || [];
                }
            } catch (error) {
                console.error('Error getting latest subtitles from cache:', error);
                // Fall back to current state
                currentSubtitles = subtitlesData || [];
            }
        } else {
            // If no cache ID, use current state
            currentSubtitles = subtitlesData || [];
        }

        // Reset the force stop flag when retrying a segment
        setProcessingForceStopped(false);

        // Determine if this is a video or audio file based on the segment name
        // Segment names for audio files typically include 'audio' in the name
        const isAudio = segments && segments[segmentIndex] &&
            (segments[segmentIndex].name?.toLowerCase().includes('audio') ||
             segments[segmentIndex].url?.toLowerCase().includes('audio'));
        const mediaType = isAudio ? 'audio' : 'video';


        // Mark this segment as retrying
        setRetryingSegments(prev => [...prev, segmentIndex]);

        // Update the segment status to show it's retrying
        const retryingStatus = {
            index: segmentIndex,
            status: 'retrying',
            message: t('output.retryingSegment', 'Retrying segment...'),
            shortMessage: t('output.retrying', 'Retrying...')
        };
        const event = new CustomEvent('segmentStatusUpdate', { detail: [retryingStatus] });
        window.dispatchEvent(event);

        // No need to save/restore model since we're not changing it

        try {
            // Retry processing the specific segment
            const updatedSubtitles = await retrySegmentProcessing(
                segmentIndex,
                segments,
                currentSubtitles,
                (status) => {
                    // Only update the overall status if it's a success message
                    if (status.type === 'success') {
                        setStatus(status);
                    }
                },
                t,
                mediaType,
                { userProvidedSubtitles, modelId }
            );

            // Update the subtitles data with the new results
            setSubtitlesData(updatedSubtitles);

            // Store the updated subtitles in localStorage to ensure they're not overwritten
            try {
                localStorage.setItem('latest_segment_subtitles', JSON.stringify(updatedSubtitles));

            } catch (e) {
                console.error('Error saving latest subtitles to localStorage:', e);
            }

            // Trigger auto-save after segment subtitles arrive
            // Find the save button
            const saveButton = document.querySelector('.lyrics-save-btn');
            if (saveButton) {


                // Create a promise to track when the save is complete
                const savePromise = new Promise((resolve) => {
                    // Create a one-time event listener for the save completion
                    const handleSaveComplete = () => {

                        resolve();
                        // Remove the event listener
                        window.removeEventListener('subtitles-saved', handleSaveComplete);
                    };

                    // Listen for a custom event that will be dispatched when save is complete
                    window.addEventListener('subtitles-saved', handleSaveComplete, { once: true });

                    // Click the save button to trigger the save
                    saveButton.click();

                    // Set a timeout in case the event never fires
                    setTimeout(() => {
                        window.removeEventListener('subtitles-saved', handleSaveComplete);
                        resolve();
                    }, 2000);
                });

                // Wait for the save to complete
                await savePromise;
            } else {
                console.warn('Could not find save button to auto-save after segment subtitles arrived');
            }

            // Show a brief success message
            // Check if we're generating a new segment or retrying an existing one
            const isGenerating = !subtitlesData || subtitlesData.length === 0;
            setStatus({
                message: isGenerating
                    ? t('output.segmentGenerateSuccess', 'Segment {{segmentNumber}} processed successfully and combined with existing subtitles', { segmentNumber: segmentIndex + 1 })
                    : t('output.segmentRetrySuccess', 'Segment {{segmentNumber}} reprocessed successfully', { segmentNumber: segmentIndex + 1 }),
                type: 'success'
            });
            return true;
        } catch (error) {
            console.error('Error retrying segment:', error);

            // Update the segment status to show the error
            const errorStatus = {
                index: segmentIndex,
                status: 'error',
                message: error.message || t('output.processingFailed', 'Processing failed'),
                shortMessage: t('output.failed', 'Failed')
            };
            const errorEvent = new CustomEvent('segmentStatusUpdate', { detail: [errorStatus] });
            window.dispatchEvent(errorEvent);

            // Show error message
            setStatus({
                message: `${t('errors.segmentRetryFailed', 'Failed to retry segment {{segmentNumber}}', { segmentNumber: segmentIndex + 1 })}: ${error.message}`,
                type: 'error'
            });
            return false;
        } finally {
            // Remove this segment from the retrying list
            setRetryingSegments(prev => prev.filter(idx => idx !== segmentIndex));
        }
    }, [subtitlesData, t]);

    return {
        subtitlesData,
        setSubtitlesData,
        status,
        setStatus,
        isGenerating,
        generateSubtitles,
        retryGeneration,
        updateSegmentsStatus,
        retrySegment,
        retryingSegments
    };
};

export default useSubtitles;
export { generateUrlBasedCacheId };
