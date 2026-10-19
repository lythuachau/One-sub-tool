import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultSettings } from '../subtitleSettings/constants';
import SubtitleSettingsPanel from '../subtitleSettings/components/SubtitleSettingsPanel';
import CloseButton from '../common/CloseButton';
import useSubtitleSettings from '../subtitleSettings/hooks/useSubtitleSettings';
import { adaptiveUrl, requestAdaptiveBuild } from '../../services/adaptiveSyncService';
import '../../styles/SubtitleSettings.css';
import '../../styles/VideoPreview.css';
import '../../styles/narration/narrationPlaybackMenuRedesign.css';

const readSubtitleSettings = () => {
  try {
    const savedSettings = localStorage.getItem('subtitle_settings');
    return savedSettings ? { ...defaultSettings, ...JSON.parse(savedSettings) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
};

const AdaptiveSyncPreview = ({ plan, onRenderVideo }) => {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const voiceRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activePanel, setActivePanel] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [subtitleSettings, setSubtitleSettings] = useState(readSubtitleSettings);
  const [originalVolume, setOriginalVolume] = useState(plan.options?.originalVolume ?? 0.15);
  const [voiceVolume, setVoiceVolume] = useState(plan.options?.voiceVolume ?? 1);
  const hasSeparateAudioTracks = Boolean(plan.assets.video && plan.assets.voice);
  const hasTranslation = Boolean(plan.assets.subtitles?.translated?.vtt);
  const targetLanguage = plan.mappedSubtitles?.translated?.[0]?.language;

  const {
    isOpen: isSubtitlePanelOpen,
    setIsOpen: setIsSubtitlePanelOpen,
    subtitleLanguage,
    handleSettingChange,
    handleSubtitleLanguageChange,
    resetToDefaults
  } = useSubtitleSettings(subtitleSettings, setSubtitleSettings);

  const toggleNarrationPanel = () => {
    setIsSubtitlePanelOpen(false);
    setActivePanel(current => current === 'narration' ? null : 'narration');
  };

  const refreshNarration = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError('');
    try {
      await requestAdaptiveBuild();
    } catch (refreshError) {
      setError(refreshError.message || 'Làm mới thuyết minh thất bại.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setOriginalVolume(plan.options?.originalVolume ?? 0.15);
    setVoiceVolume(plan.options?.voiceVolume ?? 1);
  }, [plan.id, plan.options?.originalVolume, plan.options?.voiceVolume]);

  useEffect(() => {
    const video = videoRef.current;
    const voice = voiceRef.current;
    if (!video || !voice || !hasSeparateAudioTracks) return undefined;

    const syncVoice = force => {
      if (!Number.isFinite(voice.duration) || voice.duration <= 0) return;
      const targetTime = Math.min(video.currentTime, Math.max(0, voice.duration - 0.01));
      if (force || Math.abs(voice.currentTime - targetTime) > 0.2) voice.currentTime = targetTime;
      voice.playbackRate = video.playbackRate;
    };
    const playVoice = () => {
      syncVoice(true);
      voice.play().catch(playError => setError(playError.message || 'Không phát được audio thuyết minh trong preview.'));
    };
    const pauseVoice = () => {
      syncVoice(true);
      voice.pause();
    };
    const onLoadedMetadata = () => {
      syncVoice(true);
      if (!video.paused) voice.play().catch(playError => setError(playError.message || 'Không phát được audio thuyết minh trong preview.'));
    };
    const onTimeUpdate = () => syncVoice(false);
    const onRateChange = () => { voice.playbackRate = video.playbackRate; };
    const onSeeking = () => syncVoice(true);
    const onSeeked = () => {
      syncVoice(true);
      if (!video.paused) voice.play().catch(playError => setError(playError.message || 'Không phát được audio thuyết minh trong preview.'));
    };

    video.addEventListener('play', playVoice);
    video.addEventListener('pause', pauseVoice);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ratechange', onRateChange);
    voice.addEventListener('loadedmetadata', onLoadedMetadata);
    voice.playbackRate = video.playbackRate;

    return () => {
      video.removeEventListener('play', playVoice);
      video.removeEventListener('pause', pauseVoice);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ratechange', onRateChange);
      voice.removeEventListener('loadedmetadata', onLoadedMetadata);
      voice.pause();
    };
  }, [plan.id, hasSeparateAudioTracks]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = originalVolume;
    if (voiceRef.current) voiceRef.current.volume = voiceVolume;
  }, [plan.id, originalVolume, voiceVolume]);

  const previewVideo = hasSeparateAudioTracks ? plan.assets.video : plan.assets.preview;
  const activeSubtitleSource = subtitleLanguage === 'translated' && hasTranslation ? 'translated' : 'original';
  const activeSubtitle = (plan.mappedSubtitles?.[activeSubtitleSource] || []).find(item => {
    const start = Number(item.start ?? item.startTime);
    const end = Number(item.end ?? item.endTime);
    return Number.isFinite(start) && Number.isFinite(end) && currentTime >= start && currentTime < end;
  });
  const subtitleBackground = /^#[0-9a-f]{6}$/i.test(subtitleSettings.backgroundColor || '')
    ? subtitleSettings.backgroundColor : '#000000';
  const subtitleRgb = [1, 3, 5].map(index => parseInt(subtitleBackground.slice(index, index + 2), 16)).join(', ');
  const subtitleOpacity = Math.max(0, Math.min(1, Number(subtitleSettings.opacity) || 0));
  const subtitlePosition = Math.max(0, Math.min(100, Number(subtitleSettings.position) || 90));
  const subtitleWidth = Math.max(10, Math.min(100, Number(subtitleSettings.boxWidth) || 80));
  const subtitleFontSize = Math.max(8, Math.min(96, Number(subtitleSettings.fontSize) || 24));
  const subtitlePadding = Math.max(0, Math.min(48, Number(subtitleSettings.backgroundPadding) || 0));
  const subtitleRadius = Math.max(0, Math.min(48, Number(subtitleSettings.backgroundRadius) || 0));
  const subtitleTextAlign = ['left', 'center', 'right'].includes(subtitleSettings.textAlign) ? subtitleSettings.textAlign : 'center';
  const subtitleTextTransform = ['none', 'uppercase', 'lowercase', 'capitalize'].includes(subtitleSettings.textTransform)
    ? subtitleSettings.textTransform : 'none';

  return <div className="preview-section adaptive-sync-preview">
    <div className="video-preview-header">
      <h3>{t('output.videoPreview', 'Xem trước video với phụ đề')}</h3>
      <div className="action-buttons">
        <button
          className={`action-button subtitle-settings-toggle md-filled-tonal-button ${isSubtitlePanelOpen ? 'active' : ''}`}
          type="button"
          aria-expanded={isSubtitlePanelOpen}
          onClick={() => {
            setActivePanel(null);
            setIsSubtitlePanelOpen(open => !open);
          }}
          title={t('subtitleSettings.settingsTooltip', 'Tùy chỉnh phụ đề')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>{t('subtitleSettings.toggleSettings', 'Cài đặt phụ đề')}</span>
        </button>
        <button
          className={`action-button narration-settings-toggle md-filled-tonal-button ${activePanel === 'narration' ? 'active' : ''}`}
          type="button"
          aria-expanded={activePanel === 'narration'}
          onClick={toggleNarrationPanel}
          title={t('narration.settingsTooltip', 'Cài đặt thuyết minh')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
          <span>{t('narration.toggleSettings', 'Cài đặt thuyết minh')}</span>
        </button>
        <button
          className="action-button render-video-toggle md-filled-tonal-button"
          type="button"
          onClick={onRenderVideo}
          title={t('videoRendering.renderTooltip', 'Render video với phụ đề và thuyết minh')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <span>{t('videoRendering.renderVideo', 'Render Video')}</span>
        </button>

        <SubtitleSettingsPanel
          isOpen={isSubtitlePanelOpen}
          setIsOpen={setIsSubtitlePanelOpen}
          settings={subtitleSettings}
          handleSettingChange={handleSettingChange}
          subtitleLanguage={subtitleLanguage}
          handleSubtitleLanguageChange={handleSubtitleLanguageChange}
          hasTranslation={hasTranslation}
          targetLanguage={targetLanguage}
          resetToDefaults={resetToDefaults}
        />
        {activePanel === 'narration' && (
          <div className="subtitle-settings-panel narration-panel adaptive-narration-panel" role="dialog" aria-label={t('narration.settings', 'Cài đặt thuyết minh')}>
            <div className="settings-header">
              <h4>{t('narration.playbackTitle', 'Thuyết minh')}</h4>
              <div className="settings-header-actions">
                <CloseButton onClick={() => setActivePanel(null)} variant="default" size="small" />
              </div>
            </div>
            <div className="settings-content">
              <div className="setting-group">
                <label htmlFor="adaptive-preview-original-volume">{t('narration.videoVolume', 'Âm thanh gốc')}</label>
                <div className="slider-with-value">
                  <input
                    id="adaptive-preview-original-volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={originalVolume}
                    onChange={event => setOriginalVolume(Number(event.target.value))}
                  />
                  <span>{Math.round(originalVolume * 100)}%</span>
                </div>
              </div>
              {hasSeparateAudioTracks && (
                <div className="setting-group">
                  <label htmlFor="adaptive-preview-voice-volume">{t('narration.narrationVolume', 'Âm lượng thuyết minh')}</label>
                  <div className="slider-with-value">
                    <input
                      id="adaptive-preview-voice-volume"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={voiceVolume}
                      onChange={event => setVoiceVolume(Number(event.target.value))}
                    />
                    <span>{Math.round(voiceVolume * 100)}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>

    <div className="adaptive-sync-video-wrapper" style={{ position: 'relative', width: '100%' }}>
      <video
        ref={videoRef}
        key={plan.id}
        className="adaptive-sync-video"
        controls
        preload="metadata"
        crossOrigin="anonymous"
        style={{ width: '100%', maxHeight: 640, display: 'block' }}
        src={adaptiveUrl(previewVideo)}
        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
        onSeeked={event => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={event => setCurrentTime(event.currentTarget.currentTime)}
      />
      {activeSubtitle && (
        <div
          className="custom-subtitle-container adaptive-custom-subtitle-container"
          style={{
            width: `${subtitleWidth}%`,
            bottom: `calc(100% - ${subtitlePosition}%)`,
            transform: 'translateY(50%)'
          }}
        >
          <div
            className="custom-subtitle"
            style={{
              backgroundColor: `rgba(${subtitleRgb}, ${subtitleOpacity})`,
              color: subtitleSettings.textColor || '#ffffff',
              fontFamily: subtitleSettings.fontFamily || 'Arial, sans-serif',
              fontSize: `${subtitleFontSize}px`,
              fontWeight: subtitleSettings.fontWeight || '400',
              lineHeight: subtitleSettings.lineSpacing || '1.4',
              textAlign: subtitleTextAlign,
              textTransform: subtitleTextTransform,
              letterSpacing: `${Number(subtitleSettings.letterSpacing) || 0}px`,
              padding: `${subtitlePadding}px`,
              borderRadius: `${subtitleRadius}px`,
              textShadow: subtitleSettings.textShadow ? '1px 1px 2px rgba(0, 0, 0, 0.8)' : 'none',
              whiteSpace: 'pre-line'
            }}
          >
            {activeSubtitle.text}
          </div>
        </div>
      )}
    </div>
    {hasSeparateAudioTracks && <audio ref={voiceRef} preload="auto" src={adaptiveUrl(plan.assets.voice)} />}
    <div className="adaptive-preview-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
      <button className="pill-button secondary" type="button" disabled={refreshing} onClick={refreshNarration}>
        {refreshing ? 'Đang làm mới thuyết minh…' : 'Làm mới thuyết minh'}
      </button>
    </div>
    {error && <p role="alert" className="adaptive-preview-error" style={{ color: 'var(--md-error, #ffb4ab)' }}>{error}</p>}
  </div>;
};

export default AdaptiveSyncPreview;
