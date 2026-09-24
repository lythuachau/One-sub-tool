import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import '../styles/LyricsDisplay.css';
import TimelineVisualization from './lyrics/TimelineVisualization';
import LyricItem from './lyrics/LyricItem';
import LyricsHeader from './lyrics/LyricsHeader';
import { useLyricsEditor } from '../hooks/useLyricsEditor';
import { VariableSizeList as List } from 'react-window';
import { extractYoutubeVideoId } from '../utils/videoDownloader';
import { downloadTXT, downloadSRT, downloadJSON } from '../utils/fileUtils';
import { completeDocument, summarizeDocument } from '../services/geminiService';
import { generateUrlBasedCacheId } from '../hooks/useSubtitles';
import DownloadOptionsModal from './DownloadOptionsModal';

// Helper function to download files
const downloadFile = (content, filename, type = 'text/plain') => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Virtualized row renderer for lyrics
const VirtualizedLyricRow = ({ index, style, data }) => {
  const {
    lyrics,
    currentIndex,
    currentTime,
    allowEditing,
    isDragging,
    onLyricClick,
    onMouseDown,
    getLastDragEnd,
    onDelete,
    onTextEdit,
    onSplitLyric,
    onInsert,
    onMerge,
    timeFormat
  } = data;

  const lyric = lyrics[index];
  const hasNextLyric = index < lyrics.length - 1;

  return (
    <div style={style}>
      <LyricItem
        key={index}
        lyric={lyric}
        index={index}
        isCurrentLyric={index === currentIndex}
        currentTime={currentTime}
        allowEditing={allowEditing}
        isDragging={isDragging}
        onLyricClick={onLyricClick}
        onMouseDown={onMouseDown}
        getLastDragEnd={getLastDragEnd}
        onDelete={onDelete}
        onTextEdit={onTextEdit}
        onSplitLyric={onSplitLyric}
        onInsert={onInsert}
        onMerge={onMerge}
        hasNextLyric={hasNextLyric}
        timeFormat={timeFormat}
      />
    </div>
  );
};

