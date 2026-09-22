import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Generate Button component
 * @param {Object} props - Component props
 * @param {Function} props.handleGenerateNarration - Function to handle narration generation
 * @param {boolean} props.isGenerating - Whether generation is in progress
 * @param {Object} props.referenceAudio - Reference audio object
 * @param {Array} props.generationResults - Generation results
 * @param {Function} props.downloadAllAudio - Function to download all audio
 * @param {Function} props.downloadAlignedAudio - Function to download aligned audio
 * @param {Function} props.cancelGeneration - Function to cancel narration generation
 * @param {string|null} props.subtitleSource - The selected subtitle source
 * @param {boolean} props.isServiceAvailable - Whether the narration service is available
 * @param {boolean} props.requiresReferenceAudio - Whether the selected mode needs reference audio
 * @param {string} props.serviceUnavailableMessage - Message to show when service is unavailable
 * @returns {JSX.Element} - Rendered component
 */
const GenerateButton = ({
  handleGenerateNarration,
  isGenerating,
  referenceAudio,
  generationResults,
  downloadAllAudio,
  downloadAlignedAudio,
  cancelGeneration,
  subtitleSource,
  isServiceAvailable = true,
  requiresReferenceAudio = true,
  serviceUnavailableMessage = ''
}) => {
  const { t } = useTranslation();
  const missingReferenceAudio = requiresReferenceAudio && !referenceAudio;

  return (
    <div className="narration-row generate-button-row">
      <div className="row-content generate-button-container">
        {/* Left side - Generate/Cancel button */}
        <div className="generate-button-left">
          {isGenerating ? (
            <button
              className="pill-button danger cancel-btn"
              onClick={cancelGeneration}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              {t('narration.cancel', 'Cancel Generation')}
            </button>
          ) : (
            <button
              className="pill-button primary"
              onClick={handleGenerateNarration}
              disabled={missingReferenceAudio || !subtitleSource || !isServiceAvailable}
              title={
                !isServiceAvailable ? serviceUnavailableMessage :
                !subtitleSource ? t('narration.noSourceSelectedError', 'Please select a subtitle source (Original or Translated)') :
                missingReferenceAudio ? t('narration.noReferenceAudioError', 'Please upload or record reference audio') : ''
              }
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 5.14v14l11-7-11-7z" />
              </svg>
              {t('narration.generate', 'Generate Narration')}
            </button>
          )}
        </div>

        {/* Right side - Download buttons */}
        <div className="generate-button-right">
          <div className="pill-button-group">
            <button
              className="pill-button secondary download-all-btn"
              onClick={downloadAllAudio}
              title={t('narration.downloadAllTooltip', 'Download all generated audio files')}
              disabled={!generationResults || generationResults.length === 0 || !generationResults.some(r => r.success && (r.audioData || r.filename))}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t('narration.downloadAll', 'Tải xuống tất cả')}
            </button>

            <button
              className="pill-button secondary"
              onClick={downloadAlignedAudio}
              title={t('narration.downloadAlignedTooltip', 'Tải xuống một tập tin thuyết minh đã sắp xếp')}
              disabled={!generationResults || generationResults.length === 0 || !generationResults.some(r => r.success && (r.audioData || r.filename))}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t('narration.downloadAligned', 'Tải xuống như đã sắp xếp trên timeline')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GenerateButton;
