/**
 * API routes for media (video and audio) operations
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { VIDEOS_DIR, SERVER_URL } = require('../config');
const { downloadYouTubeVideo } = require('../services/youtube');
const { resolveDouyinTarget } = require('../services/douyin/nativeDownloader');
const { getDownloadProgress } = require('../services/shared/progressTracker');
const { getVideoDimensions } = require('../services/videoProcessing/durationUtils');
const {
  isVideoSourceMatch,
  writeVideoSourceMetadata,
  quarantineStaleVideoArtifact
} = require('../services/shared/videoSourceMetadata');
const {
  splitVideoIntoSegments,
  splitMediaIntoSegments,
  convertAudioToVideo
} = require('../services/videoProcessingService');

// Configure multer for large file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, VIDEOS_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname || 'uploaded-file';
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension);
    const filename = `large_upload_${timestamp}_${baseName}${extension}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024 // 2GB limit
  }
});

/**
 * POST /api/copy-large-file - Copy a large file to the videos directory with progress tracking
 */
router.post('/copy-large-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const filename = req.file.filename;

    // Return the file path for the client to reference
    res.json({
      success: true,
      filePath: `/videos/${filename}`,
      serverPath: filePath,
      size: req.file.size,
      message: 'Large file copied successfully'
    });
  } catch (error) {
    console.error('Error copying large file:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to copy large file',
      details: error.message
    });
  }
});

/**
 * GET /api/video-exists/:videoId - Check if a video exists
 */
router.get('/video-exists/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const sourceUrl = req.query.url;
  let canonicalVideoId = videoId;
  if (sourceUrl && /(?:douyin\.com|iesdouyin\.com)/i.test(sourceUrl)) {
    try {
      const target = await resolveDouyinTarget(sourceUrl);
      canonicalVideoId = String(target.videoId);
    } catch (error) {
      console.warn(`[VIDEO-EXISTS] Douyin URL resolution failed for ${videoId}: ${error.message}`);
    }
  }

  let videoPath = path.join(VIDEOS_DIR, `${canonicalVideoId}.mp4`);
  let filename = `${canonicalVideoId}.mp4`;

  // If exact match doesn't exist, look for files starting with videoId
  if (!fs.existsSync(videoPath)) {
    const files = fs.readdirSync(VIDEOS_DIR);
    const matchingFile = files.find(file =>
      file.startsWith(`${canonicalVideoId}_`) && file.endsWith('.mp4')
    );

    if (matchingFile) {
      videoPath = path.join(VIDEOS_DIR, matchingFile);
      filename = matchingFile;
    }
  }

  if (!fs.existsSync(videoPath) || !sourceUrl) {
    res.json({ exists: false });
    return;
  }

  try {
    const matches = await isVideoSourceMatch(videoPath, { videoId: canonicalVideoId, sourceUrl });
    if (!matches) {
      await quarantineStaleVideoArtifact(videoPath, 'source-mismatch');
      res.json({ exists: false });
      return;
    }

    const stats = fs.statSync(videoPath);
    res.json({
      exists: true,
      videoId: canonicalVideoId,
      requestedVideoId: videoId,
      url: `/videos/${filename}`,
      size: stats.size,
      createdAt: stats.birthtime
    });
  } catch (error) {
    console.error('Error validating cached video source:', error);
    res.status(500).json({ exists: false, error: 'Failed to validate cached video' });
  }
});

/**
 * GET /api/segment-exists/:segmentId - Check if a segment exists
 */
router.get('/segment-exists/:segmentId', (req, res) => {
  const { segmentId } = req.params;
  const segmentPath = path.join(VIDEOS_DIR, `${segmentId}.mp4`);

  if (fs.existsSync(segmentPath)) {
    const stats = fs.statSync(segmentPath);
    res.json({
      exists: true,
      url: `/videos/${segmentId}.mp4`,
      size: stats.size,
      createdAt: stats.birthtime
    });
  } else {
    res.json({ exists: false });
  }
});

