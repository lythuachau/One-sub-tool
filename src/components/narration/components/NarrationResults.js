import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import StandardSlider from '../../common/StandardSlider';
import { VariableSizeList as List } from 'react-window';
import { SERVER_URL } from '../../../config';
import { enhanceF5TTSNarrations } from '../../../utils/narrationEnhancer';
import { shortenNarrationText } from '../../../services/gemini/narrationTextShortener';
import consumeSseJsonStream from '../../../utils/consumeSseJsonStream';

/**
 * Virtualized row renderer for F5-TTS narration results
 */
const ResultRow = ({ index, style, data }) => {
  const {
    generationResults,
    onRetry,
    retryingSubtitleId,
    currentAudio,
    isPlaying,
    playAudio,
    downloadAudio,
    standaloneTextMode,
    editingSubtitleId,
    draftText,
    setDraftText,
    onEditText,
    onCancelEdit,
    onRegenerateEditedText,
    onShortenText,
    shorteningSubtitleId,
    editError,
    overlappedIds,
    overlapsById,
    t
  } = data;

  const result = generationResults[index];
  const subtitle_id = result.subtitle_id;
  const isEditing = String(editingSubtitleId) === String(subtitle_id);
  const isOverlapped = overlappedIds.has(String(subtitle_id));
  const overlap = overlapsById.get(String(subtitle_id));

  return (
    <div
      style={style}
      className={`result-item
        ${standaloneTextMode ? 'standalone-text-result' : ''}
        ${isEditing ? 'narration-editing' : ''}
        ${result.success ? '' : 'failed'}
        ${currentAudio && currentAudio.id === subtitle_id ? 'playing' : ''}
        ${isOverlapped ? 'timing-overlapped' : ''}
        ${retryingSubtitleId === subtitle_id ? 'retrying' : ''}`}
      title={isOverlapped
        ? t('narration.overlappedBy', 'Bị audio {{ids}} đè lên', { ids: overlap?.overlappedBy?.join(', ') || '' })
        : undefined}
    >
      <div className="result-text">
        <span className="result-id">{subtitle_id}.</span>
        {isEditing ? (
          <div className="narration-text-editor">
            <textarea
              value={draftText}
              onChange={event => setDraftText(event.target.value)}
              aria-label={t('narration.editNarrationText', 'Edit narration text')}
              disabled={retryingSubtitleId === subtitle_id}
            />
            {editError && <span className="narration-text-editor-error" role="alert">{editError}</span>}
            <div className="narration-text-editor-actions">
              <button
                className="pill-button primary"
                onClick={() => onRegenerateEditedText(result)}
                disabled={!draftText.trim() || !onRetry || retryingSubtitleId === subtitle_id}
              >
                {retryingSubtitleId === subtitle_id
                  ? t('narration.generating', 'Đang tạo lại…')
                  : t('narration.regenerateEditedText', 'Tạo lại TTS')}
              </button>
              <button className="pill-button secondary" onClick={onCancelEdit} disabled={retryingSubtitleId === subtitle_id}>
                {t('common.cancel', 'Hủy')}
              </button>
            </div>
          </div>
        ) : (
          <span className="result-text-content">{result.text}</span>
        )}
        {isOverlapped && !isEditing && (
          <span className="timing-overlap-badge">{t('narration.overlapped', 'Bị chồng')}</span>
        )}
      </div>

      <div className="result-controls">
        {result.success ? (
          <>
            <button
              className="pill-button primary"
              onClick={() => playAudio(result)}
            >
              {currentAudio && currentAudio.id === subtitle_id && isPlaying ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="4" width="4" height="16" fill="currentColor" />
                    <rect x="14" y="4" width="4" height="16" fill="currentColor" />
                  </svg>
                  {t('narration.pause', 'Pause')}
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                  </svg>
                  {t('narration.play', 'Play')}
                </>
              )}
            </button>
            {!isEditing && <>
              <button
                className="pill-button secondary narration-shorten-button"
                onClick={() => onShortenText(result)}
                disabled={shorteningSubtitleId === subtitle_id || retryingSubtitleId === subtitle_id}
                title={t('narration.shortenWithGemini', 'Rút gọn câu bằng Gemini')}
              >
                {shorteningSubtitleId === subtitle_id
                  ? t('narration.shortening', 'Đang rút gọn…')
                  : t('narration.shorten', 'Rút gọn')}
              </button>
              <button
                className="pill-button secondary narration-edit-button"
                onClick={() => onEditText(result)}
                disabled={retryingSubtitleId === subtitle_id || shorteningSubtitleId === subtitle_id}
                title={t('narration.editNarrationText', 'Chỉnh sửa văn bản')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
                </svg>
                {t('narration.edit', 'Sửa')}
              </button>
            </>}
            <button
              className="pill-button secondary"
              onClick={() => downloadAudio(result)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t('narration.download', 'Download')}
            </button>
            {onRetry && (
              <button
                className={`pill-button secondary retry-button ${retryingSubtitleId === subtitle_id ? 'retrying' : ''}`}
                onClick={() => onRetry(subtitle_id)}
                title={t('narration.retry', 'Retry generation')}
                disabled={retryingSubtitleId === subtitle_id}
              >
                {retryingSubtitleId === subtitle_id ? (
                  <>
                    <svg className="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    {t('narration.retrying', 'Retrying...')}
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 4v6h6" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    {t('narration.retry', 'Retry')}
                  </>
                )}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="error-message">
              {t('narration.failed', 'Generation failed')}
            </span>
            {onRetry && (
              <button
                className={`pill-button secondary retry-button ${retryingSubtitleId === subtitle_id ? 'retrying' : ''}`}
                onClick={() => onRetry(subtitle_id)}
                title={t('narration.retry', 'Retry generation')}
                disabled={retryingSubtitleId === subtitle_id}
              >
                {retryingSubtitleId === subtitle_id ? (
                  <>
                    <svg className="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    {t('narration.retrying', 'Retrying...')}
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 4v6h6" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    {t('narration.retry', 'Retry')}
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Narration Results component
 * @param {Object} props - Component props
 * @param {Array} props.generationResults - Generation results
 * @param {Function} props.playAudio - Function to play audio
 * @param {Object} props.currentAudio - Current audio being played
 * @param {boolean} props.isPlaying - Whether audio is playing
 * @param {Function} props.getAudioUrl - Function to get audio URL
 * @param {Function} props.onRetry - Function to retry generation for a specific subtitle
 * @param {number|null} props.retryingSubtitleId - ID of the subtitle currently being retried
 * @param {Function} props.onRetryFailed - Function to retry all failed narrations
 * @returns {JSX.Element} - Rendered component
 */
const NarrationResults = ({
  generationResults,
  playAudio,
  currentAudio,
  isPlaying,
  getAudioUrl,
  onRetry,
  retryingSubtitleId,
  onRetryFailed,
  title,
  standaloneTextMode = false,
  isGenerating = false
}) => {
  const { t } = useTranslation();
  const listRef = useRef(null);
  const rowHeights = useRef({});
  const [loadedFromCache, setLoadedFromCache] = useState(false);
  const [editingSubtitleId, setEditingSubtitleId] = useState(null);
  const [draftText, setDraftText] = useState('');
  const [shorteningSubtitleId, setShorteningSubtitleId] = useState(null);
  const [editError, setEditError] = useState('');
  const [overlappedIds, setOverlappedIds] = useState(new Set());
  const [overlapsById, setOverlapsById] = useState(new Map());
  const [overlapRefreshKey, setOverlapRefreshKey] = useState(0);
  const overlapRequestRef = useRef(null);
  const shorteningControllerRef = useRef(null);

  // Speed control state
  const [speedValue, setSpeedValue] = useState(1.0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [currentFile, setCurrentFile] = useState('');
  const [speedModificationError, setSpeedModificationError] = useState('');

  const resolveTiming = useCallback((result) => {
    const directStart = result.start ?? result.start_time;
    const directEnd = result.end ?? result.end_time;
    const hasStart = directStart !== null && directStart !== undefined && Number.isFinite(Number(directStart));
    const hasEnd = directEnd !== null && directEnd !== undefined && Number.isFinite(Number(directEnd));
    if (hasStart && hasEnd) return { start: Number(directStart), end: Number(directEnd) };

    const subtitles = [
      ...(Array.isArray(window.groupedSubtitles) ? window.groupedSubtitles : []),
      ...(Array.isArray(window.translatedSubtitles) ? window.translatedSubtitles : []),
      ...(Array.isArray(window.originalSubtitles) ? window.originalSubtitles : []),
      ...(Array.isArray(window.subtitlesData) ? window.subtitlesData : []),
      ...(Array.isArray(window.subtitles) ? window.subtitles : [])
    ];
    const ids = new Set([result.subtitle_id, ...(result.original_ids || [])].map(String));
    const subtitle = subtitles.find(item => ids.has(String(item.id ?? item.subtitle_id ?? item.index)));
    const start = subtitle?.start;
    const end = subtitle?.end;
    return start !== null && start !== undefined && end !== null && end !== undefined
      && Number.isFinite(Number(start)) && Number.isFinite(Number(end))
      ? { start: Number(start), end: Number(end) }
      : null;
  }, []);

  const startTextEdit = (result, text = result.text || '') => {
    setEditingSubtitleId(result.subtitle_id);
    setDraftText(text);
    setEditError('');
  };

  const handleShortenText = async (result) => {
    shorteningControllerRef.current?.abort();
    const controller = new AbortController();
    shorteningControllerRef.current = controller;
    setShorteningSubtitleId(result.subtitle_id);
    setEditError('');
    try {
      const shortened = await shortenNarrationText(result.text, controller.signal);
      startTextEdit(result, shortened);
    } catch (error) {
      if (error.name !== 'AbortError') {
        setEditingSubtitleId(result.subtitle_id);
        setDraftText(result.text || '');
        setEditError(error.message);
      }
    } finally {
      if (shorteningControllerRef.current === controller) shorteningControllerRef.current = null;
      setShorteningSubtitleId(null);
    }
  };

  const cancelTextEdit = () => {
    setEditingSubtitleId(null);
    setDraftText('');
    setEditError('');
  };

  const regenerateEditedText = async (result) => {
    const text = draftText.trim();
    if (!text || !onRetry) return;
    setEditError('');
    try {
      await onRetry(result.subtitle_id, text);
    } catch (error) {
      setEditError(error.message || t('narration.retryError', 'Không tạo lại được TTS.'));
    }
  };

  useEffect(() => {
    if (editingSubtitleId === null || retryingSubtitleId !== null) return;
    const regenerated = generationResults?.find(result =>
      String(result.subtitle_id) === String(editingSubtitleId)
      && result.success
      && result.text === draftText
    );
    if (regenerated) {
      setEditingSubtitleId(null);
      setDraftText('');
      setEditError('');
    }
  }, [generationResults, editingSubtitleId, retryingSubtitleId, draftText]);

  useEffect(() => {
    rowHeights.current = {};
    listRef.current?.resetAfterIndex(0);
  }, [editingSubtitleId, overlappedIds]);

  useEffect(() => {
    const refresh = () => setOverlapRefreshKey(value => value + 1);
    window.addEventListener('narration-audio-files-updated', refresh);
    return () => window.removeEventListener('narration-audio-files-updated', refresh);
  }, []);

  useEffect(() => () => {
    overlapRequestRef.current?.abort();
    shorteningControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    overlapRequestRef.current?.abort();
    setOverlappedIds(new Set());
    setOverlapsById(new Map());
    if (standaloneTextMode || isGenerating || retryingSubtitleId !== null || !generationResults?.length) return undefined;

    const successful = generationResults.filter(result => result.success);
    if (!successful.length || successful.some(result => !result.filename)) return undefined;

    const narrations = successful.map(result => {
      const timing = resolveTiming(result);
      if (!timing) return null;
      return {
        subtitle_id: result.subtitle_id,
        filename: result.filename,
        start: timing.start
      };
    }).filter(Boolean);
    if (narrations.length < 2) return undefined;

    const controller = new AbortController();
    overlapRequestRef.current = controller;
    fetch(`${SERVER_URL}/api/narration/analyze-overlaps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ narrations }),
      signal: controller.signal
    })
      .then(async response => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) throw new Error(data?.error || `HTTP ${response.status}`);
        setOverlappedIds(new Set((data.overlappedIds || []).map(String)));
        setOverlapsById(new Map((data.overlaps || []).map(item => [String(item.id), item])));
      })
      .catch(error => {
        if (error.name !== 'AbortError') console.warn('Narration overlap analysis failed:', error.message);
      });

    return () => controller.abort();
  }, [generationResults, isGenerating, retryingSubtitleId, standaloneTextMode, overlapRefreshKey, resolveTiming]);

  // Download audio as WAV file
  const downloadAudio = (result) => {
    if (result.filename) {
      try {


        // Get the audio URL
        const audioUrl = getAudioUrl(result.filename);


        // Use fetch to get the file as a blob
        fetch(audioUrl)
          .then(response => {
            if (!response.ok) {
              throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
            }
            return response.blob();
          })
          .then(blob => {
            // Create a blob URL
            const blobUrl = URL.createObjectURL(blob);

            // Create a download link
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `narration_${result.subtitle_id}.wav`;
            a.style.display = 'none';
            document.body.appendChild(a);

            // Trigger the download
            a.click();

            // Clean up
            setTimeout(() => {
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);
            }, 100);


          })
          .catch(error => {
            console.error('Error downloading audio file:', error);
            alert(t('narration.downloadError', `Error downloading audio file: ${error.message}`));
          });
      } catch (error) {
        console.error('Error initiating download:', error);
        alert(t('narration.downloadError', `Error initiating download: ${error.message}`));
      }
    } else {
      console.error('No filename available for download');
      alert(t('narration.downloadError', 'No audio file available for download'));
    }
  };

  // Speed modification function
  const modifyAudioSpeed = async () => {
    if (!generationResults || generationResults.length === 0) {
      console.log('No narration results to modify');
      return;
    }

    // Filter successful narrations
    const successfulNarrations = generationResults.filter(result => result.success && result.filename);

    if (successfulNarrations.length === 0) {
      console.log('No successful narrations to modify');
      return;
    }

    setIsProcessing(true);
    setProcessingProgress({ current: 0, total: successfulNarrations.length });
    setCurrentFile('');
    setSpeedModificationError('');

    try {
      console.log(`Modifying speed of ${successfulNarrations.length} narration files to ${speedValue}x`);

      // Use batch endpoint to process all files at once
      const apiUrl = `${SERVER_URL}/api/narration/batch-modify-audio-speed`;
      console.log(`Sending request to: ${apiUrl}`);

      // Use fetch with streaming response to get real-time progress updates
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filenames: successfulNarrations.map(result => result.filename),
          speedFactor: speedValue
        })
      });

      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }

      let completedEvent = null;
      await consumeSseJsonStream(response, data => {
        if (data.status === 'progress' || data.status === 'file-error') {
          setProcessingProgress({ current: data.processed ?? 0, total: data.total ?? successfulNarrations.length });
          setCurrentFile(data.current || '');
        } else if (data.status === 'completed') {
          completedEvent = data;
          setProcessingProgress({ current: data.processed ?? data.total ?? 0, total: data.total ?? successfulNarrations.length });
          setCurrentFile('');
        } else if (data.status === 'error') {
          throw new Error(data.error || 'Unknown error occurred');
        }
      });

      if (!completedEvent) throw new Error('The server ended the speed-processing stream before reporting completion');
      const batchErrors = Array.isArray(completedEvent.errors) ? completedEvent.errors : [];
      if (Array.isArray(completedEvent.results) && completedEvent.results.length > 0) {
        window.dispatchEvent(new Event('narration-audio-files-updated'));
      }
      if (!completedEvent.success || batchErrors.length > 0) {
        const details = batchErrors.slice(0, 3)
          .map(item => `${item.filename || 'Audio'}: ${item.error || 'Processing failed'}`)
          .join('; ');
        const remaining = batchErrors.length > 3 ? ` (+${batchErrors.length - 3} more)` : '';
        const message = details || completedEvent.message || 'One or more audio files could not be processed';
        throw new Error(`${message}${remaining}`);
      }

      console.log('All files processed successfully');
    } catch (error) {
      console.error('Error modifying audio speed:', error);
      setSpeedModificationError(t('narration.speedModifyError', { error: error.message }));
    } finally {
      setIsProcessing(false);
      setProcessingProgress({ current: 0, total: 0 });
      setCurrentFile('');
    }
  };

  // Check if there are any failed narrations
  const hasFailedNarrations = generationResults && generationResults.some(result => !result.success);

  // Function to calculate row height based on content
  const getRowHeight = (index) => {
    // Return cached height if available
    if (rowHeights.current[index]) return rowHeights.current[index];

    // Calculate height based on content
    const result = generationResults[index];
    if (!result) return 60; // Default height

    // Calculate height based on text length
    const text = result.text || '';
    const lineCount = text.split('\n').length; // Count actual line breaks
    const estimatedLines = Math.ceil(text.length / 40); // Estimate based on characters per line
    const lines = Math.max(lineCount, estimatedLines);
    const controlsHeight = window.innerWidth <= 768 ? 108 : 60;

    // Base height + additional height per line + space for controls
    const editing = String(generationResults[index]?.subtitle_id) === String(editingSubtitleId);
    const height = Math.max(
      controlsHeight,
      60 + (lines > 1 ? (lines - 1) * 20 : 0),
      editing ? 220 : 0
    );

    // Cache the calculated height
    rowHeights.current[index] = height;
    return height;
  };

  // Function to save audio to server
  const saveAudioToServer = async (result) => {
    if (!result || !result.audioData) return null;

    try {
      // Send the audio data to the server
      const response = await fetch(`${SERVER_URL}/api/narration/save-vieneu-audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioData: result.audioData,
          subtitle_id: result.subtitle_id,
          generation_id: result.generation_id,
          sampleRate: result.sampleRate || 24000,
          mimeType: result.mimeType || 'audio/pcm'
        })
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();

      if (data.success) {
        // Return the filename
        return data.filename;
      } else {
        throw new Error(data.error || 'Unknown error saving audio to server');
      }
    } catch (error) {
      console.error(`Error saving audio for subtitle ${result.subtitle_id}:`, error);
      return null;
    }
  };

  // Reset row heights when results change
  useEffect(() => {
    rowHeights.current = {};
    if (listRef.current) {
      listRef.current.resetAfterIndex(0);
    }

    // Save narrations to file system when they change
    if (generationResults && generationResults.length > 0) {
      try {
        // Process each narration result that has audioData but no filename
        const savePromises = generationResults
          .filter(result => result.success && result.audioData && !result.filename)
          .map(async (result) => {
            const filename = await saveAudioToServer(result);
            if (filename) {
              // Update the result with the filename
              result.filename = filename;
              // Remove the audioData to save memory once it's saved to the server
              delete result.audioData;
            }
            return result;
          });

        // Wait for all save operations to complete
        Promise.all(savePromises)
          .then(updatedResults => {
            if (updatedResults.length > 0) {
              window.dispatchEvent(new Event('narration-audio-files-updated'));
              if (standaloneTextMode) return;

              // Get subtitles from window object for enhancing narrations with timing information
              const subtitles = window.originalSubtitles || window.subtitlesData || [];

              // Enhance narrations with timing information from subtitles
              const enhancedResults = enhanceF5TTSNarrations(generationResults, subtitles);

              // Make sure all narrations have the filename property set
              // This is critical for the "Refresh Narration" button to work
              const resultsWithFilenames = enhancedResults.map(result => {
                // If the result already has a filename, use it
                if (result.filename) {
                  return result;
                }

                // If the result doesn't have a filename but has audioData, it means
                // we're still in the process of saving it to the server
                if (result.audioData) {
                  console.warn(`Narration for subtitle ${result.subtitle_id} has audioData but no filename yet`);
                  return result;
                }

                // If the result has neither filename nor audioData, it's likely a failed narration
                if (!result.success) {
                  return result;
                }

                // For any other case, construct a default filename based on the subtitle_id
                return {
                  ...result,
                  filename: `subtitle_${result.subtitle_id}/f5tts_1.wav`
                };
              });

              // Update window.originalNarrations with enhanced results for alignment
              window.originalNarrations = [...resultsWithFilenames];

              // Dispatch an event to notify other components that narrations have been updated
              const event = new CustomEvent('narrations-updated', {
                detail: {
                  source: 'original', // Assuming F5-TTS narrations are for original subtitles
                  narrations: resultsWithFilenames
                }
              });
              window.dispatchEvent(event);
            }
          })
          .catch(error => {
            console.error('Error saving F5-TTS narrations to server:', error);
          });

      } catch (error) {
        console.error('Error processing F5-TTS narrations for saving:', error);
      }
    }
  }, [generationResults, standaloneTextMode]);

  // We no longer need to load narrations from localStorage cache
  // The narrations will be loaded from the file system by the parent component
  // This useEffect is kept as a placeholder for future enhancements
  useEffect(() => {
    // Only try to load if we don't have results yet
    if (generationResults && generationResults.length > 0) return;

    // No need to do anything here - narrations are loaded from the file system
    // by the parent component (UnifiedNarrationSection.js)
  }, [generationResults]);

  // Listen for narrations-updated event to update the component
  useEffect(() => {
    const handleNarrationsUpdated = (event) => {
      if (event.detail && event.detail.narrations && event.detail.fromCache) {

        // Reset loading state since we now have the narrations
        setLoadedFromCache(false);
      }
    };

    // Add event listener
    window.addEventListener('narrations-updated', handleNarrationsUpdated);

    // Clean up
    return () => {
      window.removeEventListener('narrations-updated', handleNarrationsUpdated);
    };
  }, []);

  const resultRowData = {
    generationResults: generationResults || [],
    onRetry,
    retryingSubtitleId,
    currentAudio,
    isPlaying,
    playAudio,
    getAudioUrl,
    downloadAudio,
    standaloneTextMode,
    editingSubtitleId,
    draftText,
    setDraftText,
    onEditText: result => startTextEdit(result),
    onCancelEdit: cancelTextEdit,
    onRegenerateEditedText: regenerateEditedText,
    onShortenText: handleShortenText,
    shorteningSubtitleId,
    editError,
    overlappedIds,
    overlapsById,
    t
  };

  return (
    <div className="results-section">
      <div className="results-header">
        <h4>{title || t('narration.results', 'Generated Narration')}</h4>

        {/* Retry Failed Narrations button */}
        {hasFailedNarrations && onRetryFailed && (
          <button
            className="pill-button secondary retry-failed-button"
            onClick={onRetryFailed}
            disabled={retryingSubtitleId !== null}
            title={t('narration.retryFailedTooltip', 'Retry all failed narrations')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            {t('narration.retryFailed', 'Retry Failed Narrations')}
          </button>
        )}

        {/* Speed Control Slider */}
        {generationResults && generationResults.length > 0 && (
          <div className="speed-control-container">
            <span className="speed-control-label">{t('narration.speed', 'Speed')}:</span>
            <div className="slider-with-value">
              <StandardSlider
                value={speedValue}
                onChange={(value) => setSpeedValue(parseFloat(value))}
                min={0.5}
                max={2.0}
                step={0.1}
                orientation="Horizontal"
                size="XSmall"
                state={isProcessing ? "Disabled" : "Enabled"}
                width="compact" // Compact width for speed control
                showValueIndicator={false} // Using custom value display
                showIcon={false}
                showStops={false}
                className="speed-control-slider"
                id="narration-speed-control"
                ariaLabel={t('narration.speed', 'Speed')}
              />
              <div className="slider-value-display">{speedValue.toFixed(1)}x</div>
            </div>
            {isProcessing ? (
              <div className="speed-control-progress">
                <div className="speed-control-spinner"></div>
                <div className="speed-control-progress-info">
                  <span>{processingProgress.current}/{processingProgress.total}</span>
                  {currentFile && (
                    <span className="speed-control-filename" title={currentFile}>
                      {currentFile.length > 10 ? currentFile.substring(0, 10) + '...' : currentFile}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <button
                className="speed-control-apply-button"
                onClick={modifyAudioSpeed}
                disabled={!generationResults || generationResults.length === 0}
              >
                {t('narration.apply', 'Apply')}
              </button>
            )}
          </div>
        )}
        {speedModificationError && (
          <div className="speed-control-error" role="alert">{speedModificationError}</div>
        )}
      </div>

      <div className="results-list">
        {(!generationResults || generationResults.length === 0) ? (
          loadedFromCache ? (
            // Show loading indicator when loading from cache
            <div className="loading-from-cache-message">
              <div className="loading-spinner-small"></div>
              {t('narration.loadingFromCache', 'Loading narrations from previous session...')}
            </div>
          ) : (
            // Show waiting message when no results and not loading from cache
            <div className="no-results-message">
              {t('narration.waitingForResults', 'Waiting for narration results...')}
            </div>
          )
        ) : (
          standaloneTextMode && generationResults.length === 1 ? (
            <div className="results-virtualized-list standalone-text-results-list">
              <ResultRow index={0} style={{}} data={resultRowData} />
            </div>
          ) : (
            <List
              ref={listRef}
              className="results-virtualized-list"
              height={700}
              width="100%"
              itemCount={generationResults ? generationResults.length : 0}
              itemSize={getRowHeight}
              overscanCount={5}
              itemData={resultRowData}
            >
              {ResultRow}
            </List>
          )
        )}
      </div>
    </div>
  );
};

export default NarrationResults;
