import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generateChatterboxSpeech, getOmniVoiceDesignOptions } from '../../../services/chatterboxService';
import VoicePreviewButton from './VoicePreviewButton';
import '../../../styles/narration/omnivoiceVoiceControls.css';

const FALLBACK_GROUPS = {
  gender: ['male', 'female'],
  age: ['child', 'teenager', 'young adult', 'middle-aged', 'elderly'],
  pitch: ['very low pitch', 'low pitch', 'moderate pitch', 'high pitch', 'very high pitch'],
  style: ['whisper'],
  accent: ['american accent', 'british accent', 'australian accent', 'chinese accent', 'canadian accent', 'indian accent', 'korean accent', 'portuguese accent', 'russian accent', 'japanese accent'],
  dialect: ['河南话', '陕西话', '四川话', '贵州话', '云南话', '桂林话', '济南话', '石家庄话', '甘肃话', '宁夏话', '青岛话', '东北话']
};

const GROUP_ORDER = ['gender', 'age', 'pitch', 'style', 'accent', 'dialect'];
const GROUP_LABELS = {
  gender: 'Giới tính',
  age: 'Độ tuổi',
  pitch: 'Cao độ',
  style: 'Phong cách',
  accent: 'Accent tiếng Anh',
  dialect: 'Phương ngữ tiếng Trung'
};
const TOKEN_LABELS = {
  male: 'Nam',
  female: 'Nữ',
  child: 'Trẻ em',
  teenager: 'Thiếu niên',
  'young adult': 'Người trẻ',
  'middle-aged': 'Trung niên',
  elderly: 'Cao tuổi',
  'very low pitch': 'Rất trầm',
  'low pitch': 'Trầm',
  'moderate pitch': 'Vừa',
  'high pitch': 'Cao',
  'very high pitch': 'Rất cao',
  whisper: 'Thì thầm',
  'american accent': 'Mỹ',
  'british accent': 'Anh',
  'australian accent': 'Úc',
  'chinese accent': 'Trung Quốc',
  'canadian accent': 'Canada',
  'indian accent': 'Ấn Độ',
  'korean accent': 'Hàn Quốc',
  'portuguese accent': 'Bồ Đào Nha',
  'russian accent': 'Nga',
  'japanese accent': 'Nhật Bản'
};

const parseSelections = (instruct, groups) => {
  const tokens = String(instruct || '').split(/[,，]/).map(token => token.trim().toLowerCase()).filter(Boolean);
  return GROUP_ORDER.reduce((result, group) => {
    result[group] = tokens.find(token => (groups[group] || []).includes(token)) || '';
    return result;
  }, {});
};

const composeInstruct = (selections) => {
  const tokens = GROUP_ORDER.map(group => selections[group]).filter(Boolean);
  return tokens.join(selections.dialect ? '，' : ', ');
};

