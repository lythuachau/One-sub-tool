// Import SERVER_URL from config
import { SERVER_URL } from '../config';

/**
 * Parse time string (00:00:00,000 or 00:00:00.000) to seconds
 * @param {string} timeString - Time string in format 00:00:00,000 or 00:00:00.000
 * @returns {number} - Time in seconds
 */
export const parseTimeString = (timeString) => {
  if (!timeString) return 0;

  // Handle SRT format (00:00:00,000) or WebVTT format (00:00:00.000)
  if (timeString.includes(':')) {
    const [hours, minutes, secondsMs] = timeString.split(':');
    const [seconds, ms] = secondsMs.includes(',')
      ? secondsMs.split(',')
      : secondsMs.split('.');

    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(ms) / 1000;
  }

  // If it's just a number, return it as is
  if (!isNaN(parseFloat(timeString))) {
    return parseFloat(timeString);
  }

  return 0;
};

/**
 * Convert seconds to SRT time format (HH:MM:SS,mmm)
 * @param {number} seconds - Time in seconds
 * @returns {string} - Time in SRT format
 */
export const secondsToSrtTime = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
};

/**
 * Clean subtitle text by removing any SRT formatting that might be embedded in it
 * @param {string} text - The subtitle text that might contain SRT formatting
 * @returns {string} - Cleaned text without SRT formatting
 */
export const cleanSubtitleText = (text) => {
  if (!text) return '';

  // Remove any SRT entry numbers at the beginning of lines
  let cleanedText = text.replace(/^"?\d+\s*$/gm, '');

  // Remove timestamp lines (00:00:00,000 --> 00:00:00,000)
  cleanedText = cleanedText.replace(/^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\s*$/gm, '');

  // Remove any quotes that might be wrapping the entire text
  cleanedText = cleanedText.replace(/^"|"$/g, '');

  // Remove any empty lines that might have been created
  cleanedText = cleanedText.split('\n').filter(line => line.trim()).join('\n');

  return cleanedText.trim();
};

/**
 * Generate SRT content from subtitles
 * @param {Array} subtitles - Array of subtitle objects
 * @returns {string} - SRT content
 */
export const generateSrtContent = (subtitles) => {
  return subtitles.map((subtitle, index) => {
    // Always convert to proper SRT format (HH:MM:SS,mmm)
    let startTime, endTime;

    // If we have numeric start/end values, convert them to SRT format
    if (subtitle.start !== undefined) {
      startTime = secondsToSrtTime(subtitle.start);
    }
    // If we have startTime string, ensure it's in SRT format
    else if (subtitle.startTime) {
      // Check if it's already in SRT format
      if (/^\d{2}:\d{2}:\d{2},\d{3}$/.test(subtitle.startTime)) {
        startTime = subtitle.startTime;
      } else {
        // Try to parse and convert to SRT format
        const timeInSeconds = parseTimeString(subtitle.startTime);
        startTime = secondsToSrtTime(timeInSeconds);
      }
    } else {
      startTime = '00:00:00,000';
    }

    // Same for end time
    if (subtitle.end !== undefined) {
      endTime = secondsToSrtTime(subtitle.end);
    }
    else if (subtitle.endTime) {
      if (/^\d{2}:\d{2}:\d{2},\d{3}$/.test(subtitle.endTime)) {
        endTime = subtitle.endTime;
      } else {
        const timeInSeconds = parseTimeString(subtitle.endTime);
        endTime = secondsToSrtTime(timeInSeconds);
      }
    } else {
      endTime = '00:00:05,000';
    }

    // Clean the subtitle text to remove any SRT formatting that might be embedded in it
    const cleanedText = cleanSubtitleText(subtitle.text);

    return `${index + 1}\n${startTime} --> ${endTime}\n${cleanedText}`;
  }).join('\n\n');
};

/**
 * Download subtitles as SRT file
 * @param {Array} subtitles - Array of subtitle objects
 * @param {string} filename - Name of the file to download
 */
export const downloadSRT = (subtitles, filename) => {
  if (!subtitles || subtitles.length === 0) {
    console.error('No subtitles to download');
    return;
  }

  const content = generateSrtContent(subtitles);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'subtitles.srt';
  document.body.appendChild(a);
  a.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
};

/**
 * Generate JSON content from subtitles
 * @param {Array} subtitles - Array of subtitle objects
 * @returns {string} - JSON content
 */
export const generateJsonContent = (subtitles) => {
  // Create a clean version of the subtitles with consistent properties
  const cleanSubtitles = subtitles.map((subtitle, index) => {
    // Convert any startTime/endTime strings to numeric values if needed
    let start = subtitle.start;
    let end = subtitle.end;

    // If we have startTime/endTime strings but no numeric values, convert them
    if (subtitle.startTime && start === undefined) {
      // Parse the SRT time format (00:00:00,000) to seconds
      const [hours, minutes, secondsMs] = subtitle.startTime.split(':');
      const [seconds, ms] = secondsMs.split(',');
      start = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(ms) / 1000;
    }

    if (subtitle.endTime && end === undefined) {
      const [hours, minutes, secondsMs] = subtitle.endTime.split(':');
      const [seconds, ms] = secondsMs.split(',');
      end = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(ms) / 1000;
    }

    return {
      id: index + 1,
      start: start,
      end: end,
      startTime: subtitle.startTime,
      endTime: subtitle.endTime,
      text: subtitle.text
    };
  });

  return JSON.stringify(cleanSubtitles, null, 2); // Pretty print with 2 spaces
};

/**
 * Download subtitles as JSON file
 * @param {Array} subtitles - Array of subtitle objects
 * @param {string} filename - Name of the file to download
 */
export const downloadJSON = (subtitles, filename) => {
  if (!subtitles || subtitles.length === 0) {
    console.error('No subtitles to download');
    return;
  }

  const content = generateJsonContent(subtitles);
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'subtitles.json';
  document.body.appendChild(a);
  a.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
};

/**
 * Generate plain text content from subtitles (without timings)
 * @param {Array} subtitles - Array of subtitle objects
 * @returns {string} - Plain text content
 */
export const generateTxtContent = (subtitles) => {
  return subtitles.map(subtitle => subtitle.text).join('\n');
};

/**
 * Download subtitles as TXT file (text only, no timings)
 * @param {Array} subtitles - Array of subtitle objects
 * @param {string} filename - Name of the file to download
 */
export const downloadTXT = (subtitles, filename) => {
  if (!subtitles || subtitles.length === 0) {
    console.error('No subtitles to download');
    return;
  }

  const content = generateTxtContent(subtitles);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'subtitles.txt';
  document.body.appendChild(a);
  a.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);

  // Return the plain text content for potential further processing
  return content;
};

