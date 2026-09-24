import { useEffect } from 'react';
import { hasValidTokens } from '../../services/youtubeApiService';
import { initGeminiButtonEffects, resetAllGeminiButtonEffects } from '../../utils/geminiButtonEffects';
import { syncLocalStorageToServer } from '../../services/localStorageService';
import initTabPillAnimation from '../../utils/tabPillAnimation';

/**
 * Hook for managing application side effects
 */
export const useAppEffects = (props) => {
  const {
    setSegmentsStatus,
    setVideoSegments,
    setShowVideoAnalysis,
    setVideoAnalysisResult,
    setApiKeysSet,
    setStatus,
    setTheme,
    setShowWaveform,
    setTimeFormat,
    setOptimizeVideos,
    setOptimizedResolution,
    setUseOptimizedPreview,
    subtitlesData,
    status,
    handleDownloadAndPrepareYouTubeVideo,
    prepareVideoForSegments,
    uploadedFile,
    t
  } = props;

  // Initialize UI effects after component mounts
  useEffect(() => {
    // Small delay to ensure DOM is fully rendered
    const timer = setTimeout(() => {
      // Initialize Gemini button effects
      initGeminiButtonEffects();

      // Initialize tab pill sliding animation
      initTabPillAnimation();
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  // Sync localStorage to server on startup
  useEffect(() => {
    // Sync localStorage to server for use by narration service
    syncLocalStorageToServer()

      .catch(error => console.error('Error syncing localStorage to server:', error));
  }, []);

  // Re-initialize Gemini button effects when subtitles data changes
  useEffect(() => {
    if (subtitlesData && subtitlesData.length > 0) {
      // Use a small delay to ensure the DOM is updated
      const timer = setTimeout(() => {
        initGeminiButtonEffects();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [subtitlesData]);

  // Reset all Gemini button effects when status changes
  useEffect(() => {
    if (status && (status.type === 'success' || status.type === 'error')) {
      // Use a small delay to ensure the DOM is updated
      const timer = setTimeout(() => {
        resetAllGeminiButtonEffects();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [status]);

  // Listen for segment status updates
  useEffect(() => {
    // Set up event listener for segment status updates
    const handleSegmentStatusUpdate = (event) => {
      if (event.detail && Array.isArray(event.detail)) {
        // If this is a full update (all segments), replace the array
        if (event.detail.length > 1) {
          setSegmentsStatus(event.detail);
        } else {
          // If this is a single segment update, update just that segment
          const updatedSegment = event.detail[0];
          setSegmentsStatus(prevStatus => {
            const newStatus = [...prevStatus];
            const index = newStatus.findIndex(s => s.index === updatedSegment.index);
            if (index !== -1) {
              newStatus[index] = updatedSegment;
            }
            return newStatus;
          });
        }
      }
    };

    // Add event listener
    window.addEventListener('segmentStatusUpdate', handleSegmentStatusUpdate);

    // Clean up
    return () => {
      window.removeEventListener('segmentStatusUpdate', handleSegmentStatusUpdate);
    };
  }, [setSegmentsStatus]);

  // Listen for video segments update
  useEffect(() => {
    // Set up event listener for video segments
    const handleVideoSegmentsUpdate = (event) => {
      if (event.detail && Array.isArray(event.detail)) {
        setVideoSegments(event.detail);
      }
    };

    // Add event listener
    window.addEventListener('videoSegmentsUpdate', handleVideoSegmentsUpdate);

    // Clean up
    return () => {
      window.removeEventListener('videoSegmentsUpdate', handleVideoSegmentsUpdate);
    };
  }, [setVideoSegments]);

  // Listen for video analysis events
  useEffect(() => {
    // Handle video analysis started
    const handleVideoAnalysisStarted = () => {
      // Only show the modal if the flag is set in localStorage AND video analysis is enabled
      const useVideoAnalysis = localStorage.getItem('use_video_analysis') !== 'false';
      if (localStorage.getItem('show_video_analysis') === 'true' && useVideoAnalysis) {
        setShowVideoAnalysis(true);
      }
    };

    // Handle video analysis complete
    const handleVideoAnalysisComplete = (event) => {
      // Only update the result if the flag is set in localStorage AND video analysis is enabled
      const useVideoAnalysis = localStorage.getItem('use_video_analysis') !== 'false';
      if (event.detail && localStorage.getItem('show_video_analysis') === 'true' && useVideoAnalysis) {
        setVideoAnalysisResult(event.detail);
        // Store current timestamp to allow for stale data detection
        localStorage.setItem('video_analysis_timestamp', Date.now().toString());
      }
    };

    // Add event listeners
    window.addEventListener('videoAnalysisStarted', handleVideoAnalysisStarted);
    window.addEventListener('videoAnalysisComplete', handleVideoAnalysisComplete);

    // Clean up
    return () => {
      window.removeEventListener('videoAnalysisStarted', handleVideoAnalysisStarted);
      window.removeEventListener('videoAnalysisComplete', handleVideoAnalysisComplete);
    };
  }, [setShowVideoAnalysis, setVideoAnalysisResult]);

  // Listen for theme and settings changes from other components
  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'theme' || !event.key) {
        const newTheme = localStorage.getItem('theme') || 'dark';
        setTheme(newTheme);
      }

      if (event.key === 'show_waveform' || !event.key) {
        const newShowWaveform = localStorage.getItem('show_waveform') !== 'false';
        setShowWaveform(newShowWaveform);
      }

      if (event.key === 'time_format' || !event.key) {
        const newTimeFormat = localStorage.getItem('time_format') || 'hms';
        setTimeFormat(newTimeFormat);
      }

      if (event.key === 'optimize_videos' || !event.key) {
        localStorage.setItem('optimize_videos', 'false');
        setOptimizeVideos(false);
      }

      if (event.key === 'optimized_resolution' || !event.key) {
        const newOptimizedResolution = localStorage.getItem('optimized_resolution') || '360p';
        setOptimizedResolution(newOptimizedResolution);
      }

      if (event.key === 'use_optimized_preview' || !event.key) {
        localStorage.setItem('use_optimized_preview', 'false');
        setUseOptimizedPreview(false);
      }

      // Sync localStorage to server when API keys change
      if (event.key === 'gemini_api_key' || event.key === 'gemini_model') {
        syncLocalStorageToServer()

          .catch(error => console.error('Error syncing localStorage to server:', error));
      }

      // Check for video analysis changes
      if (event.key === 'show_video_analysis' || event.key === 'video_analysis_timestamp' || !event.key) {
        const showAnalysis = localStorage.getItem('show_video_analysis') === 'true';
        const timestamp = localStorage.getItem('video_analysis_timestamp');
        const isProcessing = localStorage.getItem('video_processing_in_progress') === 'true';

        // Check if the analysis is stale (older than 5 minutes)
        const isStale = timestamp && (Date.now() - parseInt(timestamp, 10) > 5 * 60 * 1000);

        if (isStale) {
          // Clear stale analysis data
          localStorage.removeItem('show_video_analysis');
          localStorage.removeItem('video_analysis_timestamp');
          localStorage.removeItem('video_analysis_result');
          setShowVideoAnalysis(false);
          setVideoAnalysisResult(null);
          return;
        }

        // If we're already processing (after user made a choice), don't show the modal again
        if (isProcessing) {
          return;
        }

        if (showAnalysis && !isStale && !isProcessing) {
          setShowVideoAnalysis(true);

          // Get the analysis result from localStorage
          try {
            const analysisResult = JSON.parse(localStorage.getItem('video_analysis_result'));
            if (analysisResult) {
              setVideoAnalysisResult(analysisResult);
            }
          } catch (error) {
            console.error('Error parsing video analysis result from localStorage:', error);
            // Clear invalid data
            localStorage.removeItem('show_video_analysis');
            localStorage.removeItem('video_analysis_timestamp');
            localStorage.removeItem('video_analysis_result');
            setShowVideoAnalysis(false);
            setVideoAnalysisResult(null);
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [setTheme, setShowWaveform, setTimeFormat, setOptimizeVideos, setOptimizedResolution, setUseOptimizedPreview, setShowVideoAnalysis, setVideoAnalysisResult]);

  // Check for OAuth authentication success
  useEffect(() => {
    const checkOAuthSuccess = () => {
      const oauthSuccess = localStorage.getItem('oauth_auth_success') === 'true';
      if (oauthSuccess) {
        // Clear the flag
        localStorage.removeItem('oauth_auth_success');

        // Update API keys status
        const useOAuth = localStorage.getItem('use_youtube_oauth') === 'true';
        const hasOAuthTokens = hasValidTokens();

        if (useOAuth && hasOAuthTokens) {
          setApiKeysSet(prevState => ({
            ...prevState,
            youtube: true
          }));

          // Show success message
          setStatus({
            message: 'YouTube authentication successful!',
            type: 'success'
          });

          // Clear any previous error messages
          setTimeout(() => {
            setStatus({});
          }, 5000);
        }
      }
    };

    // Check immediately
    checkOAuthSuccess();

    // Set up interval to check periodically
    const intervalId = setInterval(checkOAuthSuccess, 1000);

    // Set up message listener for OAuth success
    const handleMessage = (event) => {
      if (event.origin === window.location.origin &&
          event.data && event.data.type === 'OAUTH_SUCCESS') {
        checkOAuthSuccess();
      }
    };

    window.addEventListener('message', handleMessage);

    // Set up storage event listener
    const handleStorageChange = (event) => {
      if (event.key === 'youtube_oauth_token' || event.key === 'oauth_auth_success') {
        checkOAuthSuccess();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Clean up
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [setApiKeysSet, setStatus]);

  // Effect to detect when subtitles are loaded from cache and prepare video for segments
  useEffect(() => {
    // Check if subtitles were loaded from cache
    // Look for both the translation key and common text patterns in different languages
    const isCacheLoadMessage =
      (status?.translationKey === 'output.subtitlesLoadedFromCache') ||
      (status?.message && status.type === 'success' &&
       (status.message.includes('cache') ||
        status.message.includes('bộ nhớ đệm') ||
        status.message.includes('캐시')));

    if (isCacheLoadMessage && subtitlesData) {
      // For file upload tab
      if (uploadedFile) {


        // Prepare the video for segments
        prepareVideoForSegments(uploadedFile).catch(error => {
          console.error('Error preparing video for segments after cache load:', error);
          // Show a warning but keep the subtitles
          setStatus({
            message: t('warnings.segmentsPreparationFailed', 'Subtitles loaded, but video segment preparation failed: {{message}}', { message: error.message }),
            type: 'warning'
          });
        });
      }
      // For YouTube tab, we need to download the video first
      else if (handleDownloadAndPrepareYouTubeVideo) {


        // We'll handle YouTube videos in a separate function to avoid making this effect too complex
        handleDownloadAndPrepareYouTubeVideo();
      }
    }
  }, [status, subtitlesData, uploadedFile, t, prepareVideoForSegments, handleDownloadAndPrepareYouTubeVideo, setStatus]);
};
