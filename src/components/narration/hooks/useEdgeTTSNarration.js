import { useCallback, useState, useEffect } from 'react';
import { SERVER_URL } from '../../../config';
import { getNarrationSubtitlesForSource, groupedSubtitlesMatchSource } from '../../../utils/narrationSubtitleSource';

/**
 * Custom hook for Edge TTS narration generation
 * @param {Object} params - Parameters
 * @param {Function} params.setIsGenerating - Function to set generating state
 * @param {Function} params.setGenerationStatus - Function to set generation status
 * @param {Function} params.setError - Function to set error message
 * @param {Function} params.setGenerationResults - Function to set generation results
 * @param {Array} params.generationResults - Current generation results
 * @param {string} params.subtitleSource - Selected subtitle source
 * @param {Array} params.originalSubtitles - Original subtitles
 * @param {Array} params.translatedSubtitles - Translated subtitles
 * @param {Array} params.subtitles - Fallback subtitles
 * @param {Object} params.originalLanguage - Original language
 * @param {Object} params.translatedLanguage - Translated language
 * @param {string} params.selectedVoice - Selected Edge TTS voice
 * @param {string} params.rate - Speech rate
 * @param {string} params.volume - Speech volume
 * @param {string} params.pitch - Speech pitch
 * @param {Function} params.t - Translation function
 * @param {Function} params.setRetryingSubtitleId - Function to set retrying subtitle ID
 * @returns {Object} - Edge TTS narration handlers
 */
