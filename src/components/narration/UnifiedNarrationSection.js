import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAudioUrl } from '../../services/narrationService';
import useNarrationHandlers from './hooks/useNarrationHandlers';

// Import custom hooks
import useNarrationState from './hooks/useNarrationState';
import useAvailabilityCheck from './hooks/useAvailabilityCheck';
import useGeminiNarration from './hooks/useGeminiNarration';
import useChatterboxNarration from './hooks/useChatterboxNarration';
import useEdgeTTSNarration from './hooks/useEdgeTTSNarration';
import useGTTSNarration from './hooks/useGTTSNarration';
import useAudioPlayback from './hooks/useAudioPlayback';
import useNarrationStorage from './hooks/useNarrationStorage';
import useUIEffects from './hooks/useUIEffects';
import useNarrationCache from './hooks/useNarrationCache';
import useWindowStateManager from './hooks/useWindowStateManager';

// Import modular components
import CapCutNarration from './components/CapCutNarration';
import AdaptiveSyncController from './components/AdaptiveSyncPanel';
import VibiNarration from './components/VibiNarration';
import ReferenceAudioSection from './components/ReferenceAudioSection';
import AudioControls from './components/AudioControls';
import VieNeuVoiceControls from './components/VieNeuVoiceControls';
import SubtitleSourceSelection from './components/SubtitleSourceSelection';
import GeminiSubtitleSourceSelection from './components/GeminiSubtitleSourceSelection';
import ChatterboxControls from './components/ChatterboxControls';
import OmniVoiceModeControls from './components/OmniVoiceModeControls';
import EdgeTTSControls from './components/EdgeTTSControls';
import GTTSControls from './components/GTTSControls';
import GeminiVoiceSelection from './components/GeminiVoiceSelection';
import GeminiConcurrentClientsSlider from './components/GeminiConcurrentClientsSlider';
import AdvancedSettingsToggle from './components/AdvancedSettingsToggle';
import GenerateButton from './components/GenerateButton';

import NarrationResults from './components/NarrationResults';
import GeminiNarrationResults from './components/GeminiNarrationResults';
import StatusMessage from './components/StatusMessage';
import NarrationMethodSelection from './components/NarrationMethodSelection';
import NarrationInputSource, { buildStandaloneNarrationSegments } from './components/NarrationInputSource';
import { NARRATION_METHODS } from './narrationMethods';
import { getNarrationSubtitlesForSource, groupedSubtitlesMatchSource } from '../../utils/narrationSubtitleSource';

// Import styles
import '../../styles/narration/unifiedNarrationRedesign.css';
import '../../styles/narration/standaloneNarration.css';

/**
 * Unified Narration Section component that combines settings and generation
 * @param {Object} props - Component props
 * @param {Array} props.subtitles - Subtitles to generate narration for (fallback)
 * @param {Array} props.originalSubtitles - Original subtitles
 * @param {Array} props.translatedSubtitles - Translated subtitles (optional)
 * @param {string} props.videoPath - Path to the current video (optional)
 * @param {Function} props.onReferenceAudioChange - Callback when reference audio changes
 * @param {Object} props.referenceAudio - Initial reference audio
 * @returns {JSX.Element} - Rendered component
 */