/**
 * POST /api/download-video - Download a YouTube video
 */
router.post('/download-video', async (req, res) => {
  const { videoId, sourceUrl, useCookies = false } = req.body;



  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }

  const videoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

  const expectedSourceUrl = sourceUrl || `https://www.youtube.com/watch?v=${videoId}`;

  // A cache hit is valid only when its sidecar proves the same source URL.
  if (fs.existsSync(videoPath) && await isVideoSourceMatch(videoPath, { videoId, sourceUrl: expectedSourceUrl })) {
    return res.json({
      success: true,
      message: 'Video already downloaded',
      url: `/videos/${videoId}.mp4`
    });
  }

  if (fs.existsSync(videoPath)) {
    await quarantineStaleVideoArtifact(videoPath, 'source-mismatch');
  }

  try {
    // Download the video using JavaScript libraries with audio prioritized
    const result = await downloadYouTubeVideo(videoId, useCookies);

    // Check if the file was created successfully
    if (fs.existsSync(videoPath)) {
      await writeVideoSourceMetadata({
        videoPath,
        videoId,
        sourceUrl: expectedSourceUrl,
        method: result.method || 'youtube'
      });

      return res.json({
        success: true,
        message: result.message || 'Video downloaded successfully',
        url: `/videos/${videoId}.mp4`
      });
    } else {
      throw new Error('Download completed but video file was not found');
    }
  } catch (error) {
    console.error('Error downloading video:', error);

    // Clean up any partial file
    try {
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    } catch (e) {
      console.error('Error cleaning up incomplete file:', e);
    }

    return res.status(500).json({
      error: 'Failed to download video',
      details: error.message
    });
  }
});

/**
 * GET /api/download-progress/:videoId - Get download progress for a video
 */
router.get('/download-progress/:videoId', (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }

  try {
    const progress = getDownloadProgress(videoId);
    res.json({
      success: true,
      videoId: videoId,
      progress: progress.progress,
      status: progress.status,
      timestamp: progress.timestamp
    });
  } catch (error) {
    console.error('Error getting download progress:', error);
    res.status(500).json({
      error: 'Failed to get download progress',
      details: error.message
    });
  }
});

/**
 * GET /api/video-dimensions/:videoId - Get video dimensions and quality
 */
router.get('/video-dimensions/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }

  try {
    // Look for video file with pattern matching (handles files with titles)
    let videoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

    // If exact match doesn't exist, look for files starting with videoId
    if (!fs.existsSync(videoPath)) {
      const files = fs.readdirSync(VIDEOS_DIR);
      const matchingFile = files.find(file =>
        file.startsWith(`${videoId}_`) && file.endsWith('.mp4')
      );

      if (matchingFile) {
        videoPath = path.join(VIDEOS_DIR, matchingFile);
      }
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({
        success: false,
        error: 'Video file not found'
      });
    }

    const dimensions = await getVideoDimensions(videoPath);

    res.json({
      success: true,
      videoId: videoId,
      width: dimensions.width,
      height: dimensions.height,
      quality: dimensions.quality,
      resolution: dimensions.resolution
    });
  } catch (error) {
    console.error('Error getting video dimensions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get video dimensions',
      details: error.message
    });
  }
});

/**
 * POST /api/split-existing-file - Split a file that already exists on the server
 */