const OmniVoiceModeControls = ({
  mode,
  setMode,
  instruct,
  setInstruct,
  isGenerating,
  isAvailable,
  referenceAudio,
  referenceText,
  exaggeration,
  cfgWeight,
  language
}) => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState(FALLBACK_GROUPS);
  const [optionsError, setOptionsError] = useState('');

  useEffect(() => {
    let active = true;
    getOmniVoiceDesignOptions()
      .then(data => {
        if (!active || !data?.groups) return;
        const nextGroups = { ...FALLBACK_GROUPS, ...data.groups };
        setGroups(nextGroups);
        setInstruct(current => composeInstruct(parseSelections(current, nextGroups)) || current);
        setOptionsError('');
      })
      .catch(error => {
        if (active) setOptionsError(error.message || 'Không tải được danh sách thuộc tính OmniVoice.');
      });

    return () => {
      active = false;
    };
  }, [setInstruct]);

  const selections = useMemo(() => parseSelections(instruct, groups), [instruct, groups]);

  const updateSelection = (group, value) => {
    const next = { ...selections, [group]: value };
    if (group === 'accent' && value) next.dialect = '';
    if (group === 'dialect' && value) next.accent = '';
    setInstruct(composeInstruct(next));
  };

  const previewVoice = async () => {
    let voiceFile = referenceAudio?.file || null;
    const voiceFilePath = referenceAudio?.filepath || null;

    if (mode === 'reference' && !voiceFile && !voiceFilePath && referenceAudio?.url) {
      const response = await fetch(referenceAudio.url);
      if (!response.ok) throw new Error(`Không tải được âm thanh tham chiếu (${response.status}).`);
      const blob = await response.blob();
      voiceFile = new File([blob], referenceAudio.filename || 'reference.wav', { type: blob.type || 'audio/wav' });
    }

    return generateChatterboxSpeech(
      t('narration.voicePreviewText', 'Xin chào, đây là bản nghe thử của giọng đọc hiện tại.'),
      exaggeration,
      cfgWeight,
      mode === 'reference' ? voiceFile : null,
      mode === 'reference' ? voiceFilePath : null,
      mode === 'reference' ? (referenceAudio?.text || referenceText || '') : '',
      mode,
      instruct,
      language
    );
  };

  return (
    <>
      <div className="narration-row omnivoice-mode-row">
        <div className="row-label">
          <label>{t('narration.voiceSource', 'Nguồn giọng')}:</label>
        </div>
        <div className="row-content">
          <div className="narration-method-selection omnivoice-mode-selection">
            <div className="radio-pill-group">
              {[
                ['reference', t('narration.referenceAudioMode', 'Âm thanh tham chiếu')],
                ['design', t('narration.voiceDesignMode', 'Thiết kế giọng')],
                ['auto', t('narration.autoVoiceMode', 'Tự sinh giọng')]
              ].map(([value, label]) => (
                <div className="radio-pill" key={value}>
                  <input
                    type="radio"
                    id={`omnivoice-mode-${value}`}
                    name="omnivoice-voice-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    disabled={isGenerating}
                  />
                  <label htmlFor={`omnivoice-mode-${value}`}>{label}</label>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {mode === 'design' && (
        <div className="narration-row omnivoice-design-row">
          <div className="row-label">
            <label>{t('narration.voiceDesignOptions', 'Tùy chỉnh giọng')}:</label>
          </div>
          <div className="row-content omnivoice-design-controls">
            <div className="omnivoice-design-grid">
              {GROUP_ORDER.map(group => (
                <label className="omnivoice-design-field" key={group}>
                  <span>{GROUP_LABELS[group]}</span>
                  <select
                    value={selections[group]}
                    onChange={event => updateSelection(group, event.target.value)}
                    disabled={isGenerating}
                  >
                    <option value="">Tự động</option>
                    {(groups[group] || []).map(option => (
                      <option value={option} key={option}>
                        {TOKEN_LABELS[option] || option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="omnivoice-instruct-preview">
              <span>Chuỗi gửi model:</span> <code>{instruct || 'Tự động'}</code>
            </div>
            <div className="setting-description">
              {optionsError || t('narration.voiceDesignDescription', 'Chọn thuộc tính hợp lệ; OmniVoice sẽ tạo giọng theo mô tả và không cần âm thanh tham chiếu.')}
            </div>
          </div>
        </div>
      )}

      {mode === 'auto' && (
        <div className="narration-row omnivoice-auto-row">
          <div className="row-label" />
          <div className="row-content">
            <div className="setting-description">
              {t('narration.autoVoiceDescription', 'OmniVoice tự chọn giọng. Kết quả có thể khác nhau giữa các lần tạo.')}
            </div>
          </div>
        </div>
      )}

      <div className="narration-row omnivoice-preview-row">
        <div className="row-label" />
        <div className="row-content">
          <VoicePreviewButton
            disabled={isGenerating || !isAvailable || (mode === 'reference' && !referenceAudio) || (mode === 'design' && !instruct.trim())}
            onPreview={previewVoice}
          />
        </div>
      </div>
    </>
  );
};

export default OmniVoiceModeControls;