/**
 * Convert a file to base64 string
 * @param {File} file - The file to convert
 * @returns {Promise<string>} - Promise resolving to base64 string
 */
export const fileToBase64 = (file, { signal } = {}) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort);
    };
    const handleAbort = () => {
      reader.onabort = null;
      reader.abort();
      const error = signal?.reason?.name
        ? signal.reason
        : new DOMException('File conversion was aborted', 'AbortError');
      cleanup();
      reject(error);
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener('abort', handleAbort, { once: true });
    reader.readAsDataURL(file);
    reader.onload = () => {
      cleanup();
      // Extract the base64 data from the data URL
      // Format is: data:[<mediatype>][;base64],<data>
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = (error) => {
      cleanup();
      console.error('Error converting file to base64:', error);
      reject(error);
    };
    reader.onabort = () => {
      cleanup();
      reject(new DOMException('File conversion was aborted', 'AbortError'));
    };
  });
};

/**
 * Extract audio from a video and download it
 * @param {string} videoPath - Path to the video file
 * @param {string} filename - Name of the file to download (without extension)
 * @returns {Promise<boolean>} - Promise resolving to success status
 */
export const extractAndDownloadAudio = async (videoPath, filename = 'audio') => {
  try {


    // Create a download link element that we'll use later
    const a = document.createElement('a');
    document.body.appendChild(a);
    a.style.display = 'none';

    // Handle blob URLs differently - we need to fetch the blob and send the actual data
    if (videoPath.startsWith('blob:')) {


      try {
        // Fetch the blob data
        const videoBlob = await fetch(videoPath).then(r => r.blob());


        // Create a form for the file upload
        const formData = new FormData();
        formData.append('video', videoBlob, 'video.mp4');

        // Use fetch with blob to download directly
        const response = await fetch(`${SERVER_URL}/api/extract-audio-from-blob`, {
          method: 'POST',
          body: videoBlob,
        });

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }

        // Get the blob from the response
        const audioBlob = await response.blob();

        // Create a URL for the blob
        const blobUrl = URL.createObjectURL(audioBlob);

        // Set up the download
        a.href = blobUrl;
        a.download = `${filename}.mp3`;
        a.click();

        // Clean up
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          document.body.removeChild(a);
        }, 100);

        return true;
      } catch (blobError) {
        console.error('Error processing blob:', blobError);
        throw new Error('Failed to process video data from blob URL');
      }
    } else {
      // For regular URLs, use a direct download approach
      try {
        // Fetch the audio data directly
        const response = await fetch(`${SERVER_URL}/api/extract-audio?videoPath=${encodeURIComponent(videoPath)}&filename=${encodeURIComponent(filename)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ videoPath }),
        });

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }

        // Get the blob from the response
        const audioBlob = await response.blob();

        // Create a URL for the blob
        const blobUrl = URL.createObjectURL(audioBlob);

        // Set up the download
        a.href = blobUrl;
        a.download = `${filename}.mp3`;
        a.click();

        // Clean up
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          document.body.removeChild(a);
        }, 100);

        return true;
      } catch (downloadError) {
        console.error('Error downloading audio:', downloadError);
        throw new Error(`Failed to download audio: ${downloadError.message}`);
      }
    }
  } catch (error) {
    console.error('Error extracting audio:', error);
    return false;
  }
};