router.post('/split-existing-file', async (req, res) => {
  try {
    const { filename, segmentDuration = 600, fastSplit = false } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const filePath = path.join(VIDEOS_DIR, filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    // Determine media type from file extension
    const extension = path.extname(filename).toLowerCase();
    const isAudio = ['.mp3', '.wav', '.aac', '.ogg', '.flac'].includes(extension);
    const mediaType = isAudio ? 'audio' : 'video';

    // Extract media ID from filename
    const mediaId = filename.replace(/\.(mp[34]|webm|mov|avi|wmv|flv|mkv|mp3|wav|aac|ogg|flac)$/i, '');

    const processPath = filePath;

    // Split the media file into segments
    const result = await splitMediaIntoSegments(
      processPath,
      segmentDuration,
      VIDEOS_DIR,
      `${mediaId}_part`,
      {
        fastSplit,
        mediaType
      }
    );

    res.json({
      success: true,
      originalMedia: `/videos/${filename}`,
      mediaId: mediaId,
      mediaType: mediaType,
      segments: result.segments.map(segment => ({
        path: `/videos/${path.basename(segment.path)}`,
        url: `${SERVER_URL}/videos/${path.basename(segment.path)}?startTime=${segment.startTime}&duration=${segment.duration}`,
        name: path.basename(segment.path),
        startTime: segment.startTime,
        duration: segment.duration,
        theoreticalStartTime: segment.theoreticalStartTime,
        theoreticalDuration: segment.theoreticalDuration
      })),
      message: `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} split successfully`,
      optimized: null
    });
  } catch (error) {
    console.error('Error splitting existing file:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to split existing file'
    });
  }
});

/**
 * POST /api/upload-and-split-video - Upload and split a media file (video or audio)
 */
router.post('/upload-and-split-video', express.raw({ limit: '2gb', type: '*/*' }), async (req, res) => {
  try {
    // Determine if this is a video or audio file based on MIME type
    const contentType = req.headers['content-type'] || '';
    const isAudio = contentType.startsWith('audio/');
    const mediaType = isAudio ? 'audio' : 'video';

    // Generate a unique filename
    const timestamp = Date.now();
    const fileExtension = contentType.split('/')[1] || (isAudio ? 'mp3' : 'mp4');
    const filename = `upload_${timestamp}.${fileExtension}`;
    const mediaPath = path.join(VIDEOS_DIR, filename);

    // Save the uploaded media file
    fs.writeFileSync(mediaPath, req.body);


    // Get segment duration from query params or use default (10 minutes)
    const segmentDuration = parseInt(req.query.segmentDuration || '600');
    const fastSplit = req.query.fastSplit === 'true';
    const processPath = mediaPath;

    // Split the media file into segments
    const result = await splitMediaIntoSegments(
      processPath,
      segmentDuration,
      VIDEOS_DIR,
      `segment_${timestamp}`,
      {
        fastSplit,
        mediaType
      }
    );

    // Return the list of segment files
    res.json({
      success: true,
      originalMedia: `/videos/${filename}`,
      mediaType: mediaType,
      batchId: result.batchId,
      segments: result.segments.map(segment => `/videos/${path.basename(segment.path)}`),
      message: `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} uploaded and split successfully`,
      optimized: null
    });
  } catch (error) {
    const errorMediaType = req.headers['content-type']?.startsWith('audio/') ? 'audio' : 'video';
    console.error(`Error processing ${errorMediaType} upload:`, error);
    res.status(500).json({
      success: false,
      error: error.message || `Failed to process ${errorMediaType}`
    });
  }
});

/**
 * POST /api/split-video - Split a media file (video or audio) into segments
 */
