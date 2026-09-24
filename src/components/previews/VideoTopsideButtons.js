import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LiquidGlass from '../common/LiquidGlass';
import { extractAndDownloadAudio } from '../../utils/fileUtils';

const VideoTopsideButtons = ({
  showCustomControls,
  isFullscreen,
  controlsVisible,
  isVideoHovered,
  isRefreshingNarration,
  setIsRefreshingNarration,
  isAudioDownloading,
  setIsAudioDownloading,
  setError,
  videoRef,
  videoSource,
  videoUrl
}) => {
  const { t } = useTranslation();

  const refreshSession = useRef(null);
  const [syncSession, setSyncSession] = useState(null);

  useEffect(() => {
    return () => {
      refreshSession.current?.controller.abort();
      refreshSession.current = null;
      setIsRefreshingNarration(false);
    };
  }, [videoUrl, videoRef, setIsRefreshingNarration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !syncSession || syncSession.video !== video || syncSession.url !== videoUrl) return;
    const audio = syncSession.audio;
    let active = true;
    const isCurrent = () => active && videoRef.current === video;
    const syncTime = () => {
      if (isCurrent()) audio.currentTime = video.currentTime;
    };
    const play = () => {
      if (!isCurrent()) return;
      syncTime();
      audio.play().catch(error => {
        if (isCurrent()) console.warn('Audio play error:', error);
      });
    };
    const pause = () => { if (isCurrent()) audio.pause(); };
    const timeupdate = () => {
      if (isCurrent() && Math.abs(audio.currentTime - video.currentTime) > 0.3) syncTime();
    };
    const ratechange = () => { if (isCurrent()) audio.playbackRate = video.playbackRate; };
    const volumechange = event => {
      if (isCurrent() && Number.isFinite(event.detail?.volume)) {
        audio.volume = Math.min(1, Math.max(0, event.detail.volume));
      }
    };
    const listeners = { play, pause, seeked: syncTime, timeupdate, ratechange };
    Object.entries(listeners).forEach(([type, handler]) => video.addEventListener(type, handler));
    window.addEventListener('narration-volume-change', volumechange);
    audio.volume = Math.min(1, Math.max(0, window.narrationVolume ?? 1));
    ratechange();
    if (!video.paused) play();
    return () => {
      active = false;
      Object.entries(listeners).forEach(([type, handler]) => video.removeEventListener(type, handler));
      window.removeEventListener('narration-volume-change', volumechange);
      audio.pause();
    };
  }, [syncSession, videoUrl, videoRef]);

  return (
    <>
      {/* Top buttons container */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        right: '10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        zIndex: 10,
        pointerEvents: 'none' // Allow clicks to pass through the container
      }}>
        {/* Left side buttons */}
        <div style={{
          display: 'flex',
          gap: '10px',
          alignItems: 'center'
        }}>
          {/* Refresh Narration button - only show when custom controls are available */}
          {showCustomControls && (
            <LiquidGlass
              width="auto"
              height={50}
              position="relative"
              borderRadius="25px"
              className="content-center interactive theme-primary"
              cursor="pointer"
              effectIntensity={0.6}
              effectRadius={0.5}
              effectWidth={0.3}
              effectHeight={0.2}
              animateOnHover={true}
              hoverScale={1.05}
              updateOnMouseMove={false}
              style={{
                opacity: isFullscreen ? (controlsVisible ? 1 : 0) : (isVideoHovered || controlsVisible) ? 1 : 0,
                transition: 'opacity 0.6s ease-in-out',
                pointerEvents: isFullscreen ? (controlsVisible ? 'auto' : 'none') : (isVideoHovered || controlsVisible) ? 'auto' : 'none'
              }}
          aria-label={t('preview.refreshNarration', 'Refresh Narration')}
          onClick={async () => {
            refreshSession.current?.controller.abort();
            const session = { controller: new AbortController(), video: videoRef.current, url: videoUrl };
            refreshSession.current = session;
            const isCurrentRefresh = () => refreshSession.current === session && !session.controller.signal.aborted && videoRef.current === session.video;
            try {
              // Pause the video if it's playing
              if (videoRef.current && !videoRef.current.paused) {
                videoRef.current.pause();
              }

              // Set refreshing state
              setIsRefreshingNarration(true);

              // Use the EXACT same implementation as the download aligned button
              const { SERVER_URL } = await import('../../config');

              // Get narration data from window objects (same as VideoRenderingSection.js)
              const isUsingGroupedSubtitles = window.useGroupedSubtitles || false;
              const groupedNarrations = window.groupedNarrations || [];
              const originalNarrations = window.originalNarrations || [];
              const translatedNarrations = window.translatedNarrations || [];

              let generationResults = [];

              // Use grouped narrations if available and enabled, otherwise use original/translated narrations
              if (isUsingGroupedSubtitles && groupedNarrations.length > 0) {
                generationResults = groupedNarrations;
                console.log(`Using grouped narrations for refresh. Found ${generationResults.length} grouped narrations.`);
              } else if (translatedNarrations.length > 0) {
                generationResults = translatedNarrations;
                console.log(`Using translated narrations for refresh. Found ${generationResults.length} narrations.`);
              } else if (originalNarrations.length > 0) {
                generationResults = originalNarrations;
                console.log(`Using original narrations for refresh. Found ${generationResults.length} narrations.`);
              }

              if (generationResults.length === 0) {
                throw new Error('No narration results to generate aligned audio');
              }

              // EXACT same subtitle timing lookup as VideoRenderingSection.js
              // Get all subtitles from the window object, prioritizing grouped subtitles if using them
              const allSubtitles = isUsingGroupedSubtitles && window.groupedSubtitles ?
                window.groupedSubtitles :
                (window.subtitlesData || window.originalSubtitles || window.subtitles || []);

              // Also try translated subtitles if no other subtitles found
              if (allSubtitles.length === 0 && window.translatedSubtitles && Array.isArray(window.translatedSubtitles)) {
                allSubtitles.push(...window.translatedSubtitles);
              }

              // Create a map for faster lookup
              const subtitleMap = {};
              allSubtitles.forEach(sub => {
                if (sub.id !== undefined) {
                  subtitleMap[sub.id] = sub;
                }
              });

              // EXACT same data preparation as downloadAlignedAudio in useNarrationHandlers.js
              const narrationData = generationResults
                .filter(result => result.success && result.filename)
                .map(result => {
                  // Get the correct subtitle ID from the result
                  const subtitleId = result.subtitle_id;
                  const isGrouped = result.original_ids && result.original_ids.length > 1;

                  // Find the corresponding subtitle for timing information
                  let subtitle = subtitleMap[subtitleId];

                  // If this is a grouped subtitle and we couldn't find it directly in the map,
                  // we might need to calculate its timing from the original subtitles
                  if (!subtitle && isGrouped && result.original_ids) {
                    console.log(`Handling grouped subtitle ${subtitleId} with ${result.original_ids.length} original IDs`);

                    // Get all the original subtitles that are part of this group
                    const originalSubtitles = result.original_ids
                      .map(id => subtitleMap[id])
                      .filter(Boolean);

                    if (originalSubtitles.length > 0) {
                      // Calculate start and end times from the original subtitles
                      const start = Math.min(...originalSubtitles.map(sub => sub.start));
                      const end = Math.max(...originalSubtitles.map(sub => sub.end));

                      // Create a synthetic subtitle with the calculated timing
                      subtitle = {
                        id: subtitleId,
                        start,
                        end,
                        text: result.text
                      };

                      console.log(`Created synthetic timing for grouped subtitle ${subtitleId}: start=${start}, end=${end}`);
                    }
                  }

                  // If we found a matching subtitle or created synthetic timing, use it
                  if (subtitle && typeof subtitle.start === 'number' && typeof subtitle.end === 'number') {
                    return {
                      filename: result.filename,
                      subtitle_id: result.subtitle_id,
                      start: subtitle.start,
                      end: subtitle.end,
                      text: subtitle.text || result.text || '',
                      // Preserve original_ids if they exist
                      original_ids: result.original_ids || [subtitleId]
                    };
                  }

                  // Otherwise, use existing timing or defaults
                  return {
                    filename: result.filename,
                    subtitle_id: result.subtitle_id,
                    start: result.start || 0,
                    end: result.end || (result.start ? result.start + 5 : 5),
                    text: result.text || '',
                    // Preserve original_ids if they exist
                    original_ids: result.original_ids || [subtitleId]
                  };
                });

              // Sort by start time to ensure correct order
              narrationData.sort((a, b) => a.start - b.start);

              // EXACT same fetch call as downloadAlignedAudio
              const response = await fetch(`${SERVER_URL}/api/narration/download-aligned`, {
                method: 'POST',
                mode: 'cors',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'audio/wav'
                },
                body: JSON.stringify({ narrations: narrationData }),
                signal: session.controller.signal
              });

              // Check for audio alignment notification after successful response
              if (response.ok) {
                // Import and check for duration notification
                const { checkAudioAlignmentFromResponse } = await import('../../utils/audioAlignmentNotification.js');
                checkAudioAlignmentFromResponse(response);
              }

              // Check if the response is successful
              if (!response.ok) {
                // Try to parse error message if it's JSON
                try {
                  const errorData = await response.json();
                  throw new Error(errorData.error || 'Failed to generate aligned audio');
                } catch (jsonError) {
                  // If it's not JSON, use the status text
                  throw new Error(`Failed to generate aligned audio: ${response.statusText}`);
                }
              }

              // Get the blob from the response
              const blob = await response.blob();
              if (!isCurrentRefresh()) return;

              // Create a blob URL for the aligned narration service
              const blobUrl = URL.createObjectURL(blob);

              console.log('🎵 Aligned narration generated, integrating with service...');
              console.log('📦 Blob size:', blob.size, 'bytes');
              console.log('🔗 Blob URL:', blobUrl);

              // Use the proper aligned narration service
              const {
                getAlignedAudioElement
              } = await import('../../services/alignedNarrationService.js');
              if (!isCurrentRefresh()) {
                URL.revokeObjectURL(blobUrl);
                return;
              }

              // DON'T reset the audio element first - this clears the cache!
              // resetAlignedAudioElement();

              // Update the aligned narration cache FIRST (the service needs this)
              window.alignedNarrationCache = {
                blob: blob,
                url: blobUrl,
                timestamp: Date.now(),
                subtitleTimestamps: {}
              };
              console.log('💾 Updated alignedNarrationCache:', window.alignedNarrationCache);

              // Set a flag to indicate that aligned narration is available
              window.isAlignedNarrationAvailable = true;
              console.log('✅ Set isAlignedNarrationAvailable to true');

              // Now get the audio element using the service (this should work now)
              console.log('🎧 Getting audio element from service...');
              const audioElement = getAlignedAudioElement();
              console.log('🎧 Audio element:', audioElement);

              // The service MUST return an audio element or we have a bug
              if (!audioElement) {
                console.error('❌ CRITICAL: Service failed to create audio element');
                throw new Error('Service failed to create audio element');
              }

              console.log('🔧 Setting up audio element with blob URL...');
              audioElement.src = blobUrl;
              console.log('📍 Audio element src set to:', audioElement.src);

              audioElement.load();
              console.log('⏳ Audio element load() called');

              // Add event listeners to track audio loading
              audioElement.onloadstart = () => console.log('🔄 Audio loading started');
              audioElement.oncanplay = () => console.log('▶️ Audio can start playing');
              audioElement.oncanplaythrough = () => console.log('🎯 Audio can play through');
              audioElement.onerror = (e) => console.error('❌ Audio error:', e);
              audioElement.onloadeddata = () => console.log('📊 Audio data loaded');
              audioElement.onloadedmetadata = () => {
                console.log('📋 Audio metadata loaded - Duration:', audioElement.duration, 'seconds');
              };

              console.log('✅ Aligned narration audio element set up with service');

              console.log('📡 Dispatching aligned-narration-ready event...');
              // Notify the system that aligned narration is available
              // This will trigger the aligned narration hooks to start working
              window.dispatchEvent(new CustomEvent('aligned-narration-ready', {
                detail: {
                  url: blobUrl,
                  timestamp: Date.now()
                }
              }));

              console.log('📡 Dispatching aligned-narration-status event...');
              // Also dispatch the status event that the hooks listen for
              window.dispatchEvent(new CustomEvent('aligned-narration-status', {
                detail: {
                  status: 'complete',
                  message: 'Aligned narration generation complete',
                  isStillGenerating: false,
                  available: true,
                  url: blobUrl,
                  timestamp: Date.now()
                }
              }));

              setSyncSession({ video: session.video, url: session.url, audio: audioElement });

              console.log('✅ Aligned narration regenerated successfully and integrated with service');

            } catch (error) {
              if (!isCurrentRefresh() || error.name === 'AbortError') return;
              console.error('Error during aligned narration regeneration:', error);
              setError(error.message || 'Failed to refresh narration');
            } finally {
              if (refreshSession.current === session) setIsRefreshingNarration(false);
            }
          }}
          disabled={isRefreshingNarration}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            width: '100%',
            height: '100%',
            padding: '0 16px',
            opacity: isRefreshingNarration ? 0.7 : 1,
            cursor: isRefreshingNarration ? 'not-allowed' : 'pointer'
          }}>
            {isRefreshingNarration ? (
              // Show loading spinner when refreshing
              <>
                <svg className="spinner" width="22" height="22" viewBox="0 0 24 24" style={{ color: 'white', filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8))' }}>
                  <circle className="path" cx="12" cy="12" r="10" fill="none" strokeWidth="3"></circle>
                </svg>
                <span style={{ color: 'white', fontSize: '13px', fontWeight: '600', textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)' }}>
                  {t('preview.refreshingNarration', 'Refreshing...')}
                </span>
              </>
            ) : (
              // Show refresh icon when not refreshing
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white" style={{ filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8))' }}>
                  <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                </svg>
                <span style={{ color: 'white', fontSize: '13px', fontWeight: '600', textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)' }}>
                  {t('preview.refreshNarration', 'Refresh Narration')}
                </span>
              </>
            )}
          </div>
            </LiquidGlass>
          )}

          {/* Gemini FPS Info button - only show when custom controls are available */}
          {showCustomControls && (
            <LiquidGlass
              width="auto"
              height={50}
              position="relative"
              borderRadius="25px"
              className="content-center interactive theme-warning shape-circle"
              cursor="pointer"
              effectIntensity={0.7}
              effectRadius={0.6}
              effectWidth={0.4}
              effectHeight={0.4}
              animateOnHover={true}
              hoverScale={1.1}
              updateOnMouseMove={true}
              aria-label="Gemini FPS Info"
              style={{
                opacity: isFullscreen ? (controlsVisible ? 1 : 0) : (isVideoHovered || controlsVisible) ? 1 : 0,
                transition: 'opacity 0.6s ease-in-out',
                pointerEvents: isFullscreen ? (controlsVisible ? 'auto' : 'none') : (isVideoHovered || controlsVisible) ? 'auto' : 'none'
              }}
              onClick={() => {
                window.open('https://ai.google.dev/gemini-api/docs/video-understanding', '_blank');
              }}
            >
          <div
            title="Gemini chỉ xử lý 1FPS dù gửi video có FPS cao, bấm nút để xem thêm, vui lòng chọn Render Video để có chất lượng + FPS tốt nhất"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: '0 12px',
              minWidth: 'fit-content'
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white" style={{ filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8))' }}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
            </div>
          </LiquidGlass>
        )}
        </div>

        {/* Right side buttons */}
        <div style={{
          display: 'flex',
          gap: '10px',
          alignItems: 'center'
        }}>
          {/* Extract frame button - only show when custom controls are available */}
          {showCustomControls && (
            <LiquidGlass
              width="auto"
              height={50}
                  position="relative"
              borderRadius="25px"
              className="content-center interactive theme-info"
              cursor="pointer"
              effectIntensity={0.6}
              effectRadius={0.5}
              effectWidth={0.3}
              effectHeight={0.2}
              animateOnHover={true}
              hoverScale={1.05}
              updateOnMouseMove={false}
              style={{
                opacity: isFullscreen ? (controlsVisible ? 1 : 0) : (isVideoHovered || controlsVisible) ? 1 : 0,
                transition: 'opacity 0.6s ease-in-out',
                pointerEvents: isFullscreen ? (controlsVisible ? 'auto' : 'none') : (isVideoHovered || controlsVisible) ? 'auto' : 'none'
              }}
          aria-label={t('preview.extractFrame', 'Extract Frame')}
          onClick={async () => {
            try {
              const videoElement = document.querySelector('.native-video-container video');
              if (!videoElement) {
                console.error('Video element not found');
                return;
              }

              // Create canvas to capture current frame
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');

              // Set canvas dimensions to match video
              canvas.width = videoElement.videoWidth;
              canvas.height = videoElement.videoHeight;

              // Draw current video frame to canvas
              ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

              // Convert canvas to blob
              canvas.toBlob((blob) => {
                if (blob) {
                  // Create download link
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;

                  // Generate filename with timestamp
                  const currentTime = Math.floor(videoElement.currentTime);
                  const minutes = Math.floor(currentTime / 60);
                  const seconds = currentTime % 60;
                  const timestamp = `${minutes}m${seconds}s`;

                  link.download = `frame_${timestamp}.png`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);

                  console.log('Frame extracted successfully');
                } else {
                  console.error('Failed to create blob from canvas');
                }
              }, 'image/png');

            } catch (error) {
              console.error('Error extracting frame:', error);
            }
          }}
        >
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '0 16px',
            minWidth: 'fit-content',
            whiteSpace: 'nowrap'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white" style={{ filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8))' }}>
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
            <span style={{ color: 'white', fontSize: '13px', fontWeight: '600', textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)' }}>
              {t('preview.extractFrame', 'Extract Frame')}
            </span>
          </div>
          </LiquidGlass>
        )}

        {/* Download audio button - only show when custom controls are available */}
        {showCustomControls && (
          <LiquidGlass
            width="auto"
            height={50}
            position="relative"
            borderRadius="25px"
            className={`content-center interactive ${isAudioDownloading ? 'theme-secondary' : 'theme-success'}`}
            cursor={isAudioDownloading ? 'not-allowed' : 'pointer'}
            effectIntensity={isAudioDownloading ? 0.3 : 0.6}
            effectRadius={0.5}
            effectWidth={0.3}
            effectHeight={0.2}
            animateOnHover={!isAudioDownloading}
            hoverScale={1.05}
            updateOnMouseMove={false}
            aria-label={t('preview.downloadAudio', 'Download Audio')}
            style={{
              opacity: isFullscreen ? (controlsVisible ? 1 : 0) : (isVideoHovered || controlsVisible) ? 1 : 0,
              transition: 'opacity 0.6s ease-in-out',
              pointerEvents: isFullscreen ? (controlsVisible ? 'auto' : 'none') : (isVideoHovered || controlsVisible) ? 'auto' : 'none'
            }}
          onClick={async () => {
            if (isAudioDownloading) return; // Prevent multiple clicks

            // Get video title or use default
            const videoTitle = videoSource?.title || 'audio';
            // Always extract from the original video source.
            const currentVideoUrl = videoUrl;

            // Show loading state
            setError('');
            setIsAudioDownloading(true);

            // Extract and download audio - our utility function now handles blob URLs properly
            const success = await extractAndDownloadAudio(currentVideoUrl, videoTitle);

            // Reset loading state
            setIsAudioDownloading(false);

            // Show error if failed
            if (!success) {
              setError(t('preview.audioExtractionError', 'Failed to extract audio from video. Please try again.'));

              // Clear error after 5 seconds
              setTimeout(() => {
                setError('');
              }, 5000);
            }
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            width: '100%',
            height: '100%',
            opacity: isAudioDownloading ? 0.7 : 1,
            cursor: isAudioDownloading ? 'not-allowed' : 'pointer',
            padding: '0 16px',
            minWidth: 'fit-content',
            whiteSpace: 'nowrap'
          }}>
            {isAudioDownloading ? (
              // Material Design loading spinner
              <>
                <svg className="spinner" width="20" height="20" viewBox="0 0 24 24" style={{ color: 'white', filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8))' }}>
                  <circle className="path" cx="12" cy="12" r="10" fill="none" strokeWidth="3"></circle>
                </svg>
                <span style={{ color: 'white', fontSize: '13px', fontWeight: '600', textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)' }}>
                  {t('preview.downloadingAudio', 'Downloading...')}
                </span>
              </>
            ) : (
              // Material Design download icon
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white" style={{ filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8))' }}>
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                </svg>
                <span style={{ color: 'white', fontSize: '13px', fontWeight: '600', textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)' }}>
                  {t('preview.downloadAudio', 'Download Audio')}
                </span>
              </>
            )}
          </div>
        </LiquidGlass>
        )}
        </div>
      </div>
    </>
  );
};

export default VideoTopsideButtons;
