import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../../styles/narration/voicePreviewButton.css';

const VoicePreviewButton = ({ onPreview, disabled = false }) => {
  const { t } = useTranslation();
  const audioRef = useRef(null);
  const objectUrlRef = useRef(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const handlePreview = async () => {
    if (isPreviewing || disabled) return;

    setIsPreviewing(true);
    setError('');
    try {
      const audio = await onPreview();
      if (!(audio instanceof Blob) || audio.size === 0) {
        throw new Error(t('narration.voicePreviewEmpty', 'Không nhận được âm thanh nghe thử.'));
      }

      if (audioRef.current) audioRef.current.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);

      const nextUrl = URL.createObjectURL(audio);
      objectUrlRef.current = nextUrl;
      setAudioUrl(nextUrl);
      window.setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.load();
          audioRef.current.play().catch(() => {});
        }
      }, 0);
    } catch (previewError) {
      setError(previewError.message || t('narration.voicePreviewError', 'Không tạo được âm thanh nghe thử.'));
    } finally {
      setIsPreviewing(false);
    }
  };

  return (
    <div className="voice-preview-control">
      <button
        type="button"
        className="pill-button voice-preview-button"
        onClick={handlePreview}
        disabled={disabled || isPreviewing}
      >
        <span aria-hidden="true">{isPreviewing ? '⏳' : '▶'}</span>
        {isPreviewing
          ? t('narration.voicePreviewLoading', 'Đang tạo nghe thử...')
          : t('narration.voicePreview', 'Nghe thử giọng')}
      </button>
      {audioUrl && (
        <audio
          ref={audioRef}
          className="voice-preview-player"
          controls
          src={audioUrl}
          onError={() => setError(t('narration.voicePreviewError', 'Không phát được âm thanh nghe thử.'))}
        />
      )}
      {error && <div className="voice-preview-error" role="alert">{error}</div>}
    </div>
  );
};

export default VoicePreviewButton;
