import React, { useEffect, useMemo, useState } from 'react';
import { getOmniVoiceLanguages } from '../../../services/chatterboxService';

export const buildStandaloneNarrationSegments = (text) => String(text || '')
  .replace(/\r/g, '')
  .split(/\n\s*\n/)
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value, index) => ({
    id: index + 1,
    subtitle_id: index + 1,
    text: value,
    translated_text: value
  }));

const NarrationInputSource = ({ mode, setMode, text, setText, disabled, language, setLanguage, showLanguage }) => {
  const segments = buildStandaloneNarrationSegments(text);
  const wordCount = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const [languageOptions, setLanguageOptions] = useState([]);
  const [languageSearch, setLanguageSearch] = useState('');
  const [languagesLoading, setLanguagesLoading] = useState(false);
  const [languagesError, setLanguagesError] = useState('');

  useEffect(() => {
    if (!showLanguage) return undefined;

    const controller = new AbortController();
    setLanguagesLoading(true);
    setLanguagesError('');
    getOmniVoiceLanguages({ signal: controller.signal })
      .then(options => {
        if (!controller.signal.aborted) setLanguageOptions(options);
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setLanguageOptions([]);
          setLanguagesError(error.message || 'Không tải được danh sách ngôn ngữ OmniVoice.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLanguagesLoading(false);
      });

    return () => controller.abort();
  }, [showLanguage]);

  const filteredLanguages = useMemo(() => {
    const query = languageSearch.trim().toLocaleLowerCase();
    const matches = languageOptions.filter(option => (
      !query || `${option.name} ${option.code}`.toLocaleLowerCase().includes(query)
    ));
    const selected = languageOptions.find(option => option.code === language);
    if (selected && !matches.some(option => option.code === selected.code)) {
      return [selected, ...matches];
    }
    return matches;
  }, [languageOptions, languageSearch, language]);

  return (
    <section className="standalone-narration-source" aria-label="Nguồn nội dung thuyết minh">
      <div className="narration-row">
        <div className="row-label">
          <label>Nội dung thuyết minh:</label>
        </div>
        <div className="row-content">
          <div className="radio-pill-group">
            {[
              ['subtitles', 'Phụ đề video'],
              ['text', 'Văn bản riêng']
            ].map(([value, label]) => (
              <div className="radio-pill" key={value}>
                <input
                  type="radio"
                  id={`narration-input-${value}`}
                  name="narration-input-source"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  disabled={disabled}
                />
                <label htmlFor={`narration-input-${value}`}>{label}</label>
              </div>
            ))}
          </div>
        </div>
      </div>
      {mode === 'text' && (
        <>
          {showLanguage && (
            <div className="narration-row standalone-language-row">
              <div className="row-label">
                <label htmlFor="standalone-narration-language">Ngôn ngữ văn bản:</label>
              </div>
              <div className="row-content">
                <div className="standalone-language-picker">
                  <input
                    type="search"
                    className="standalone-language-search"
                    value={languageSearch}
                    onChange={event => setLanguageSearch(event.target.value)}
                    disabled={disabled || languagesLoading || Boolean(languagesError)}
                    placeholder="Tìm tên tiếng Anh hoặc mã, ví dụ Russian / ru"
                    aria-label="Tìm ngôn ngữ OmniVoice"
                  />
                  <select
                    id="standalone-narration-language"
                    className="pill-button secondary"
                    value={language}
                    onChange={event => setLanguage(event.target.value)}
                    disabled={disabled || languagesLoading || Boolean(languagesError) || !languageOptions.length}
                  >
                    <option value="">Không chỉ định ngôn ngữ</option>
                    {filteredLanguages.map(option => (
                      <option value={option.code} key={`${option.code}-${option.name}`}>
                        {option.name} ({option.code})
                      </option>
                    ))}
                  </select>
                </div>
                {languagesLoading && <span className="standalone-language-status">Đang tải danh sách ngôn ngữ OmniVoice…</span>}
                {languagesError && (
                  <span className="standalone-language-status error" role="status">
                    Không tải được danh sách ngôn ngữ: {languagesError}
                  </span>
                )}
                {!languagesLoading && !languagesError && languageOptions.length > 0 && (
                  <span className="standalone-language-status">
                    {languageOptions.length} ngôn ngữ · {filteredLanguages.length} kết quả phù hợp
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="narration-row standalone-text-row">
            <div className="row-label">
              <label htmlFor="standalone-narration-text">Văn bản:</label>
            </div>
            <div className="row-content standalone-text-content">
              <textarea
                id="standalone-narration-text"
                className="reference-text standalone-narration-textarea"
                value={text}
                onChange={(event) => setText(event.target.value)}
                disabled={disabled}
                rows={6}
                placeholder="Nhập nội dung cần đọc. Mỗi đoạn cách nhau bằng một dòng trống sẽ tạo thành một mục audio riêng."
                aria-label="Văn bản cần tạo thuyết minh"
              />
              <div className="standalone-text-meta" aria-live="polite">
                <span>{segments.length} đoạn</span>
                <span>{wordCount} từ · {String(text || '').length} ký tự</span>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default NarrationInputSource;
