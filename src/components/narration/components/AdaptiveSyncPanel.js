import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getCurrentMediaCacheId } from '../../../utils/mediaCacheIdentity';
import { acceptAdaptivePlan, configureAdaptiveSync, detachAdaptiveSync, downloadSyncArtifact, setAdaptiveOptions, syncInputSignature,
  syncRequest, useAdaptiveSyncState } from '../../../services/adaptiveSyncService';
import '../../../styles/narration/adaptiveSync.css';

const legacyMediaIds = (() => {
  const ids = new Set();
  for (const key of Object.keys(localStorage)) {
    if (!/narration.*cache|translated_subtitles_cache/.test(key)) continue;
    try { const value = JSON.parse(localStorage.getItem(key));
      for (const item of value?.entries || [value]) if (item?.mediaId) ids.add(String(item.mediaId));
    } catch { /* Ignore non-JSON legacy settings. */ }
  }
  return ids;
})();

const AdaptiveSyncPanel = ({ videoPath, videoDuration, generationResults, originalSubtitles, translatedSubtitles,
  subtitleSource, groupedSubtitles, useGroupedSubtitles }) => {
  const state = useAdaptiveSyncState();
  const [mediaKey, setMediaKey] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
  useEffect(() => { let active = true; Promise.all([getCurrentMediaCacheId(), syncRequest('/legacy-projects')]).then(([id, legacy]) => {
    legacy.ids.forEach(key => legacyMediaIds.add(String(key))); if (active) { resolvedVideo.current = videoPath; setMediaKey(id); }
  }).catch(e => { if (active) setError(`Chưa xác minh dự án cũ: ${e.message}`); });
    return () => { active = false; }; }, [videoPath]);
  useLayoutEffect(() => {
    if (!mediaKey || resolvedVideo.current !== videoPath) return undefined;
    const savedId = configureAdaptiveSync(mediaKey, signature, legacyMediaIds.has(String(mediaKey)));
    const controller = new AbortController();
    if (savedId) syncRequest(`/plans/${savedId}`, { signal: controller.signal })
      .then(plan => { acceptAdaptivePlan(plan, signature); if (plan.error) setError(plan.error); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); operation.current?.abort(); };
  }, [mediaKey, signature, videoPath]);
  const build = async () => {
    if (busy || !state.enabled || !videoPath) return;
    const controller = new AbortController(); operation.current = controller;
    let planId;
    setBusy(true); setError('');
    try {
      if (!narrations.length || !sourceSubtitles.length) throw new Error('Cần có phụ đề và thuyết minh đã tạo.');
      if (narrations.length !== (useGroupedSubtitles ? groupedSubtitles || [] : sourceSubtitles).length) throw new Error('Thuyết minh chưa đủ các câu của nguồn phụ đề đã chọn.');
      const video = await fetch(videoPath, { signal: controller.signal });
      if (!video.ok) throw new Error('Video nguồn không còn truy cập được.');
      const body = new FormData(); body.append('video', await video.blob(), 'source.mp4');
      const source = await syncRequest('/source', { method: 'POST', body, signal: controller.signal });
      let plan = await syncRequest('/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ sourceId: source.sourceId, narrations, subtitleSource, options: state.options,
          subtitles: { original: originalSubtitles || [], translated: translatedSubtitles || [] } }) });
      planId = plan.id;
      if (!acceptAdaptivePlan(plan, signature) || !plan.ready) return;
      plan = await syncRequest(`/plans/${plan.id}/build`, { method: 'POST', signal: controller.signal });
      acceptAdaptivePlan(plan, signature);
      while (plan.status === 'building') {
        await new Promise(resolve => setTimeout(resolve, 750));
        controller.signal.throwIfAborted();
        plan = await syncRequest(`/plans/${plan.id}`, { signal: controller.signal });
        if (!acceptAdaptivePlan(plan, signature)) return;
      }
      if (plan.status !== 'ready') throw new Error(plan.error || 'Đồng bộ chưa hoàn tất.');
    } catch (e) {
      if (controller.signal.aborted) { if (planId) syncRequest(`/plans/${planId}/build`, { method: 'DELETE' }).catch(() => {}); }
      else setError(e.message);
    } finally { if (operation.current === controller) { operation.current = null; setBusy(false); } }
  };
  const buildRef = useRef(build); buildRef.current = build;
  useEffect(() => { const handler = () => buildRef.current(); window.addEventListener('adaptive-sync-build-requested', handler);
    return () => { window.removeEventListener('adaptive-sync-build-requested', handler); operation.current?.abort(); detachAdaptiveSync(); }; }, []);
  if (!videoPath || !mediaKey) return null;
  return <section className="adaptive-sync-panel" aria-label="Đồng bộ thuyết minh thích ứng">
    <label><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e => setAdaptiveOptions({ enabled: e.target.checked })} /> Đồng bộ thích ứng — cho phép kéo dài video</label>
    {state.enabled && <>
      <p>Giữ nguyên lời và dữ liệu nguồn. Tận dụng khoảng lặng → giọng 1.25x → hình tối thiểu 0.8x → giọng tối đa 1.6x. Không tự cắt lời.</p>
      <label><input type="checkbox" checked={state.options.lead > 0} disabled={busy} onChange={e => setAdaptiveOptions({ options: { lead: e.target.checked ? 0.25 : 0 } })} /> Cho phép đọc sớm tối đa 0.25 giây trong khoảng trống</label>
      <div className="adaptive-sync-actions">
        <label>Âm thanh gốc <input type="range" min="0" max="100" value={Math.round(state.options.originalVolume * 100)} disabled={busy} onChange={e => setAdaptiveOptions({ options: { originalVolume: Number(e.target.value) / 100 } })} /> {Math.round(state.options.originalVolume * 100)}%</label>
        <label>Thuyết minh <input type="range" min="0" max="100" value={Math.round(state.options.voiceVolume * 100)} disabled={busy} onChange={e => setAdaptiveOptions({ options: { voiceVolume: Number(e.target.value) / 100 } })} /> {Math.round(state.options.voiceVolume * 100)}%</label>
        <button className="pill-button" disabled={busy || !signature} onClick={build}>Áp dụng đồng bộ</button>
        {busy && <button className="pill-button secondary" onClick={() => operation.current?.abort()}>Hủy</button>}
      </div>
      {state.plan && <div role="status">{state.plan.sourceDuration.toFixed(2)}s → {state.plan.outputDuration.toFixed(2)}s · {busy ? `${state.plan.progress}% ${state.plan.message || ''}` : state.plan.status === 'ready' ? 'Đã áp dụng cùng timeline cho preview và xuất' : 'Chưa áp dụng'}</div>}
      {error && <p role="alert" className="adaptive-sync-error">{error}</p>}
      {state.plan?.placements?.length > 0 && <details><summary>Chi tiết đồng bộ từng câu ({state.plan.placements.length})</summary><ul>{state.plan.placements.map(item => <li key={item.id}>Câu {item.id}: cấp {item.tier} · giọng {item.tempo.toFixed(2)}x · hình {item.videoSpeed.toFixed(2)}x · {item.outStart.toFixed(2)}–{item.outEnd.toFixed(2)}s {item.overflowMs > 0 && <strong> — Cần rút gọn/tạo lại, dư {item.overflowMs}ms</strong>}</li>)}</ul></details>}
      {state.asset && <div className="adaptive-sync-actions"><button className="pill-button secondary" onClick={() => downloadSyncArtifact(state.asset.assets.voice, 'voice-timeline.wav').catch(e => setError(e.message))}>Audio theo timeline</button>{Object.entries(state.asset.assets.subtitles).filter(([, value]) => value).map(([key, files]) => <span key={key}>{key === 'translated' ? 'Phụ đề dịch' : 'Phụ đề gốc'}: {['srt', 'ass'].map(kind => <button className="pill-button secondary" key={kind} onClick={() => downloadSyncArtifact(files[kind], `${key}.${kind}`).catch(e => setError(e.message))}>{kind.toUpperCase()}</button>)}</span>)}</div>}
    </>}
  </section>;
};

export default AdaptiveSyncPanel;
