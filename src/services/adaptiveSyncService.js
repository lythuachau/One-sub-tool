import { useSyncExternalStore } from 'react';
import { SERVER_URL } from '../config';

const STORAGE = 'adaptive_sync_projects_v1';
const initialRenderSettings = (() => { try { return JSON.parse(localStorage.getItem('videoRender_renderSettings') || 'null'); } catch { return null; } })();
const listeners = new Set();
let state = { enabled: false, mediaKey: null, signature: '', asset: null, plan: null, options: { lead: 0.25, originalVolume: 0.15, voiceVolume: 1 } };
const records = () => { try { return JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch { return {}; } };
const emit = next => {
  state = { ...state, ...next };
  document.body.dataset.adaptiveSync = String(state.enabled);
  listeners.forEach(listener => listener());
};
const persist = () => {
  if (!state.mediaKey) return;
  try {
    const entries = records();
    const previous = entries[state.mediaKey] || {};
    entries[state.mediaKey] = { ...previous, enabled: state.enabled, options: state.options, updatedAt: Date.now(),
      ...(state.signature ? { signature: state.signature, planId: state.plan?.id || null } : {}) };
    const sorted = Object.entries(entries).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 30);
    localStorage.setItem(STORAGE, JSON.stringify(Object.fromEntries(sorted)));
  } catch (error) { console.warn('Adaptive sync state was not saved:', error); }
};
export const useAdaptiveSyncState = () => useSyncExternalStore(listener => {
  listeners.add(listener); return () => listeners.delete(listener);
}, () => state);
export const adaptiveUrl = value => value ? new URL(value, SERVER_URL).href : null;
export const syncRequest = async (route, init = {}) => {
  const response = await fetch(`${SERVER_URL}/api/narration/sync${route}`, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Adaptive sync HTTP ${response.status}`);
  return result;
};
export const configureAdaptiveSync = (mediaKey, signature, isLegacy) => {
  if (state.mediaKey === mediaKey && state.signature === signature) return null;
  const saved = records()[mediaKey];
  const sameMedia = state.mediaKey === mediaKey;
  let volumes = {};
  try { const settings = initialRenderSettings;
    if (settings) volumes = { originalVolume: (settings.originalAudioVolume ?? 15) / 100, voiceVolume: (settings.narrationVolume ?? 100) / 100 };
  } catch { /* Keep defaults when old settings are malformed. */ }
  const options = sameMedia ? state.options : saved?.options || { lead: 0.25, originalVolume: 0.15, voiceVolume: 1, ...volumes };
  emit({ mediaKey, signature, enabled: sameMedia ? state.enabled : saved?.enabled ?? !isLegacy,
    options, asset: null, plan: null });
  return signature && saved?.signature === signature ? saved.planId : null;
};
export const setAdaptiveOptions = changes => {
  emit({ ...changes, options: { ...state.options, ...changes.options }, plan: null, asset: null });
  persist();
};
export const acceptAdaptivePlan = (plan, signature) => {
  if (!state.enabled || state.signature !== signature || Object.entries(state.options).some(([key, value]) => plan.options[key] !== value)) return false;
  emit({ plan, asset: plan.status === 'ready' ? plan : null }); persist(); return true;
};
export const invalidateAdaptiveSync = () => { emit({ plan: null, asset: null }); persist(); };
export const isAdaptiveSyncEnabled = () => state.enabled;
export const detachAdaptiveSync = () => emit({ enabled: false, mediaKey: null, signature: '', asset: null, plan: null });
export const mapSyncSubtitles = (items, plan) => {
  const map = time => time + plan.warps.reduce((extra, w) => extra + (w.factor - 1) * Math.max(0, Math.min(time - w.start, w.end - w.start)), 0);
  return (items || []).map(item => { const start = Number(item.start ?? item.startTime), end = Number(item.end ?? item.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Mốc phụ đề không hợp lệ');
    return { ...item, start: map(start), end: map(end), startTime: map(start), endTime: map(end) }; });
};
export const requireAdaptiveAsset = () => {
  if (!state.enabled || !state.signature) return null;
  if (!state.asset || state.asset.fingerprint !== state.plan?.fingerprint) {
    throw new Error('Hãy bấm “Áp dụng đồng bộ” và xử lý các câu báo lỗi trước khi làm mới, tải audio hoặc render video.');
  }
  return state.asset;
};
export const adaptiveAudioResponse = async () => {
  const asset = await validateAdaptiveAsset();
  return asset ? fetch(adaptiveUrl(asset.assets.voice)) : null;
};
export const validateAdaptiveAsset = async () => {
  const asset = requireAdaptiveAsset();
  if (!asset) return null;
  const signature = state.signature;
  const current = await syncRequest(`/plans/${asset.id}`);
  if (current.status !== 'ready' || state.signature !== signature || state.asset?.id !== asset.id) {
    invalidateAdaptiveSync(); throw new Error(current.error || 'Kế hoạch đồng bộ đã thay đổi. Hãy áp dụng lại.');
  }
  return current;
};
export const verifyAdaptiveVideo = async (plan, source, signal) => {
  let blob = source;
  if (!(source instanceof Blob)) {
    const url = typeof source === 'string' ? source : source?.url;
    if (!url) throw new Error('Chưa xác định được video nguồn để đối chiếu SyncPlan.');
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Video nguồn không còn truy cập được.');
    blob = await response.blob();
  }
  const body = new FormData(); body.append('video', blob, 'source.mp4');
  const result = await syncRequest('/source', { method: 'POST', body, signal });
  if (result.sourceId !== plan.sourceId) throw new Error('Video render khác video nguồn của SyncPlan. Chọn lại video nguồn và áp dụng đồng bộ trước khi xuất.');
};
export const requestAdaptiveBuild = () => window.dispatchEvent(new Event('adaptive-sync-build-requested'));
export const downloadSyncArtifact = async (url, filename) => {
  await validateAdaptiveAsset();
  const response = await fetch(adaptiveUrl(url));
  if (!response.ok) throw new Error('Tệp đồng bộ không còn truy cập được. Hãy áp dụng đồng bộ lại.');
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = objectUrl; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
};
export const syncInputSignature = value => {
  const text = JSON.stringify(value); let first = 2166136261, second = 5381;
  for (let i = 0; i < text.length; i++) { first = Math.imul(first ^ text.charCodeAt(i), 16777619); second = Math.imul(second, 33) ^ text.charCodeAt(i); }
  return `${text.length}:${first >>> 0}:${second >>> 0}`;
};

window.addEventListener('narration-audio-files-updated', invalidateAdaptiveSync);
window.addEventListener('narration-speed-modified', invalidateAdaptiveSync);
window.addEventListener('translation-reset', invalidateAdaptiveSync);