const LyricsDisplay = ({
  matchedLyrics,
  currentTime,
  onLyricClick,
  duration,
  onUpdateLyrics,
  allowEditing = false,
  seekTime = null,
  timeFormat = 'seconds',
  onSaveSubtitles = null, // New callback for when subtitles are saved
  onUpdateTranslatedLyrics = null,
  videoSource = null, // Video source URL for audio analysis
  translatedSubtitles = null, // Translated subtitles
  videoTitle = 'subtitles' // Video title for download filenames
}) => {
  const { t } = useTranslation();
  const [editingSource, setEditingSource] = useState('original');
  const hasTranslatedSubtitles = translatedSubtitles && translatedSubtitles.length > 0;
  const sourceLyrics = editingSource === 'translated' && hasTranslatedSubtitles
    ? translatedSubtitles
    : matchedLyrics;
  // Initialize zoom with a function that calculates the minimum zoom based on duration
  const [zoom, setZoom] = useState(() => {
    // Try to get the duration from the video element if it exists
    const videoElement = document.querySelector('video');
    if (videoElement && videoElement.duration && !isNaN(videoElement.duration)) {
      // Calculate minimum zoom based on duration
      const minZoom = videoElement.duration <= 300 ? 1 : videoElement.duration / 300;
      return minZoom;
    }
    // Default to 1 if we can't determine the duration yet
    return 1;
  });
  const [panOffset, setPanOffset] = useState(0);
  const [centerTimelineAt, setCenterTimelineAt] = useState(null);
  const rowHeights = useRef({});
  const [txtContent, setTxtContent] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [splitDuration, setSplitDuration] = useState(() => {
    // Get the split duration from localStorage or use default (0 = no split)
    return parseInt(localStorage.getItem('consolidation_split_duration') || '0');
  });

  // Get naming information for downloads
  const getNamingInfo = () => {
    // Get uploaded SRT info
    let sourceSubtitleName = '';
    try {
      const uploadedSrtInfo = localStorage.getItem('uploaded_srt_info');
      if (uploadedSrtInfo) {
        const srtInfo = JSON.parse(uploadedSrtInfo);
        if (srtInfo.hasUploaded && srtInfo.fileName) {
          sourceSubtitleName = srtInfo.fileName;
        }
      }
    } catch (error) {
      console.error('Error parsing uploaded SRT info:', error);
    }

    // Get video name (from uploaded file or video title)
    let videoName = '';
    const uploadedFileUrl = localStorage.getItem('current_file_url');
    if (uploadedFileUrl) {
      // For uploaded files, try to get the original file name
      // This might be stored in the uploadedFile object or we can use videoTitle
      videoName = videoTitle;
    } else {
      // For YouTube videos, use the video title
      videoName = videoTitle;
    }

    // Get target languages
    let targetLanguages = [];
    try {
      const translationTargetLanguage = localStorage.getItem('translation_target_language');
      if (translationTargetLanguage) {
        // Try to parse as JSON first (for multi-language)
        try {
          const parsed = JSON.parse(translationTargetLanguage);
          if (Array.isArray(parsed)) {
            targetLanguages = parsed;
          } else {
            targetLanguages = [{ value: parsed }];
          }
        } catch {
          // If not JSON, treat as single language string
          targetLanguages = [{ value: translationTargetLanguage }];
        }
      }
    } catch (error) {
      console.error('Error parsing target languages:', error);
    }

    return {
      sourceSubtitleName,
      videoName,
      targetLanguages
    };
  };
  const [consolidationStatus, setConsolidationStatus] = useState('');
  const [showWaveform, setShowWaveform] = useState(() => {
    // Load from localStorage, default to true if not set
    return localStorage.getItem('show_waveform') !== 'false';
  });
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(() => {
    // Load from localStorage, default to true (auto-scroll enabled) if not set
    return localStorage.getItem('lyrics_auto_scroll') !== 'false';
  });

  // Function to calculate row height based on text content
  const getRowHeight = index => {
    // If we already calculated this height, return it
    if (rowHeights.current[index] !== undefined) {
      return rowHeights.current[index];
    }

    const lyric = matchedLyrics[index];
    if (!lyric) return 50; // Default height

    // Calculate height based on text length
    const text = lyric.text || '';
    const lineCount = text.split('\n').length; // Count actual line breaks
    const estimatedLines = Math.ceil(text.length / 40); // Estimate based on characters per line
    const lines = Math.max(lineCount, estimatedLines);

    // Base height + additional height per line
    const height = 50 + (lines > 1 ? (lines - 1) * 20 : 0);

    // Cache the calculated height
    rowHeights.current[index] = height;
    return height;
  };

  // Reset row heights when lyrics change
  useEffect(() => {
    rowHeights.current = {};
    if (listRef.current) {
      listRef.current.resetAfterIndex(0);
    }
  }, [matchedLyrics]);

  // Update zoom level when duration changes
  useEffect(() => {
    if (duration) {
      // Calculate minimum zoom based on duration
      const minZoom = duration <= 300 ? 1 : duration / 300;

      // Only update if the current zoom is less than the minimum
      if (zoom < minZoom) {

        setZoom(minZoom);
      }
    }
  }, [duration, zoom]);

  // Listen for changes to the show_waveform setting in localStorage
  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'show_waveform') {
        setShowWaveform(event.newValue !== 'false');
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Save auto-scroll setting to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('lyrics_auto_scroll', autoScrollEnabled.toString());
  }, [autoScrollEnabled]);

  // Listen for consolidation status updates
  useEffect(() => {
    const handleConsolidationStatus = (event) => {
      if (event.detail && event.detail.message) {
        setConsolidationStatus(event.detail.message);

        // Check if this is a completion message
        if (event.detail.message.includes('Processing completed for all')) {
          // Clear the status after a delay
          setTimeout(() => {
            setConsolidationStatus('');
          }, 3000);
        }
      }
    };

    window.addEventListener('consolidation-status', handleConsolidationStatus);

    return () => {
      window.removeEventListener('consolidation-status', handleConsolidationStatus);
    };
  }, []);

  // Gemini effects for the Download Center button have been removed to reduce lag

  const {
    lyrics,
    isSticky,
    setIsSticky,
    isAtOriginalState,
    isAtSavedState,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
    handleReset,
    startDrag,
    handleDrag,
    endDrag,
    isDragging,
    getLastDragEnd,
    handleDeleteLyric,
    handleTextEdit,
    handleInsertLyric,
    handleMergeLyrics,
    updateSavedLyrics,
    handleSplitSubtitles,
    handleSplitLyric
  } = useLyricsEditor(
    sourceLyrics,
    editingSource === 'translated' ? onUpdateTranslatedLyrics : onUpdateLyrics,
    editingSource
  );

  // Find current lyric index based on time
  const currentIndex = lyrics.findIndex((lyric, index) => {
    const nextLyric = lyrics[index + 1];
    // If there's a next lyric, use the middle point between current lyric's end and next lyric's start
    // Subtract 1ms from the midpoint to prevent flickering when subtitleA.end == subtitleB.start
    // Otherwise, use the current lyric's end time
    return currentTime >= lyric.start &&
      (nextLyric ? currentTime < (lyric.end + (nextLyric.start - lyric.end) / 2) - 0.001 : currentTime <= lyric.end);
  });

  useEffect(() => {
    if (!hasTranslatedSubtitles && editingSource === 'translated') {
      setEditingSource('original');
    }
  }, [editingSource, hasTranslatedSubtitles]);

  const handleSourceChange = (source) => {
    if (source === 'translated' && !hasTranslatedSubtitles) return;
    setEditingSource(source);
  };

  // Reference to the virtualized list
  const listRef = useRef(null);
  const isScrollingRef = useRef(false);
  const scrollAnimationRef = useRef(null);

  // Smooth scroll function for virtualized list
  const smoothScrollToItem = (targetIndex, align = 'center') => {
    if (!listRef.current || isScrollingRef.current || targetIndex < 0) return;

    const list = listRef.current;

    // Get current scroll position
    const currentScrollTop = list.state.scrollOffset;

    // Calculate target scroll position manually but more accurately
    let targetScrollTop = 0;

    // Sum up heights of all items before the target
    for (let i = 0; i < targetIndex; i++) {
      targetScrollTop += getRowHeight(i);
    }

    // Adjust for center alignment
    if (align === 'center') {
      const containerHeight = 300;
      const targetItemHeight = getRowHeight(targetIndex);
      targetScrollTop -= (containerHeight - targetItemHeight) / 2;
    }

    // Clamp to valid scroll range
    const maxScrollTop = Math.max(0,
      lyrics.reduce((sum, _, i) => sum + getRowHeight(i), 0) - 300
    );
    targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));

    const distance = targetScrollTop - currentScrollTop;

    // If the distance is very small, just snap to position
    if (Math.abs(distance) < 5) {
      list.scrollTo(targetScrollTop);
      return;
    }

    // For large jumps (more than 2 container heights), use instant scroll to avoid virtualization issues
    const containerHeight = 300;
    const largeJumpThreshold = containerHeight * 2;

    if (Math.abs(distance) > largeJumpThreshold) {
      // Use react-window's built-in scrollToItem for large jumps to handle virtualization properly
      list.scrollToItem(targetIndex, align);
      return;
    }

    // Cancel any existing animation
    if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current);
    }

    isScrollingRef.current = true;
    const startTime = performance.now();
    // Shorter duration for more responsive feel
    const duration = Math.min(400, Math.max(150, Math.abs(distance) * 0.8));

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Use easeOutQuart for smoother deceleration
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const newScrollTop = currentScrollTop + (distance * easeOutQuart);

      list.scrollTo(newScrollTop);

      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(animate);
      } else {
        isScrollingRef.current = false;
        scrollAnimationRef.current = null;
      }
    };

    scrollAnimationRef.current = requestAnimationFrame(animate);
  };

  // Auto-scroll to the current lyric with smooth positioning
  useEffect(() => {
    if (autoScrollEnabled && currentIndex >= 0 && listRef.current) {
      // Use smooth scroll instead of abrupt scrollToItem
      smoothScrollToItem(currentIndex, 'center');
    }
  }, [currentIndex, autoScrollEnabled]);

  // Cleanup scroll animation on unmount
  useEffect(() => {
    return () => {
      if (scrollAnimationRef.current) {
        cancelAnimationFrame(scrollAnimationRef.current);
      }
    };
  }, []);

  // Watch for seekTime changes to center the timeline
  useEffect(() => {
    if (seekTime !== null) {
      // Center the timeline on the seek time
      setCenterTimelineAt(seekTime);

    }
  }, [seekTime]);

  // Generate comprehensive filename based on priority system
  const generateFilename = (source, namingInfo = {}) => {
    const { sourceSubtitleName = '', videoName = '', targetLanguages = [] } = namingInfo;

    // Priority 1: Source subtitle name (remove extension)
    let baseName = '';
    if (sourceSubtitleName) {
      baseName = sourceSubtitleName.replace(/\.(srt|json)$/i, '');
    }
    // Priority 2: Video name (remove extension)
    else if (videoName) {
      baseName = videoName.replace(/\.[^/.]+$/, '');
    }
    // Fallback: Use video title or default
    else {
      baseName = videoTitle || 'subtitles';
    }

    // Add language suffix for translations
    let langSuffix = '';
    if (source === 'translated' && targetLanguages.length > 0) {
      if (targetLanguages.length === 1) {
        // Single language: use the language name
        const langName = targetLanguages[0].value || targetLanguages[0];
        langSuffix = `_${langName.toLowerCase().replace(/\s+/g, '_')}`;
      } else {
        // Multiple languages: use multi_lang
        langSuffix = '_multi_lang';
      }
    }

    return `${baseName}${langSuffix}`;
  };

  // Handle download request from modal
  const handleDownload = (source, format, namingInfo = {}) => {
    const subtitlesToUse = source === 'translated' ? translatedSubtitles : lyrics;

    if (subtitlesToUse && subtitlesToUse.length > 0) {
      const baseFilename = generateFilename(source, namingInfo);

      switch (format) {
        case 'srt':
          downloadSRT(subtitlesToUse, `${baseFilename}.srt`);
          break;
        case 'json':
          downloadJSON(subtitlesToUse, `${baseFilename}.json`);
          break;
        case 'txt':
          const content = downloadTXT(subtitlesToUse, `${baseFilename}.txt`);
          setTxtContent(content);
          break;
        default:
          break;
      }
    }
  };

  // Handle process request from modal
  const handleProcess = async (source, processType, model, splitDurationParam, customPrompt, namingInfo = {}) => {
    const subtitlesToUse = source === 'translated' ? translatedSubtitles : lyrics;

    // Store the current source in localStorage for language detection
    localStorage.setItem('current_processing_source', source);

    if (!subtitlesToUse || subtitlesToUse.length === 0) return;

    // First, get the text content if we don't have it yet
    let textContent = txtContent;
    if (!textContent) {
      textContent = subtitlesToUse.map(subtitle => subtitle.text).join('\n\n');
      setTxtContent(textContent);
    }

    // Use the provided split duration or the state value
    const splitDurationToUse = splitDurationParam !== undefined ? splitDurationParam : splitDuration;

    // Save the split duration setting to localStorage
    localStorage.setItem('consolidation_split_duration', splitDurationToUse.toString());

    // Update the state
    setSplitDuration(splitDurationToUse);

    // Clear any previous status
    setConsolidationStatus('');

    try {
      let result;
      if (processType === 'consolidate') {
        result = await completeDocument(textContent, model, customPrompt, splitDurationToUse);
      } else if (processType === 'summarize') {
        result = await summarizeDocument(textContent, model, customPrompt);
      }

      // Check if the result is JSON and extract plain text
      if (result && typeof result === 'string' && (result.trim().startsWith('{') || result.trim().startsWith('['))) {
        try {
          const jsonResult = JSON.parse(result);


          // For summarize feature
          if (jsonResult.summary) {
            let plainText = jsonResult.summary;

            // Add key points if available
            if (jsonResult.keyPoints && Array.isArray(jsonResult.keyPoints) && jsonResult.keyPoints.length > 0) {
              plainText += '\n\nKey Points:\n';
              jsonResult.keyPoints.forEach((point, index) => {
                plainText += `\n${index + 1}. ${point}`;
              });
            }

            result = plainText;

          }
          // For consolidate feature
          else if (jsonResult.content) {
            result = jsonResult.content;

          }
          // For any other JSON structure
          else if (jsonResult.text) {
            result = jsonResult.text;

          }
        } catch (e) {

          // Keep the original result if parsing fails
        }
      }

      // Result is ready for download

      // Show a temporary success message
      const successMessage = document.createElement('div');
      successMessage.className = 'save-success-message';
      successMessage.textContent = processType === 'consolidate'
        ? t('output.documentCompleted', 'Document completed successfully')
        : t('output.summaryCompleted', 'Summary completed successfully');
      document.body.appendChild(successMessage);

      // Remove the message after 3 seconds
      setTimeout(() => {
        if (document.body.contains(successMessage)) {
          document.body.removeChild(successMessage);
        }
      }, 3000);

      // Download the processed document
      const baseFilename = generateFilename(source, namingInfo);
      const processTypeSuffix = processType === 'consolidate' ? 'completed' : 'summary';
      const filename = `${baseFilename}_${processTypeSuffix}.txt`;
      downloadFile(result, filename);
    } catch (error) {
      console.error(`Error ${processType === 'consolidate' ? 'completing' : 'summarizing'} document:`, error);

      // Show error status
      setConsolidationStatus(t('consolidation.error', 'Error processing document: {{message}}', { message: error.message }));
    } finally {
      // Processing is complete
    }
  };

  // Function to save current subtitles to cache
  const handleSave = async () => {
    try {
      if (editingSource === 'translated') {
        updateSavedLyrics();
        onSaveSubtitles?.(lyrics, editingSource);
        return;
      }

      // Get the current video source
      const currentVideoUrl = localStorage.getItem('current_video_url');
      const currentFileUrl = localStorage.getItem('current_file_url');
      let cacheId = null;

      if (currentVideoUrl) {
        // For any video URL, use unified URL-based caching
        cacheId = await generateUrlBasedCacheId(currentVideoUrl);
      } else if (currentFileUrl) {
        // For uploaded files, the cacheId is already stored
        cacheId = localStorage.getItem('current_file_cache_id');
      }

      if (!cacheId) {
        console.error('No cache ID found for current media');
        return;
      }

      // Check if we have latest segment subtitles in localStorage
      let subtitlesToSave = lyrics;
      if (editingSource === 'original') {
        try {
          const latestSubtitles = localStorage.getItem('latest_segment_subtitles');
          if (latestSubtitles) {
            const parsedSubtitles = JSON.parse(latestSubtitles);
            if (Array.isArray(parsedSubtitles) && parsedSubtitles.length > 0) {
              subtitlesToSave = parsedSubtitles;
              localStorage.removeItem('latest_segment_subtitles');
            }
          }
        } catch (e) {
          console.error('Error parsing latest subtitles from localStorage:', e);
        }
      }

      // Save to cache
      const response = await fetch('http://localhost:3031/api/save-subtitles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cacheId,
          subtitles: subtitlesToSave
        })
      });

      const result = await response.json();
      if (result.success) {

        // Show a temporary success message
        const saveMessage = document.createElement('div');
        saveMessage.className = 'save-success-message';
        saveMessage.textContent = t('output.subtitlesSaved', 'Progress saved successfully');
        document.body.appendChild(saveMessage);

        // Remove the message after 3 seconds
        setTimeout(() => {
          if (document.body.contains(saveMessage)) {
            document.body.removeChild(saveMessage);
          }
        }, 3000);

        // Update the saved lyrics state in the editor
        updateSavedLyrics();

        // Call the callback if provided to update parent component state
        if (onSaveSubtitles) {
          onSaveSubtitles(subtitlesToSave, editingSource);
        }

        // Dispatch custom events to notify that subtitles have been saved
        // These are used by various components including segment retry and aligned narration
        window.dispatchEvent(new CustomEvent('subtitles-saved', {
          detail: { success: true }
        }));

        // Also dispatch a subtitle-timing-changed event for the aligned narration component
        window.dispatchEvent(new CustomEvent('subtitle-timing-changed', {
          detail: {
            action: 'save',
            timestamp: Date.now(),
            subtitles: subtitlesToSave
          }
        }));
      } else {
        console.error('Failed to save subtitles:', result.error);
      }
    } catch (error) {
      console.error('Error saving subtitles:', error);
    }
  };

  // Setup drag event handlers with performance optimizations
  const handleMouseDown = (e, index, field) => {
    e.preventDefault();
    e.stopPropagation();
    startDrag(index, field, e.clientX, lyrics[index][field]);

    // Use passive event listeners for better performance
    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp, { passive: false });

    // Add a class to the body to indicate dragging is in progress
    document.body.classList.add('lyrics-dragging');
  };

  // Use a throttled mouse move handler
  const lastMoveTimeRef = useRef(0);
  const handleMouseMove = (e) => {
    e.preventDefault();

    // Throttle mousemove events
    const now = performance.now();
    if (now - lastMoveTimeRef.current < 16) { // ~60fps
      return;
    }
    lastMoveTimeRef.current = now;

    // Use requestAnimationFrame for smoother updates
    requestAnimationFrame(() => {
      handleDrag(e.clientX, duration);
    });
  };

  const handleMouseUp = (e) => {
    e.preventDefault();
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.classList.remove('lyrics-dragging');
    endDrag();
  };

  return (
    <div className={`lyrics-display ${Object.keys(isDragging()).length > 0 ? 'dragging-active' : ''}`}>
      {allowEditing && hasTranslatedSubtitles && (
        <div className="subtitle-edit-source-switch" role="tablist" aria-label={t('lyrics.editSource', 'Subtitle source to edit')}>
          <button
            type="button"
            className={editingSource === 'original' ? 'active' : ''}
            onClick={() => handleSourceChange('original')}
            role="tab"
            aria-selected={editingSource === 'original'}
          >
            {t('lyrics.original', 'Phụ đề gốc')}
          </button>
          <button
            type="button"
            className={editingSource === 'translated' ? 'active' : ''}
            onClick={() => handleSourceChange('translated')}
            role="tab"
            aria-selected={editingSource === 'translated'}
          >
            {t('lyrics.translated', 'Phụ đề đã dịch')}
          </button>
        </div>
      )}
      <div className="controls-timeline-container">
        <LyricsHeader
          allowEditing={allowEditing}
          isSticky={isSticky}
          setIsSticky={setIsSticky}
          canUndo={canUndo}
          canRedo={canRedo}
          isAtOriginalState={isAtOriginalState}
          isAtSavedState={isAtSavedState}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onReset={handleReset}
          onSave={handleSave}
          autoScrollEnabled={autoScrollEnabled}
          setAutoScrollEnabled={setAutoScrollEnabled}
          lyrics={lyrics}
          onSplitSubtitles={handleSplitSubtitles}
        />

        <TimelineVisualization
          lyrics={lyrics}
          currentTime={currentTime}
          duration={duration}
          onTimelineClick={onLyricClick}
          zoom={zoom}
          setZoom={setZoom}
          panOffset={panOffset}
          setPanOffset={setPanOffset}
          centerOnTime={centerTimelineAt}
          timeFormat={timeFormat}
          videoSource={videoSource}
          showWaveform={showWaveform}
        />
      </div>

      <div className="lyrics-container-wrapper">
        {lyrics.length > 0 && (
          <List
            ref={listRef}
            className="lyrics-container"
            height={300} // Reduced height for more compact view
            width="100%"
            itemCount={lyrics.length}
            itemSize={getRowHeight} // Dynamic row heights based on content
            overscanCount={5} // Number of items to render outside of the visible area
            itemData={{
              lyrics,
              currentIndex,
              currentTime,
              allowEditing,
              isDragging,
              onLyricClick: (time) => {
                // Center the timeline on the clicked lyric
                setCenterTimelineAt(time);
                // Reset the center time in the next frame to allow future clicks to work
                requestAnimationFrame(() => {
                  setCenterTimelineAt(null);
                });
                // Call the original onLyricClick function
                onLyricClick(time);
              },
              onMouseDown: handleMouseDown,
              getLastDragEnd,
              onDelete: handleDeleteLyric,
              onTextEdit: handleTextEdit,
              onSplitLyric: handleSplitLyric,
              onInsert: handleInsertLyric,
              onMerge: handleMergeLyrics,
              timeFormat
            }}
          >
            {VirtualizedLyricRow}
          </List>
        )}
      </div>

      <div className="help-text-container">
        {allowEditing && (
          <div className="help-text">
            <p dangerouslySetInnerHTML={{
              __html: t('lyrics.timingInstructions', 'Hiện có ??? dòng phụ đề. Bấm trực tiếp vào nội dung để sửa; đặt con trỏ rồi nhấn Enter để tách thành dòng mới. Kéo dấu thời gian để điều chỉnh thời gian cho mỗi phụ đề. Chế độ "Dính" sẽ điều chỉnh tất cả phụ đề theo sau. Chế độ "Cuộn" sẽ giúp tự dời tầm nhìn lên dòng sub đang chạy. 5 nút còn lại: Chia nhỏ sub, Lưu, Đặt lại, Hoàn tác, Làm lại')
                .replace('??? dòng', `<strong>${lyrics.length} dòng</strong>`)
                .replace('??? subtitle lines', `<strong>${lyrics.length} subtitle lines</strong>`)
                .replace('???개의 자막 라인', `<strong>${lyrics.length}개의 자막 라인</strong>`)
            }} />
          </div>
        )}

        <div className="download-buttons">
          <button
            className="btn-base btn-primary btn-large download-btn-primary"
            onClick={() => setIsModalOpen(true)}
            disabled={!lyrics.length}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>{t('download.downloadCenter', 'Download Center')}</span>
          </button>

          {/* Show consolidation status if available */}
          {consolidationStatus && (
            <div className="consolidation-status">
              <div className="status-spinner"></div>
              <span>{consolidationStatus}</span>
            </div>
          )}

          {/* Download Options Modal */}
          <DownloadOptionsModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onDownload={handleDownload}
            onProcess={handleProcess}
            hasTranslation={translatedSubtitles && translatedSubtitles.length > 0}
            hasOriginal={lyrics && lyrics.length > 0}
            sourceSubtitleName={getNamingInfo().sourceSubtitleName}
            videoName={getNamingInfo().videoName}
            targetLanguages={getNamingInfo().targetLanguages}
          />
        </div>
      </div>
    </div>
  );
};

export default LyricsDisplay;
