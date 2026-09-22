import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getVieNeuVoices, previewVieNeuSpeech } from '../../../services/narrationService';
import VoicePreviewButton from './VoicePreviewButton';
import '../../../styles/narration/vieneuVoiceControls.css';

const VieNeuVoiceControls = ({
  mode,
  setMode,
  voice,
  setVoice,
  isGenerating,
  isAvailable,
  referenceAudio,
  referenceText,
  speechRate
}) => {
  const { t } = useTranslation();
  const [voices, setVoices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;

    const loadVoices = async () => {
      try {
        const data = await getVieNeuVoices();
        if (!active) return;

        const availableVoices = Array.isArray(data.voices) ? data.voices : [];
        setVoices(availableVoices);
        setVoice(currentVoice => {
          if (availableVoices.some(item => item.id === currentVoice)) return currentVoice;
          return data.default_voice || availableVoices[0]?.id || currentVoice;
        });
        setLoadError('');
      } catch (error) {
        if (active) {
          setLoadError(error.message || t('narration.vieneuVoiceLoadError', 'Không tải được danh sách giọng VieNeu.'));
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadVoices();
    return () => {
      active = false;
    };
  }, [setVoice, t]);

  return (
    <>
      <div className="narration-row vieneu-voice-mode-row">
        <div className="row-label">
          <label>{t('narration.voiceSource', 'Nguồn giọng')}:</label>
        </div>
        <div className="row-content">
          <div className="radio-pill-group">
            {[
              ['preset', t('narration.vieneuPresetVoice', 'Giọng có sẵn')],
              ['reference', t('narration.referenceAudioMode', 'Âm thanh tham chiếu')]
            ].map(([value, label]) => (
              <div className="radio-pill" key={value}>
                <input
                  type="radio"
                  id={`vieneu-voice-mode-${value}`}
                  name="vieneu-voice-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  disabled={isGenerating}
                />
                <label htmlFor={`vieneu-voice-mode-${value}`}>{label}</label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {mode === 'preset' && (
        <div className="narration-row vieneu-preset-row">
          <div className="row-label">
            <label htmlFor="vieneu-preset-voice">
              {t('narration.vieneuPresetVoiceLabel', 'Giọng VieNeu')}:
            </label>
          </div>
          <div className="row-content">
            <select
              id="vieneu-preset-voice"
              className="vieneu-voice-select"
              value={voice}
              onChange={(event) => setVoice(event.target.value)}
              disabled={isGenerating || isLoading || voices.length === 0}
            >
              {voices.map(item => (
                <option value={item.id} key={item.id}>
                  {item.name}{item.description ? ` — ${item.description}` : ''}
                </option>
              ))}
            </select>
            <div className="setting-description">
              {isLoading
                ? t('narration.vieneuVoiceLoading', 'Đang tải danh sách giọng từ VieNeu...')
                : loadError || t('narration.vieneuPresetDescription', 'Dùng giọng có sẵn của VieNeu, không cần âm thanh tham chiếu.')}
            </div>
          </div>
        </div>
      )}

      <div className="narration-row vieneu-preview-row">
        <div className="row-label" />
        <div className="row-content">
          <VoicePreviewButton
            disabled={isGenerating || !isAvailable || (mode === 'preset' && !voice) || (mode === 'reference' && !referenceAudio)}
            onPreview={() => previewVieNeuSpeech({
              text: t('narration.voicePreviewText', 'Xin chào, đây là bản nghe thử của giọng đọc hiện tại.'),
              voice: mode === 'preset' ? voice : undefined,
              referenceAudio: mode === 'reference' ? referenceAudio : null,
              referenceText: mode === 'reference' ? (referenceAudio?.text || referenceText) : '',
              speechRate
            })}
          />
        </div>
      </div>
    </>
  );
};

export default VieNeuVoiceControls;
