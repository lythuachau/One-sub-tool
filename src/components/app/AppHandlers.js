import { parseSrtContent } from '../../utils/srtParser';
import { resetGeminiButtonState } from '../../utils/geminiButtonEffects';
import { cancelYoutubeVideoDownload, extractYoutubeVideoId } from '../../utils/videoDownloader';
import { cancelDouyinVideoDownload, extractDouyinVideoId } from '../../utils/douyinDownloader';
import { cancelGenericVideoDownload } from '../../utils/allSitesDownloader';
import { cancelDouyinDownloadPlaywright } from '../../utils/douyinPlaywrightDownloader';
import { prepareVideoForSegments, downloadAndPrepareYouTubeVideo } from './VideoProcessingHandlers';
import { hasValidTokens } from '../../services/youtubeApiService';
import { hasValidDownloadedVideo } from '../../utils/videoUtils';
import { getSubtitleEngine } from '../../services/subtitleEngineService';
import { clearVideoIdentity, persistVideoIdentity } from '../../utils/videoIdentity';

/**
 * Hook for application event handlers
 */
export const useAppHandlers = (appState) => {
  const {
    activeTab,
    setActiveTab,
    selectedVideo,
    setSelectedVideo,
    uploadedFile,
    setUploadedFile,
    apiKeysSet,
    setStatus,
    subtitlesData,
    setSubtitlesData,
    // isDownloading is used in validateInput
    setIsDownloading,
    // downloadProgress is used in UI elsewhere
    setDownloadProgress,
    currentDownloadId,
    setCurrentDownloadId,
    isSrtOnlyMode,
    setIsSrtOnlyMode,
    userProvidedSubtitles,
    useUserProvidedSubtitles,
    generateSubtitles,
    retryGeneration,
    isRetrying,
    setIsRetrying,
    setSegmentsStatus,
    setVideoSegments,
    t = (key, defaultValue) => defaultValue // Provide a default implementation if t is not available
  } = appState;

  /**
   * Validate input before generating subtitles
   */
  const validateInput = () => {
    // If we're in SRT-only mode, always return true
    if (isSrtOnlyMode) {
      return true;
    }

    // Otherwise, check for video/audio sources
    if (activeTab === 'unified-url') {
      return selectedVideo !== null;
    } else if (activeTab === 'youtube-url') {
      return selectedVideo !== null;
    } else if (activeTab === 'youtube-search') {
      return selectedVideo !== null;
    } else if (activeTab === 'file-upload') {
      return uploadedFile !== null;
    }
    return false;
  };

  /**
   * Handle SRT/JSON file upload
   */
  const handleSrtUpload = async (fileContent, fileName) => {
    try {
      let parsedSubtitles = [];

      // Check if it's a JSON file
      if (fileName && fileName.toLowerCase().endsWith('.json')) {
        try {
          const jsonData = JSON.parse(fileContent);
          if (Array.isArray(jsonData)) {
            parsedSubtitles = jsonData;
          } else {
            setStatus({ message: t('errors.invalidJsonFile', 'JSON file must contain an array of subtitles'), type: 'error' });
            return;
          }
        } catch (error) {
          setStatus({ message: t('errors.invalidJsonFormat', 'Invalid JSON format'), type: 'error' });
          return;
        }
      } else {
        // Parse as SRT content
        parsedSubtitles = parseSrtContent(fileContent);
      }

      if (parsedSubtitles.length === 0) {
        setStatus({ message: t('errors.invalidSrtFormat', 'Invalid SRT format or empty file'), type: 'error' });
        return;
      }

      // Check if we have any video sources (including pasted URLs)
      const hasUploadedFile = activeTab === 'file-upload' && uploadedFile !== null;
      const hasDownloadedVideo = hasValidDownloadedVideo(uploadedFile);
      const hasYoutubeVideo = activeTab.includes('youtube') && selectedVideo !== null;
      const hasUnifiedVideo = activeTab === 'unified-url' && selectedVideo !== null;

      // Determine if we should go into SRT-only mode
      // SRT-only mode: no video source at all (no uploaded file, no downloaded video, no pasted URL)
      const hasAnyVideoSource = hasUploadedFile || hasDownloadedVideo || hasYoutubeVideo || hasUnifiedVideo;

      if (!hasAnyVideoSource) {
        setIsSrtOnlyMode(true);
        setSubtitlesData(parsedSubtitles);
        setStatus({ message: t('output.srtOnlyMode', 'Working with SRT only. No video source available.'), type: 'info' });
        return;
      } else {
        // If we have any video source, make sure we're not in SRT-only mode
        setIsSrtOnlyMode(false);

        // Always reset downloading state when uploading an SRT file
        setIsDownloading(false);
        setDownloadProgress(0);
      }

      // For YouTube tabs, we don't need to download the video immediately when uploading an SRT file
      // Just set the subtitles data and show a success message
      if (activeTab.includes('youtube') && selectedVideo) {
        // Make sure we're not in downloading state
        setIsDownloading(false);
        setDownloadProgress(0);

        // Set the subtitles data directly
        setSubtitlesData(parsedSubtitles);
        const fileType = fileName && fileName.toLowerCase().endsWith('.json') ? 'JSON' : 'SRT';
        setStatus({ message: t('output.subtitleUploadSuccess', `${fileType} file uploaded successfully!`), type: 'success' });
      } else if (activeTab === 'file-upload' && uploadedFile) {
        try {
          // For file upload tab, set the subtitles data directly
          setSubtitlesData(parsedSubtitles);
          const fileType = fileName && fileName.toLowerCase().endsWith('.json') ? 'JSON' : 'SRT';
          setStatus({ message: t('output.subtitleUploadSuccess', `${fileType} file uploaded successfully!`), type: 'success' });

          // Create a wrapper function that includes the additional parameters
          const prepareVideoWrapper = async (file) => {
            return prepareVideoForSegments(file, setStatus, setVideoSegments, setSegmentsStatus, t);
          };

          // Prepare the video for segment processing
          await prepareVideoWrapper(uploadedFile);

          // Update status to show that segments are ready
          setStatus({ message: t('output.segmentsReady', 'Video segments are ready for processing!'), type: 'success' });
        } catch (error) {
          console.error('Error preparing video for segments:', error);
          // Still keep the subtitles, but show a warning
          setStatus({
            message: t('warnings.segmentsPreparationFailed', 'Subtitles loaded, but video segment preparation failed: {{message}}', { message: error.message }),
            type: 'warning'
          });
        }
      } else if (hasUnifiedVideo) {
        // For unified URL input, set the subtitles data directly
        // We'll download the video when the user clicks "Generate Subtitles"

        // Make sure we're not in downloading state
        setIsDownloading(false);
        setDownloadProgress(0);

        setSubtitlesData(parsedSubtitles);
        setStatus({ message: t('output.srtUploadSuccess', 'SRT file uploaded successfully!'), type: 'success' });
      } else if (hasDownloadedVideo) {
        // For downloaded video, set the subtitles data directly
        setSubtitlesData(parsedSubtitles);
        setStatus({ message: t('output.srtUploadSuccess', 'SRT file uploaded successfully!'), type: 'success' });
      } else {
        // For any other case (like unified-url tab with no URL), just set the subtitles
        setSubtitlesData(parsedSubtitles);
        setStatus({ message: t('output.srtUploadSuccess', 'SRT file uploaded successfully!'), type: 'success' });
      }
    } catch (error) {
      console.error('Error parsing SRT file:', error);
      setStatus({ message: t('errors.srtParsingFailed', 'Failed to parse SRT file: {{message}}', { message: error.message }), type: 'error' });
    }
  };

  /**
   * Handle generating subtitles
   */
  const handleGenerateSubtitles = async () => {
    if (!validateInput()) {
      setStatus({ message: t('errors.invalidInput'), type: 'error' });
      return;
    }

    // If we're in SRT-only mode, just show a message
    if (isSrtOnlyMode) {
      setStatus({ message: t('output.srtOnlyMode', 'Working with SRT only. No video source available.'), type: 'info' });
      return;
    }

    // Clear the segments-status before starting the generation process
    setSegmentsStatus([]);

    let input, inputType;

    // For YouTube or Unified URL tabs, download the video first and switch to upload tab
    if ((activeTab.includes('youtube') || activeTab === 'unified-url') && selectedVideo) {
      try {
        // Set downloading state to true to disable the generate button
        setIsDownloading(true);
        setDownloadProgress(0);

        // Set status to downloading
        setStatus({ message: t('output.downloadingVideo', 'Downloading video...'), type: 'loading' });

        // Extract video ID and set it as current download
        let videoId;
        if (selectedVideo.source === 'douyin') {
          videoId = extractDouyinVideoId(selectedVideo.url);
        } else if (selectedVideo.source === 'douyin-playwright') {
          videoId = extractDouyinVideoId(selectedVideo.url);
        } else if (selectedVideo.source === 'all-sites' || selectedVideo.source === 'all-sites-url') {
          videoId = selectedVideo.id;
        } else {
          videoId = extractYoutubeVideoId(selectedVideo.url);
        }
        persistVideoIdentity(selectedVideo);
        setCurrentDownloadId(videoId);

        // Create a wrapper function that includes the additional parameters
        const prepareVideoWrapper = async (file) => {
          return prepareVideoForSegments(file, setStatus, setVideoSegments, setSegmentsStatus, t);
        };

        // Create a wrapper for system-initiated tab changes
        const systemTabChange = (tab) => handleTabChange(tab, false);

        // Download and prepare the YouTube video
        const downloadedFile = await downloadAndPrepareYouTubeVideo(
          selectedVideo,
          setIsDownloading,
          setDownloadProgress,
          setStatus,
          setCurrentDownloadId,
          systemTabChange,
          setUploadedFile,
          setIsSrtOnlyMode,
          prepareVideoWrapper,
          t
        );

        // Now process with the downloaded file
        input = downloadedFile;
        inputType = 'file-upload';

        // Prepare options for subtitle generation
        const subtitleOptions = {};

        // Add user-provided subtitles if available and enabled
        if (useUserProvidedSubtitles && userProvidedSubtitles) {
          subtitleOptions.userProvidedSubtitles = userProvidedSubtitles;

        }

        // Check if we have a valid input file
        if (!input) {
          console.error('No valid input file available after download');
          setStatus({
            message: t('errors.noValidInput', 'No valid input file available. Please try again or use a different video.'),
            type: 'error'
          });
          return;
        }

        // If we already have subtitles data (from an uploaded SRT file), don't generate new subtitles
        if (subtitlesData && subtitlesData.length > 0) {
          // Just update the status to show that the video is ready
          setStatus({ message: t('output.videoReady', 'Video is ready for playback with uploaded subtitles!'), type: 'success' });
        } else {
          // Otherwise, generate new subtitles
          await generateSubtitles(input, inputType, apiKeysSet, subtitleOptions);
        }
      } catch (error) {
        console.error('Error downloading video:', error);
        // Reset downloading state
        setIsDownloading(false);
        setDownloadProgress(0);
        setStatus({ message: `${t('errors.videoDownloadFailed', 'Video download failed')}: ${error.message}`, type: 'error' });
        return;
      }
    } else if (activeTab === 'file-upload' && uploadedFile) {
      input = uploadedFile;
      inputType = 'file-upload';

      // Prepare options for subtitle generation
      const subtitleOptions = {};

      // Add user-provided subtitles if available and enabled
      if (useUserProvidedSubtitles && userProvidedSubtitles) {
        subtitleOptions.userProvidedSubtitles = userProvidedSubtitles;

      }

      // Check if we have a valid input file
      if (!input) {
        console.error('No valid input file available');
        setStatus({
          message: t('errors.noValidInput', 'No valid input file available. Please try again or upload a different file.'),
          type: 'error'
        });
        return;
      }

      // If we already have subtitles data (from an uploaded SRT file), don't generate new subtitles
      if (subtitlesData && subtitlesData.length > 0) {
        // Just update the status to show that the video is ready
        setStatus({ message: t('output.videoReady', 'Video is ready for playback with uploaded subtitles!'), type: 'success' });
      } else {
        // Otherwise, generate new subtitles
        await generateSubtitles(input, inputType, apiKeysSet, subtitleOptions);
      }
    }

    // Reset button animation state when generation is complete
    resetGeminiButtonState();
  };

  /**
   * Handle retrying subtitle generation - FORCE RETRY that ignores validation
   */
  const handleRetryGeneration = async () => {
    console.log('FORCE RETRY: handleRetryGeneration called');

    // Prevent multiple simultaneous retries
    if (isRetrying) {
      console.log('FORCE RETRY: Already retrying, ignoring duplicate call');
      return;
    }

    // Only check for API key - this is the minimum requirement
    if (getSubtitleEngine() === 'gemini' && !apiKeysSet.gemini) {
      console.log('No Gemini API key available');
      setStatus({ message: t('errors.apiKeyRequired', 'Gemini API key is required'), type: 'error' });
      return;
    }

    console.log('FORCE RETRY: Setting retrying state to true');
    // Set retrying state to true immediately
    setIsRetrying(true);

    // Clear the segments-status before starting the retry process
    setSegmentsStatus([]);

    console.log('FORCE RETRY: Determining input source...');
    let input, inputType;

    // Try to get input from current state or localStorage
    // Priority: 1. Current selected video/file, 2. localStorage cached data

    if (uploadedFile) {
      console.log('FORCE RETRY: Using uploaded file');
      input = uploadedFile;
      inputType = 'file-upload';
    } else if (selectedVideo) {
      console.log('FORCE RETRY: Using selected video');
      input = selectedVideo;
      inputType = activeTab.includes('youtube') || activeTab === 'unified-url' ? 'youtube' : 'file-upload';
    } else {
      // Try to get from localStorage
      const cachedVideoUrl = localStorage.getItem('current_video_url');
      const cachedFileUrl = localStorage.getItem('current_file_url');

      if (cachedVideoUrl) {
        console.log('FORCE RETRY: Using cached video URL');
        const cachedVideoId = localStorage.getItem('current_video_id');
        const cachedSource = cachedVideoUrl.includes('douyin.com') ? 'douyin-playwright' : 'youtube';
        input = {
          id: cachedVideoId,
          url: cachedVideoUrl,
          source: cachedSource,
          title: cachedSource === 'douyin-playwright' ? 'Douyin Video' : 'YouTube Video'
        };
        inputType = 'youtube';
      } else if (cachedFileUrl) {
        console.log('FORCE RETRY: Using cached file URL');
        // For cached files, we'll need to use the retryGeneration function directly
        input = null; // Will be handled by retryGeneration
        inputType = 'file-upload';
      } else {
        console.log('FORCE RETRY: No input source found, but proceeding anyway...');
        // If we have subtitles data, we can still retry with the last known configuration
        input = null;
        inputType = 'retry';
      }
    }

    console.log('FORCE RETRY: Input determined:', { input, inputType });

    // For YouTube or Unified URL tabs, download the video first and switch to upload tab
    if ((inputType === 'youtube' || activeTab === 'unified-url') && input && input.url) {
      try {
        // Set downloading state to true to disable the generate button
        setIsDownloading(true);
        setDownloadProgress(0);

        // Set status to downloading
        setStatus({ message: t('output.downloadingVideo', 'Downloading video...'), type: 'loading' });

        // Create a wrapper function that includes the additional parameters
        const prepareVideoWrapper = async (file) => {
          return prepareVideoForSegments(file, setStatus, setVideoSegments, setSegmentsStatus, t);
        };

        // Create a wrapper for system-initiated tab changes
        const systemTabChange = (tab) => handleTabChange(tab, false);

        // Download and prepare the YouTube video
        const downloadedFile = await downloadAndPrepareYouTubeVideo(
          input,
          setIsDownloading,
          setDownloadProgress,
          setStatus,
          setCurrentDownloadId,
          systemTabChange,
          setUploadedFile,
          setIsSrtOnlyMode,
          prepareVideoWrapper,
          t
        );

        // Now process with the downloaded file
        input = downloadedFile;
        inputType = 'file-upload';

        // Prepare options for subtitle generation
        const subtitleOptions = {};

        // Add user-provided subtitles if available and enabled
        if (useUserProvidedSubtitles && userProvidedSubtitles) {
          subtitleOptions.userProvidedSubtitles = userProvidedSubtitles;

        }

        // Check if we have a valid input file
        if (!input) {
          console.error('No valid input file available after download');
          setStatus({
            message: t('errors.noValidInput', 'No valid input file available. Please try again or use a different video.'),
            type: 'error'
          });
          // Reset retrying state
          setIsRetrying(false);
          return;
        }

        // FORCE RETRY: Always retry generating subtitles, ignore existing data
        console.log('FORCE RETRY: Forcing subtitle regeneration for downloaded video...');
        await retryGeneration(input, inputType, apiKeysSet, subtitleOptions);
      } catch (error) {
        console.error('Error downloading video:', error);
        // Reset downloading state
        setIsDownloading(false);
        setDownloadProgress(0);
        // Reset retrying state
        setIsRetrying(false);
        setStatus({ message: `${t('errors.videoDownloadFailed', 'Video download failed')}: ${error.message}`, type: 'error' });
        return;
      }
    } else if (activeTab === 'file-upload' && uploadedFile) {
      input = uploadedFile;
      inputType = 'file-upload';

      try {
        // Prepare options for subtitle generation
        const subtitleOptions = {};

        // Add user-provided subtitles if available and enabled
        if (useUserProvidedSubtitles && userProvidedSubtitles) {
          subtitleOptions.userProvidedSubtitles = userProvidedSubtitles;

        }

        // Check if we have a valid input file
        if (!input) {
          console.error('No valid input file available');
          setStatus({
            message: t('errors.noValidInput', 'No valid input file available. Please try again or upload a different file.'),
            type: 'error'
          });
          return;
        }

        // FORCE RETRY: Always retry generating subtitles, ignore existing data
        console.log('FORCE RETRY: Forcing subtitle regeneration...');
        await retryGeneration(input, inputType, apiKeysSet, subtitleOptions);
      } finally {
        // Reset retrying state regardless of success or failure
        setIsRetrying(false);
        // Reset button animation state when generation is complete
        resetGeminiButtonState();
      }
    } else {
      // Direct retry without re-downloading - use retryGeneration function
      console.log('FORCE RETRY: Using direct retry method');

      try {
        // First, delete any existing subtitle files to force regeneration
        console.log('FORCE RETRY: Deleting existing subtitle files...');
        try {
          const response = await fetch('/api/delete-subtitles', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              // Send any identifiers that might help locate the files
              videoUrl: selectedVideo?.url || localStorage.getItem('current_video_url'),
              fileName: uploadedFile?.name || localStorage.getItem('current_file_name'),
              cacheId: localStorage.getItem('current_file_cache_id')
            })
          });

          if (response.ok) {
            console.log('FORCE RETRY: Subtitle files deleted successfully');
          } else {
            console.log('FORCE RETRY: Could not delete subtitle files, but continuing...');
          }
        } catch (deleteError) {
          console.log('FORCE RETRY: Error deleting files, but continuing...', deleteError);
        }

        // Clear any cached subtitles data and preview section
        console.log('FORCE RETRY: Clearing all subtitle data and preview...');
        setSubtitlesData(null);
        localStorage.removeItem('subtitles_data');
        localStorage.removeItem('latest_segment_subtitles');

        // Clear any window-stored subtitle data that might be cached
        if (window.subtitlesData) {
          window.subtitlesData = null;
        }

        // Clear status to remove any success messages
        setStatus({ message: t('output.retrying', 'Retrying subtitle generation...'), type: 'loading' });

        // Prepare options for subtitle generation
        const subtitleOptions = {};

        // Add user-provided subtitles if available and enabled
        if (useUserProvidedSubtitles && userProvidedSubtitles) {
          subtitleOptions.userProvidedSubtitles = userProvidedSubtitles;
        }

        console.log('FORCE RETRY: Calling retryGeneration with:', { input, inputType, subtitleOptions });

        // Call retryGeneration directly - it will handle finding the right input
        await retryGeneration(input, inputType, apiKeysSet, subtitleOptions);

        console.log('FORCE RETRY: retryGeneration completed');
      } catch (error) {
        console.error('FORCE RETRY: Error during direct retry:', error);
        setStatus({ message: `${t('errors.retryFailed', 'Retry failed')}: ${error.message}`, type: 'error' });
      } finally {
        // Reset retrying state regardless of success or failure
        setIsRetrying(false);
        // Reset button animation state when generation is complete
        resetGeminiButtonState();
      }
    }
  };

  /**
   * Handle cancelling the current download
   */
  const handleCancelDownload = () => {
    if (currentDownloadId) {
      // Check the source of the download
      if (activeTab === 'unified-url' && selectedVideo?.source === 'douyin-playwright') {
        cancelDouyinDownloadPlaywright(currentDownloadId);
      } else if (activeTab === 'unified-url' && selectedVideo?.source === 'douyin') {
        // Cancel Douyin download
        cancelDouyinVideoDownload(currentDownloadId);
      } else if (activeTab === 'unified-url' && selectedVideo?.source === 'all-sites') {
        // Cancel generic URL download
        cancelGenericVideoDownload(currentDownloadId);
      } else {
        // Default to YouTube download
        cancelYoutubeVideoDownload(currentDownloadId);
      }

      // Reset states
      setIsDownloading(false);
      setDownloadProgress(0);
      setCurrentDownloadId(null);
      setStatus({ message: t('output.downloadCancelled', 'Download cancelled'), type: 'warning' });
    }
  };

  /**
   * Handle tab change
   */
  const handleTabChange = (tab, isUserInitiated = true) => {
    // Only update user preference if this is a user-initiated change
    if (isUserInitiated) {
      localStorage.setItem('userPreferredTab', tab);
    }

    // Always update the current active tab
    localStorage.setItem('lastActiveTab', tab);
    setActiveTab(tab);

    // Only reset state for user-initiated tab changes
    // System-initiated changes (like after video download) should preserve state
    if (isUserInitiated) {
      setSelectedVideo(null);
      setUploadedFile(null);
      setStatus({}); // Reset status
      setSubtitlesData(null); // Reset subtitles data

      // Only reset SRT-only mode if we don't have subtitles data in localStorage
      const subtitlesData = localStorage.getItem('subtitles_data');
      if (!subtitlesData) {
        setIsSrtOnlyMode(false); // Reset SRT-only mode
      }

      localStorage.removeItem('current_video_url');
      clearVideoIdentity();
      localStorage.removeItem('current_file_url');
      localStorage.removeItem('current_file_cache_id'); // Also clear the file cache ID
    }
  };

  /**
   * Handle saving API keys and settings
   */
  const saveApiKeys = (geminiKey, youtubeKey, geniusKey, segmentDuration = 5, geminiModel, timeFormat, showWaveformSetting, optimizedResolutionSetting, useOptimizedPreviewSetting, useCookiesForDownloadSetting, vibiKey) => {
    // Save to localStorage
    if (geminiKey) {
      localStorage.setItem('gemini_api_key', geminiKey);
    } else {
      localStorage.removeItem('gemini_api_key');
    }

    if (youtubeKey) {
      localStorage.setItem('youtube_api_key', youtubeKey);
    } else {
      localStorage.removeItem('youtube_api_key');
    }

    if (geniusKey) {
      localStorage.setItem('genius_token', geniusKey);
    } else {
      localStorage.removeItem('genius_token');
    }

    // Save segment duration
    if (segmentDuration) {
      localStorage.setItem('segment_duration', segmentDuration.toString());
    }

    // Save time format
    if (timeFormat) {
      localStorage.setItem('time_format', timeFormat);
      appState.setTimeFormat(timeFormat);
    }

    // Save waveform setting
    if (showWaveformSetting !== undefined) {
      localStorage.setItem('show_waveform', showWaveformSetting.toString());
      appState.setShowWaveform(showWaveformSetting);
    }

    // Save Gemini model
    if (geminiModel) {
      localStorage.setItem('gemini_model', geminiModel);
    }

    if (optimizedResolutionSetting) {
      localStorage.setItem('optimized_resolution', optimizedResolutionSetting);
      appState.setOptimizedResolution(optimizedResolutionSetting);
    }

    if (vibiKey) {
      localStorage.setItem('vibi_api_key', vibiKey);
    } else if (vibiKey === '') {
      localStorage.removeItem('vibi_api_key');
    }

    if (useOptimizedPreviewSetting !== undefined) {
      localStorage.setItem('use_optimized_preview', 'false');
      appState.setUseOptimizedPreview(false);
      console.log('[AppHandlers] Original video preview is enforced');

      // Trigger a custom event to immediately notify VideoPreview component
      // This ensures immediate synchronization without waiting for the 500ms interval
      window.dispatchEvent(new CustomEvent('optimizedPreviewChanged', {
        detail: { value: false }
      }));
    }

    if (useCookiesForDownloadSetting !== undefined) {
      localStorage.setItem('use_cookies_for_download', useCookiesForDownloadSetting.toString());
      appState.setUseCookiesForDownload(useCookiesForDownloadSetting);
    }

    // Update state based on the selected authentication method
    const useOAuth = localStorage.getItem('use_youtube_oauth') === 'true';
    const hasOAuthTokens = hasValidTokens();

    appState.setApiKeysSet({
      gemini: !!geminiKey,
      youtube: useOAuth ? hasOAuthTokens : !!youtubeKey,
      genius: !!geniusKey,
      vibi: !!vibiKey
    });

    // Show success notification
    setStatus({ message: t('settings.savedSuccessfully', 'Settings saved successfully!'), type: 'success' });
  };

  // Create a wrapper function for prepareVideoForSegments that includes the additional parameters
  const prepareVideoForSegmentsWrapper = async (file) => {
    return prepareVideoForSegments(file, setStatus, setVideoSegments, setSegmentsStatus, t);
  };

  // Create a wrapper function for downloadAndPrepareYouTubeVideo
  const handleDownloadAndPrepareYouTubeVideo = async () => {
    if (!selectedVideo) {
      console.error('No YouTube video selected');
      return;
    }

    // Create a wrapper for system-initiated tab changes
    const systemTabChange = (tab) => handleTabChange(tab, false);

    await downloadAndPrepareYouTubeVideo(
      selectedVideo,
      setIsDownloading,
      setDownloadProgress,
      setStatus,
      setCurrentDownloadId,
      systemTabChange,
      setUploadedFile,
      setIsSrtOnlyMode,
      prepareVideoForSegmentsWrapper,
      t
    );
  };

  return {
    validateInput,
    handleSrtUpload,
    handleGenerateSubtitles,
    handleRetryGeneration,
    handleCancelDownload,
    handleTabChange,
    saveApiKeys,
    prepareVideoForSegments: prepareVideoForSegmentsWrapper,
    handleDownloadAndPrepareYouTubeVideo
  };
};
