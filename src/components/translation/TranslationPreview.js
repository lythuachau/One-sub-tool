import React from 'react';
import { useTranslation } from 'react-i18next';
import LyricsDisplay from '../LyricsDisplay';

const TranslationPreview = ({
  translatedSubtitles,
  targetLanguages,
  loadedFromCache,
  currentTime,
  duration,
  onLyricClick,
  onUpdateLyrics,
  onSaveSubtitles,
  videoTitle
}) => {
  const { t } = useTranslation();

  if (!translatedSubtitles || translatedSubtitles.length === 0) return null;

  const languageLabel = targetLanguages.length > 1
    ? ` (${targetLanguages.map(lang => lang.value).filter(value => value.trim() !== '').join(', ')})`
    : targetLanguages[0]?.value?.trim()
      ? ` (${targetLanguages[0].value})`
      : '';

  return (
    <div className="translation-row preview-row">
      <div className="row-label">
        <label>{t('translation.previewLabel', 'Bản dịch')}:</label>
      </div>
      <div className="row-content">
        <div className="translation-preview translation-preview-animated">
          <h4>
            {t('translation.preview', 'Translation Preview')}
            {languageLabel}
            {loadedFromCache && (
              <span className="cache-indicator" title={t('translation.fromCache', 'Loaded from cache')}>
                {' '}↧
              </span>
            )}
          </h4>
          <LyricsDisplay
            matchedLyrics={translatedSubtitles}
            currentTime={currentTime}
            onLyricClick={onLyricClick}
            onUpdateLyrics={onUpdateLyrics}
            onSaveSubtitles={(lyrics) => onSaveSubtitles?.(lyrics, 'translated')}
            allowEditing={true}
            duration={duration}
            timeFormat="seconds"
            videoSource={null}
            showWaveform={false}
            translatedSubtitles={null}
            persistToCache={false}
            videoTitle={videoTitle}
          />
        </div>
      </div>
    </div>
  );
};

export default TranslationPreview;