const useEdgeTTSNarration = ({
  setIsGenerating,
  setGenerationStatus,
  setError,
  setGenerationResults,
  generationResults,
  subtitleSource,
  originalSubtitles,
  translatedSubtitles,
  subtitles,
  originalLanguage,
  translatedLanguage,
  selectedVoice,
  setSelectedVoice,
  rate,
  setRate,
  volume,
  setVolume,
  pitch,
  setPitch,
  t,
  setRetryingSubtitleId,
  useGroupedSubtitles,
  groupedSubtitles,
  setUseGroupedSubtitles
}) => {
  const [abortController, setAbortController] = useState(null);

  /**
   * Get the appropriate subtitles based on source and grouping
   */
  const getSourceSubtitles = useCallback(() => getNarrationSubtitlesForSource({
    subtitleSource, originalSubtitles, translatedSubtitles, subtitles
  }), [subtitleSource, originalSubtitles, translatedSubtitles, subtitles]);
  const isUsingCurrentGroups = useCallback(() =>
    useGroupedSubtitles && groupedSubtitlesMatchSource(groupedSubtitles, getSourceSubtitles()),
  [getSourceSubtitles, groupedSubtitles, useGroupedSubtitles]);

  const getSubtitlesForGeneration = useCallback(() => {
    if (isUsingCurrentGroups()) {
      console.log(`Edge TTS: Using ${groupedSubtitles.length} grouped subtitles`);
      return groupedSubtitles;
    }
    return getSourceSubtitles();
  }, [groupedSubtitles, getSourceSubtitles, isUsingCurrentGroups]);

  /**
   * Handle Edge TTS narration generation
   */
  const handleEdgeTTSNarration = useCallback(async () => {
    // Clear all caches and files for fresh generation
    const { clearNarrationCachesAndFiles } = await import('../utils/cacheManager');
    await clearNarrationCachesAndFiles(setGenerationResults);

    const subtitlesToProcess = getSubtitlesForGeneration();

    if (!subtitlesToProcess || subtitlesToProcess.length === 0) {
      setError(t('narration.noSubtitlesError', 'No subtitles available for narration generation.'));
      return;
    }

    if (!selectedVoice) {
      setError(t('narration.noVoiceSelectedError', 'Please select a voice for Edge TTS.'));
      return;
    }

    try {
      setIsGenerating(true);
      setError('');
      setGenerationResults([]);
      
      const controller = new AbortController();
      setAbortController(controller);

      const settings = {
        voice: selectedVoice,
        rate: rate || '+0%',
        volume: volume || '+0%',
        pitch: pitch || '+0Hz'
      };

      const requestBody = {
        subtitles: subtitlesToProcess,
        settings: settings
      };

      setGenerationStatus(t('narration.edgeTTSGeneratingProgress', 'Starting Edge TTS generation...'));

      const response = await fetch(`${SERVER_URL}/api/narration/edge-tts/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const results = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.status === 'started') {
                setGenerationStatus(t('narration.edgeTTSGeneratingProgress', 'Generating {{current}} of {{total}} narrations with Edge TTS...', {
                  current: 1,
                  total: data.total
                }));
              } else if (data.status === 'progress') {
                setGenerationStatus(t('narration.edgeTTSGeneratingProgress', 'Generating {{current}} of {{total}} narrations with Edge TTS...', {
                  current: data.current,
                  total: data.total
                }));
                
                if (data.result) {
                  results.push(data.result);
                  setGenerationResults([...results]);
                }
              } else if (data.status === 'error') {
                if (data.result) {
                  results.push(data.result);
                  setGenerationResults([...results]);
                }
              } else if (data.status === 'completed') {
                const finalResults = data.results || results;
                setGenerationResults(finalResults);
                setGenerationStatus(t('narration.edgeTTSGenerationComplete', 'Edge TTS narration generation completed successfully!'));

                // Cache narrations to localStorage
                try {
                  // Get current media ID
                  const getCurrentMediaId = () => {
                    const currentVideoUrl = localStorage.getItem('current_video_url');
                    const currentFileUrl = localStorage.getItem('current_file_url');

                    if (currentVideoUrl) {
                      // Extract video ID from YouTube URLs
                      const match = currentVideoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                      return match ? match[1] : null;
                    } else if (currentFileUrl) {
                      return localStorage.getItem('current_file_cache_id');
                    }
                    return null;
                  };

                  const mediaId = getCurrentMediaId();
                  if (mediaId) {
                    // Create cache entry with narrations
                    const cacheEntry = {
                      mediaId,
                      subtitleSource,
                      timestamp: Date.now(),
                      narrations: finalResults.map(result => ({
                        subtitle_id: result.subtitle_id,
                        filename: result.filename,
                        success: result.success,
                        text: result.text,
                        method: 'edge-tts'
                      })),
                      settings: {
                        voice: selectedVoice,
                        rate: rate || '+0%',
                        volume: volume || '+0%',
                        pitch: pitch || '+0Hz'
                      }
                    };

                    // Save to localStorage
                    localStorage.setItem('edge_tts_narrations_cache', JSON.stringify(cacheEntry));
                    console.log('Cached Edge TTS narrations');
                  }
                } catch (error) {
                  console.error('Error caching Edge TTS narrations:', error);
                }

                // Handle grouped narrations storage and cleanup
                if (isUsingCurrentGroups()) {
                  // Store as grouped narrations in window object
                  window.groupedNarrations = [...finalResults];
                  window.useGroupedSubtitles = true;
                  // Update the React state to reflect that we're now using grouped subtitles
                  setUseGroupedSubtitles(true);
                  console.log(`Stored ${finalResults.length} Edge TTS grouped narrations and updated state`);
                } else {
                  // Store as original/translated narrations
                  if (subtitleSource === 'original') {
                    window.originalNarrations = [...finalResults];
                  } else {
                    window.translatedNarrations = [...finalResults];
                  }
                  window.useGroupedSubtitles = false;
                }
              }
            } catch (parseError) {
              console.warn('Failed to parse SSE data:', parseError);
            }
          }
        }
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        setGenerationStatus(t('narration.edgeTTSGenerationCancelled', 'Edge TTS generation cancelled'));
      } else {
        console.error('Edge TTS generation error:', error);
        setError(t('narration.edgeTTSGenerationError', 'Error generating Edge TTS narration: {{error}}', { error: error.message }));
      }
    } finally {
      setIsGenerating(false);
      setAbortController(null);
    }
  }, [
    getSubtitlesForGeneration,
    selectedVoice,
    rate,
    volume,
    pitch,
    setIsGenerating,
    setError,
    setGenerationResults,
    setGenerationStatus,
    setUseGroupedSubtitles,
    subtitleSource,
    isUsingCurrentGroups,
    t
  ]);

  /**
   * Cancel Edge TTS generation
   */
  const cancelEdgeTTSGeneration = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setIsGenerating(false);
    setGenerationStatus(t('narration.edgeTTSGenerationCancelled', 'Edge TTS generation cancelled'));
  }, [abortController, setIsGenerating, setGenerationStatus, t]);

  /**
   * Retry Edge TTS narration for a specific subtitle
   */
  const retryEdgeTTSNarration = useCallback(async (subtitleId, textOverride) => {
    const subtitlesToProcess = getSubtitlesForGeneration();
    const sourceSubtitle = subtitlesToProcess.find(sub => String(sub.id) === String(subtitleId));
    const subtitle = sourceSubtitle && typeof textOverride === 'string'
      ? { ...sourceSubtitle, text: textOverride, translated_text: textOverride }
      : sourceSubtitle;
    
    if (!subtitle) {
      setError(t('narration.subtitleNotFoundError', 'Subtitle not found for retry.'));
      return;
    }

    if (!selectedVoice) {
      setError(t('narration.noVoiceSelectedError', 'Please select a voice for Edge TTS.'));
      return;
    }

    try {
      setRetryingSubtitleId(subtitleId);
      
      const settings = {
        voice: selectedVoice,
        rate: rate || '+0%',
        volume: volume || '+0%',
        pitch: pitch || '+0Hz'
      };

      const requestBody = {
        subtitles: [subtitle],
        settings: settings
      };

      const response = await fetch(`${SERVER_URL}/api/narration/edge-tts/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.status === 'completed' && data.results?.length > 0) {
                const newResult = {
                  ...data.results[0],
                  ...(typeof textOverride === 'string' ? { text: textOverride } : {})
                };
                
                // Update the specific result in the generation results
                setGenerationResults(prev => 
                  prev.map(result => 
                    String(result.subtitle_id) === String(subtitleId) ? { ...result, ...newResult } : result
                  )
                );
              }
            } catch (parseError) {
              console.warn('Failed to parse SSE data:', parseError);
            }
          }
        }
      }

    } catch (error) {
      console.error('Edge TTS retry error:', error);
      setError(t('narration.edgeTTSRetryError', 'Error retrying Edge TTS narration: {{error}}', { error: error.message }));
    } finally {
      setRetryingSubtitleId(null);
    }
  }, [
    getSubtitlesForGeneration,
    selectedVoice,
    rate,
    volume,
    pitch,
    setError,
    setGenerationResults,
    setRetryingSubtitleId,
    t
  ]);

  /**
   * Retry all failed Edge TTS narrations
   */
  const retryFailedEdgeTTSNarrations = useCallback(async () => {
    const failedResults = generationResults.filter(result => !result.success);
    
    if (failedResults.length === 0) {
      return;
    }

    const subtitlesToProcess = getSubtitlesForGeneration();
    const failedSubtitles = failedResults.map(result => 
      subtitlesToProcess.find(sub => sub.id === result.subtitle_id)
    ).filter(Boolean);

    if (failedSubtitles.length === 0) {
      setError(t('narration.noFailedSubtitlesError', 'No failed subtitles found for retry.'));
      return;
    }

    try {
      setIsGenerating(true);
      setError('');

      const settings = {
        voice: selectedVoice,
        rate: rate || '+0%',
        volume: volume || '+0%',
        pitch: pitch || '+0Hz'
      };

      const requestBody = {
        subtitles: failedSubtitles,
        settings: settings
      };

      setGenerationStatus(t('narration.edgeTTSRetryingFailed', 'Retrying failed Edge TTS narrations...'));

      const response = await fetch(`${SERVER_URL}/api/narration/edge-tts/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.status === 'progress' && data.result) {
                // Update the specific result in the generation results
                setGenerationResults(prev => 
                  prev.map(result => 
                    result.subtitle_id === data.result.subtitle_id ? data.result : result
                  )
                );
              } else if (data.status === 'completed') {
                setGenerationStatus(t('narration.edgeTTSRetryComplete', 'Edge TTS retry completed!'));
              }
            } catch (parseError) {
              console.warn('Failed to parse SSE data:', parseError);
            }
          }
        }
      }

    } catch (error) {
      console.error('Edge TTS retry failed error:', error);
      setError(t('narration.edgeTTSRetryFailedError', 'Error retrying failed Edge TTS narrations: {{error}}', { error: error.message }));
    } finally {
      setIsGenerating(false);
    }
  }, [
    generationResults,
    getSubtitlesForGeneration,
    selectedVoice,
    rate,
    volume,
    pitch,
    setIsGenerating,
    setError,
    setGenerationResults,
    setGenerationStatus,
    t
  ]);

  // Listen for cached narrations loaded event
  useEffect(() => {
    const handleCachedNarrationsLoaded = (event) => {
      if (event.detail?.subtitleSource === subtitleSource && event.detail.narrations) {
        console.log('Edge TTS: Received cached narrations from cache hook');
        setGenerationResults(event.detail.narrations);
        setGenerationStatus(t('narration.loadedFromCache', 'Loaded Edge TTS narrations from previous session'));

        // Restore settings if available
        if (event.detail.settings) {
          const settings = event.detail.settings;
          if (settings.voice && setSelectedVoice) setSelectedVoice(settings.voice);
          if (settings.rate && setRate) setRate(settings.rate);
          if (settings.volume && setVolume) setVolume(settings.volume);
          if (settings.pitch && setPitch) setPitch(settings.pitch);
        }
      }
    };

    window.addEventListener('edge-tts-narrations-loaded-from-cache', handleCachedNarrationsLoaded);

    return () => {
      window.removeEventListener('edge-tts-narrations-loaded-from-cache', handleCachedNarrationsLoaded);
    };
  }, [setGenerationResults, setGenerationStatus, t, setSelectedVoice, setRate, setVolume, setPitch, subtitleSource]);

  return {
    handleEdgeTTSNarration,
    cancelEdgeTTSGeneration,
    retryEdgeTTSNarration,
    retryFailedEdgeTTSNarrations
  };
};

export default useEdgeTTSNarration;