router.post('/split-video', express.raw({ limit: '2gb', type: '*/*' }), async (req, res) => {
  try {
    // Determine if this is a video or audio file based on MIME type
    const contentType = req.headers['content-type'] || '';
    const isAudio = contentType.startsWith('audio/');
    const mediaType = isAudio ? 'audio' : 'video';

    // Generate a unique filename for the original media file
    let mediaId = req.query.mediaId || req.query.videoId || `${mediaType}_${Date.now()}`;

    // Remove any file extension from mediaId to prevent double extensions
    mediaId = mediaId.replace(/\.(mp[34]|webm|mov|avi|wmv|flv|mkv)$/i, '');

    // Log the cleaned mediaId


    const fileExtension = contentType.split('/')[1] || (isAudio ? 'mp3' : 'mp4');
    const filename = `${mediaId}.${fileExtension}`;
    const mediaPath = path.join(VIDEOS_DIR, filename);

    // Check if the file size is reasonable
    if (req.body.length < 100 * 1024) { // Less than 100KB
      console.error(`[SPLIT-VIDEO] File is too small (${req.body.length} bytes), likely not a valid ${mediaType}`);
      return res.status(400).json({
        success: false,
        error: `File is too small (${req.body.length} bytes), likely not a valid ${mediaType}`
      });
    }

    // Save the uploaded media file
    fs.writeFileSync(mediaPath, req.body);



    // Get segment duration from query params or use default (10 minutes = 600 seconds)
    const segmentDuration = parseInt(req.query.segmentDuration || '600');
    const fastSplit = req.query.fastSplit === 'true';
    const processPath = mediaPath;

    // Split the media file into segments
    const result = await splitMediaIntoSegments(
      processPath,
      segmentDuration,
      VIDEOS_DIR,
      `${mediaId}_part`,
      {
        fastSplit,
        mediaType
      }
    );

    // Return the list of segment files with actual durations
    res.json({
      success: true,
      originalMedia: `/videos/${filename}`,
      mediaId: mediaId,
      mediaType: mediaType,
      segments: result.segments.map(segment => ({
        path: `/videos/${path.basename(segment.path)}`,
        // Include actual duration and start time in the URL as query parameters
        url: `${SERVER_URL}/videos/${path.basename(segment.path)}?startTime=${segment.startTime}&duration=${segment.duration}`,
        name: path.basename(segment.path),
        // Include actual duration and start time in the segment object
        startTime: segment.startTime,
        duration: segment.duration,
        // Include theoretical values for reference
        theoreticalStartTime: segment.theoreticalStartTime,
        theoreticalDuration: segment.theoreticalDuration
      })),
      message: `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} split successfully`,
      optimized: null
    });
  } catch (error) {
    const errorMediaType = req.headers['content-type']?.startsWith('audio/') ? 'audio' : 'video';
    console.error(`[SPLIT-VIDEO] Error splitting ${errorMediaType}:`, error);
    res.status(500).json({
      success: false,
      error: error.message || `Failed to split ${errorMediaType}`
    });
  }
});

/**
 * POST /api/optimize-existing-file - Legacy compatibility endpoint.
 * The original file is returned without optimization.
 */
router.post('/optimize-existing-file', async (req, res) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const filePath = path.join(VIDEOS_DIR, filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    const extension = path.extname(filename).toLowerCase();
    const isAudio = ['.mp3', '.wav', '.aac', '.ogg', '.flac'].includes(extension);
    let dimensions = {};
    if (!isAudio) {
      try {
        dimensions = await getVideoDimensions(filePath);
      } catch (error) {
        console.warn(`[OPTIMIZE-EXISTING] Could not read dimensions: ${error.message}`);
      }
    }

    res.json({
      success: true,
      originalVideo: `/videos/${filename}`,
      optimizedVideo: `/videos/${filename}`,
      resolution: dimensions.resolution || null,
      fps: null,
      width: dimensions.width || null,
      height: dimensions.height || null,
      wasOptimized: false,
      analysis: null,
      message: 'Video optimization disabled; original file used'
    });
  } catch (error) {
    console.error('[OPTIMIZE-EXISTING] Error reading existing file:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to use existing file'
    });
  }
});

/**
 * POST /api/optimize-video - Legacy compatibility endpoint.
 * The uploaded original file is stored and returned without optimization.
 */