const UnifiedNarrationSection = ({
  subtitles,
  originalSubtitles,
  translatedSubtitles,
  videoPath,
  videoDuration,
  onReferenceAudioChange,
  referenceAudio: initialReferenceAudio
}) => {
  const { t } = useTranslation();

  // Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const fileInputRef = useRef(null);
  const statusRef = useRef(null);
  const contentRef = useRef(null);
  const sectionRef = useRef(null);

  // Use custom hooks for state management
  const narrationState = useNarrationState(initialReferenceAudio);

  // Destructure state from the hook
  const {
    // Narration Method state
    narrationMethod, setNarrationMethod,
    isGeminiAvailable, setIsGeminiAvailable,
    isChatterboxAvailable, setIsChatterboxAvailable,
    vieneuStatus, setVieneuStatus,
    omnivoiceStatus, setOmnivoiceStatus,

    // Gemini-specific settings
    selectedVoice, setSelectedVoice,
    concurrentClients, setConcurrentClients,

    // Chatterbox-specific settings
    exaggeration, setExaggeration,
    cfgWeight, setCfgWeight,
    omnivoiceMode, setOmnivoiceMode,
    omnivoiceInstruct, setOmnivoiceInstruct,
    vieneuVoiceMode, setVieneuVoiceMode,
    vieneuVoice, setVieneuVoice,

    // Edge TTS-specific settings
    edgeTTSVoice, setEdgeTTSVoice,
    edgeTTSRate, setEdgeTTSRate,
    edgeTTSVolume, setEdgeTTSVolume,
    edgeTTSPitch, setEdgeTTSPitch,

    // gTTS-specific settings
    gttsLanguage, setGttsLanguage,
    gttsTld, setGttsTld,
    gttsSlow, setGttsSlow,

    // Narration Settings state (for F5-TTS)
    referenceAudio, setReferenceAudio,
    referenceText, setReferenceText,
    isRecording, setIsRecording,
    /* recordedAudio, */ setRecordedAudio,
    isExtractingSegment, setIsExtractingSegment,
    segmentStartTime, segmentEndTime,
    autoRecognize, setAutoRecognize,
    isRecognizing, setIsRecognizing,

    // Narration Generation state
    isAvailable, setIsAvailable,
    isGenerating, setIsGenerating,
    generationStatus, setGenerationStatus,
    generationResults, setGenerationResults,
    error, setError,
    currentAudio, setCurrentAudio,
    isPlaying, setIsPlaying,
    subtitleSource, setSubtitleSource,
    advancedSettings, setAdvancedSettings,
    originalLanguage, setOriginalLanguage,
    translatedLanguage, setTranslatedLanguage,
    retryingSubtitleId, setRetryingSubtitleId,
    useGroupedSubtitles, setUseGroupedSubtitles,
    groupedSubtitles, setGroupedSubtitles,
    isGroupingSubtitles, setIsGroupingSubtitles,
    groupingIntensity, setGroupingIntensity,
    selectedNarrationModel,
    setSelectedNarrationModel,

    // Helper functions
    updateReferenceAudio
  } = narrationState;

  const hasSubtitleInput = [subtitles, originalSubtitles, translatedSubtitles]
    .some(items => Array.isArray(items) && items.length > 0);
  const [narrationInputMode, setNarrationInputMode] = useState(() => hasSubtitleInput ? 'subtitles' : 'text');
  const [hasChosenInputMode, setHasChosenInputMode] = useState(false);
  const [standaloneText, setStandaloneText] = useState('');
  const [standaloneTextLanguage, setStandaloneTextLanguage] = useState('vi');
  const [standaloneResultsByMethod, setStandaloneResultsByMethod] = useState({});
  const standaloneTextMode = narrationInputMode === 'text';
  const handleNarrationInputModeChange = useCallback((mode) => {
    setHasChosenInputMode(true);
    setNarrationInputMode(mode);
  }, []);

  useEffect(() => {
    if (!hasSubtitleInput && narrationInputMode === 'subtitles') {
      setNarrationInputMode('text');
      setHasChosenInputMode(false);
      return;
    }

    if (hasSubtitleInput && !hasChosenInputMode && !standaloneText.trim()) {
      setNarrationInputMode('subtitles');
    }
  }, [hasChosenInputMode, hasSubtitleInput, narrationInputMode, standaloneText]);

  const standaloneSegments = useMemo(() => buildStandaloneNarrationSegments(standaloneText), [standaloneText]);
  const activeGenerationResults = useMemo(() => standaloneTextMode
    ? (standaloneResultsByMethod[narrationMethod]?.text === standaloneText ? standaloneResultsByMethod[narrationMethod].results : [])
    : generationResults, [generationResults, narrationMethod, standaloneResultsByMethod, standaloneText, standaloneTextMode]);
  const activeSubtitleSource = standaloneTextMode
    ? 'original'
    : subtitleSource === 'translated' && !(Array.isArray(translatedSubtitles) && translatedSubtitles.length > 0)
      ? 'original'
      : subtitleSource;
  const activeOriginalSubtitles = useMemo(() => standaloneTextMode
    ? standaloneSegments
    : (originalSubtitles || subtitles || []), [originalSubtitles, standaloneSegments, standaloneTextMode, subtitles]);
  const activeTranslatedSubtitles = useMemo(() => standaloneTextMode ? [] : translatedSubtitles, [standaloneTextMode, translatedSubtitles]);
  const activeSubtitleFallback = standaloneTextMode ? standaloneSegments : subtitles;
  const activeOriginalLanguage = standaloneTextMode ? standaloneTextLanguage : originalLanguage;
  const activeTranslatedLanguage = standaloneTextMode ? standaloneTextLanguage : translatedLanguage;
  const activeSourceSubtitles = useMemo(() => standaloneTextMode
    ? standaloneSegments
    : getNarrationSubtitlesForSource({
      subtitleSource: activeSubtitleSource,
      originalSubtitles: activeOriginalSubtitles,
      translatedSubtitles: activeTranslatedSubtitles,
      subtitles: activeSubtitleFallback
    }), [activeOriginalSubtitles, activeSubtitleFallback, activeTranslatedSubtitles, activeSubtitleSource, standaloneSegments, standaloneTextMode]);
  const activeUseGroupedSubtitles = !standaloneTextMode && useGroupedSubtitles &&
    groupedSubtitlesMatchSource(groupedSubtitles, activeSourceSubtitles);
  const activeGroupedSubtitles = activeUseGroupedSubtitles ? groupedSubtitles : null;
  const getActiveSubtitles = useCallback(() => {
    if (standaloneTextMode) return standaloneSegments;
    if (activeUseGroupedSubtitles && activeGroupedSubtitles?.length) return activeGroupedSubtitles;
    return activeSourceSubtitles;
  }, [activeGroupedSubtitles, activeSourceSubtitles, activeUseGroupedSubtitles, standaloneSegments, standaloneTextMode]);
  const setActiveGenerationResults = useCallback((update) => {
    if (!standaloneTextMode) {
      setGenerationResults(update);
      return;
    }
    setStandaloneResultsByMethod((previous) => {
      const bucket = previous[narrationMethod];
      const current = bucket?.text === standaloneText ? bucket.results : [];
      const next = typeof update === 'function' ? update(current) : update;
      return { ...previous, [narrationMethod]: { text: standaloneText, results: next } };
    });
  }, [narrationMethod, setGenerationResults, standaloneText, standaloneTextMode]);

  const hasStandaloneText = standaloneSegments.length > 0;
  const handleSubtitleSourceChange = useCallback((source) => {
    if (source !== subtitleSource) {
      setGenerationResults([]);
      setError('');
      setGenerationStatus('');
      setCurrentAudio(null);
      setIsPlaying(false);
      setGroupedSubtitles(null);
      setUseGroupedSubtitles(false);
      window.groupedSubtitles = null;
      window.groupedNarrations = [];
      window.useGroupedSubtitles = false;
    }
    setSubtitleSource(source);
  }, [setCurrentAudio, setError, setGenerationResults, setGenerationStatus, setIsPlaying, setGroupedSubtitles, setSubtitleSource, setUseGroupedSubtitles, subtitleSource]);

  useEffect(() => {
    if (!standaloneTextMode && subtitleSource !== activeSubtitleSource) {
      handleSubtitleSourceChange(activeSubtitleSource);
    }
  }, [activeSubtitleSource, handleSubtitleSourceChange, standaloneTextMode, subtitleSource]);
  const downloadStandaloneAudio = useCallback(async () => {
    try {
      const result = activeGenerationResults.find(item => item.success && item.filename);
      if (!result) throw new Error('Chưa có audio thuyết minh thành công để tải xuống.');

      const response = await fetch(getAudioUrl(result.filename));
      if (!response.ok) throw new Error(`Không tải được audio (HTTP ${response.status}).`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const sourceName = String(result.filename).split(/[\\/]/).pop();
      const extension = sourceName.includes('.') ? sourceName.split('.').pop() : 'audio';
      link.download = `thuyet-minh-van-ban.${extension}`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(downloadError.message || 'Không thể tải audio thuyết minh.');
    }
  }, [activeGenerationResults, setError]);

  // Use availability check hook
  useAvailabilityCheck({
    narrationMethod,
    setIsAvailable,
    setIsGeminiAvailable,
    setIsChatterboxAvailable,
    setVieneuStatus,
    setOmnivoiceStatus,
    setError,
    t
  });

  useEffect(() => {
    const legacyMethod = ['gemini', 'edge-tts', 'gtts'].includes(narrationMethod);
    if (legacyMethod) {
      setNarrationMethod(NARRATION_METHODS.VIENEU);
      localStorage.setItem('narration_method', NARRATION_METHODS.VIENEU);
    }
  }, [narrationMethod, setNarrationMethod]);

  // Use Gemini narration hook
  const {
    handleGeminiNarration,
    cancelGeminiGeneration,
    retryGeminiNarration,
    retryFailedGeminiNarrations
  } = useGeminiNarration({
    setIsGenerating,
    setGenerationStatus,
    setError,
    setGenerationResults,
    generationResults,
    subtitleSource: activeSubtitleSource,
    originalSubtitles: activeOriginalSubtitles,
    translatedSubtitles: activeTranslatedSubtitles,
    subtitles: activeSubtitleFallback,
    originalLanguage,
    translatedLanguage,
    selectedVoice,
    concurrentClients,
    useGroupedSubtitles: activeUseGroupedSubtitles,
    setUseGroupedSubtitles,
    groupedSubtitles: activeGroupedSubtitles,
    setGroupedSubtitles,
    isGroupingSubtitles,
    setIsGroupingSubtitles,
    groupingIntensity,
    t,
    setRetryingSubtitleId
  });

  // Use Chatterbox narration hook
  const {
    handleChatterboxNarration,
    cancelChatterboxGeneration,
    retryChatterboxNarration,
    retryFailedChatterboxNarrations
  } = useChatterboxNarration({
    narrationMethod,
    setIsGenerating,
    setGenerationStatus,
    setError,
    setGenerationResults: setActiveGenerationResults,
    generationResults: activeGenerationResults,
    subtitleSource: activeSubtitleSource,
    originalSubtitles: activeOriginalSubtitles,
    translatedSubtitles: activeTranslatedSubtitles,
    subtitles: activeSubtitleFallback,
    originalLanguage: activeOriginalLanguage,
    translatedLanguage: activeTranslatedLanguage,
    exaggeration,
    cfgWeight,
    omnivoiceMode,
    omnivoiceInstruct,
    referenceAudio,
    referenceText,
    useGroupedSubtitles: activeUseGroupedSubtitles,
    setUseGroupedSubtitles,
    groupedSubtitles: activeGroupedSubtitles,
    setGroupedSubtitles,
    isGroupingSubtitles,
    setIsGroupingSubtitles,
    groupingIntensity,
    t,
    setRetryingSubtitleId,
    standaloneTextMode
  });

  // Use Edge TTS narration hook
  const {
    handleEdgeTTSNarration,
    cancelEdgeTTSGeneration,
    retryEdgeTTSNarration,
    retryFailedEdgeTTSNarrations
  } = useEdgeTTSNarration({
    setIsGenerating,
    setGenerationStatus,
    setError,
    setGenerationResults,
    generationResults,
    subtitleSource: activeSubtitleSource,
    originalSubtitles: activeOriginalSubtitles,
    translatedSubtitles: activeTranslatedSubtitles,
    subtitles: activeSubtitleFallback,
    originalLanguage,
    translatedLanguage,
    selectedVoice: edgeTTSVoice,
    setSelectedVoice: setEdgeTTSVoice,
    rate: edgeTTSRate,
    setRate: setEdgeTTSRate,
    volume: edgeTTSVolume,
    setVolume: setEdgeTTSVolume,
    pitch: edgeTTSPitch,
    setPitch: setEdgeTTSPitch,
    t,
    setRetryingSubtitleId,
    useGroupedSubtitles: activeUseGroupedSubtitles,
    groupedSubtitles: activeGroupedSubtitles,
    setUseGroupedSubtitles
  });

  // Use gTTS narration hook
  const {
    handleGTTSNarration,
    cancelGTTSGeneration,
    retryGTTSNarration,
    retryFailedGTTSNarrations
  } = useGTTSNarration({
    setIsGenerating,
    setGenerationStatus,
    setError,
    setGenerationResults,
    generationResults,
    subtitleSource: activeSubtitleSource,
    originalSubtitles: activeOriginalSubtitles,
    translatedSubtitles: activeTranslatedSubtitles,
    subtitles: activeSubtitleFallback,
    originalLanguage,
    translatedLanguage,
    selectedLanguage: gttsLanguage,
    setSelectedLanguage: setGttsLanguage,
    tld: gttsTld,
    setTld: setGttsTld,
    slow: gttsSlow,
    setSlow: setGttsSlow,
    t,
    setRetryingSubtitleId,
    useGroupedSubtitles: activeUseGroupedSubtitles,
    groupedSubtitles: activeGroupedSubtitles,
    setUseGroupedSubtitles
  });

  // Use audio playback hook
  const { audioRef, handleAudioEnded } = useAudioPlayback({
    isPlaying,
    currentAudio,
    setIsPlaying
  });

  useEffect(() => {
    setError('');
    setGenerationStatus('');
    setCurrentAudio(null);
    setIsPlaying(false);
    audioRef.current?.pause();
  }, [audioRef, narrationInputMode, narrationMethod, setCurrentAudio, setError, setGenerationStatus, setIsPlaying]);

  // Use narration storage hook
  useNarrationStorage({
    generationResults,
    subtitleSource: activeSubtitleSource
  });

  // Use UI effects hook
  useUIEffects({
    isGenerating,
    generationStatus,
    statusRef,
    t,
    referenceAudio,
    segmentStartTime,
    segmentEndTime,
    setError
  });

  // Use narration cache hook
  useNarrationCache({
    generationResults,
    setGenerationResults,
    setGenerationStatus,
    subtitleSource: activeSubtitleSource,
    originalSubtitles: activeOriginalSubtitles,
    translatedSubtitles: activeTranslatedSubtitles,
    subtitles: activeSubtitleFallback,
    t,
    setReferenceAudio,
    setReferenceText
  });

  // Use window state manager hook
  useWindowStateManager({
    generationResults,
    subtitleSource: activeSubtitleSource,
    narrationMethod,
    originalSubtitles: activeOriginalSubtitles,
    translatedSubtitles: activeTranslatedSubtitles,
    subtitles: activeSubtitleFallback,
    useGroupedSubtitles: activeUseGroupedSubtitles,
    groupedSubtitles: activeGroupedSubtitles,
    setGroupedSubtitles,
    setIsGroupingSubtitles,
    setUseGroupedSubtitles,
    groupingIntensity
  });

  // Wrapper function for setReferenceText that also updates cache
  const setReferenceTextWithCache = (newText) => {
    setReferenceText(newText);

    // Update reference audio cache if we have reference audio
    if (referenceAudio) {
      try {
        const getCurrentMediaId = () => {
          const currentVideoUrl = localStorage.getItem('current_video_url');
          const currentFileUrl = localStorage.getItem('current_file_url');

          if (currentVideoUrl) {
            const match = currentVideoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            return match ? match[1] : null;
          } else if (currentFileUrl) {
            return localStorage.getItem('current_file_cache_id');
          }
          return null;
        };

        const mediaId = getCurrentMediaId();
        if (mediaId) {
          const referenceAudioCache = {
            mediaId,
            timestamp: Date.now(),
            referenceAudio: {
              filename: referenceAudio.filename,
              text: newText || '',
              url: referenceAudio.url,
              filepath: referenceAudio.filepath
            }
          };

          localStorage.setItem('reference_audio_cache', JSON.stringify(referenceAudioCache));
          console.log('Updated reference audio cache with new text');
        }
      } catch (error) {
        console.error('Error updating reference audio cache with new text:', error);
      }
    }
  };

  // Update reference audio when initialReferenceAudio changes
  useEffect(() => {
    updateReferenceAudio(initialReferenceAudio);
  }, [initialReferenceAudio, updateReferenceAudio]);

  // Reset UI state when switching narration methods, but preserve results for aligned narration
  useEffect(() => {
    // Clear status and error messages, but don't clear generation results
    // This ensures aligned narration can still access the results
    setGenerationStatus('');
    setError('');

    // Remove any generating classes
    if (sectionRef.current) {
      sectionRef.current.classList.remove('f5tts-generating', 'gemini-generating');
    }
  }, [narrationMethod, setGenerationStatus, setError]);

  // No height animation when narration method changes - let content flow naturally

  // No overall section height animation - let content flow naturally

  // No special effect for height when generation starts - let content flow naturally

  // Import the handler functions from separate file to keep this component clean
  const {
    handleFileUpload,
    startRecording,
    stopRecording,
    // extractSegment is available but not used in this component
    clearReferenceAudio,
    handleGenerateNarration,
    playAudio,
    downloadAllAudio,
    downloadAlignedAudio,
    cancelGeneration,
    retryF5TTSNarration,
    retryFailedNarrations,
    handleExampleSelect
  } = useNarrationHandlers({
    fileInputRef,
    mediaRecorderRef,
    audioChunksRef,
    referenceAudio,
    referenceText,
    setReferenceAudio,
    setReferenceText,
    setRecordedAudio,
    setIsRecording,
    setIsExtractingSegment,
    setIsRecognizing,
    setError,
    autoRecognize,
    segmentStartTime,
    segmentEndTime,
    videoPath,
    onReferenceAudioChange,
    getSelectedSubtitles: getActiveSubtitles,
    advancedSettings,
    setIsGenerating,
    isGenerating,
    setGenerationStatus,
    setGenerationResults: setActiveGenerationResults,
    generationResults: activeGenerationResults,
    currentAudio,
    setCurrentAudio,
    setIsPlaying,
    statusRef,
    t,
    subtitleSource: activeSubtitleSource,
    translatedSubtitles: activeTranslatedSubtitles,
    vieneuVoiceMode,
    vieneuVoice,
    isPlaying,
    selectedNarrationModel,
    originalLanguage: activeOriginalLanguage,
    translatedLanguage: activeTranslatedLanguage,
    setRetryingSubtitleId,
    useGroupedSubtitles: activeUseGroupedSubtitles,
    setUseGroupedSubtitles,
    groupedSubtitles: activeGroupedSubtitles,
    standaloneTextMode
  });


  return (
    <div className="narration-section" ref={sectionRef}>
      <div className="narration-header">
        <h3>{t('narration.title', 'Generate Narration')}</h3>
        <p className="narration-description">
          {t('narration.descriptionWithCapcut', 'Tạo thuyết minh bằng VieNeu-TTS, OmniVoice, Vibi ElevenLabs hoặc CapCut TTS.')}
        </p>
      </div>

      {!standaloneTextMode && <AdaptiveSyncController videoPath={videoPath} videoDuration={videoDuration}
        generationResults={activeGenerationResults} originalSubtitles={activeOriginalSubtitles}
        translatedSubtitles={activeTranslatedSubtitles} subtitleSource={activeSubtitleSource}
        groupedSubtitles={activeGroupedSubtitles} useGroupedSubtitles={activeUseGroupedSubtitles} />}
      {/* Narration Method Selection */}
      <NarrationMethodSelection
        narrationMethod={narrationMethod}
        setNarrationMethod={setNarrationMethod}
        isGenerating={isGenerating}
        isF5Available={isAvailable}
        isChatterboxAvailable={isChatterboxAvailable}
        vieneuStatus={vieneuStatus}
        omnivoiceStatus={omnivoiceStatus}
        isVibiAvailable
      />

      <NarrationInputSource
        mode={narrationInputMode}
        setMode={handleNarrationInputModeChange}
        text={standaloneText}
        setText={setStandaloneText}
        disabled={isGenerating}
        hasSubtitles={hasSubtitleInput}
        language={standaloneTextLanguage}
        setLanguage={setStandaloneTextLanguage}
        showLanguage={narrationMethod === NARRATION_METHODS.OMNIVOICE && standaloneTextMode}
      />

      {/* Error Message - only show when there's an actual error message */}
      {error && <StatusMessage message={error} type="error" />}

      <div className="narration-content-container" ref={contentRef}>
      {narrationMethod === 'vibi' ? (
        <VibiNarration
          getSubtitles={getActiveSubtitles}
          subtitleSource={activeSubtitleSource} isGenerating={isGenerating} setIsGenerating={setIsGenerating}
          generationResults={activeGenerationResults} setGenerationResults={setActiveGenerationResults}
          downloadAllAudio={downloadAllAudio} downloadAlignedAudio={standaloneTextMode ? downloadStandaloneAudio : downloadAlignedAudio}
          currentAudio={currentAudio} isPlaying={isPlaying} playAudio={playAudio}
          useGroupedSubtitles={activeUseGroupedSubtitles} audioRef={audioRef} handleAudioEnded={handleAudioEnded}
          standaloneTextMode={standaloneTextMode} isInputValid={!standaloneTextMode || hasStandaloneText}
          combinedAudioLabel={standaloneTextMode ? 'Tải audio' : ''}
          combinedAudioTooltip={standaloneTextMode ? 'Tải audio duy nhất được tạo từ toàn bộ văn bản.' : ''}>
          {!standaloneTextMode && <SubtitleSourceSelection
            subtitleSource={activeSubtitleSource}
            setSubtitleSource={handleSubtitleSourceChange}
            isGenerating={isGenerating}
            translatedSubtitles={activeTranslatedSubtitles}
            originalSubtitles={activeOriginalSubtitles} subtitles={activeSubtitleFallback}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={activeUseGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={activeGroupedSubtitles}
            setGroupedSubtitles={setGroupedSubtitles}
            groupingIntensity={groupingIntensity}
            setGroupingIntensity={setGroupingIntensity}
            onGroupedSubtitlesGenerated={setGroupedSubtitles}
            narrationMethod={narrationMethod}
          />}
        </VibiNarration>
      ) : narrationMethod === 'capcut' ? (
        <CapCutNarration
          videoPath={videoPath}
          videoDuration={videoDuration}
          getOriginalSubtitles={() => activeOriginalSubtitles}
          getSubtitles={getActiveSubtitles}
          subtitleSource={activeSubtitleSource} isGenerating={isGenerating} setIsGenerating={setIsGenerating}
          generationResults={activeGenerationResults} setGenerationResults={setActiveGenerationResults}
          downloadAllAudio={downloadAllAudio} downloadAlignedAudio={standaloneTextMode ? downloadStandaloneAudio : downloadAlignedAudio}
          currentAudio={currentAudio} isPlaying={isPlaying} playAudio={playAudio}
          useGroupedSubtitles={activeUseGroupedSubtitles} audioRef={audioRef} handleAudioEnded={handleAudioEnded}
          standaloneTextMode={standaloneTextMode} isInputValid={!standaloneTextMode || hasStandaloneText}
          combinedAudioLabel={standaloneTextMode ? 'Tải audio' : ''}
          combinedAudioTooltip={standaloneTextMode ? 'Tải audio duy nhất được tạo từ toàn bộ văn bản.' : ''}>
          {!standaloneTextMode && <SubtitleSourceSelection
            subtitleSource={activeSubtitleSource}
            setSubtitleSource={handleSubtitleSourceChange}
            isGenerating={isGenerating}
            translatedSubtitles={activeTranslatedSubtitles}
            originalSubtitles={activeOriginalSubtitles} subtitles={activeSubtitleFallback}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={activeUseGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={activeGroupedSubtitles}
            setGroupedSubtitles={setGroupedSubtitles}
            groupingIntensity={groupingIntensity}
            setGroupingIntensity={setGroupingIntensity}
            onGroupedSubtitlesGenerated={setGroupedSubtitles}
            narrationMethod={narrationMethod}
            onLanguageDetected={(source, language) => {
              if (source === 'original') {
                setOriginalLanguage(language);
              } else if (source === 'translated') {
                setTranslatedLanguage(language);
              }
            }}
          />}
        </CapCutNarration>
      ) : narrationMethod === NARRATION_METHODS.VIENEU ? (
        // F5-TTS UI
        <div className="f5tts-content">
          <VieNeuVoiceControls
            mode={vieneuVoiceMode}
            setMode={setVieneuVoiceMode}
            voice={vieneuVoice}
            setVoice={setVieneuVoice}
            isGenerating={isGenerating}
            isAvailable={isAvailable}
            referenceAudio={referenceAudio}
            referenceText={referenceText}
            speechRate={advancedSettings.speechRate}
          />

          {vieneuVoiceMode === 'reference' && (
            <>
              <AudioControls
                handleFileUpload={handleFileUpload}
                fileInputRef={fileInputRef}
                isRecording={isRecording}
                startRecording={startRecording}
                stopRecording={stopRecording}
                isAvailable={isAvailable}
                referenceAudio={referenceAudio}
                clearReferenceAudio={clearReferenceAudio}
                onExampleSelect={handleExampleSelect}
              />

              <ReferenceAudioSection
                referenceAudio={referenceAudio}
                autoRecognize={autoRecognize}
                setAutoRecognize={setAutoRecognize}
                isRecognizing={isRecognizing}
                referenceText={referenceText}
                setReferenceText={setReferenceTextWithCache}
                clearReferenceAudio={clearReferenceAudio}
                isRecording={isRecording}
                isExtractingSegment={isExtractingSegment}
              />
            </>
          )}

          {/* Subtitle Source Selection */}
          {!standaloneTextMode && <SubtitleSourceSelection
            subtitleSource={activeSubtitleSource}
            setSubtitleSource={handleSubtitleSourceChange}
            isGenerating={isGenerating}
            translatedSubtitles={activeTranslatedSubtitles}
            originalSubtitles={activeOriginalSubtitles} subtitles={activeSubtitleFallback}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={activeUseGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={activeGroupedSubtitles}
            setGroupedSubtitles={setGroupedSubtitles}
            groupingIntensity={groupingIntensity}
            setGroupingIntensity={setGroupingIntensity}
            narrationMethod={narrationMethod}
            onLanguageDetected={(source, language, modelId, modelError) => {


              if (modelError) {
                console.warn(`Model availability error: ${modelError}`);
              }

              // Update the selected narration model
              if (modelId) {
                setSelectedNarrationModel(modelId);
              }

              // Update the appropriate language state
              if (source === 'original') {
                setOriginalLanguage(language);
              } else if (source === 'translated') {
                setTranslatedLanguage(language);
              }

              // Store in localStorage for persistence
              try {
                localStorage.setItem('detected_language', JSON.stringify({
                  source,
                  language,
                  modelId,
                  modelError
                }));
              } catch (e) {
                console.error('Error storing detected language in localStorage:', e);
              }
            }}
          />}

          {/* Advanced Settings Toggle */}
          <AdvancedSettingsToggle
            advancedSettings={advancedSettings}
            setAdvancedSettings={setAdvancedSettings}
            isGenerating={isGenerating}
          />

          {/* Generate Button */}
          <GenerateButton
            handleGenerateNarration={handleGenerateNarration}
            isGenerating={isGenerating}
            referenceAudio={referenceAudio}
            generationResults={activeGenerationResults}
            downloadAllAudio={downloadAllAudio}
            downloadAlignedAudio={standaloneTextMode ? downloadStandaloneAudio : downloadAlignedAudio}
            cancelGeneration={cancelGeneration}
            subtitleSource={activeSubtitleSource}
            isServiceAvailable={isAvailable}
            requiresReferenceAudio={vieneuVoiceMode === 'reference'}
            isInputValid={(!standaloneTextMode || hasStandaloneText) &&
              (omnivoiceMode !== 'design' || Boolean(String(omnivoiceInstruct || '').trim()))}
            inputValidationMessage={omnivoiceMode === 'design' && !String(omnivoiceInstruct || '').trim()
              ? 'Chọn ít nhất một thuộc tính giọng hoặc chuyển sang chế độ Tự sinh giọng.'
              : 'Nhập văn bản cần đọc trước khi tạo audio.'}
            standaloneTextMode={standaloneTextMode}
            combinedAudioLabel={standaloneTextMode ? 'Tải audio' : ''}
            combinedAudioTooltip={standaloneTextMode ? 'Tải audio duy nhất được tạo từ toàn bộ văn bản.' : ''}
            serviceUnavailableMessage={t('narration.serviceUnavailableMessage', 'Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được.')}
          />

          {/* Generation Status */}
          <StatusMessage
            message={(isGenerating || retryingSubtitleId) ? generationStatus : ''}
            type="info"
            statusRef={statusRef}
            showProgress={isGenerating && generationStatus && generationStatus.includes('Generating narrations')}
            isGenerating={isGenerating}
          />

          {/* Results */}
          <NarrationResults
            generationResults={activeGenerationResults}
            playAudio={playAudio}
            currentAudio={currentAudio}
            isPlaying={isPlaying}
            getAudioUrl={getAudioUrl}
            onRetry={retryF5TTSNarration}
            retryingSubtitleId={retryingSubtitleId}
            onRetryFailed={retryFailedNarrations}
            title={standaloneTextMode ? 'Thuyết minh từ văn bản' : undefined}
            standaloneTextMode={standaloneTextMode}
            isGenerating={isGenerating}
          />

          {/* Hidden audio player for playback */}
          <audio
            ref={audioRef}
            src={currentAudio?.url}
            onEnded={handleAudioEnded}
            style={{ display: 'none' }}
          />
        </div>
      ) : narrationMethod === NARRATION_METHODS.OMNIVOICE ? (
        // Chatterbox UI
        <div className="chatterbox-content">
          <OmniVoiceModeControls
            mode={omnivoiceMode}
            setMode={setOmnivoiceMode}
            instruct={omnivoiceInstruct}
            setInstruct={setOmnivoiceInstruct}
            isGenerating={isGenerating}
            isAvailable={isChatterboxAvailable}
            referenceAudio={referenceAudio}
            referenceText={referenceText}
            exaggeration={exaggeration}
            cfgWeight={cfgWeight}
             language={activeSubtitleSource === 'translated' ? activeTranslatedLanguage : activeOriginalLanguage}
          />

          {omnivoiceMode === 'reference' && (
            <AudioControls
              handleFileUpload={handleFileUpload}
              fileInputRef={fileInputRef}
              isRecording={isRecording}
              startRecording={startRecording}
              stopRecording={stopRecording}
              isAvailable={isChatterboxAvailable}
              referenceAudio={referenceAudio}
              clearReferenceAudio={clearReferenceAudio}
              onExampleSelect={handleExampleSelect}
            />
          )}

          {/* Subtitle Source Selection - reuse from F5-TTS */}
          {!standaloneTextMode && <SubtitleSourceSelection
            subtitleSource={activeSubtitleSource}
            setSubtitleSource={handleSubtitleSourceChange}
            isGenerating={isGenerating}
            translatedSubtitles={activeTranslatedSubtitles}
            originalSubtitles={activeOriginalSubtitles} subtitles={activeSubtitleFallback}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={activeUseGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={activeGroupedSubtitles}
            setGroupedSubtitles={setGroupedSubtitles}
            groupingIntensity={groupingIntensity}
            setGroupingIntensity={setGroupingIntensity}
            onGroupedSubtitlesGenerated={setGroupedSubtitles}
            narrationMethod={narrationMethod}
            onLanguageDetected={(source, language) => {
              if (source === 'original') {
                setOriginalLanguage(language);
              } else if (source === 'translated') {
                setTranslatedLanguage(language);
              }
            }}
          />}

          {/* Chatterbox Controls */}
          <ChatterboxControls
            exaggeration={exaggeration}
            setExaggeration={setExaggeration}
            cfgWeight={cfgWeight}
            setCfgWeight={setCfgWeight}
            isGenerating={isGenerating}
          />

          {/* Generate Button - reuse from F5-TTS */}
          <GenerateButton
            handleGenerateNarration={handleChatterboxNarration}
            isGenerating={isGenerating}
            referenceAudio={referenceAudio}
            subtitleSource={activeSubtitleSource}
            cancelGeneration={cancelChatterboxGeneration}
            downloadAllAudio={downloadAllAudio}
            downloadAlignedAudio={standaloneTextMode ? downloadStandaloneAudio : downloadAlignedAudio}
            generationResults={activeGenerationResults}
            isServiceAvailable={isChatterboxAvailable}
            requiresReferenceAudio={omnivoiceMode === 'reference'}
            isInputValid={!standaloneTextMode || hasStandaloneText}
            inputValidationMessage="Nhập văn bản cần đọc trước khi tạo audio."
            standaloneTextMode={standaloneTextMode}
            combinedAudioLabel={standaloneTextMode ? 'Tải audio' : ''}
            combinedAudioTooltip={standaloneTextMode ? 'Tải audio duy nhất được tạo từ toàn bộ văn bản.' : ''}
            serviceUnavailableMessage={t('narration.chatterboxUnavailableMessage', 'Chatterbox API is not available. Please start the Chatterbox service.')}
          />

          {/* Generation Status */}
          <StatusMessage
            message={(isGenerating || retryingSubtitleId) ? generationStatus : ''}
            type="info"
            statusRef={statusRef}
            showProgress={isGenerating && Boolean(generationStatus)}
            isGenerating={isGenerating}
          />

          {/* Chatterbox Results - reuse F5-TTS results component */}
          <NarrationResults
            generationResults={activeGenerationResults}
            onRetry={retryChatterboxNarration}
            retryingSubtitleId={retryingSubtitleId}
            onRetryFailed={retryFailedChatterboxNarrations}
            hasGenerationError={!!error && error.includes('Chatterbox')}
            currentAudio={currentAudio}
            isPlaying={isPlaying}
            playAudio={playAudio}
            getAudioUrl={getAudioUrl}
            subtitleSource={activeSubtitleSource}
            title={standaloneTextMode ? 'Thuyết minh từ văn bản' : undefined}
            standaloneTextMode={standaloneTextMode}
            isGenerating={isGenerating}
          />

          {/* Hidden audio player for playback */}
          <audio
            ref={audioRef}
            src={currentAudio?.url}
            onEnded={handleAudioEnded}
            style={{ display: 'none' }}
          />
        </div>
      ) : narrationMethod === 'edge-tts' ? (
        // Edge TTS UI
        <div className="edge-tts-content">
          {/* Subtitle Source Selection */}
          <SubtitleSourceSelection
            subtitleSource={activeSubtitleSource}
            setSubtitleSource={handleSubtitleSourceChange}
            isGenerating={isGenerating}
            translatedSubtitles={activeTranslatedSubtitles}
            originalSubtitles={activeOriginalSubtitles} subtitles={activeSubtitleFallback}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={activeUseGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={activeGroupedSubtitles}
            setGroupedSubtitles={setGroupedSubtitles}
            groupingIntensity={groupingIntensity}
            setGroupingIntensity={setGroupingIntensity}
            onGroupedSubtitlesGenerated={setGroupedSubtitles}
            narrationMethod={narrationMethod}
            onLanguageDetected={(source, language) => {
              if (source === 'original') {
                setOriginalLanguage(language);
              } else if (source === 'translated') {
                setTranslatedLanguage(language);
              }
            }}
          />

          {/* Edge TTS Controls */}
          <EdgeTTSControls
            selectedVoice={edgeTTSVoice}
            setSelectedVoice={setEdgeTTSVoice}
            rate={edgeTTSRate}
            setRate={setEdgeTTSRate}
            volume={edgeTTSVolume}
            setVolume={setEdgeTTSVolume}
            pitch={edgeTTSPitch}
            setPitch={setEdgeTTSPitch}
            isGenerating={isGenerating}
            detectedLanguage={activeSubtitleSource === 'original' ? activeOriginalLanguage : activeTranslatedLanguage}
          />

          {/* Generate Button */}
          <GenerateButton
            handleGenerateNarration={handleEdgeTTSNarration}
            isGenerating={isGenerating}
            referenceAudio={null}
            subtitleSource={activeSubtitleSource}
            cancelGeneration={cancelEdgeTTSGeneration}
            downloadAllAudio={downloadAllAudio}
            downloadAlignedAudio={downloadAlignedAudio}
            generationResults={generationResults}
            isServiceAvailable={true}
            serviceUnavailableMessage=""
          />

          {/* Generation Status */}
          <StatusMessage
            message={(isGenerating || retryingSubtitleId) ? generationStatus : ''}
            type="info"
            statusRef={statusRef}
            showProgress={isGenerating && generationStatus && generationStatus.includes('Generating')}
            isGenerating={isGenerating}
          />

          {/* Edge TTS Results */}
          <NarrationResults
            generationResults={generationResults}
            onRetry={retryEdgeTTSNarration}
            retryingSubtitleId={retryingSubtitleId}
            onRetryFailed={retryFailedEdgeTTSNarrations}
            hasGenerationError={!!error && error.includes('Edge TTS')}
            currentAudio={currentAudio}
            isPlaying={isPlaying}
            playAudio={playAudio}
            getAudioUrl={getAudioUrl}
            subtitleSource={activeSubtitleSource}
            isGenerating={isGenerating}
          />

          {/* Hidden audio player for playback */}
          <audio
            ref={audioRef}
            src={currentAudio?.url}
            onEnded={handleAudioEnded}
            style={{ display: 'none' }}
          />
        </div>
      ) : narrationMethod === 'gtts' ? (
        // gTTS UI
        <div className="gtts-content">
          {/* Subtitle Source Selection */}
          <SubtitleSourceSelection
            subtitleSource={activeSubtitleSource}
            setSubtitleSource={handleSubtitleSourceChange}
            isGenerating={isGenerating}
            translatedSubtitles={activeTranslatedSubtitles}
            originalSubtitles={activeOriginalSubtitles} subtitles={activeSubtitleFallback}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={activeUseGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={activeGroupedSubtitles}
            setGroupedSubtitles={setGroupedSubtitles}
            groupingIntensity={groupingIntensity}
            setGroupingIntensity={setGroupingIntensity}
            onGroupedSubtitlesGenerated={setGroupedSubtitles}
            narrationMethod={narrationMethod}
            onLanguageDetected={(source, language) => {
              if (source === 'original') {
                setOriginalLanguage(language);
              } else if (source === 'translated') {
                setTranslatedLanguage(language);
              }
            }}
          />

          {/* gTTS Controls */}
          <GTTSControls
            selectedLanguage={gttsLanguage}
            setSelectedLanguage={setGttsLanguage}
            tld={gttsTld}
            setTld={setGttsTld}
            slow={gttsSlow}
            setSlow={setGttsSlow}
            isGenerating={isGenerating}
            detectedLanguage={activeSubtitleSource === 'original' ? activeOriginalLanguage : activeTranslatedLanguage}
          />

          {/* Generate Button */}
          <GenerateButton
            handleGenerateNarration={handleGTTSNarration}
            isGenerating={isGenerating}
            referenceAudio={null}
            subtitleSource={activeSubtitleSource}
            cancelGeneration={cancelGTTSGeneration}
            downloadAllAudio={downloadAllAudio}
            downloadAlignedAudio={downloadAlignedAudio}
            generationResults={generationResults}
            isServiceAvailable={true}
            serviceUnavailableMessage=""
          />

          {/* Generation Status */}
          <StatusMessage
            message={(isGenerating || retryingSubtitleId) ? generationStatus : ''}
            type="info"
            statusRef={statusRef}
            showProgress={isGenerating && generationStatus && generationStatus.includes('Generating')}
            isGenerating={isGenerating}
          />

          {/* gTTS Results */}
          <NarrationResults
            generationResults={generationResults}
            onRetry={retryGTTSNarration}
            retryingSubtitleId={retryingSubtitleId}
            onRetryFailed={retryFailedGTTSNarrations}
            hasGenerationError={!!error && error.includes('gTTS')}
            currentAudio={currentAudio}
            isPlaying={isPlaying}
            playAudio={playAudio}
            getAudioUrl={getAudioUrl}
            subtitleSource={activeSubtitleSource}
            isGenerating={isGenerating}
          />

          {/* Hidden audio player for playback */}
          <audio
            ref={audioRef}
            src={currentAudio?.url}
            onEnded={handleAudioEnded}
            style={{ display: 'none' }}
          />
        </div>
      ) : (
        // Gemini UI
        <div className="gemini-content">
          {/* Simplified Subtitle Source Selection for Gemini */}
          <GeminiSubtitleSourceSelection
            subtitleSource={activeSubtitleSource}
            setSubtitleSource={handleSubtitleSourceChange}
            isGenerating={isGenerating}
            translatedSubtitles={activeTranslatedSubtitles}
            originalSubtitles={activeOriginalSubtitles} subtitles={activeSubtitleFallback}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={activeUseGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={activeGroupedSubtitles}
            setGroupedSubtitles={setGroupedSubtitles}
            groupingIntensity={groupingIntensity}
            setGroupingIntensity={setGroupingIntensity}
            onGroupedSubtitlesGenerated={setGroupedSubtitles}
            onLanguageDetected={(source, language) => {
              // Update the appropriate language state
              if (source === 'original') {
                setOriginalLanguage(language);
              } else if (source === 'translated') {
                setTranslatedLanguage(language);
              }
            }}
          />

          {/* Voice Selection for Gemini */}
          <GeminiVoiceSelection
            selectedVoice={selectedVoice}
            setSelectedVoice={setSelectedVoice}
            isGenerating={isGenerating}
          />

          {/* Concurrent Clients Slider for Gemini */}
          <GeminiConcurrentClientsSlider
            concurrentClients={concurrentClients}
            setConcurrentClients={setConcurrentClients}
            isGenerating={isGenerating}
          />

          {/* Generate Button */}
          <GenerateButton
            handleGenerateNarration={handleGeminiNarration}
            isGenerating={isGenerating}
            referenceAudio={null}
            subtitleSource={activeSubtitleSource}
            cancelGeneration={cancelGeminiGeneration}
            downloadAllAudio={downloadAllAudio}
            downloadAlignedAudio={downloadAlignedAudio}
            generationResults={generationResults}
            isServiceAvailable={isGeminiAvailable}
            serviceUnavailableMessage={t('narration.geminiUnavailableMessage', 'Gemini API is not available. Please check your API key in settings.')}
          />

          {/* Generation Status */}
          <StatusMessage
            message={(isGenerating || retryingSubtitleId) ? generationStatus : ''}
            type="info"
            statusRef={statusRef}
            showProgress={isGenerating && generationStatus && generationStatus.includes('Generating narrations')}
            isGenerating={isGenerating}
          />

          {/* Gemini Results */}
          <GeminiNarrationResults
            generationResults={generationResults}
            onRetry={retryGeminiNarration}
            retryingSubtitleId={retryingSubtitleId}
            onRetryFailed={retryFailedGeminiNarrations}
            hasGenerationError={!!error && error.includes('Gemini')}
            subtitleSource={activeSubtitleSource}
            isGenerating={isGenerating}
            standaloneTextMode={standaloneTextMode}
          />

          {/* No need for a separate audio element here as it's included in the GeminiNarrationResults component */}
        </div>
      )}
      </div>
    </div>
  );
};

export default UnifiedNarrationSection;
