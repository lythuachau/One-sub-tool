import { useCallback, useEffect, useRef } from 'react';
import {
  generateChatterboxSpeech,
  checkChatterboxAvailability,
  isChatterboxServiceInitialized,
  cancelOmniVoiceGeneration
} from '../../../services/chatterboxService';
import { SERVER_URL } from '../../../config';
import { clearBrowserCaches } from '../utils/cacheManager';

const createGenerationId = () => `generation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const cancellationError = () => new DOMException('OmniVoice generation cancelled', 'AbortError');
const subtitleId = (subtitle, index) => subtitle.id ?? subtitle.subtitle_id ?? index + 1;

const readAudioBlob = (blob, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(cancellationError());
  const reader = new FileReader();
  const cleanup = () => signal.removeEventListener('abort', onAbort);
  const onAbort = () => {
    cleanup();
    reader.abort();
    reject(cancellationError());
  };
  reader.onload = () => {
    cleanup();
    if (signal.aborted) reject(cancellationError());
    else resolve(String(reader.result).split(',')[1]);
  };
  reader.onerror = () => {
    cleanup();
    reject(new Error('Failed to read narration audio'));
  };
  signal.addEventListener('abort', onAbort, { once: true });
  reader.readAsDataURL(blob);
});

const requestCancellation = run => {
  if (!run.cancelPromise) run.cancelPromise = cancelOmniVoiceGeneration(run.id);
  return run.cancelPromise;
};

const getCurrentMediaId = () => {
  const videoUrl = localStorage.getItem('current_video_url');
  if (videoUrl) return videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] || null;
  return localStorage.getItem('current_file_url') ? localStorage.getItem('current_file_cache_id') : null;
};

const useChatterboxNarration = ({
  setIsGenerating,
  setGenerationStatus,
  setError,
  setGenerationResults,
  generationResults,
  narrationMethod,
  subtitleSource,
  originalSubtitles,
  translatedSubtitles,
  subtitles,
  originalLanguage,
  translatedLanguage,
  exaggeration,
  cfgWeight,
  omnivoiceMode,
  omnivoiceInstruct,
  referenceAudio,
  referenceText,
  useGroupedSubtitles,
  setUseGroupedSubtitles,
  groupedSubtitles,
  standaloneTextMode = false,
  t,
  setRetryingSubtitleId
}) => {
  const activeRun = useRef(null);
  const isActive = useCallback(run => activeRun.current === run && !run.controller.signal.aborted, []);
  const assertActive = useCallback(run => {
    if (!isActive(run)) throw cancellationError();
  }, [isActive]);

  useEffect(() => () => {
    const run = activeRun.current;
    activeRun.current = null;
    if (run && !run.finished) {
      run.controller.abort();
      void requestCancellation(run).catch(error => console.warn(error.message));
    }
  }, [narrationMethod]);

  const getSelectedSubtitles = useCallback(() => {
    if (useGroupedSubtitles && groupedSubtitles) return groupedSubtitles;
    if (subtitleSource === 'translated' && translatedSubtitles) return translatedSubtitles;
    return originalSubtitles || subtitles || [];
  }, [useGroupedSubtitles, groupedSubtitles, subtitleSource, translatedSubtitles, originalSubtitles, subtitles]);

  const getReferenceAudioFile = useCallback(async signal => {
    if (referenceAudio?.file) return referenceAudio.file;
    if (!referenceAudio?.url) return null;
    const response = await fetch(referenceAudio.url, { signal });
    if (!response.ok) throw new Error(`Reference audio returned HTTP ${response.status}`);
    return new File([await response.blob()], referenceAudio.filename || 'reference.wav', { type: 'audio/wav' });
  }, [referenceAudio]);

  const saveAudioBlobToServer = useCallback(async (blob, id, run) => {
    assertActive(run);
    const audioData = await readAudioBlob(blob, run.controller.signal);
    assertActive(run);
    const response = await fetch(`${SERVER_URL}/api/narration/save-omnivoice-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: run.controller.signal,
      body: JSON.stringify({ audioData, subtitle_id: id, generation_id: run.id, sampleRate: 24000, mimeType: 'audio/wav' })
    });
    assertActive(run);
    if (response.status === 409) throw cancellationError();
    if (!response.ok) throw new Error(`Saving OmniVoice audio returned HTTP ${response.status}`);
    const data = await response.json();
    assertActive(run);
    if (!data.success) throw new Error(data.error || 'Failed to save OmniVoice audio');
    return data.filename;
  }, [assertActive]);

  const publishResults = useCallback((run, results) => {
    assertActive(run);
    const snapshot = [...results];
    setGenerationResults(previous => isActive(run) ? snapshot : previous);
    if (run.source === 'standalone') return;
    if (run.grouped) window.groupedNarrations = snapshot;
    else if (run.source === 'translated') window.translatedNarrations = snapshot;
    else window.originalNarrations = snapshot;
    window.useGroupedSubtitles = run.grouped;
  }, [assertActive, isActive, setGenerationResults]);

  const runNarration = useCallback(async (retryIds = null) => {
    if (activeRun.current && !activeRun.current.finished && !activeRun.current.controller.signal.aborted) return;
    const run = {
      id: createGenerationId(),
      controller: new AbortController(),
      finished: false,
      grouped: !standaloneTextMode && Boolean(useGroupedSubtitles && groupedSubtitles?.length),
      source: standaloneTextMode ? 'standalone' : subtitleSource
    };
    activeRun.current = run;
    setIsGenerating(true);
    setError('');
    setGenerationStatus(t('narration.omnivoiceStarting', 'Đang chuẩn bị tạo thuyết minh OmniVoice...'));
    if (retryIds?.length === 1) setRetryingSubtitleId(retryIds[0]);

    try {
      const selected = getSelectedSubtitles();
      const jobs = selected.map((subtitle, index) => ({ subtitle, id: subtitleId(subtitle, index) }))
        .filter(job => !retryIds || retryIds.some(id => String(id) === String(job.id)));
      if (!jobs.length) throw new Error(t('narration.noSubtitlesError', 'No subtitles available for narration'));
      const mediaId = standaloneTextMode ? null : getCurrentMediaId();
      let results = retryIds ? [...generationResults] : [];
      if (!retryIds) {
        if (!standaloneTextMode) clearBrowserCaches();
        publishResults(run, results);
      }
      if (run.grouped) setUseGroupedSubtitles(true);

      if (!isChatterboxServiceInitialized()) {
        const status = await checkChatterboxAvailability(3, 2000, true, run.controller.signal);
        assertActive(run);
        if (!status.available || !status.ready) throw new Error(status.message || 'OmniVoice is not ready');
      }

      const needsReference = omnivoiceMode === 'reference';
      const voiceFilePath = needsReference ? referenceAudio?.filepath || null : null;
      const voiceFile = needsReference && !voiceFilePath ? await getReferenceAudioFile(run.controller.signal) : null;
      assertActive(run);
      if (needsReference && !voiceFilePath && !voiceFile) throw new Error('Reference audio is required for OmniVoice');
      if (omnivoiceMode === 'design' && !omnivoiceInstruct?.trim()) throw new Error('Voice design instructions are required');

      let errors = 0;
      for (let index = 0; index < jobs.length; index++) {
        assertActive(run);
        const { subtitle, id } = jobs[index];
        setGenerationStatus(t('narration.omnivoiceGeneratingProgress', 'OmniVoice: {{progress}}/{{total}}', {
          progress: index + 1, total: jobs.length
        }));
        let result = {
          subtitle_id: id, text: subtitle.text, start_time: subtitle.start, end_time: subtitle.end,
          method: 'omnivoice', generation_id: run.id
        };
        try {
          const audio = await generateChatterboxSpeech(
            subtitle.text, exaggeration, cfgWeight, voiceFile, voiceFilePath,
            referenceAudio?.text || referenceText || '', omnivoiceMode, omnivoiceInstruct,
            subtitleSource === 'translated' ? translatedLanguage : originalLanguage,
            { signal: run.controller.signal, generationId: run.id }
          );
          assertActive(run);
          const filename = await saveAudioBlobToServer(audio, id, run);
          result = { ...result, filename, success: true };
        } catch (error) {
          assertActive(run);
          if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
          errors++;
          result = { ...result, success: false, error: error.message };
        }
        assertActive(run);
        results = retryIds
          ? results.map(previous => String(previous.subtitle_id) === String(id) ? result : previous)
          : [...results, result];
        publishResults(run, results);
      }

      assertActive(run);
      if (mediaId) {
        try {
          localStorage.setItem('chatterbox_narrations_cache', JSON.stringify({
            mediaId, timestamp: Date.now(), narrations: results,
            referenceAudio: referenceAudio ? {
              filename: referenceAudio.filename, text: referenceAudio.text || '', url: referenceAudio.url
            } : null
          }));
        } catch (error) {
          console.warn('Could not cache OmniVoice narrations:', error);
        }
      }
      setGenerationStatus(errors
        ? t('narration.omnivoiceGenerationPartial', 'OmniVoice: {{success}} thành công, {{errors}} lỗi.', { success: jobs.length - errors, errors })
        : t('narration.omnivoiceGenerationComplete', 'Đã tạo xong thuyết minh OmniVoice.'));
    } catch (error) {
      if (isActive(run)) {
        if (error.name === 'AbortError') {
          run.controller.abort();
          setGenerationStatus(t('narration.omnivoiceGenerationCancelled', 'Đã dừng tạo thuyết minh OmniVoice.'));
          void requestCancellation(run).catch(cancelError => console.warn(cancelError.message));
        } else {
          setError(t('narration.chatterboxGenerationError', 'Error generating narration with Chatterbox: {{error}}', { error: error.message }));
          if (error.name === 'TimeoutError') {
            run.controller.abort();
            setGenerationStatus(t('narration.omnivoiceGenerationTimeout', 'Đã dừng lượt OmniVoice do quá thời gian chờ.'));
            void requestCancellation(run).catch(cancelError => console.warn(cancelError.message));
          }
        }
      }
    } finally {
      run.finished = true;
      if (activeRun.current === run) {
        setIsGenerating(false);
        setRetryingSubtitleId(null);
      }
    }
  }, [useGroupedSubtitles, groupedSubtitles, subtitleSource, standaloneTextMode, setIsGenerating, setError, setGenerationStatus,
    setRetryingSubtitleId, t, getSelectedSubtitles, generationResults, publishResults, setUseGroupedSubtitles,
    assertActive, omnivoiceMode, referenceAudio, getReferenceAudioFile, omnivoiceInstruct, exaggeration,
    cfgWeight, referenceText, translatedLanguage, originalLanguage, saveAudioBlobToServer, isActive]);

  const cancelChatterboxGeneration = useCallback(() => {
    const run = activeRun.current;
    if (!run || run.finished || run.controller.signal.aborted) return;
    run.controller.abort();
    setIsGenerating(false);
    setRetryingSubtitleId(null);
    setError('');
    setGenerationStatus(t('narration.omnivoiceGenerationCancelled', 'Đã dừng tạo thuyết minh OmniVoice.'));
    void requestCancellation(run).catch(error => {
      if (activeRun.current === run) {
        setError(t('narration.omnivoiceCancellationUnconfirmed', 'Đã dừng gửi câu mới; backend chưa xác nhận hủy. {{error}}', { error: error.message }));
      }
    });
  }, [setIsGenerating, setRetryingSubtitleId, setError, setGenerationStatus, t]);

  const handleChatterboxNarration = useCallback(() => runNarration(), [runNarration]);
  const retryChatterboxNarration = useCallback(id => runNarration([id]), [runNarration]);
  const retryFailedChatterboxNarrations = useCallback(() => {
    const ids = generationResults.filter(result => result.success === false).map(result => result.subtitle_id);
    if (ids.length) return runNarration(ids);
  }, [generationResults, runNarration]);

  return { handleChatterboxNarration, cancelChatterboxGeneration, retryChatterboxNarration, retryFailedChatterboxNarrations };
};

export default useChatterboxNarration;
