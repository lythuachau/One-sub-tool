import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getCurrentMediaCacheId } from '../../../utils/mediaCacheIdentity';
import { acceptAdaptivePlan, configureAdaptiveSync, detachAdaptiveSync, registerAdaptiveBuildHandler,
  syncInputSignature, syncRequest, useAdaptiveSyncState } from '../../../services/adaptiveSyncService';

const AdaptiveSyncController = ({ videoPath, videoDuration, generationResults, originalSubtitles, translatedSubtitles,
  subtitleSource, groupedSubtitles, useGroupedSubtitles }) => {
  const state = useAdaptiveSyncState();
  const [mediaKey, setMediaKey] = useState(null);
  const [initializationError, setInitializationError] = useState('');
  const operation = useRef(null);
  const resolvedVideo = useRef(null);
  const sourceSubtitles = subtitleSource === 'translated' ? translatedSubtitles || [] : originalSubtitles || [];
  const narrations = useMemo(() => {
    const timing = useGroupedSubtitles ? groupedSubtitles || [] : subtitleSource === 'translated' ? translatedSubtitles || [] : originalSubtitles || [];
    return (generationResults || []).map(item => {
      const cue = timing.find(sub => String(sub.id ?? sub.subtitle_id) === String(item.subtitle_id));
      return { ...cue, ...item, start: Number(item.start ?? cue?.start ?? cue?.startTime),
        end: Number(item.end ?? cue?.end ?? cue?.endTime), original_ids: item.original_ids || cue?.original_ids };
    });
  }, [generationResults, groupedSubtitles, originalSubtitles, subtitleSource, translatedSubtitles, useGroupedSubtitles]);
  const signature = useMemo(() => narrations.length ? syncInputSignature({ mediaKey, videoDuration,
    narrations: narrations.map(({ subtitle_id, filename, audioData, start, end, text, original_ids, cueAlignments, method, retriedAt, timestamp }) => ({ subtitle_id, filename, audioData, start, end, text, original_ids, cueAlignments, method, retriedAt, timestamp })),
    originalSubtitles, translatedSubtitles, subtitleSource, useGroupedSubtitles }) : '',
  [mediaKey, videoDuration, narrations, originalSubtitles, translatedSubtitles, subtitleSource, useGroupedSubtitles]);

  useLayoutEffect(() => { detachAdaptiveSync(); setMediaKey(null); }, [videoPath]);
  useEffect(() => {
    let active = true;
    if (!videoPath) return () => { active = false; };
    getCurrentMediaCacheId().then(id => {
      if (active) { resolvedVideo.current = videoPath; setMediaKey(id); setInitializationError(''); }
    }).catch(error => {
      if (active) setInitializationError(`Chưa xác định được video để căn chỉnh: ${error.message}`);
    });
    return () => { active = false; };
  }, [videoPath]);

  useLayoutEffect(() => {
    if (!mediaKey || resolvedVideo.current !== videoPath) return undefined;
    const savedId = configureAdaptiveSync(mediaKey, signature);
    const controller = new AbortController();
    if (savedId) syncRequest(`/plans/${savedId}`, { signal: controller.signal })
      .then(plan => { acceptAdaptivePlan(plan, signature); })
      .catch(error => { if (!controller.signal.aborted) console.warn('Could not restore the saved narration sync plan:', error); });
    return () => { controller.abort(); operation.current?.abort(); };
  }, [mediaKey, signature, videoPath]);

  const build = async () => {
    if (operation.current) throw new Error('Đang căn chỉnh thuyết minh, vui lòng đợi hoàn tất.');
    if (initializationError) throw new Error(initializationError);
    if (!state.enabled || !videoPath || !mediaKey) throw new Error('Chưa có video nguồn để căn chỉnh thuyết minh.');
    const controller = new AbortController();
    operation.current = controller;
    let planId;
    try {
      if (!narrations.length || !sourceSubtitles.length) throw new Error('Cần có phụ đề và thuyết minh đã tạo.');
      if (narrations.length !== (useGroupedSubtitles ? groupedSubtitles || [] : sourceSubtitles).length) {
        throw new Error('Thuyết minh chưa đủ các câu của nguồn phụ đề đã chọn.');
      }
      const video = await fetch(videoPath, { signal: controller.signal });
      if (!video.ok) throw new Error('Video nguồn không còn truy cập được.');
      const body = new FormData();
      body.append('video', await video.blob(), 'source.mp4');
      const source = await syncRequest('/source', { method: 'POST', body, signal: controller.signal });
      let plan = await syncRequest('/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ sourceId: source.sourceId, narrations, subtitleSource, options: state.options,
          subtitles: { original: originalSubtitles || [], translated: translatedSubtitles || [] } }) });
      planId = plan.id;
      if (!acceptAdaptivePlan(plan, signature)) throw new Error('Phụ đề hoặc audio vừa thay đổi. Hãy bấm làm mới thuyết minh lại.');
      plan = await syncRequest(`/plans/${plan.id}/build`, { method: 'POST', signal: controller.signal });
      if (!acceptAdaptivePlan(plan, signature)) throw new Error('Phụ đề hoặc audio vừa thay đổi trong lúc căn chỉnh. Hãy thử lại.');
      while (plan.status === 'building') {
        await new Promise(resolve => setTimeout(resolve, 750));
        controller.signal.throwIfAborted();
        plan = await syncRequest(`/plans/${plan.id}`, { signal: controller.signal });
        if (!acceptAdaptivePlan(plan, signature)) throw new Error('Phụ đề hoặc audio vừa thay đổi trong lúc căn chỉnh. Hãy thử lại.');
      }
      if (plan.status !== 'ready') throw new Error(plan.error || 'Đồng bộ chưa hoàn tất.');
      window.dispatchEvent(new CustomEvent('narration-refresh-completed', { detail: { mode: 'adaptive' } }));
      return plan;
    } catch (error) {
      if (controller.signal.aborted && planId) syncRequest(`/plans/${planId}/build`, { method: 'DELETE' }).catch(() => {});
      throw error;
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  };
  const buildRef = useRef(build);
  buildRef.current = build;
  useEffect(() => {
    const unregister = registerAdaptiveBuildHandler(() => buildRef.current());
    return () => { unregister(); operation.current?.abort(); detachAdaptiveSync(); };
  }, []);

  return null;
};

export default AdaptiveSyncController;