router.post('/optimize-video', express.raw({ limit: '2gb', type: '*/*' }), async (req, res) => {
  try {
    const contentType = req.headers['content-type'] || 'video/mp4';
    const isAudio = contentType.startsWith('audio/');
    const mediaType = isAudio ? 'audio' : 'video';
    const timestamp = Date.now();
    const originalFileExtension = contentType.split('/')[1] || (isAudio ? 'mp3' : 'mp4');
    const originalFilename = `original_${timestamp}.${originalFileExtension}`;
    const originalPath = path.join(VIDEOS_DIR, originalFilename);

    fs.writeFileSync(originalPath, req.body);

    let dimensions = {};
    if (!isAudio) {
      try {
        dimensions = await getVideoDimensions(originalPath);
      } catch (error) {
        console.warn(`[OPTIMIZE-VIDEO] Could not read dimensions: ${error.message}`);
      }
    }

    res.json({
      success: true,
      originalMedia: `/videos/${originalFilename}`,
      mediaType,
      optimizedVideo: `/videos/${originalFilename}`,
      resolution: dimensions.resolution || null,
      fps: null,
      width: dimensions.width || null,
      height: dimensions.height || null,
      duration: dimensions.duration || null,
      wasOptimized: false,
      analysis: null,
      message: 'Video optimization disabled; original file used'
    });
  } catch (error) {
    const errorMediaType = req.headers['content-type']?.startsWith('audio/') ? 'audio' : 'video';
    console.error(`[OPTIMIZE-VIDEO] Error storing original ${errorMediaType}:`, error);
    res.status(500).json({
      success: false,
      error: error.message || `Failed to store original ${errorMediaType}`
    });
  }
});

/**
 * POST /api/extract-audio - Extract audio from a video file path
 */
router.post('/extract-audio', async (req, res) => {
  try {
    const { videoPath } = req.body;
    // Get filename from query parameter or body
    const filename = req.query.filename || req.body.filename || 'audio';

    if (!videoPath) {
      return res.status(400).json({ error: 'Video path is required' });
    }

    // Determine if the path is a URL or a local path
    const isUrl = videoPath.startsWith('http');

    // Skip blob URLs - they should use the /extract-audio-from-blob endpoint
    if (videoPath.startsWith('blob:')) {
      return res.status(400).json({ error: 'Blob URLs are not supported by this endpoint. Use /extract-audio-from-blob instead.' });
    }

    // Resolve the actual file path
    let actualVideoPath;



    if (isUrl) {
      // Extract the filename from the URL
      const urlParts = videoPath.split('/');
      const filename = urlParts[urlParts.length - 1];
      actualVideoPath = path.join(VIDEOS_DIR, filename);

    } else {
      // If it's a relative path like /videos/filename.mp4
      const relativePath = videoPath.startsWith('/') ? videoPath.substring(1) : videoPath;
      const pathParts = relativePath.split('/');
      const filename = pathParts[pathParts.length - 1];
      actualVideoPath = path.join(VIDEOS_DIR, filename);

    }

    // If the file doesn't exist, try to extract the filename from the path and look for it directly
    if (!fs.existsSync(actualVideoPath)) {


      // Try to get just the filename without query parameters
      const filenameWithoutQuery = videoPath.split('?')[0].split('/').pop();
      const alternativePath = path.join(VIDEOS_DIR, filenameWithoutQuery);


      if (fs.existsSync(alternativePath)) {
        actualVideoPath = alternativePath;

      } else {
        // List all files in the videos directory to help with debugging

        const files = fs.readdirSync(VIDEOS_DIR);

      }
    }

    // Check if the video file exists
    if (!fs.existsSync(actualVideoPath)) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    // Generate a unique filename for the audio
    const timestamp = Date.now();
    const audioFilename = `audio_${timestamp}.mp3`;
    const audioPath = path.join(VIDEOS_DIR, audioFilename);

    // Use ffmpeg to extract audio
    const { spawn } = require('child_process');
    const ffmpegProcess = spawn('ffmpeg', [
      '-i', actualVideoPath,
      '-vn',  // No video
      '-acodec', 'libmp3lame',  // MP3 codec
      '-q:a', '2',  // Quality (0-9, lower is better)
      '-y',  // Overwrite output file
      audioPath
    ]);

    // Handle process completion
    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        // Success


        // Set the Content-Disposition header to force download with the provided filename
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.mp3"`);
        res.setHeader('Content-Type', 'audio/mpeg');

        // Stream the file directly instead of returning a URL
        const fileStream = fs.createReadStream(audioPath);
        fileStream.pipe(res);
      } else {
        // Error
        console.error(`Error extracting audio: ffmpeg process exited with code ${code}`);
        res.status(500).json({
          success: false,
          error: 'Failed to extract audio'
        });
      }
    });

    // Handle process error
    ffmpegProcess.on('error', (err) => {
      console.error('Error spawning ffmpeg process:', err);
      res.status(500).json({
        success: false,
        error: 'Failed to start audio extraction process'
      });
    });
  } catch (error) {
    console.error('Error extracting audio:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to extract audio'
    });
  }
});

