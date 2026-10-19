export const SUBTITLE_GROUPING_MODEL_STORAGE_KEY = 'subtitle_grouping_model';

export const getSubtitleGroupingModel = () => {
  if (typeof localStorage === 'undefined') return 'gemini-flash-latest';

  return localStorage.getItem(SUBTITLE_GROUPING_MODEL_STORAGE_KEY) ||
    localStorage.getItem('gemini_model') ||
    'gemini-flash-latest';
};
