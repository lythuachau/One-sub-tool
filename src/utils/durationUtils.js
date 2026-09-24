/**
 * Utility functions for handling media (video and audio) durations
 */

import { createRequestController, removeRequestController } from '../services/gemini/requestManagement';

/**
 * Get the segment duration in minutes from localStorage
 * @returns {number} - Segment duration in minutes
 */
export const getSegmentDurationMinutes = () => {
    const savedDuration = parseInt(localStorage.getItem('segment_duration') || '5');
    // Ensure the value is within the allowed range: 1 to 45 minutes
    if (savedDuration >= 1 && savedDuration <= 45) {
        return savedDuration;
    }
    return 5; // Default to 5 minutes if out of range
};

/**
 * Calculate the segment duration in seconds
 * @returns {number} - Segment duration in seconds
 */
export const getMaxSegmentDurationSeconds = () => getSegmentDurationMinutes() * 60;

/**
 * Get the duration of a media file (video or audio).
 * @param {File} mediaFile - The media file (video or audio)
 * @param {Object} options - Optional parent cancellation signal
 * @returns {Promise<number>} - The duration in seconds
 */
export const getVideoDuration = (mediaFile, { signal: parentSignal } = {}) => {
    return new Promise((resolve, reject) => {
        const { requestId, signal, controller } = createRequestController({ type: 'media-metadata' });
        let mediaElement = null;
        let objectUrl = null;
        let settled = false;

        const abortFromParent = () => controller.abort(parentSignal.reason);

        const cleanup = () => {
            if (parentSignal) {
                parentSignal.removeEventListener('abort', abortFromParent);
            }
            if (mediaElement) {
                mediaElement.onloadedmetadata = null;
                mediaElement.onerror = null;
                mediaElement.onabort = null;
                mediaElement.removeAttribute('src');
                mediaElement.load();
            }
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                objectUrl = null;
            }
            signal.removeEventListener('abort', handleAbort);
            removeRequestController(requestId);
        };

        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback(value);
        };

        const handleAbort = () => {
            const error = signal.reason && signal.reason.name
                ? signal.reason
                : new DOMException('Media metadata request was aborted', 'AbortError');
            finish(reject, error);
        };
        signal.addEventListener('abort', handleAbort, { once: true });
        if (parentSignal) {
            if (parentSignal.aborted) {
                abortFromParent();
            } else {
                parentSignal.addEventListener('abort', abortFromParent, { once: true });
            }
        }

        if (!mediaFile) {
            console.error('No media file provided to getVideoDuration');
            return finish(resolve, 600);
        }

        // Check if the file has a valid type
        if (!mediaFile.type) {
            console.warn('Media file has no type, assuming video/mp4');
            mediaFile = new File([mediaFile], mediaFile.name || 'video.mp4', { type: 'video/mp4' });
        }

        // Determine if this is a video or audio file based on MIME type or name
        const isAudio = mediaFile.type.startsWith('audio/') ||
                       (mediaFile.name && /\.(mp3|wav|ogg|aac|flac)$/i.test(mediaFile.name));

        const isVideo = mediaFile.type.startsWith('video/') ||
                       (mediaFile.name && /\.(mp4|webm|mov|avi|mkv)$/i.test(mediaFile.name)) ||
                       (!isAudio); // Default to video if not explicitly audio

        if (isVideo) {
            // Use video element for video files
            const video = document.createElement('video');
            mediaElement = video;
            video.preload = 'metadata';

            video.onloadedmetadata = () => {
                finish(resolve, video.duration);
            };

            video.onerror = (e) => {
                console.error('Error loading video metadata:', e);
                finish(resolve, 600);
            };

            video.onabort = handleAbort;

            try {
                objectUrl = URL.createObjectURL(mediaFile);
                video.src = objectUrl;
            } catch (error) {
                console.error('Error creating object URL:', error);
                finish(resolve, 600);
            }
        } else if (isAudio) {
            // Use audio element for audio files
            const audio = document.createElement('audio');
            mediaElement = audio;
            audio.preload = 'metadata';

            audio.onloadedmetadata = () => {
                finish(resolve, audio.duration);
            };

            audio.onerror = (e) => {
                console.error('Error loading audio metadata:', e);
                finish(resolve, 600);
            };

            audio.onabort = handleAbort;

            try {
                objectUrl = URL.createObjectURL(mediaFile);
                audio.src = objectUrl;
            } catch (error) {
                console.error('Error creating object URL:', error);
                finish(resolve, 600);
            }
        } else {
            console.warn('Unsupported file type, using fallback duration');
            finish(resolve, 600);
        }
    });
};

/**
 * Alias for getVideoDuration to maintain backward compatibility
 * @param {File} mediaFile - The media file (video or audio)
 * @returns {Promise<number>} - The duration in seconds
 */
export const getMediaDuration = getVideoDuration;

/**
 * Create a media segment from the original file
 * @param {File} originalFile - The original media file (video or audio)
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @param {number} segmentIndex - Index of the segment
 * @returns {File} - A new File object representing the segment
 */
export const createVideoSegment = (originalFile, startTime, endTime, segmentIndex) => {
    // Since we can't actually split the media in the browser,
    // we'll create a reference to the original file with metadata
    // about the segment's time range
    const isAudio = originalFile.type.startsWith('audio/');
    const extension = isAudio ? 'mp3' : 'mp4';

    const segmentFile = new File([originalFile], `segment_${segmentIndex}.${extension}`, {
        type: originalFile.type,
        lastModified: originalFile.lastModified
    });

    // Attach metadata to the file object
    segmentFile.segmentStartTime = startTime;
    segmentFile.segmentEndTime = endTime;
    segmentFile.segmentIndex = segmentIndex;
    segmentFile.originalFileName = originalFile.name;

    return segmentFile;
};