/**
 * POST /api/extract-audio-from-blob - Extract audio from a video blob
 * This endpoint accepts the actual video data as a binary file
 */
router.post('/extract-audio-from-blob', express.raw({ limit: '500mb', type: '*/*' }), async (req, res) => {
  try {


    // Get filename from query parameter
    const filename = req.query.filename || 'audio';

    // Generate unique filenames for the temporary video and the output audio
    const timestamp = Date.now();
    const videoFilename = `temp_video_${timestamp}.mp4`;
    const audioFilename = `audio_${timestamp}.mp3`;
    const videoPath = path.join(VIDEOS_DIR, videoFilename);
    const audioPath = path.join(VIDEOS_DIR, audioFilename);

    // Save the uploaded video data to a temporary file
    fs.writeFileSync(videoPath, req.body);


    // Use ffmpeg to extract audio
    const { spawn } = require('child_process');
    const ffmpegProcess = spawn('ffmpeg', [
      '-i', videoPath,
      '-vn',  // No video
      '-acodec', 'libmp3lame',  // MP3 codec
      '-q:a', '2',  // Quality (0-9, lower is better)
      '-y',  // Overwrite output file
      audioPath
    ]);

    // Handle process completion
    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        // Success


        // Clean up the temporary video file
        try {
          fs.unlinkSync(videoPath);

        } catch (err) {
          console.error(`Error deleting temporary video file: ${err.message}`);
        }

        // Set the Content-Disposition header to force download with the provided filename
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.mp3"`);
        res.setHeader('Content-Type', 'audio/mpeg');

        // Stream the file directly instead of returning a URL
        const fileStream = fs.createReadStream(audioPath);
        fileStream.pipe(res);
      } else {
        // Error
        console.error(`Error extracting audio: ffmpeg process exited with code ${code}`);

        // Clean up the temporary video file
        try {
          fs.unlinkSync(videoPath);

        } catch (err) {
          console.error(`Error deleting temporary video file: ${err.message}`);
        }

        res.status(500).json({
          success: false,
          error: 'Failed to extract audio'
        });
      }
    });

    // Handle process error
    ffmpegProcess.on('error', (err) => {
      console.error('Error spawning ffmpeg process:', err);

      // Clean up the temporary video file
      try {
        fs.unlinkSync(videoPath);

      } catch (deleteErr) {
        console.error(`Error deleting temporary video file: ${deleteErr.message}`);
      }

      res.status(500).json({
        success: false,
        error: 'Failed to start audio extraction process'
      });
    });
  } catch (error) {
    console.error('Error extracting audio from blob:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to extract audio from blob'
    });
  }
});

/**
 * GET /api/converted-audio-exists/:audioHash - Check if a converted audio file exists
 */
