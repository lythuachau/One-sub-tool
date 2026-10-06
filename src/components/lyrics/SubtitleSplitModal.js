import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import CustomModelDialog from '../settings/CustomModelDialog';
import StandardSlider from '../common/StandardSlider';

import { countWords, smartSplitText } from '../../utils/naturalSubtitleSplit';

/**
 * Split subtitle timing proportionally based on text chunks
 * @param {number} startTime - Original start time
 * @param {number} endTime - Original end time
 * @param {Array} chunks - Array of text chunks with word counts
 * @returns {Array} - Array of timing objects
 */
const splitTiming = (startTime, endTime, chunks) => {
  if (chunks.length <= 1) {
    return [{ start: startTime, end: endTime }];
  }
  
  const totalWords = chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0);
  const totalDuration = endTime - startTime;
  
  const timings = [];
  let currentTime = startTime;
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const proportion = chunk.wordCount / totalWords;
    const duration = totalDuration * proportion;
    
    const chunkStart = currentTime;
    const chunkEnd = i === chunks.length - 1 ? endTime : currentTime + duration;
    
    timings.push({
      start: chunkStart,
      end: chunkEnd
    });
    
    currentTime = chunkEnd;
  }
  
  return timings;
};

const SubtitleSplitModal = ({ isOpen, onClose, lyrics, onSplitSubtitles }) => {
  const { t } = useTranslation();
  const [maxWords, setMaxWords] = useState(8);

  const handleApply = () => {
    if (!lyrics || lyrics.length === 0) {
      onClose();
      return;
    }
    
    const newLyrics = [];
    
    lyrics.forEach((lyric) => {
      const wordCount = countWords(lyric.text);
      
      // If subtitle is already within limit, keep it as is
      if (wordCount <= maxWords) {
        newLyrics.push(lyric);
      } else {
        // Split the subtitle
        const chunks = smartSplitText(lyric.text, maxWords);
        if (chunks.length === 1) { newLyrics.push(lyric); return; }
        const timings = splitTiming(lyric.startTime ?? lyric.start, lyric.endTime ?? lyric.end, chunks);
        
        chunks.forEach((chunk, index) => {
          const timing = timings[index];
          newLyrics.push({
            ...lyric,
            text: chunk.text,
            start: timing.start,
            end: timing.end,
            startTime: timing.start,
            endTime: timing.end,
            id: `${lyric.id}_${index + 1}`
          });
        });
      }
    });
    
    // Call the callback with the new lyrics
    onSplitSubtitles(newLyrics);
    onClose();
  };
  
  return (
    <CustomModelDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('subtitleSplit.title', 'Chia nhỏ subtitles')}
      footer={
        <button
          className="apply-btn"
          onClick={handleApply}
          style={{
            backgroundColor: 'var(--md-primary)',
            color: 'var(--md-on-primary)',
            border: 'none',
            borderRadius: 'var(--md-shape-medium)',
            padding: '8px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          {t('subtitleSplit.apply', 'Áp dụng')}
        </button>
      }
    >
      <div style={{ padding: '16px 0' }}>
        <p style={{
          marginBottom: '16px',
          color: 'var(--md-on-surface-variant)',
          fontSize: '14px',
          lineHeight: '1.4'
        }}>
          {t('subtitleSplit.description', 'Chia nhỏ sub thông minh (các sub đã nhỏ hơn giới hạn sẽ không bị ảnh hưởng)')}
        </p>

        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            marginBottom: '12px',
            fontSize: '14px',
            fontWeight: '500',
            color: 'var(--md-on-surface)'
          }}>
            {t('subtitleSplit.sliderTitle', 'Số chữ maximum của mỗi sub')}
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <StandardSlider
              value={maxWords}
              onChange={(value) => setMaxWords(parseInt(value))}
              min={6}
              max={30}
              step={1}
              orientation="Horizontal"
              size="XSmall"
              state="Enabled"
              showValueIndicator={false}
              showIcon={false}
              showStops={false}
              className="subtitle-split-slider"
              id="subtitle-split-slider"
              ariaLabel={t('subtitleSplit.sliderTitle', 'Số chữ maximum của mỗi sub')}
            />
            <span style={{
              minWidth: '100px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--md-primary)',
              textAlign: 'right'
            }}>
              {t('subtitleSplit.limitLabel', 'Giới hạn: {{count}} {{unit}}', {
                count: maxWords,
                unit: maxWords === 1
                  ? t('subtitleSplit.wordUnit', 'từ')
                  : t('subtitleSplit.wordsUnit', 'từ')
              })}
            </span>
          </div>
        </div>

        <p>{t('subtitleSplit.naturalHelp', 'Ưu tiên dấu câu và mệnh đề; mỗi đoạn mới ít nhất 6 từ. Không có điểm ngắt phù hợp thì giữ nguyên. Thời gian chia theo tỷ lệ chữ, không phải căn theo audio.')}</p>

      </div>
    </CustomModelDialog>
  );
};

export default SubtitleSplitModal;
