import React from 'react';
import { useTranslation } from 'react-i18next';

const TtsSubtitleEditor = ({
  source,
  subtitles,
  disabled = false,
  onTextChange,
  onReset
}) => {
  const { t } = useTranslation();

  if (!subtitles || subtitles.length === 0) {
    return null;
  }

  return (
    <section className="tts-subtitle-editor" aria-label={t('narration.ttsEditor.title', 'TTS subtitle editor')}>
      <div className="tts-subtitle-editor-header">
        <div>
          <h4>{t('narration.ttsEditor.title', 'Chỉnh nội dung đọc TTS')}</h4>
          <p>{t('narration.ttsEditor.description', 'Nhấn Enter tại vị trí muốn ngắt. Phụ đề và timestamp gốc được giữ nguyên; chỉ audio TTS được tạo lại theo từng đoạn.')}</p>
        </div>
        <button
          type="button"
          className="tts-subtitle-editor-reset"
          onClick={onReset}
          disabled={disabled}
        >
          {t('narration.ttsEditor.reset', 'Khôi phục')}
        </button>
      </div>

      <div className="tts-subtitle-editor-list">
        {subtitles.map((subtitle, index) => {
          const id = subtitle.id ?? subtitle.subtitle_id ?? index + 1;
          return (
            <label className="tts-subtitle-editor-row" key={`${source}-${id}`}>
              <span className="tts-subtitle-editor-meta">
                <strong>#{id}</strong>
                <span>{Number(subtitle.start ?? subtitle.start_time ?? 0).toFixed(2)}s – {Number(subtitle.end ?? subtitle.end_time ?? 0).toFixed(2)}s</span>
              </span>
              <textarea
                value={subtitle.text || ''}
                onChange={(event) => onTextChange(id, event.target.value)}
                disabled={disabled}
                rows={Math.min(4, Math.max(1, (subtitle.text || '').split('\n').length))}
                spellCheck="false"
                aria-label={t('narration.ttsEditor.lineLabel', 'TTS text {{id}}', { id })}
              />
            </label>
          );
        })}
      </div>
    </section>
  );
};

export default TtsSubtitleEditor;
