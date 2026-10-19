import { extractYoutubeVideoId } from './videoDownloader';

export const generateMediaCacheIdFromUrl = async url => {
  if (!url) return null;

  try {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return extractYoutubeVideoId(url);
    }

    if (url.includes('douyin.com')) {
      const { extractDouyinVideoId } = await import('./douyinDownloader');
      return extractDouyinVideoId(url);
    }

    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsedUrl.pathname.replace(/\//g, '_');
    const query = parsedUrl.search.replace(/[^a-zA-Z0-9]/g, '_');
    const cleanId = `${domain}${path}${query}`.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return cleanId ? `site_${cleanId}` : null;
  } catch (error) {
    console.error('Error generating media cache ID:', error);
    return null;
  }
};

export const getCurrentMediaCacheId = async () => {
  const currentUrl = localStorage.getItem('current_video_url') || localStorage.getItem('current_file_source_url');
  if (currentUrl) {
    const mediaId = await generateMediaCacheIdFromUrl(currentUrl);
    if (mediaId) return mediaId;
  }

  return localStorage.getItem('current_file_cache_id')
    || localStorage.getItem('current_file_video_id')
    || localStorage.getItem('current_video_id')
    || null;
};

export const generateSubtitleHash = subtitles => {
  if (!Array.isArray(subtitles) || subtitles.length === 0) return '';
  const subtitleString = subtitles.map(item => `${item.id || item.subtitle_id || ''}:${item.text || ''}`).join('|');
  let hash = 0;
  for (let index = 0; index < subtitleString.length; index += 1) {
    hash = ((hash << 5) - hash) + subtitleString.charCodeAt(index);
    hash |= 0;
  }
  return hash.toString(16);
};

export const generateNarrationInputHash = subtitles => {
  if (!Array.isArray(subtitles) || subtitles.length === 0) return '';
  const serialized = JSON.stringify(subtitles.map(item => ({
    id: item.id ?? item.subtitle_id ?? null,
    text: item.text ?? item.translated_text ?? '',
    start: item.start ?? null,
    end: item.end ?? null,
    original_ids: item.original_ids ?? null,
    sourceId: item.sourceId ?? null,
  })));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

export const readMediaCacheEntries = key => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (Array.isArray(value?.entries)) return value.entries;
    if (value && typeof value === 'object' && value.mediaId) return [value];
  } catch (error) {
    console.error(`Error reading media cache ${key}:`, error);
  }
  return [];
};

export const writeMediaCacheEntry = (key, entry, maxEntries = 12) => {
  try {
    const entries = readMediaCacheEntries(key).filter(existing => existing.cacheId !== entry.cacheId);
    entries.push({ ...entry, updatedAt: Date.now() });
    entries.sort((left, right) => (right.updatedAt || right.timestamp || 0) - (left.updatedAt || left.timestamp || 0));
    localStorage.setItem(key, JSON.stringify({ schema: 2, entries: entries.slice(0, maxEntries) }));
    return true;
  } catch (error) {
    console.error(`Error writing media cache ${key}:`, error);
    return false;
  }
};

export const removeMediaCacheEntries = (key, shouldRemove) => {
  try {
    const entries = readMediaCacheEntries(key).filter(entry => !shouldRemove(entry));
    if (entries.length) {
      localStorage.setItem(key, JSON.stringify({ schema: 2, entries }));
    } else {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.error(`Error removing media cache ${key}:`, error);
  }
};
