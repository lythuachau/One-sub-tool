/**
 * Utility for splitting media (videos and audio) into segments using the server
 */

// Server URL for the local server - using unified port configuration
const SERVER_URL = 'http://localhost:3031'; // Backend server port

/**
 * Upload a media file (video or audio) to the server and split it into segments
 * @param {File} mediaFile - The media file (video or audio) to split
 * @param {number} segmentDuration - Duration of each segment in seconds (default: 600 seconds = 10 minutes)
 * @param {Function} onProgress - Progress callback function
 * @param {boolean} fastSplit - Whether to use fast splitting mode (uses stream copy instead of re-encoding)
 * @param {Object} options - Additional options
 * Original media is always used; optimization options are ignored for compatibility.
 * @returns {Promise<Object>} - Object containing segment URLs and metadata
 */
export const splitVideoOnServer = async (mediaFile, segmentDuration = 600, onProgress = () => {}, fastSplit = false, options = {}) => {
  try {
    // Determine if this is a video or audio file based on MIME type
    const isAudio = mediaFile.type.startsWith('audio/');
    const mediaType = isAudio ? 'audio' : 'video';

    // Check if this file has already been copied to the server
    console.log(`[SPLIT-VIDEO-DEBUG] File: ${mediaFile.name}, isCopiedToServer: ${mediaFile.isCopiedToServer}, serverPath: ${mediaFile.serverPath}`);

    if (mediaFile.isCopiedToServer && mediaFile.serverPath) {
      console.log(`[SPLIT-VIDEO-DEBUG] Using existing file on server: ${mediaFile.serverPath}`);
      // File is already on server, use the server-side splitting endpoint
      return await splitFileOnServer(mediaFile, segmentDuration, onProgress, fastSplit, options);
    } else {
      console.log(`[SPLIT-VIDEO-DEBUG] File not on server, uploading new file`);
    }

    // Use the translation key for the uploading message
    const uploadingKey = isAudio ? 'output.uploadingAudioToServer' : 'output.uploadingVideoToServer';
    const uploadingDefaultMsg = isAudio ? 'Uploading audio to server...' : 'Uploading video to server...';

    // The onProgress function should handle translation, but we provide both the key and default message
    onProgress(10, uploadingKey, uploadingDefaultMsg);

    // Validate the media file
    if (!mediaFile || !mediaFile.size) {
      throw new Error('Invalid media file: File is empty or undefined');
    }

    // Check if the file size is reasonable
    if (mediaFile.size < 100 * 1024) { // Less than 100KB
      throw new Error(`Media file is too small (${mediaFile.size} bytes), likely not a valid file`);
    }

    // Ensure the file has a name
    const fileName = mediaFile.name || `${mediaType}_${Date.now()}.${mediaType === 'audio' ? 'mp3' : 'mp4'}`;

    // Log the file details


    // Check if the file name contains a site_ prefix, which means it's from the all-sites downloader
    let mediaId;
    if (fileName.includes('site_')) {
      // Extract the site ID from the filename (without the .mp4 extension)
      const siteIdMatch = fileName.match(/site_[a-zA-Z0-9_]+/);
      if (siteIdMatch) {
        // Use the site ID as the media ID to maintain consistency
        mediaId = siteIdMatch[0];

      } else {
        // Generate a unique ID for this media file
        mediaId = `${mediaType}_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`;

      }
    } else {
      // Generate a unique ID for this media file
      mediaId = `${mediaType}_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`;

    }

    const url = `${SERVER_URL}/api/split-video?mediaId=${mediaId}&segmentDuration=${segmentDuration}&fastSplit=${fastSplit}&mediaType=${mediaType}`;




    // Upload the media file
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': mediaFile.type,
      },
      body: mediaFile, // Send the raw file
    });

    if (!response.ok) {
      console.error('Upload failed with status:', response.status);
      let errorMessage = `Failed to split ${mediaType} (Status: ${response.status})`;

      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        console.error('Error parsing error response:', e);
        // Try to get the text response instead
        try {
          const textResponse = await response.text();
          console.error('Error response text:', textResponse);
          errorMessage += ` - Server response: ${textResponse.substring(0, 100)}...`;
        } catch (textError) {
          console.error('Error getting response text:', textError);
        }
      }

      throw new Error(errorMessage);
    }

    // Use the translation key for the uploaded message
    const uploadedKey = isAudio ? 'output.audioUploaded' : 'output.videoUploaded';
    const uploadedDefaultMsg = isAudio ? 'Audio uploaded, processing segments...' : 'Video uploaded, processing segments...';

    onProgress(80, uploadedKey, uploadedDefaultMsg);

    const data = await response.json();


    // Use the translation key for the segments ready message
    const readyKey = isAudio ? 'output.audioSegmentsReady' : 'output.videoSegmentsReady';
    const readyDefaultMsg = isAudio ? 'Audio segments ready' : 'Video segments ready';

    onProgress(100, readyKey, readyDefaultMsg);

    // Log the actual segment durations for debugging
    // Commented out to avoid unused variable warnings
    /*
    if (data.segments && data.segments.length > 0) {
      let totalActualDuration = 0;
      let totalTheoreticalDuration = 0;

      data.segments.forEach((segment) => {
        // Calculate totals for actual and theoretical durations
        const actualDuration = segment.duration;
        const theoreticalDuration = segment.theoreticalDuration;

        totalActualDuration += actualDuration;
        totalTheoreticalDuration += theoreticalDuration;
      });
    }
    */

    return {
      success: true,
      originalMedia: data.originalMedia || data.originalVideo, // Support both new and old response formats
      mediaId: data.mediaId || data.videoId, // Support both new and old response formats
      segments: data.segments,
      message: data.message,
      mediaType: mediaType,
      optimized: data.optimized || null // Include optimized video information if available
    };
  } catch (error) {
    console.error(`Error splitting ${mediaFile.type.startsWith('audio/') ? 'audio' : 'video'}:`, error);
    throw error;
  }
};

