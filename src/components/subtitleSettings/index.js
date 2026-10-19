import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import '../../styles/SubtitleSettings.css';
import '../../styles/narration/narrationPlaybackMenuRedesign.css';
import '../../styles/narration/alignedNarration.css';
import { SERVER_URL } from '../../config';
import useSubtitleSettings from './hooks/useSubtitleSettings';
import useNarration from './hooks/useNarration';
import NarrationMenu from './components/NarrationMenu';
import SubtitleSettingsPanel from './components/SubtitleSettingsPanel';

/**
 * SubtitleSettings component
 *
 * @param {Object} props - Component props
 * @param {Object} props.settings - Current subtitle settings
 * @param {Function} props.onSettingsChange - Function to handle settings changes
 * @param {boolean} props.hasTranslation - Whether translation is available
 * @param {string} props.targetLanguage - Target language for translation
 * @param {Object} props.videoRef - Reference to the video element
 * @param {Array} props.originalNarrations - Original narration audio files
 * @param {Array} props.translatedNarrations - Translated narration audio files
 * @returns {JSX.Element} - Rendered component
 */
const SubtitleSettings = ({
  settings,
  onSettingsChange,
  hasTranslation,
  targetLanguage,
  videoRef,
  originalNarrations = [],
  translatedNarrations = [],
  onRenderVideo
}) => {
  const { t } = useTranslation();

  // Use custom hooks for subtitle settings and narration
  const {
    isOpen,
    setIsOpen,
    subtitleLanguage,
    setSubtitleLanguage,
    handleSettingChange,
    handleSubtitleLanguageChange,
    resetToDefaults
  } = useSubtitleSettings(settings, onSettingsChange);

  const {
    showNarrationMenu,
    setShowNarrationMenu,
    narrationSource,
    setNarrationSource,
    narrationVolume,
    setNarrationVolume,
    videoVolume,
    setVideoVolume,
    currentNarration, // Kept for NarrationMenu props
    hasOriginalNarrations,
    hasTranslatedNarrations,
    hasAnyNarrations,
    // Only aligned narration props we need
    isGeneratingAligned,
    alignedStatus
  } = useNarration(videoRef, originalNarrations, translatedNarrations, SERVER_URL);

  // Update subtitle language when translation becomes available
  useEffect(() => {
    if (hasTranslation && settings.showTranslatedSubtitles && subtitleLanguage !== 'translated') {
      setSubtitleLanguage('translated');
      localStorage.setItem('subtitle_language', 'translated');
    }
  }, [hasTranslation, settings.showTranslatedSubtitles, subtitleLanguage, setSubtitleLanguage]);

  // No need for individual narration playback code anymore
  // Aligned narration is handled by the useAlignedNarration hook

  return (
    <div className="subtitle-settings-container">
      <div className="action-buttons">
        {/* Subtitle Settings Toggle Button */}
        <button
          className={`action-button subtitle-settings-toggle md-filled-tonal-button ${isOpen ? 'active' : ''}`}
          onClick={() => {
            const newIsOpen = !isOpen;
            setIsOpen(newIsOpen);
            // Close narration menu if it's open
            if (showNarrationMenu) {

              setShowNarrationMenu(false);
            }

          }}
          title={t('subtitleSettings.settingsTooltip', 'Customize subtitle appearance')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          <span>{t('subtitleSettings.toggleSettings', 'Subtitle Settings')}</span>
        </button>

        {/* Narration Menu */}
        <NarrationMenu
          showNarrationMenu={showNarrationMenu}
          setShowNarrationMenu={setShowNarrationMenu}
          narrationSource={narrationSource}
          setNarrationSource={setNarrationSource}
          narrationVolume={narrationVolume}
          setNarrationVolume={setNarrationVolume}
          videoVolume={videoVolume}
          setVideoVolume={setVideoVolume}
          currentNarration={currentNarration}
          hasOriginalNarrations={hasOriginalNarrations}
          hasTranslatedNarrations={hasTranslatedNarrations}
          hasAnyNarrations={hasAnyNarrations}
          isGeneratingAligned={isGeneratingAligned}
          alignedStatus={alignedStatus}
          isSubtitleSettingsOpen={isOpen}
          setIsSubtitleSettingsOpen={setIsOpen}
        />

        {/* Render Video Button */}
        <button
          className="action-button render-video-toggle md-filled-tonal-button"
          onClick={() => {
            // Close any open panels
            if (isOpen) setIsOpen(false);
            if (showNarrationMenu) setShowNarrationMenu(false);
            // Trigger render video action
            if (onRenderVideo) onRenderVideo();
          }}
          title={t('videoRendering.renderTooltip', 'Render video with subtitles and narration')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
          <span>{t('videoRendering.renderVideo', 'Render Video')}</span>
        </button>
      </div>

      {/* Subtitle Settings Panel */}
      <SubtitleSettingsPanel
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        settings={settings}
        handleSettingChange={handleSettingChange}
        subtitleLanguage={subtitleLanguage}
        handleSubtitleLanguageChange={handleSubtitleLanguageChange}
        hasTranslation={hasTranslation}
        targetLanguage={targetLanguage}
        resetToDefaults={resetToDefaults}
      />
    </div>
  );
};

export default SubtitleSettings;
