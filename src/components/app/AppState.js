import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSubtitles } from '../../hooks/useSubtitles';
import { getUserProvidedSubtitlesSync } from '../../utils/userSubtitlesStore';
import { getTranscriptionRulesSync } from '../../utils/transcriptionRulesStore';
import { hasValidTokens } from '../../services/youtubeApiService';
import { PROMPT_PRESETS } from '../../services/geminiService';
import { cleanupInvalidBlobUrls } from '../../utils/videoUtils';
import { getSubtitleEngine } from '../../services/subtitleEngineService';

/**
 * Custom hook for managing application state
 */
export const useAppState = () => {
  const { t } = useTranslation();

  // API Keys and authentication state
  const [apiKeysSet, setApiKeysSet] = useState({
    gemini: false,
    youtube: false,
    genius: false
  });

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState(localStorage.getItem('userPreferredTab') || 'unified-url');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [timeFormat, setTimeFormat] = useState(localStorage.getItem('time_format') || 'hms');
  const [showWaveform, setShowWaveform] = useState(localStorage.getItem('show_waveform') !== 'false');

  // Video processing state
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  // Video optimization is disabled; the original media is always used.
  const [optimizeVideos, setOptimizeVideos] = useState(() => {
    localStorage.setItem('optimize_videos', 'false');
    return false;
  });
  const [optimizedResolution, setOptimizedResolution] = useState(localStorage.getItem('optimized_resolution') || '360p');
  const [useOptimizedPreview, setUseOptimizedPreview] = useState(false);
  const [useCookiesForDownload, setUseCookiesForDownload] = useState(localStorage.getItem('use_cookies_for_download') === 'true');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [currentDownloadId, setCurrentDownloadId] = useState(null);
  const [isAppReady] = useState(true); // App is always ready (onboarding removed)
  const [isRetrying, setIsRetrying] = useState(false);
  const [isSrtOnlyMode, setIsSrtOnlyMode] = useState(false);

  // Video analysis state
  const [showVideoAnalysis, setShowVideoAnalysis] = useState(false);
  const [videoAnalysisResult, setVideoAnalysisResult] = useState(null);
  const [autoSelectDefaultPreset, setAutoSelectDefaultPreset] = useState(localStorage.getItem('auto_select_default_preset') === 'true');

  // Segments state
  const [segmentsStatus, setSegmentsStatus] = useState([]);
  const [videoSegments, setVideoSegments] = useState([]);

  // Rules editor state
  const [showRulesEditor, setShowRulesEditor] = useState(false);

  // User-provided subtitles state
  const [userProvidedSubtitles, setUserProvidedSubtitlesState] = useState(() => {
    // Try to get user-provided subtitles synchronously
    const savedSubtitles = getUserProvidedSubtitlesSync();
    return savedSubtitles || '';
  });

  // Track whether user-provided subtitles are being used
  const [useUserProvidedSubtitles, setUseUserProvidedSubtitles] = useState(() => {
    return localStorage.getItem('use_user_provided_subtitles') === 'true';
  });

  // Transcription rules state
  const [transcriptionRules, setTranscriptionRulesState] = useState(() => {
    // Try to get rules synchronously via the utility function
    const savedRules = getTranscriptionRulesSync();

    return savedRules;
  });

  // Get subtitles hook
  const {
    subtitlesData,
    setSubtitlesData,
    status,
    setStatus,
    isGenerating,
    generateSubtitles,
    retryGeneration,
    retrySegment,
    retryingSegments
  } = useSubtitles(t);

  // Initialize default values for settings
  useEffect(() => {
    // Migration: If user doesn't have userPreferredTab but has lastActiveTab, migrate it
    // But only if lastActiveTab is not 'file-upload' (which would be from auto-conversion)
    if (!localStorage.getItem('userPreferredTab')) {
      const lastTab = localStorage.getItem('lastActiveTab');
      if (lastTab && lastTab !== 'file-upload') {
        localStorage.setItem('userPreferredTab', lastTab);
      } else {
        // Default to unified-url if no valid preference exists
        localStorage.setItem('userPreferredTab', 'unified-url');
      }
    }

    // Set onboarding as completed
    localStorage.setItem('onboarding_completed', 'true');

    // Set default preset if not already set
    if (!localStorage.getItem('selected_preset_id')) {
      localStorage.setItem('selected_preset_id', 'general');
    }

    const currentGeminiModel = localStorage.getItem('gemini_model');
    const modelMigrationKey = 'gemini_default_model_35_migrated';
    if (!currentGeminiModel) {
      localStorage.setItem('gemini_model', 'gemini-3.5-flash');
    } else if (currentGeminiModel === 'gemini-2.5-flash' && localStorage.getItem(modelMigrationKey) !== 'true') {
      localStorage.setItem('gemini_model', 'gemini-3.5-flash');
      localStorage.setItem(modelMigrationKey, 'true');
    }

    // Set default transcription prompt if not already set
    if (!localStorage.getItem('transcription_prompt')) {
      const defaultPreset = PROMPT_PRESETS.find(preset => preset.id === 'general');
      if (defaultPreset) {
        localStorage.setItem('transcription_prompt', defaultPreset.prompt);
      }
    }

    // Clear status messages and video analysis state on mount
    // Clear any lingering status messages on page load
    setStatus({});

    // Clear video processing flag
    localStorage.removeItem('video_processing_in_progress');

    // Clean up invalid blob URLs from localStorage
    cleanupInvalidBlobUrls();

    // Check if there's an active video analysis in progress
    const showAnalysis = localStorage.getItem('show_video_analysis') === 'true';
    const timestamp = localStorage.getItem('video_analysis_timestamp');

    // Check if the analysis is stale (older than 5 minutes)
    const isStale = timestamp && (Date.now() - parseInt(timestamp, 10) > 5 * 60 * 1000);

    // Always clear video analysis data on page refresh
    // Check if this is a page refresh using a more modern approach
    const pageWasReloaded = window.performance &&
      (window.performance.getEntriesByType('navigation')[0]?.type === 'reload' ||
       document.referrer === document.location.href);

    if (isStale || pageWasReloaded) {
      // Clear analysis data
      localStorage.removeItem('show_video_analysis');
      localStorage.removeItem('video_analysis_timestamp');
      localStorage.removeItem('video_analysis_result');
      setShowVideoAnalysis(false);
      setVideoAnalysisResult(null);
      return;
    }

    if (showAnalysis && !isStale) {
      setShowVideoAnalysis(true);

      try {
        const analysisResult = JSON.parse(localStorage.getItem('video_analysis_result'));
        if (analysisResult) {
          setVideoAnalysisResult(analysisResult);
        }
      } catch (error) {
        console.error('Error parsing video analysis result from localStorage on mount:', error);
        // Clear invalid data
        localStorage.removeItem('show_video_analysis');
        localStorage.removeItem('video_analysis_timestamp');
        localStorage.removeItem('video_analysis_result');
        setShowVideoAnalysis(false);
        setVideoAnalysisResult(null);
      }
    }
  }, [setStatus]);

  // Initialize API keys and OAuth status from localStorage
  useEffect(() => {
    const geminiApiKey = localStorage.getItem('gemini_api_key');
    const youtubeApiKey = localStorage.getItem('youtube_api_key');
    const geniusApiKey = localStorage.getItem('genius_token');
    const useOAuth = localStorage.getItem('use_youtube_oauth') === 'true';
    const hasOAuthTokens = hasValidTokens();

    setApiKeysSet({
      gemini: !!geminiApiKey,
      youtube: useOAuth ? hasOAuthTokens : !!youtubeApiKey,
      genius: !!geniusApiKey
    });

    // Check API keys status and show message if needed (only for YouTube-specific messages)
    // The general Gemini API key message is handled by the reactive useEffect below
    // eslint-disable-next-line no-mixed-operators
    if (activeTab === 'youtube-search' && ((!youtubeApiKey && !useOAuth) || (useOAuth && !hasOAuthTokens))) {
      let message;

      // eslint-disable-next-line no-mixed-operators
      if (!geminiApiKey && ((!youtubeApiKey && !useOAuth) || (useOAuth && !hasOAuthTokens))) {
        message = t('errors.bothKeysRequired', 'Please set your Gemini API key and configure YouTube authentication in the settings to use this application.');
      } else if (useOAuth && !hasOAuthTokens) {
        message = t('errors.youtubeAuthRequired', 'YouTube authentication required. Please set up OAuth in settings.');
      } else {
        message = t('errors.youtubeApiKeyRequired', 'Please set your YouTube API key in the settings to use this application.');
      }

      if (message) {
        setStatus({ message, type: 'info' });
      }
    }
  }, [setStatus, activeTab, t]);

  // Reactively update status messages based on API key changes
  useEffect(() => {
    if (getSubtitleEngine() === 'whisper') return;
    // If we have a Gemini API key and the current status is an API key required message, clear it
    if (apiKeysSet.gemini && status?.message && status.type === 'info') {
      const isApiKeyRequiredMessage =
        status.message.includes('Please set your API key') ||
        status.message.includes('Vui lòng cài đặt khóa API') ||
        status.message.includes('API key') ||
        status.message.includes('khóa API');

      if (isApiKeyRequiredMessage) {
        setStatus({});
      }
    }
    // If we don't have a Gemini API key and there's no current status message, show the required message
    else if (!apiKeysSet.gemini && (!status?.message || status.type !== 'info')) {
      setStatus({
        message: t('errors.apiKeyRequired', 'Please set your API key in the settings first.'),
        type: 'info'
      });
    }
  }, [apiKeysSet.gemini, status, setStatus, t]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return {
    // State
    apiKeysSet, setApiKeysSet,
    showSettings, setShowSettings,
    activeTab, setActiveTab,
    theme, setTheme,
    timeFormat, setTimeFormat,
    showWaveform, setShowWaveform,
    selectedVideo, setSelectedVideo,
    uploadedFile, setUploadedFile,
    optimizeVideos, setOptimizeVideos,
    optimizedResolution, setOptimizedResolution,
    useOptimizedPreview, setUseOptimizedPreview,
    useCookiesForDownload, setUseCookiesForDownload,
    isDownloading, setIsDownloading,
    downloadProgress, setDownloadProgress,
    currentDownloadId, setCurrentDownloadId,
    isAppReady,
    isRetrying, setIsRetrying,
    isSrtOnlyMode, setIsSrtOnlyMode,
    showVideoAnalysis, setShowVideoAnalysis,
    videoAnalysisResult, setVideoAnalysisResult,
    autoSelectDefaultPreset, setAutoSelectDefaultPreset,
    segmentsStatus, setSegmentsStatus,
    videoSegments, setVideoSegments,
    showRulesEditor, setShowRulesEditor,
    userProvidedSubtitles, setUserProvidedSubtitlesState,
    useUserProvidedSubtitles, setUseUserProvidedSubtitles,
    transcriptionRules, setTranscriptionRulesState,

    // Subtitles hook
    subtitlesData, setSubtitlesData,
    status, setStatus,
    isGenerating,
    generateSubtitles,
    retryGeneration,
    retrySegment,
    retryingSegments
  };
};