/**
 * Split a file that has already been copied to the server
 * @param {File} mediaFile - The media file with server path information
 * @param {number} segmentDuration - Duration of each segment in seconds
 * @param {Function} onProgress - Progress callback function
 * @param {boolean} fastSplit - Whether to use fast splitting mode
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Object containing segment URLs and metadata
 */
const splitFileOnServer = async (mediaFile, segmentDuration, onProgress, fastSplit, options) => {
  try {
    // Extract filename from server path
    const filename = mediaFile.serverPath.split('/').pop();

    onProgress(20, 'output.splittingVideo', 'Splitting video into segments...');

    // Call the server-side splitting endpoint for already uploaded files
    const response = await fetch(`${SERVER_URL}/api/split-existing-file`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: filename,
        segmentDuration: segmentDuration,
        fastSplit: fastSplit,
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to split file on server');
    }

    const result = await response.json();

    onProgress(100, 'output.splittingComplete', 'Video splitting complete');

    return {
      success: true,
      originalMedia: result.originalMedia,
      mediaId: result.mediaId,
      mediaType: result.mediaType,
      segments: result.segments,
      optimized: result.optimized
    };
  } catch (error) {
    console.error('Error splitting file on server:', error);
    throw error;
  }
};

/**
 * Fetch a media segment from the server
 * @param {string} segmentUrl - URL of the segment
 * @param {number} segmentIndex - Index of the segment (optional)
 * @param {string} mediaType - Type of media ('video' or 'audio')
 * @returns {Promise<File>} - File object representing the segment
 */
export const fetchSegment = async (segmentUrl, segmentIndex, mediaType = 'video') => {
  try {
    const response = await fetch(segmentUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch segment: ${response.statusText}`);
    }

    const blob = await response.blob();
    const filename = segmentUrl.split('/').pop();

    // Extract segment index from filename if not provided
    let index = segmentIndex;
    if (index === undefined) {
      // Try to extract index from filename (assuming format with _000, _001, etc.)
      const match = filename.match(/_([0-9]{3})\.[^.]+$/);
      if (match) {
        index = parseInt(match[1]);
      }
    }

    // Create file with segment metadata
    const mimeType = mediaType === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const file = new File([blob], filename, { type: mimeType });

    // Add segment metadata if we have an index
    if (index !== undefined) {

      // Add segment index as a property
      file.segmentIndex = index;

      // Try to get segment metadata from the URL
      try {
        // Extract segment info from the URL query parameters if available
        const urlObj = new URL(segmentUrl, window.location.origin);
        const startTime = urlObj.searchParams.get('startTime');
        const duration = urlObj.searchParams.get('duration');

        if (startTime) {
          file.startTime = parseFloat(startTime);

        }

        if (duration) {
          file.duration = parseFloat(duration);


        }

        // We already parsed startTime above, no need to recalculate
        if (startTime) {
          // startTime is already set above at line 207
        }
      } catch (error) {
        console.warn('Could not parse segment URL for metadata:', error);
      }
    }

    return file;
  } catch (error) {
    console.error('Error fetching segment:', error);
    throw error;
  }
};
