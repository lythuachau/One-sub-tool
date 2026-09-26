import React from 'react';
import { useTranslation } from 'react-i18next';
import '../../../styles/narration/narrationMethodSelectionMaterial.css';
import { NARRATION_METHODS } from '../narrationMethods';

/**
 * Component for selecting the narration engine (VieNeu-TTS or OmniVoice)
 * @param {Object} props - Component props
 * @param {string} props.narrationMethod - Current narration method
 * @param {Function} props.setNarrationMethod - Function to set narration method
 * @param {boolean} props.isGenerating - Whether generation is in progress
 * @param {boolean} props.isF5Available - Whether VieNeu-TTS is available
 * @param {boolean} props.isChatterboxAvailable - Whether OmniVoice is available
 * @returns {JSX.Element} - Rendered component
 */
const NarrationMethodSelection = ({
  narrationMethod,
  setNarrationMethod,
  isGenerating,
  isF5Available = true,
  isChatterboxAvailable = true,
  vieneuStatus = 'unknown',
  omnivoiceStatus = 'unknown',
  isVibiAvailable = true,
}) => {
  const { t } = useTranslation();

  const getStatusDescription = (status, engine) => {
    if (status === 'loading' || status === 'starting') return '(Đang nạp model...)';
    if (status === 'error') return '(Lỗi khởi tạo model)';
    if (status === 'unknown') return '(Đang kiểm tra...)';
    return engine === 'vieneu'
      ? '(Không khả dụng - khởi động dịch vụ thuyết minh)'
      : '(Không khả dụng - khởi động dịch vụ thuyết minh)';
  };

  const handleMethodChange = (method) => {
    if (!isGenerating) {
      setNarrationMethod(method);
      // Save to localStorage for persistence
      localStorage.setItem('narration_method', method);
    }
  };

  return (
    <div className="narration-row narration-method-row">
      <div className="row-label">
        <label>{t('narration.narrationMethod', 'Narration Method')}:</label>
      </div>
      <div className="row-content">
        <div className="narration-method-selection">
          <div className="radio-pill-group">
            <div className="radio-pill">
              <input
                type="radio"
                id="method-vieneu"
                name="narration-method"
                value={NARRATION_METHODS.VIENEU}
                checked={narrationMethod === NARRATION_METHODS.VIENEU}
                onChange={() => handleMethodChange(NARRATION_METHODS.VIENEU)}
                disabled={isGenerating || !isF5Available}
              />
              <label htmlFor="method-vieneu" className={!isF5Available ? 'unavailable' : ''}>
                {t('narration.f5ttsMethod', 'VieNeu-TTS')}
                {!isF5Available && (
                  <span className="method-description">
                    {getStatusDescription(vieneuStatus, 'vieneu')}
                  </span>
                )}
                {isF5Available && vieneuStatus !== 'ready' && (
                  <span className="method-description">{getStatusDescription(vieneuStatus, 'vieneu')}</span>
                )}
              </label>
            </div>
            <div className="radio-pill">
              <input
                type="radio"
                id="method-omnivoice"
                name="narration-method"
                value={NARRATION_METHODS.OMNIVOICE}
                checked={narrationMethod === NARRATION_METHODS.OMNIVOICE}
                onChange={() => handleMethodChange(NARRATION_METHODS.OMNIVOICE)}
                disabled={isGenerating || !isChatterboxAvailable}
              />
              <label htmlFor="method-omnivoice" className={!isChatterboxAvailable ? 'unavailable' : ''}>
                {t('narration.chatterboxMethod', 'OmniVoice')}
                {!isChatterboxAvailable && (
                  <span className="method-description">
                    {getStatusDescription(omnivoiceStatus, 'omnivoice')}
                  </span>
                )}
                {isChatterboxAvailable && omnivoiceStatus !== 'ready' && (
                  <span className="method-description">{getStatusDescription(omnivoiceStatus, 'omnivoice')}</span>
                )}
              </label>
            </div>
            <div className="radio-pill">
              <input type="radio" id="method-capcut" name="narration-method" value="capcut"
                checked={narrationMethod === 'capcut'} onChange={() => handleMethodChange('capcut')} disabled={isGenerating} />
              <label htmlFor="method-capcut">CapCut TTS</label>
            </div>
            <div className="radio-pill">
              <input type="radio" id="method-vibi" name="narration-method" value="vibi"
                checked={narrationMethod === 'vibi'} onChange={() => handleMethodChange('vibi')} disabled={isGenerating || !isVibiAvailable} />
              <label htmlFor="method-vibi" className={!isVibiAvailable ? 'unavailable' : ''}>
                Vibi ElevenLabs
                {!isVibiAvailable && <span className="method-description">(Thêm Vibi API key trong Cài đặt)</span>}
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NarrationMethodSelection;
