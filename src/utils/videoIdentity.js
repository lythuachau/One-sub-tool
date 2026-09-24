export const persistVideoIdentity = (video) => {
  if (!video?.id || !video?.url) return;

  localStorage.setItem('current_video_id', String(video.id));
  localStorage.setItem('current_video_url', video.url);
};

export const persistDownloadedVideoIdentity = ({ videoId, sourceUrl, fileName, sourceMethod }) => {
  if (videoId) {
    localStorage.setItem('current_video_id', String(videoId));
    localStorage.setItem('current_file_video_id', String(videoId));
  }
  if (sourceUrl) {
    localStorage.setItem('current_video_url', sourceUrl);
    localStorage.setItem('current_file_source_url', sourceUrl);
  }
  if (fileName) {
    localStorage.setItem('current_file_name', fileName);
  }
  if (sourceMethod) {
    localStorage.setItem('current_file_source_method', sourceMethod);
  }
};

export const clearVideoIdentity = () => {
  [
    'current_video_id',
    'current_video_url',
    'current_file_video_id',
    'current_file_source_url',
    'current_file_source_method',
    'current_file_name'
  ].forEach(key => localStorage.removeItem(key));
};
