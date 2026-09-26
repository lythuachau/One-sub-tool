import { useRef, useEffect } from 'react';
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
import { NARRATION_METHODS } from './narrationMethods';

// Import styles
import '../../styles/narration/unifiedNarrationRedesign.css';

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
    subtitleSource,
    originalSubtitles,
    translatedSubtitles,
    subtitles,
    originalLanguage,
    translatedLanguage,
    selectedVoice,
    concurrentClients,
    useGroupedSubtitles,
    setUseGroupedSubtitles,
    groupedSubtitles,
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
    setIsGenerating,
    setGenerationStatus,
    setError,
    setGenerationResults,
    generationResults,
    subtitleSource,
    originalSubtitles,
    translatedSubtitles,
    subtitles,
    originalLanguage,
    translatedLanguage,
    exaggeration,
    cfgWeight,
    omnivoiceMode,
    omnivoiceInstruct,
    referenceAudio,
    referenceText,
    useGroupedSubtitles,
    setUseGroupedSubtitles,
    groupedSubtitles,
    setGroupedSubtitles,
    isGroupingSubtitles,
    setIsGroupingSubtitles,
    groupingIntensity,
    t,
    setRetryingSubtitleId
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
    subtitleSource,
    originalSubtitles,
    translatedSubtitles,
    subtitles,
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
    useGroupedSubtitles,
    groupedSubtitles,
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
    subtitleSource,
    originalSubtitles,
    translatedSubtitles,
    subtitles,
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
    useGroupedSubtitles,
    groupedSubtitles,
    setUseGroupedSubtitles
  });

  // Use audio playback hook
  const { audioRef, handleAudioEnded } = useAudioPlayback({
    isPlaying,
    currentAudio,
    setIsPlaying
  });

  // Use narration storage hook
  useNarrationStorage({
    generationResults,
    subtitleSource
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
    subtitleSource,
    originalSubtitles,
    translatedSubtitles,
    subtitles,
    t,
    setReferenceAudio,
    setReferenceText
  });

  // Use window state manager hook
  useWindowStateManager({
    generationResults,
    subtitleSource,
    narrationMethod,
    originalSubtitles,
    translatedSubtitles,
    subtitles,
    useGroupedSubtitles,
    groupedSubtitles,
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
    getSelectedSubtitles: () => {
      // Check if we should use grouped subtitles
      if (useGroupedSubtitles && groupedSubtitles && groupedSubtitles.length > 0) {
        return groupedSubtitles;
      }
      if (subtitleSource === 'translated' && translatedSubtitles && translatedSubtitles.length > 0) {
        return translatedSubtitles;
      }
      return originalSubtitles || subtitles;
    },
    advancedSettings,
    setIsGenerating,
    isGenerating,
    setGenerationStatus,
    setGenerationResults,
    generationResults,
    currentAudio,
    setCurrentAudio,
    setIsPlaying,
    statusRef,
    t,
    subtitleSource,
    translatedSubtitles,
    vieneuVoiceMode,
    vieneuVoice,
    isPlaying,
    selectedNarrationModel,
    originalLanguage,
    translatedLanguage,
    setRetryingSubtitleId,
    useGroupedSubtitles,
    setUseGroupedSubtitles,
    groupedSubtitles
  });


  return (
    <div className="narration-section" ref={sectionRef}>
      <div className="narration-header">
        <h3>{t('narration.title', 'Generate Narration')}</h3>
        <p className="narration-description">
          {t('narration.descriptionWithCapcut', 'Tạo thuyết minh bằng VieNeu-TTS, OmniVoice, Vibi ElevenLabs hoặc CapCut TTS.')}
        </p>
      </div>

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

      {/* Error Message - only show when there's an actual error message */}
      {error && <StatusMessage message={error} type="error" />}

      <div className="narration-content-container" ref={contentRef}>
      {narrationMethod === 'vibi' ? (
        <VibiNarration
          getSubtitles={() => useGroupedSubtitles && groupedSubtitles?.length ? groupedSubtitles : subtitleSource === 'translated' ? translatedSubtitles : originalSubtitles || subtitles}
          subtitleSource={subtitleSource} isGenerating={isGenerating} setIsGenerating={setIsGenerating}
          generationResults={generationResults} setGenerationResults={setGenerationResults}
          downloadAllAudio={downloadAllAudio} downloadAlignedAudio={downloadAlignedAudio}
          currentAudio={currentAudio} isPlaying={isPlaying} playAudio={playAudio}
          useGroupedSubtitles={useGroupedSubtitles} audioRef={audioRef} handleAudioEnded={handleAudioEnded}>
          <SubtitleSourceSelection
            subtitleSource={subtitleSource}
            setSubtitleSource={setSubtitleSource}
            isGenerating={isGenerating}
            translatedSubtitles={translatedSubtitles}
            originalSubtitles={originalSubtitles || subtitles}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={useGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={groupedSubtitles}
            groupingIntensity={groupingIntensity}
            setGroupingIntensity={setGroupingIntensity}
            onGroupedSubtitlesGenerated={setGroupedSubtitles}
            narrationMethod={narrationMethod}
          />
        </VibiNarration>
      ) : narrationMethod === 'capcut' ? (
        <CapCutNarration
          getSubtitles={() => useGroupedSubtitles && groupedSubtitles?.length ? groupedSubtitles : subtitleSource === 'translated' ? translatedSubtitles : originalSubtitles || subtitles}
          subtitleSource={subtitleSource} isGenerating={isGenerating} setIsGenerating={setIsGenerating}
          generationResults={generationResults} setGenerationResults={setGenerationResults}
          downloadAllAudio={downloadAllAudio} downloadAlignedAudio={downloadAlignedAudio}
          currentAudio={currentAudio} isPlaying={isPlaying} playAudio={playAudio}
          useGroupedSubtitles={useGroupedSubtitles} audioRef={audioRef} handleAudioEnded={handleAudioEnded}>
          <SubtitleSourceSelection
            subtitleSource={subtitleSource}
            setSubtitleSource={setSubtitleSource}
            isGenerating={isGenerating}
            translatedSubtitles={translatedSubtitles}
            originalSubtitles={originalSubtitles || subtitles}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={useGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={groupedSubtitles}
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
          <SubtitleSourceSelection
            subtitleSource={subtitleSource}
            setSubtitleSource={setSubtitleSource}
            isGenerating={isGenerating}
            translatedSubtitles={translatedSubtitles}
            originalSubtitles={originalSubtitles || subtitles}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={useGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={groupedSubtitles}
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
          />

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
            generationResults={generationResults}
            downloadAllAudio={downloadAllAudio}
            downloadAlignedAudio={downloadAlignedAudio}
            cancelGeneration={cancelGeneration}
            subtitleSource={subtitleSource}
            isServiceAvailable={isAvailable}
            requiresReferenceAudio={vieneuVoiceMode === 'reference'}
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
            generationResults={generationResults}
            playAudio={playAudio}
            currentAudio={currentAudio}
            isPlaying={isPlaying}
            getAudioUrl={getAudioUrl}
            onRetry={retryF5TTSNarration}
            retryingSubtitleId={retryingSubtitleId}
            onRetryFailed={retryFailedNarrations}
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
            language={subtitleSource === 'translated' ? translatedLanguage : originalLanguage}
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
          <SubtitleSourceSelection
            subtitleSource={subtitleSource}
            setSubtitleSource={setSubtitleSource}
            isGenerating={isGenerating}
            translatedSubtitles={translatedSubtitles}
            originalSubtitles={originalSubtitles || subtitles}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={useGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={groupedSubtitles}
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
            subtitleSource={subtitleSource}
            cancelGeneration={cancelChatterboxGeneration}
            downloadAllAudio={downloadAllAudio}
            downloadAlignedAudio={downloadAlignedAudio}
            generationResults={generationResults}
            isServiceAvailable={isChatterboxAvailable}
            requiresReferenceAudio={omnivoiceMode === 'reference'}
            serviceUnavailableMessage={t('narration.chatterboxUnavailableMessage', 'Chatterbox API is not available. Please start the Chatterbox service.')}
          />

          {/* Generation Status */}
          <StatusMessage
            message={(isGenerating || retryingSubtitleId) ? generationStatus : ''}
            type="info"
            statusRef={statusRef}
            showProgress={isGenerating && generationStatus && generationStatus.includes('Generating')}
            isGenerating={isGenerating}
          />

          {/* Chatterbox Results - reuse F5-TTS results component */}
          <NarrationResults
            generationResults={generationResults}
            onRetry={retryChatterboxNarration}
            retryingSubtitleId={retryingSubtitleId}
            onRetryFailed={retryFailedChatterboxNarrations}
            hasGenerationError={!!error && error.includes('Chatterbox')}
            currentAudio={currentAudio}
            isPlaying={isPlaying}
            playAudio={playAudio}
            getAudioUrl={getAudioUrl}
            subtitleSource={subtitleSource}
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
            subtitleSource={subtitleSource}
            setSubtitleSource={setSubtitleSource}
            isGenerating={isGenerating}
            translatedSubtitles={translatedSubtitles}
            originalSubtitles={originalSubtitles || subtitles}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={useGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={groupedSubtitles}
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
            detectedLanguage={subtitleSource === 'original' ? originalLanguage : translatedLanguage}
          />

          {/* Generate Button */}
          <GenerateButton
            handleGenerateNarration={handleEdgeTTSNarration}
            isGenerating={isGenerating}
            referenceAudio={null}
            subtitleSource={subtitleSource}
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
            subtitleSource={subtitleSource}
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
            subtitleSource={subtitleSource}
            setSubtitleSource={setSubtitleSource}
            isGenerating={isGenerating}
            translatedSubtitles={translatedSubtitles}
            originalSubtitles={originalSubtitles || subtitles}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={useGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={groupedSubtitles}
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
            detectedLanguage={subtitleSource === 'original' ? originalLanguage : translatedLanguage}
          />

          {/* Generate Button */}
          <GenerateButton
            handleGenerateNarration={handleGTTSNarration}
            isGenerating={isGenerating}
            referenceAudio={null}
            subtitleSource={subtitleSource}
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
            subtitleSource={subtitleSource}
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
            subtitleSource={subtitleSource}
            setSubtitleSource={setSubtitleSource}
            isGenerating={isGenerating}
            translatedSubtitles={translatedSubtitles}
            originalSubtitles={originalSubtitles || subtitles}
            originalLanguage={originalLanguage}
            translatedLanguage={translatedLanguage}
            setOriginalLanguage={setOriginalLanguage}
            setTranslatedLanguage={setTranslatedLanguage}
            useGroupedSubtitles={useGroupedSubtitles}
            setUseGroupedSubtitles={setUseGroupedSubtitles}
            isGroupingSubtitles={isGroupingSubtitles}
            groupedSubtitles={groupedSubtitles}
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
            subtitleSource={subtitleSource}
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
            subtitleSource={subtitleSource}
          />

          {/* No need for a separate audio element here as it's included in the GeminiNarrationResults component */}
        </div>
      )}
      </div>
    </div>
  );
};

export default UnifiedNarrationSection;
