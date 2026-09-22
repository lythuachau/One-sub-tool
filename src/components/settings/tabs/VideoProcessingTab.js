import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import StandardSlider from '../../common/StandardSlider';
import { SegmentsIcon, VideoAnalysisIcon, OptimizationIcon, DisplayIcon } from '../icons/TabIcons';
import { FiCpu } from 'react-icons/fi';
import MaterialSwitch from '../../common/MaterialSwitch';
import '../../../styles/common/material-switch.css';
import { useGeminiModels } from '../../../hooks/useGeminiModels';
import { getGeminiModelLabel, resolveGeminiModel } from '../../../services/gemini/modelDiscovery';

const VideoProcessingTab = ({
  segmentDuration,
  setSegmentDuration,
  subtitleEngine,
  setSubtitleEngine,
  geminiModel,
  setGeminiModel,
  timeFormat,
  setTimeFormat,
  showWaveform,
  setShowWaveform,
  useVideoAnalysis,
  setUseVideoAnalysis,
  videoAnalysisModel,
  setVideoAnalysisModel,
  videoAnalysisTimeout,
  setVideoAnalysisTimeout,
  autoSelectDefaultPreset,
  setAutoSelectDefaultPreset,
  optimizeVideos,
  setOptimizeVideos,
  optimizedResolution,
  setOptimizedResolution,
  useOptimizedPreview,
  setUseOptimizedPreview,
  thinkingBudgets,
  setThinkingBudgets,
  useCookiesForDownload,
  setUseCookiesForDownload
}) => {
  const { t } = useTranslation();
  const { models, isLoading: modelsLoading } = useGeminiModels();

  useEffect(() => {
    if (models.length === 0) return;

    let active = true;
    Promise.all([
      resolveGeminiModel(geminiModel),
      resolveGeminiModel(videoAnalysisModel)
    ]).then(([resolvedGeminiModel, resolvedVideoAnalysisModel]) => {
      if (!active) return;
      setGeminiModel(resolvedGeminiModel);
      setVideoAnalysisModel(resolvedVideoAnalysisModel);
    });

    return () => {
      active = false;
    };
  }, [models, geminiModel, videoAnalysisModel, setGeminiModel, setVideoAnalysisModel]);

  const modelOptions = models.length > 0 ? models : [];
  const hasGeminiModelOption = modelOptions.some((model) => model.id === geminiModel);
  const hasVideoAnalysisModelOption = modelOptions.some((model) => model.id === videoAnalysisModel);

  // Helper function to get the dropdown mode for a thinking budget value
  const getThinkingMode = (budget) => {
    if (budget === -1) return 'dynamic';
    if (budget === 0) return 'disabled';
    return 'custom';
  };

  // Helper function to get the slider value for custom mode (map token count to 0-100)
  const getSliderValue = (budget, modelId) => {
    if (modelId === 'gemini-2.5-pro') {
      // Range: 128-32768 tokens
      return Math.round(((budget - 128) / (32768 - 128)) * 100);
    } else if (modelId === 'gemini-2.5-flash') {
      // Range: 1-24576 tokens for Flash (start from 1 to avoid conflict with disabled)
      return Math.round(((budget - 1) / (24576 - 1)) * 100);
    } else {
      // Range: 512-24576 tokens for Flash Lite
      return Math.round(((budget - 512) / (24576 - 512)) * 100);
    }
  };

  // Helper function to convert slider value back to token count
  const getTokensFromSlider = (sliderValue, modelId) => {
    if (modelId === 'gemini-2.5-pro') {
      // Range: 128-32768 tokens
      return Math.round(128 + (sliderValue / 100) * (32768 - 128));
    } else if (modelId === 'gemini-2.5-flash') {
      // Range: 1-24576 tokens for Flash (start from 1 to avoid conflict with disabled)
      return Math.round(1 + (sliderValue / 100) * (24576 - 1));
    } else {
      // Range: 512-24576 tokens for Flash Lite
      return Math.round(512 + (sliderValue / 100) * (24576 - 512));
    }
  };

  // Handle dropdown mode change
  const handleModeChange = (modelId, mode) => {
    let newBudget;
    if (mode === 'dynamic') {
      newBudget = -1;
    } else if (mode === 'disabled') {
      newBudget = 0;
    } else if (mode === 'custom') {
      // Set to a reasonable default for custom mode
      if (modelId === 'gemini-2.5-pro') {
        newBudget = 1024;
      } else if (modelId === 'gemini-2.5-flash') {
        newBudget = 1024; // Flash can start from 0, but 1024 is a good default
      } else {
        newBudget = 512; // Flash Lite minimum is 512
      }
    }

    setThinkingBudgets(prev => ({
      ...prev,
      [modelId]: newBudget
    }));
  };

  // Handle slider change for custom mode
  const handleSliderChange = (modelId, sliderValue) => {
    const tokens = getTokensFromSlider(sliderValue, modelId);
    setThinkingBudgets(prev => ({
      ...prev,
      [modelId]: tokens
    }));
  };

  return (
    <div className="settings-section video-processing-section">

      {/* Grid layout for settings cards */}
      <div className="video-processing-grid">
        {/* Combined Segments and AI Model Card */}
        <div className="settings-card combined-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <SegmentsIcon />
            </div>
            <h4>{t('settings.processingSettings', 'Processing Settings')}</h4>
          </div>
          <div className="settings-card-content">
            <div className="compact-setting">
              <label htmlFor="subtitle-engine">
                {t('settings.subtitleEngine', 'Subtitle engine')}
              </label>
              <p className="setting-description">
                {t('settings.subtitleEngineDescription', 'Choose Gemini with timestamp normalization or local Faster-Whisper transcription.')}
              </p>
              <select
                id="subtitle-engine"
                value={subtitleEngine}
                onChange={(e) => setSubtitleEngine(e.target.value)}
                className="enhanced-select"
              >
                <option value="gemini">{t('settings.subtitleEngineGemini', 'Gemini + normalized timestamps')}</option>
                <option value="whisper">{t('settings.subtitleEngineWhisper', 'Whisper (Faster-Whisper)')}</option>
              </select>
            </div>

            {/* Segment Duration Setting */}
            <div className="compact-setting">
              <label htmlFor="segment-duration">
                {t('settings.segmentDuration', 'Segment Duration (minutes)')}
              </label>
              <p className="setting-description">
                {t('settings.segmentDurationDescription', 'Choose how long each video segment should be when processing long videos. Shorter segments process faster but may be less accurate.')}
              </p>
              <div className="segment-duration-slider-container">
                <div className="slider-with-value">
                  <StandardSlider
                    value={segmentDuration}
                    onChange={(value) => setSegmentDuration(parseInt(value))}
                    min={1}
                    max={45}
                    step={1}
                    orientation="Horizontal"
                    size="XSmall"
                    state="Enabled"
                    showValueIndicator={false} // Using custom value display
                    showIcon={false}
                    showStops={false}
                    className="segment-duration-slider"
                    id="segment-duration"
                    ariaLabel={t('settings.segmentDuration', 'Segment Duration')}
                  />
                  <div className="slider-value-display">
                    {segmentDuration} {t('settings.minutes', 'minutes')}
                  </div>
                </div>
              </div>
            </div>

            {/* Gemini Model Setting */}
            <div className="compact-setting">
              <label htmlFor="gemini-model">
                {t('settings.geminiModel', 'Gemini Model')}
              </label>
              <p className="setting-description">
                {modelsLoading
                  ? t('settings.geminiModelLoading', 'Detecting models available for this API key...')
                  : t('settings.geminiModelDescription', 'Select the Gemini model to use for transcription. Different models offer trade-offs between accuracy and speed.')}
              </p>
              <select
                id="gemini-model"
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                className="enhanced-select"
                disabled={subtitleEngine === 'whisper'}
              >
                {!hasGeminiModelOption && geminiModel && (
                  <option value={geminiModel}>{geminiModel} ({t('settings.modelChecking', 'checking availability')})</option>
                )}
                {modelOptions.map((model) => (
                  <option value={model.id} key={model.id}>{getGeminiModelLabel(model)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>


        {/* Video Analysis Card */}
        <div className="settings-card analysis-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <VideoAnalysisIcon />
            </div>
            <h4>{t('settings.videoAnalysisSection', 'Video Analysis')}</h4>
          </div>
          <div className="settings-card-content">
            <div className="compact-setting">
              <div className="setting-header">
                <label htmlFor="use-video-analysis">
                  {t('settings.useVideoAnalysis', 'Detect Patterns + Context Memory/Rules')}
                </label>
                <div className="material-switch-container">
                  <MaterialSwitch
                    id="use-video-analysis"
                    checked={useVideoAnalysis}
                    onChange={(e) => setUseVideoAnalysis(e.target.checked)}
                    disabled={subtitleEngine === 'whisper'}
                    ariaLabel={t('settings.useVideoAnalysis', 'Detect Patterns + Context Memory/Rules')}
                    icons={true}
                  />
                </div>
              </div>
              <p className="setting-description">
                {t('settings.useVideoAnalysisDescription', 'Before splitting video, analyze the entire video with Gemini to identify the best prompt pattern and generate transcription rules. Turn off for faster processing.')}
              </p>
            </div>

            <div className="compact-setting">
              <label htmlFor="video-analysis-model">
                {t('settings.videoAnalysisModel', 'Analysis Model')}
              </label>
              <p className="setting-description">
                {modelsLoading
                  ? t('settings.geminiModelLoading', 'Detecting models available for this API key...')
                  : t('settings.videoAnalysisModel.simplified', 'Select an available Gemini model to use for video analysis. Lite models are faster but may be less accurate.')}
              </p>
              <select
                id="video-analysis-model"
                value={videoAnalysisModel}
                onChange={(e) => setVideoAnalysisModel(e.target.value)}
                className="enhanced-select"
                disabled={!useVideoAnalysis || subtitleEngine === 'whisper'}
              >
                {!hasVideoAnalysisModelOption && videoAnalysisModel && (
                  <option value={videoAnalysisModel}>{videoAnalysisModel} ({t('settings.modelChecking', 'checking availability')})</option>
                )}
                {modelOptions.map((model) => (
                  <option value={model.id} key={model.id}>{getGeminiModelLabel(model)}</option>
                ))}
              </select>
            </div>

            <div className="compact-setting">
              <label htmlFor="video-analysis-timeout">
                {t('settings.videoAnalysisTimeout', 'Analysis Timeout')}
              </label>
              <p className="setting-description">
                {t('settings.videoAnalysisTimeout.simplified', 'Maximum time to wait for video analysis results before proceeding with default settings.')}
              </p>
              <select
                id="video-analysis-timeout"
                value={videoAnalysisTimeout}
                onChange={(e) => setVideoAnalysisTimeout(e.target.value)}
                className="enhanced-select"
                disabled={!useVideoAnalysis || subtitleEngine === 'whisper'}
              >
                <option value="none">{t('settings.timeoutNone', 'No Timeout')}</option>
                <option value="10">{t('settings.timeout10Seconds', '10 Seconds')}</option>
                <option value="20">{t('settings.timeout20Seconds', '20 Seconds')}</option>
              </select>
            </div>

            <div className="compact-setting">
              <div className="setting-header">
                <label htmlFor="auto-select-default-preset">
                  {t('settings.autoSelectDefaultPreset', 'Auto-select default preset on timeout')}
                </label>
                <div className="material-switch-container">
                  <MaterialSwitch
                    id="auto-select-default-preset"
                    checked={autoSelectDefaultPreset}
                    onChange={(e) => setAutoSelectDefaultPreset(e.target.checked)}
                    disabled={!useVideoAnalysis || subtitleEngine === 'whisper'}
                    ariaLabel={t('settings.autoSelectDefaultPreset', 'Auto-select default preset on timeout')}
                    icons={true}
                  />
                </div>
              </div>
              <p className="setting-description">
                {t('settings.autoSelectDefaultPresetDescription', "If enabled, the 'Use My Default Preset' option will be automatically selected in the Video Analysis Results pop-up when the timer expires. Otherwise, the 'Use Recommended' preset will be selected.")}
              </p>
            </div>
          </div>
        </div>

        {/* Video Optimization Card */}
        <div className="settings-card optimization-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <OptimizationIcon />
            </div>
            <h4>{t('settings.videoOptimizationSection', 'Video Optimization')}</h4>
          </div>
          <div className="settings-card-content">
            {/* Video optimization is now always enabled - no toggle needed */}
            <div className="compact-setting">
              <p
                className="setting-description optimization-always-enabled"
                dangerouslySetInnerHTML={{
                  __html: t('settings.optimizeVideosAlwaysEnabled', 'Videos are automatically optimized for Gemini processing. This reduces file size and upload time while maintaining quality for AI analysis. Gemini processes videos at 1 FPS by default.')
                }}
              />
            </div>

            <div className="compact-setting">
              <label htmlFor="optimized-resolution">
                {t('settings.optimizedResolution', 'Optimized Resolution')}
              </label>
              <p className="setting-description">
                {t('settings.optimizedResolutionDescription', 'Select the resolution for Gemini processing. Higher resolutions don\'t improve AI accuracy significantly but increase file size and upload time. 360p is recommended for most content.')}
              </p>
              <select
                id="optimized-resolution"
                value={optimizedResolution}
                onChange={(e) => setOptimizedResolution(e.target.value)}
                className="enhanced-select"
              >
                <option value="240p">{t('settings.resolution240p', '240p (Fastest, smallest files)')}</option>
                <option value="360p">{t('settings.resolution360p', '360p (Recommended for Gemini)')}</option>
              </select>
            </div>

            <div className="compact-setting">
              <div className="setting-header">
                <label htmlFor="use-optimized-preview">
                  {t('settings.useOptimizedPreview', 'Use optimized video for preview')}
                </label>
                <div className="material-switch-container">
                  <MaterialSwitch
                    id="use-optimized-preview"
                    checked={useOptimizedPreview}
                    onChange={(e) => setUseOptimizedPreview(e.target.checked)}
                    ariaLabel={t('settings.useOptimizedPreview', 'Use optimized video for preview')}
                    icons={true}
                  />
                </div>
              </div>
              <p className="setting-description">
                {t('settings.useOptimizedPreviewDescription.simplified', 'Use the optimized video for preview instead of the original. Improves performance and reduces memory usage. The optimized video has the same quality that Gemini processes (1 FPS, optimized resolution).')}
              </p>
            </div>
          </div>
        </div>

        {/* Download Settings Card */}
        <div className="settings-card download-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7,10 12,15 17,10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </div>
            <h4>{t('settings.downloadSettings', 'Download Settings')}</h4>
          </div>
          <div className="settings-card-content">
            <div className="compact-setting">
              <div className="setting-header">
                <label htmlFor="use-cookies-download">
                  {t('settings.useCookiesForDownload', 'Use browser cookies for video downloads')}
                </label>
                <div className="material-switch-container">
                  <MaterialSwitch
                    id="use-cookies-download"
                    checked={useCookiesForDownload}
                    onChange={(e) => setUseCookiesForDownload(e.target.checked)}
                    ariaLabel={t('settings.useCookiesForDownload', 'Use browser cookies for video downloads')}
                    icons={true}
                  />
                </div>
              </div>
              <p className="setting-description">
                {t('settings.useCookiesForDownloadDescription', 'Enable browser cookie authentication to access higher quality videos and bypass login restrictions. Disabling this will make downloads faster but may limit available video qualities and cause failures on restricted content.')}
              </p>
            </div>
          </div>
        </div>

        {/* Display Settings Card */}
        <div className="settings-card display-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <DisplayIcon />
            </div>
            <h4>{t('settings.displaySettings', 'Display Settings')}</h4>
          </div>
          <div className="settings-card-content">
            <div className="compact-setting">
              <label htmlFor="time-format">
                {t('settings.timeFormat', 'Time Format')}
              </label>
              <p className="setting-description">
                {t('settings.timeFormatDescription', 'Choose how time is displayed in the timeline and lyrics.')}
              </p>
              <select
                id="time-format"
                value={timeFormat}
                onChange={(e) => setTimeFormat(e.target.value)}
                className="enhanced-select"
              >
                <option value="seconds">{t('settings.timeFormatSeconds', 'Seconds (e.g., 75.40s)')}</option>
                <option value="hms">{t('settings.timeFormatHMS', 'HH:MM:SS (e.g., 1:15.40)')}</option>
              </select>
            </div>

            <div className="compact-setting">
              <div className="setting-header">
                <label htmlFor="show-waveform">
                  {t('settings.showWaveform', 'Show Audio Waveform')}
                </label>
                <div className="material-switch-container">
                  <MaterialSwitch
                    id="show-waveform"
                    checked={showWaveform}
                    onChange={(e) => setShowWaveform(e.target.checked)}
                    ariaLabel={t('settings.showWaveform', 'Show Audio Waveform')}
                    icons={true}
                  />
                </div>
              </div>
              <p className="setting-description">
                {t('settings.showWaveformDescription', 'Display audio waveform visualization in the timeline. This helps identify silent parts and speech patterns.')}
              </p>
            </div>
          </div>
        </div>

        {/* Thinking Budget Card */}
        <div className="settings-card thinking-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <FiCpu />
            </div>
            <h4>{t('settings.thinkingBudgetSection', 'AI Thinking Budget')}</h4>
          </div>
          <div className="settings-card-content">
            <p className="setting-description">
              {t('settings.thinkingBudgetDescription', 'Configure how much thinking each AI model should use. Higher budgets allow more detailed reasoning but increase processing time and cost.')}
            </p>

            {/* Gemini 2.5 Pro */}
            <div className="compact-setting">
              <label htmlFor="thinking-mode-25-pro">
                {t('settings.thinkingBudget25Pro', 'Gemini 2.5 Pro Thinking Budget')}
              </label>
              <p className="setting-description">
                {t('settings.thinkingBudget25ProDesc', 'Cannot disable thinking. Choose dynamic or set custom token budget.')}
              </p>
              <select
                id="thinking-mode-25-pro"
                value={getThinkingMode(thinkingBudgets['gemini-2.5-pro'] || -1)}
                onChange={(e) => handleModeChange('gemini-2.5-pro', e.target.value)}
                className="enhanced-select"
              >
                <option value="dynamic">{t('settings.thinkingDynamic', 'Dynamic (Auto)')}</option>
                <option value="custom">{t('settings.thinkingCustom', 'Custom')}</option>
              </select>

              {getThinkingMode(thinkingBudgets['gemini-2.5-pro'] || -1) === 'custom' && (
                <div className="thinking-slider-container">
                  <div className="slider-with-value">
                    <StandardSlider
                      value={getSliderValue(thinkingBudgets['gemini-2.5-pro'], 'gemini-2.5-pro')}
                      onChange={(value) => handleSliderChange('gemini-2.5-pro', parseInt(value))}
                      min={0}
                      max={100}
                      step={1}
                      orientation="Horizontal"
                      size="XSmall"
                      state="Enabled"
                      showValueIndicator={false} // Using custom value display
                      showIcon={false}
                      showStops={false}
                      className="thinking-budget-slider"
                      id="thinking-budget-pro"
                      ariaLabel={t('settings.thinkingBudget', 'Thinking Budget')}
                    />
                    <div className="slider-value-display">
                      {thinkingBudgets['gemini-2.5-pro']} {t('settings.tokens', 'tokens')}
                    </div>
                  </div>
                  <div className="slider-range-info">
                    {t('settings.thinkingRange', 'Range')}: 128 - 32,768 {t('settings.tokens', 'tokens')}
                  </div>
                </div>
              )}
            </div>

            {/* Gemini 2.5 Flash */}
            <div className="compact-setting">
              <label htmlFor="thinking-mode-25-flash">
                {t('settings.thinkingBudget25Flash', 'Gemini 2.5 Flash Thinking Budget')}
              </label>
              <p className="setting-description">
                {t('settings.thinkingBudget25FlashDesc', 'Can be disabled for fastest response, dynamic for auto, or custom token budget.')}
              </p>
              <select
                id="thinking-mode-25-flash"
                value={getThinkingMode(thinkingBudgets['gemini-2.5-flash'] || -1)}
                onChange={(e) => handleModeChange('gemini-2.5-flash', e.target.value)}
                className="enhanced-select"
              >
                <option value="disabled">{t('settings.thinkingDisabled', 'Disabled')}</option>
                <option value="dynamic">{t('settings.thinkingDynamic', 'Dynamic (Auto)')}</option>
                <option value="custom">{t('settings.thinkingCustom', 'Custom')}</option>
              </select>

              {getThinkingMode(thinkingBudgets['gemini-2.5-flash'] || -1) === 'custom' && (
                <div className="thinking-slider-container">
                  <div className="slider-with-value">
                    <StandardSlider
                      value={getSliderValue(thinkingBudgets['gemini-2.5-flash'], 'gemini-2.5-flash')}
                      onChange={(value) => handleSliderChange('gemini-2.5-flash', parseInt(value))}
                      min={0}
                      max={100}
                      step={1}
                      orientation="Horizontal"
                      size="XSmall"
                      state="Enabled"
                      showValueIndicator={false} // Using custom value display
                      showIcon={false}
                      showStops={false}
                      className="thinking-budget-slider"
                      id="thinking-budget-flash"
                      ariaLabel={t('settings.thinkingBudget', 'Thinking Budget')}
                    />
                    <div className="slider-value-display">
                      {thinkingBudgets['gemini-2.5-flash']} {t('settings.tokens', 'tokens')}
                    </div>
                  </div>
                  <div className="slider-range-info">
                    {t('settings.thinkingRange', 'Range')}: 1 - 24,576 {t('settings.tokens', 'tokens')}
                  </div>
                </div>
              )}
            </div>

            {/* Gemini 2.5 Flash Lite */}
            <div className="compact-setting">
              <label htmlFor="thinking-mode-25-flash-lite">
                {t('settings.thinkingBudget25FlashLite', 'Gemini 2.5 Flash Lite Thinking Budget')}
              </label>
              <p className="setting-description">
                {t('settings.thinkingBudget25FlashLiteDesc', 'Disabled by default for fastest response. Choose dynamic or custom token budget.')}
              </p>
              <select
                id="thinking-mode-25-flash-lite"
                value={getThinkingMode(thinkingBudgets['gemini-2.5-flash-lite-preview-06-17'] || 0)}
                onChange={(e) => handleModeChange('gemini-2.5-flash-lite-preview-06-17', e.target.value)}
                className="enhanced-select"
              >
                <option value="disabled">{t('settings.thinkingDisabled', 'Disabled')} ({t('settings.default', 'Default')})</option>
                <option value="dynamic">{t('settings.thinkingDynamic', 'Dynamic (Auto)')}</option>
                <option value="custom">{t('settings.thinkingCustom', 'Custom')}</option>
              </select>

              {getThinkingMode(thinkingBudgets['gemini-2.5-flash-lite-preview-06-17'] || 0) === 'custom' && (
                <div className="thinking-slider-container">
                  <div className="slider-with-value">
                    <StandardSlider
                      value={getSliderValue(thinkingBudgets['gemini-2.5-flash-lite-preview-06-17'], 'gemini-2.5-flash-lite-preview-06-17')}
                      onChange={(value) => handleSliderChange('gemini-2.5-flash-lite-preview-06-17', parseInt(value))}
                      min={0}
                      max={100}
                      step={1}
                      orientation="Horizontal"
                      size="XSmall"
                      state="Enabled"
                      showValueIndicator={false} // Using custom value display
                      showIcon={false}
                      showStops={false}
                      className="thinking-budget-slider"
                      id="thinking-budget-lite"
                      ariaLabel={t('settings.thinkingBudget', 'Thinking Budget')}
                    />
                    <div className="slider-value-display">
                      {thinkingBudgets['gemini-2.5-flash-lite-preview-06-17']} {t('settings.tokens', 'tokens')}
                    </div>
                  </div>
                  <div className="slider-range-info">
                    {t('settings.thinkingRange', 'Range')}: 512 - 24,576 {t('settings.tokens', 'tokens')}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoProcessingTab;