router.get('/converted-audio-exists/:audioHash', (req, res) => {
  const { audioHash } = req.params;

  // Look for any files that match the pattern converted_<audioHash>_*.mp4
  const files = fs.readdirSync(VIDEOS_DIR);
  const convertedFile = files.find(file => file.startsWith(`converted_${audioHash}_`) && file.endsWith('.mp4'));

  if (convertedFile) {
    const videoPath = path.join(VIDEOS_DIR, convertedFile);
    const stats = fs.statSync(videoPath);

    // Get video metadata using ffprobe
    const { getMediaDuration } = require('../services/videoProcessing/durationUtils');

    // Get the duration asynchronously and then respond
    getMediaDuration(videoPath)
      .then(duration => {
        res.json({
          exists: true,
          video: `/videos/${convertedFile}`,
          width: 256,  // Default values for converted audio files
          height: 144,
          fps: 15,
          duration: duration,
          resolution: '144p',
          size: stats.size,
          createdAt: stats.birthtime
        });
      })
      .catch(error => {
        console.error(`[CONVERTED-AUDIO-EXISTS] Error getting duration for ${videoPath}:`, error);
        // Still return that the file exists, just without duration
        res.json({
          exists: true,
          video: `/videos/${convertedFile}`,
          width: 256,
          height: 144,
          fps: 15,
          resolution: '144p',
          size: stats.size,
          createdAt: stats.birthtime
        });
      });
  } else {
    res.json({ exists: false });
  }
});

/**
 * POST /api/convert-audio-to-video - Convert an audio file to a video file
 */
router.post('/convert-audio-to-video', express.raw({ limit: '2gb', type: 'audio/*' }), async (req, res) => {
  try {
    // Get the content type to determine the audio format
    const contentType = req.headers['content-type'] || 'audio/mp3';

    // Generate a unique filename for the audio file
    const timestamp = Date.now();
    const fileExtension = contentType.split('/')[1] || 'mp3';

    // Generate a hash of the audio content for caching purposes
    const crypto = require('crypto');
    const audioHash = crypto.createHash('md5').update(req.body).digest('hex').substring(0, 10);

    // Check if we already have a converted file for this audio
    const files = fs.readdirSync(VIDEOS_DIR);
    const existingConvertedFile = files.find(file => file.startsWith(`converted_${audioHash}_`) && file.endsWith('.mp4'));

    if (existingConvertedFile) {

      const videoPath = path.join(VIDEOS_DIR, existingConvertedFile);

      try {
        // Get video metadata
        const { getMediaDuration } = require('../services/videoProcessing/durationUtils');
        const duration = await getMediaDuration(videoPath);

        // Return the existing converted file
        return res.json({
          success: true,
          video: `/videos/${existingConvertedFile}`,
          width: 256,
          height: 144,
          fps: 15,
          duration: duration,
          resolution: '144p',
          message: 'Using cached converted video',
          cached: true
        });
      } catch (error) {
        console.error(`[CONVERT-AUDIO] Error getting metadata for existing converted file: ${error.message}`);
        // Continue with new conversion as fallback
      }
    }

    const audioFilename = `audio_${timestamp}.${fileExtension}`;
    const videoFilename = `converted_${audioHash}_${timestamp}.mp4`;
    const audioPath = path.join(VIDEOS_DIR, audioFilename);
    const videoPath = path.join(VIDEOS_DIR, videoFilename);

    // Save the uploaded audio file
    fs.writeFileSync(audioPath, req.body);



    // Convert the audio to video

    const result = await convertAudioToVideo(audioPath, videoPath);


    // Delete the original audio file - we don't need it anymore
    try {
      fs.unlinkSync(audioPath);

    } catch (deleteError) {
      console.error(`[CONVERT-AUDIO] Error deleting audio file: ${deleteError.message}`);
    }

    // Return the path to the video file
    res.json({
      success: true,
      video: `/videos/${videoFilename}`,
      width: result.width,
      height: result.height,
      fps: result.fps,
      duration: result.duration,
      resolution: '144p',  // Explicitly set resolution to 144p
      message: 'Audio converted to video successfully'
    });
  } catch (error) {
    console.error('[CONVERT-AUDIO] Error converting audio to video:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to convert audio to video'
    });
  }
});

module.exports = router;
