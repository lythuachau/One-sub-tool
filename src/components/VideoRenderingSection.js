import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import StandardSlider from './common/StandardSlider';
import SubtitleCustomizationPanel, { defaultCustomization } from './SubtitleCustomizationPanel';
import RemotionVideoPreview from './RemotionVideoPreview';
import QueueManagerPanel from './QueueManagerPanel';
import { SERVER_URL } from '../config';
import '../styles/VideoRenderingSection.css';

const VIDEO_RENDERER_URL = 'http://127.0.0.1:3033';

const VideoRenderingSection = ({
  selectedVideo,
  uploadedFile,
  actualVideoUrl,
  subtitlesData,
  translatedSubtitles,
  narrationResults,
  autoFillData = null
}) => {
  const { t } = useTranslation();
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStatus, setRenderStatus] = useState('');
  const [renderedVideoUrl, setRenderedVideoUrl] = useState('');
  const [error, setError] = useState('');
  const [currentRenderId, setCurrentRenderId] = useState(null);
  const [abortController, setAbortController] = useState(null);

  // Form state with localStorage persistence
  const [selectedVideoFile, setSelectedVideoFile] = useState(null);
  const [selectedSubtitles, setSelectedSubtitles] = useState(() => {
    return localStorage.getItem('videoRender_selectedSubtitles') || 'original';
  });
  const [selectedNarration, setSelectedNarration] = useState(() => {
    return localStorage.getItem('videoRender_selectedNarration') || 'none';
  });
  const [renderSettings, setRenderSettings] = useState(() => {
    const saved = localStorage.getItem('videoRender_renderSettings');
    return saved ? JSON.parse(saved) : {
      resolution: '1080p',
      frameRate: 60,
      videoType: 'Subtitled Video',
      originalAudioVolume: 100,
      narrationVolume: 100
    };
  });

  // New feature states with localStorage persistence
  const [subtitleCustomization, setSubtitleCustomization] = useState(() => {
    const saved = localStorage.getItem('videoRender_subtitleCustomization');
    return saved ? JSON.parse(saved) : defaultCustomization;
  });
  const [renderQueue, setRenderQueue] = useState([]);
  const [currentQueueItem, setCurrentQueueItem] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRefreshingNarration, setIsRefreshingNarration] = useState(false);
  const isRenderingRef = useRef(false);
  const renderQueueRef = useRef([]);
  const startNextPendingRenderRef = useRef(null);

  const setRenderingState = (value) => {
    isRenderingRef.current = value;
    setIsRendering(value);
  };

  // Panel resizing states with localStorage persistence
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const saved = localStorage.getItem('videoRender_leftPanelWidth');
    return saved ? parseFloat(saved) : 66.67; // Default 2fr = 66.67%
  });
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef(null);  // Collapsible state - always start collapsed by default (like BackgroundImageGenerator)
  const [isCollapsed, setIsCollapsed] = useState(true); // Always start collapsed
  const [userHasCollapsed, setUserHasCollapsed] = useState(false); // Track if user has manually collapsed

  // Panel resizing functionality
  const handleMouseDown = (e) => {
    setIsResizing(true);
    e.preventDefault();
  };

  const handleMouseMove = (e) => {
    if (!isResizing || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;

    // Constrain between 30% and 80%
    const constrainedWidth = Math.min(Math.max(newLeftWidth, 30), 75);
    setLeftPanelWidth(constrainedWidth);
  };

  const handleMouseUp = () => {
    setIsResizing(false);
  };

  // Add global mouse event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const sectionRef = useRef(null);
  // Auto-fill data when autoFillData changes - with improved state management
  useEffect(() => {
    if (autoFillData) {
      console.log('[VideoRenderingSection] Processing autoFillData:', autoFillData);

      // Expand if expansion is requested - override userHasCollapsed when explicitly requested
      if (autoFillData.expand) {
        setIsCollapsed(false);
        // Reset userHasCollapsed when auto-expanding via render button
        setUserHasCollapsed(false);
      }

      // Auto-fill video - prioritize videoFile from quality modal, then actual video URL
      if (autoFillData.videoFile) {
        // Use the video file selected from the quality modal
        setSelectedVideoFile(autoFillData.videoFile);
      } else if (actualVideoUrl) {
        // Create a video file object that represents the actual playing video
        setSelectedVideoFile({
          url: actualVideoUrl,
          name: selectedVideo?.title || uploadedFile?.name || 'Current Video',
          isActualVideo: true
        });
      }

      // Auto-fill subtitles based on available data
      if (translatedSubtitles && translatedSubtitles.length > 0) {
        setSelectedSubtitles('translated');
      } else if (subtitlesData && subtitlesData.length > 0) {
        setSelectedSubtitles('original');
      }

      // Auto-fill narration if available
      if (narrationResults && narrationResults.length > 0) {
        setSelectedNarration('generated');
      }

      // Auto-scroll ONLY if explicitly requested AND from the video-quality-modal
      if (autoFillData.expand && autoFillData.autoScroll && autoFillData.source === 'video-quality-modal') {
        console.log('[VideoRenderingSection] Auto-scrolling to rendering section from video quality modal');
        setTimeout(() => {
          sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else if (autoFillData.autoScroll && autoFillData.source !== 'video-quality-modal') {
        console.log('[VideoRenderingSection] Auto-scroll requested but blocked - source:', autoFillData.source);
      }
    }
  }, [autoFillData, actualVideoUrl, selectedVideo, uploadedFile, subtitlesData, translatedSubtitles, narrationResults, userHasCollapsed]);

  // Auto-process queue when it changes
  // Restore render state from localStorage on component mount
  useEffect(() => {
    const restoreRenderState = () => {
      try {
        const savedQueue = localStorage.getItem('videoRenderQueue');
        const savedCurrentItem = localStorage.getItem('currentRenderItem');
        const savedRenderId = localStorage.getItem('currentRenderId');

        if (savedQueue) {
          const parsedQueue = JSON.parse(savedQueue);
          setRenderQueue(parsedQueue);
        }

        if (savedCurrentItem && savedRenderId) {
          const parsedCurrentItem = JSON.parse(savedCurrentItem);
          setCurrentQueueItem(parsedCurrentItem);
          setCurrentRenderId(savedRenderId);

          // Check if the render is still active on the server
          checkRenderStatus(savedRenderId, parsedCurrentItem);
        }
      } catch (error) {
        console.error('Failed to restore render state:', error);
        // Clear corrupted data
        localStorage.removeItem('videoRenderQueue');
        localStorage.removeItem('currentRenderItem');
        localStorage.removeItem('currentRenderId');
      }
    };

    restoreRenderState();
  }, []);

  // Save render state to localStorage whenever it changes
  useEffect(() => {
    if (renderQueue.length > 0) {
      localStorage.setItem('videoRenderQueue', JSON.stringify(renderQueue));
    } else {
      localStorage.removeItem('videoRenderQueue');
    }
    renderQueueRef.current = renderQueue;
  }, [renderQueue]);

  useEffect(() => {
    isRenderingRef.current = isRendering;
  }, [isRendering]);

  useEffect(() => {
    if (currentQueueItem && currentRenderId) {
      localStorage.setItem('currentRenderItem', JSON.stringify(currentQueueItem));
      localStorage.setItem('currentRenderId', currentRenderId);
    } else {
      localStorage.removeItem('currentRenderItem');
      localStorage.removeItem('currentRenderId');
    }
  }, [currentQueueItem, currentRenderId]);

  // Save video rendering settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('videoRender_selectedSubtitles', selectedSubtitles);
  }, [selectedSubtitles]);

  useEffect(() => {
    localStorage.setItem('videoRender_selectedNarration', selectedNarration);
  }, [selectedNarration]);

  useEffect(() => {
    localStorage.setItem('videoRender_renderSettings', JSON.stringify(renderSettings));
  }, [renderSettings]);

  useEffect(() => {
    localStorage.setItem('videoRender_subtitleCustomization', JSON.stringify(subtitleCustomization));
  }, [subtitleCustomization]);
  useEffect(() => {
    localStorage.setItem('videoRender_leftPanelWidth', leftPanelWidth.toString());
  }, [leftPanelWidth]);

  // Note: isCollapsed state is not persisted - always starts collapsed like BackgroundImageGenerator

  // Check if a render is still active on the server and reconnect
  const checkRenderStatus = async (renderId, queueItem) => {
    try {
      const response = await fetch(`${VIDEO_RENDERER_URL}/render-status/${renderId}`);

      if (response.ok) {
        const data = await response.json();

        if (data.status === 'active') {
          // Render is still active, reconnect to it
          console.log('Reconnecting to active render:', renderId);
          setRenderingState(true);

          // Update queue item status to processing
          setRenderQueue(prev => prev.map(item =>
            item.id === queueItem.id ? { ...item, status: 'processing', progress: data.progress || 0 } : item
          ));

          // Reconnect to the render stream
          reconnectToRender(renderId, queueItem);
        } else if (data.status === 'completed') {
          // Render completed while user was away
          console.log('Render completed while away:', renderId);
          setRenderQueue(prev => prev.map(item =>
            item.id === queueItem.id
              ? { ...item, status: 'completed', progress: 100, outputPath: data.outputPath }
              : item
          ));
          setCurrentQueueItem(null);
          setCurrentRenderId(null);

          // Start next pending render if any
          setTimeout(() => startNextPendingRender(), 1000);
        } else {
          // Render failed or was cancelled
          console.log('Render failed or cancelled while away:', renderId);
          setRenderQueue(prev => prev.map(item =>
            item.id === queueItem.id
              ? { ...item, status: 'failed', error: data.error || 'Render failed while browser was closed' }
              : item
          ));
          setCurrentQueueItem(null);
          setCurrentRenderId(null);

          // Start next pending render if any
          setTimeout(() => startNextPendingRender(), 1000);
        }
      } else {
        // Server doesn't know about this render, mark as failed
        console.log('Server does not know about render:', renderId);
        setRenderQueue(prev => prev.map(item =>
          item.id === queueItem.id
            ? { ...item, status: 'failed', error: 'Render not found on server' }
            : item
        ));
        setCurrentQueueItem(null);
        setCurrentRenderId(null);
      }
    } catch (error) {
      console.error('Failed to check render status:', error);
      // Mark as failed if we can't check status
      setRenderQueue(prev => prev.map(item =>
        item.id === queueItem.id
          ? { ...item, status: 'failed', error: 'Could not reconnect to render' }
          : item
      ));
      setCurrentQueueItem(null);
      setCurrentRenderId(null);
    }
  };

  // Reconnect to an ongoing render stream
  const reconnectToRender = async (renderId, queueItem) => {
    try {
      // Create new abort controller for this reconnection
      const controller = new AbortController();
      setAbortController(controller);

      setRenderStatus(t('videoRendering.reconnecting', 'Reconnecting to render...'));

      // Connect to the render stream
      const response = await fetch(`${VIDEO_RENDERER_URL}/render-stream/${renderId}`, {
        method: 'GET',
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Failed to reconnect to render stream: ${response.status}`);
      }

      // Handle Server-Sent Events (same logic as in handleStartRender)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        // Check if the request was aborted
        if (controller.signal.aborted) {
          console.log('Reconnection stream reading aborted');
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.status === 'queued') {
                setRenderQueue(prev => prev.map(item =>
                  item.id === queueItem.id
                    ? { ...item, status: 'pending', queuePosition: data.queuePosition || 1 }
                    : item
                ));
                setRenderStatus(t('videoRendering.waitingForRenderer', 'Waiting for renderer slot #{{position}}...', {
                  position: data.queuePosition || 1
                }));
              } else if (data.status === 'started') {
                setRenderQueue(prev => prev.map(item =>
                  item.id === queueItem.id
                    ? { ...item, status: 'processing', queuePosition: 0 }
                    : item
                ));
                setRenderStatus(t('videoRendering.rendering', 'Rendering video...'));
              }

              // Handle progress updates
              if (data.progress !== undefined) {
                const progressPercent = Math.round(data.progress * 100);

                // Simple debug to see if frame data is received
                if (data.renderedFrames && data.durationInFrames) {
                  console.log(`Frames: ${data.renderedFrames}/${data.durationInFrames}`);
                }

                setRenderQueue(prev => prev.map(item =>
                  item.id === queueItem.id
                    ? {
                        ...item,
                        progress: progressPercent,
                        renderedFrames: data.renderedFrames,
                        durationInFrames: data.durationInFrames,
                        phase: data.phase,
                        phaseDescription: data.phaseDescription
                      }
                    : item
                ));

                setRenderProgress(progressPercent);

                // Use more detailed status messages based on phase
                if (data.phase === 'encoding' || data.phaseDescription) {
                  setRenderStatus(data.phaseDescription || t('videoRendering.encodingFrames', 'Encoding and stitching frames...'));
                } else if (data.renderedFrames && data.durationInFrames) {
                  setRenderStatus(t('videoRendering.renderingFramesDetailed', 'Rendering frames: {{rendered}}/{{total}}', {
                    rendered: data.renderedFrames,
                    total: data.durationInFrames
                  }));
                } else {
                  setRenderStatus(t('videoRendering.renderingFrames', 'Processing video frames...'));
                }
              }

              // Handle completion
              if (data.status === 'complete' && data.videoUrl) {
                setRenderedVideoUrl(data.videoUrl);
                setRenderStatus(t('videoRendering.complete', 'Render complete!'));
                setRenderProgress(100);

                setRenderQueue(prev => prev.map(item =>
                  item.id === queueItem.id
                    ? { ...item, status: 'completed', progress: 100, outputPath: data.videoUrl }
                    : item
                ));

                setCurrentQueueItem(null);
                setTimeout(() => startNextPendingRender(), 1000);
                break;
              }

              // Handle cancellation
              if (data.status === 'cancelled') {
                setRenderStatus(t('videoRendering.cancelled', 'Render cancelled'));
                setRenderProgress(0);

                setRenderQueue(prev => prev.map(item =>
                  item.id === queueItem.id
                    ? { ...item, status: 'failed', progress: 0, error: 'Render was cancelled' }
                    : item
                ));
                break;
              }

              // Handle errors
              if (data.status === 'error') {
                const errorMessage = data.error || t('videoRendering.unknownError', 'Unknown error occurred');

                setRenderQueue(prev => prev.map(item =>
                  item.id === queueItem.id
                    ? { ...item, status: 'failed', error: errorMessage }
                    : item
                ));

                throw new Error(errorMessage);
              }
            } catch (parseError) {
              console.warn('Failed to parse SSE data during reconnection:', parseError);
            }
          }
        }
      }

    } catch (error) {
      console.error('Reconnection error:', error);

      if (error.name === 'AbortError') {
        console.log('Reconnection was aborted');
        setRenderStatus(t('videoRendering.cancelled', 'Render cancelled'));
        setRenderProgress(0);

        setRenderQueue(prev => prev.map(item =>
          item.id === queueItem.id
            ? { ...item, status: 'failed', progress: 0, error: 'Render was cancelled' }
            : item
        ));
      } else {
        setError(error.message);
        setRenderStatus(t('videoRendering.failed', 'Render failed'));

        setRenderQueue(prev => prev.map(item =>
          item.id === queueItem.id
            ? { ...item, status: 'failed', error: error.message }
            : item
        ));
      }
    } finally {
      setRenderingState(false);
      setCurrentRenderId(null);
      setAbortController(null);
      setCurrentQueueItem(null);
      setTimeout(() => startNextPendingRender(), 1000);
    }
  };

  // Get current subtitles based on selection
  const getCurrentSubtitles = () => {
    if (selectedSubtitles === 'translated' && translatedSubtitles && translatedSubtitles.length > 0) {
      return translatedSubtitles;
    }
    return subtitlesData || [];
  };

  // Check if aligned narration is available (same logic as refresh narration button)
  const isAlignedNarrationAvailable = () => {
    return window.isAlignedNarrationAvailable === true && window.alignedNarrationCache?.url;
  };

  // Check if individual narration segments are available (not the aligned audio)
  const hasNarrationSegments = () => {
    // Check props first
    if (narrationResults && narrationResults.length > 0) {
      // Check if any narration has success=true (meaning individual segments exist)
      const hasSuccessfulNarrations = narrationResults.some(result => result.success === true);
      if (hasSuccessfulNarrations) return true;
    }

    // Check window objects (where narrations are actually stored)
    const originalNarrations = window.originalNarrations || [];
    const translatedNarrations = window.translatedNarrations || [];
    const groupedNarrations = window.groupedNarrations || [];

    // Check if any narration segments have success=true
    const hasOriginalSegments = originalNarrations.some(result => result.success === true);
    const hasTranslatedSegments = translatedNarrations.some(result => result.success === true);
    const hasGroupedSegments = groupedNarrations.some(result => result.success === true);

    return hasOriginalSegments || hasTranslatedSegments || hasGroupedSegments;
  };

  // Get narration audio URL if available - same as refresh narration button
  const getNarrationAudioUrl = async () => {
    // First check if aligned narration is already available
    if (isAlignedNarrationAvailable()) {
      return window.alignedNarrationCache.url;
    }

    // If not available and user selected generated narration, try to generate it
    if (selectedNarration === 'generated' && narrationResults && narrationResults.length > 0) {
      try {
        // Use the same logic as the refresh narration button
        const narrationData = narrationResults.map(result => ({
          filename: result.filename,
          start_time: result.start_time,
          end_time: result.end_time,
          subtitle_id: result.subtitle_id
        }));

        // Call the same endpoint as refresh narration button
        const response = await fetch(`http://localhost:3031/api/narration/download-aligned`, {
          method: 'POST',
          mode: 'cors',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'audio/wav'
          },
          body: JSON.stringify({ narrations: narrationData })
        });

        if (response.ok) {
          // Check for audio alignment notification
          const { checkAudioAlignmentFromResponse } = await import('../utils/audioAlignmentNotification.js');
          checkAudioAlignmentFromResponse(response);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);

          // Update the cache like the refresh button does
          window.alignedNarrationCache = {
            blob: blob,
            url: url,
            timestamp: Date.now(),
            subtitleTimestamps: {}
          };
          window.isAlignedNarrationAvailable = true;

          return url;
        }
      } catch (error) {
        console.error('Failed to get aligned narration:', error);
      }
    }
    return null;
  };

  // Refresh narration function - same logic as the main video player
  const handleRefreshNarration = async () => {
    if (isRefreshingNarration) return;

    try {
      setIsRefreshingNarration(true);

      // Get narrations from window object
      const isUsingGroupedSubtitles = window.useGroupedSubtitles || false;
      const groupedNarrations = window.groupedNarrations || [];
      const originalNarrations = window.originalNarrations || [];

      // Use grouped narrations if available and enabled, otherwise use original narrations
      const narrations = (isUsingGroupedSubtitles && groupedNarrations.length > 0)
        ? groupedNarrations
        : originalNarrations;

      console.log(`Using ${isUsingGroupedSubtitles ? 'grouped' : 'original'} narrations for alignment. Found ${narrations.length} narrations.`);

      // Check if we have any narration results
      if (!narrations || narrations.length === 0) {
        console.error('No narration results available in window objects');

        // Try to reconstruct narration results from the file system
        const allSubtitles = window.subtitlesData || window.originalSubtitles || [];

        if (allSubtitles.length === 0) {
          throw new Error('No narration results or subtitles available for alignment');
        }

        // Create synthetic narration objects based on subtitles
        const syntheticNarrations = allSubtitles.map(subtitle => ({
          subtitle_id: subtitle.id,
          filename: `subtitle_${subtitle.id}/1.wav`,
          success: true,
          start: subtitle.start,
          end: subtitle.end,
          text: subtitle.text
        }));

        // Use these synthetic narrations
        narrations.length = 0;
        narrations.push(...syntheticNarrations);

        // Also update the window object for future use
        window.originalNarrations = [...syntheticNarrations];
      }

      // Force reset the aligned narration cache
      if (typeof window.resetAlignedNarration === 'function') {
        window.resetAlignedNarration();
      }

      // Clean up any existing audio elements
      if (window.alignedAudioElement) {
        try {
          window.alignedAudioElement.pause();
          window.alignedAudioElement.src = '';
          window.alignedAudioElement.load();
          window.alignedAudioElement = null;
        } catch (e) {
          console.warn('Error cleaning up window.alignedAudioElement:', e);
        }
      }

      // Get all subtitles from the window object
      const allSubtitles = isUsingGroupedSubtitles && window.groupedSubtitles ?
        window.groupedSubtitles :
        (window.subtitlesData || window.originalSubtitles || []);

      // Create a map for faster lookup
      const subtitleMap = {};
      allSubtitles.forEach(sub => {
        if (sub.id !== undefined) {
          subtitleMap[sub.id] = sub;
        }
      });

      // Prepare the data for the aligned narration with correct timing
      const narrationData = narrations
        .filter(result => {
          if (result.success && result.filename) {
            return true;
          }
          if (result.success && !result.filename && result.subtitle_id) {
            result.filename = `subtitle_${result.subtitle_id}/1.wav`;
            return true;
          }
          return false;
        })
        .map(result => {
          const subtitle = subtitleMap[result.subtitle_id];
          if (subtitle && typeof subtitle.start === 'number' && typeof subtitle.end === 'number') {
            return {
              filename: result.filename,
              subtitle_id: result.subtitle_id,
              start: subtitle.start,
              end: subtitle.end,
              text: subtitle.text || result.text || ''
            };
          }
          return {
            filename: result.filename,
            subtitle_id: result.subtitle_id,
            start: 0,
            end: 5,
            text: result.text || ''
          };
        });

      // Sort by start time to ensure correct order
      narrationData.sort((a, b) => a.start - b.start);

      if (narrationData.length === 0) {
        throw new Error('No valid narration files found. Please generate narrations first.');
      }

      // Call the same endpoint as refresh narration button
      const response = await fetch(`http://localhost:3031/api/narration/download-aligned`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'audio/wav'
        },
        body: JSON.stringify({ narrations: narrationData })
      });

      // Check for audio alignment notification after successful response
      if (response.ok) {
        const { checkAudioAlignmentFromResponse } = await import('../utils/audioAlignmentNotification.js');
        checkAudioAlignmentFromResponse(response);
      }

      if (!response.ok) {
        const errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error && errorJson.error.includes('Audio file not found')) {
            throw new Error(`Some narration files are missing. Please regenerate narrations before refreshing.`);
          } else {
            throw new Error(`Failed to generate aligned audio: ${errorJson.error || response.statusText}`);
          }
        } catch (jsonError) {
          throw new Error(`Failed to generate aligned audio: ${errorText || response.statusText}`);
        }
      }

      // Get the blob from the response
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      // Update the aligned narration cache
      window.alignedNarrationCache = {
        blob: blob,
        url: url,
        timestamp: Date.now(),
        subtitleTimestamps: {}
      };

      // Set a flag to indicate that aligned narration is available
      window.isAlignedNarrationAvailable = true;

      // Notify the system that aligned narration is available
      window.dispatchEvent(new CustomEvent('aligned-narration-ready', {
        detail: {
          url: url,
          timestamp: Date.now()
        }
      }));

    } catch (error) {
      console.error('Error during aligned narration regeneration:', error);
      setError(error.message || 'Failed to refresh narration');
    } finally {
      setIsRefreshingNarration(false);
    }
  };

  // Handle video file upload
  const handleVideoUpload = async (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedVideoFile(file);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const videoFile = files.find(file => file.type.startsWith('video/') || file.type.startsWith('audio/'));
      if (videoFile) {
        setSelectedVideoFile(videoFile);
      }
    }
  };

  // Upload file to video-renderer server
  const ensureVideoRenderer = async () => {
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(`${SERVER_URL}/api/video-renderer/ensure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok && data.success) {
          return data;
        }

        lastError = data.error || `Renderer startup failed with status ${response.status}`;
      } catch (requestError) {
        lastError = requestError.message;
      }

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, [1000, 3000][attempt - 1]));
      }
    }

    throw new Error(`Video renderer unavailable at localhost:3033. ${lastError || 'Start the renderer service and try again.'}`);
  };

  const uploadFileToRenderer = async (file, type = 'video') => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${VIDEO_RENDERER_URL}/upload/${type}`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Failed to upload ${type}`);
    }

    const data = await response.json();
    return data.filename;
  };

  // Download video from URL and upload to renderer
  const downloadVideoFromUrl = async (videoUrl) => {
    // Handle blob URLs differently - they can't be fetched from server
    if (videoUrl.startsWith('blob:')) {
      throw new Error('Blob URLs cannot be downloaded from server. Please upload the original file.');
    }

    // Fetch the video from the URL
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error('Failed to download video from URL');
    }

    // Convert to blob
    const blob = await response.blob();

    // Create a File object from the blob
    const file = new File([blob], 'video.mp4', { type: 'video/mp4' });

    // Upload to renderer
    return await uploadFileToRenderer(file, 'video');
  };

  // Convert blob URL to File object for upload
  const convertBlobUrlToFile = async (blobUrl, filename = 'video.mp4') => {
    try {
      // Fetch the blob from the blob URL
      const response = await fetch(blobUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch blob');
      }

      const blob = await response.blob();

      // Create a File object from the blob
      return new File([blob], filename, { type: blob.type || 'video/mp4' });
    } catch (error) {
      console.error('Error converting blob URL to file:', error);
      throw new Error('Failed to convert blob URL to file');
    }
  };

  // Simple render function - allows queueing multiple renders
  const handleRender = async () => {
    const shouldStartImmediately = !isRenderingRef.current;

    // Create queue item for display
    const queueItem = {
      id: `render_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      videoFile: selectedVideoFile,
      subtitles: selectedSubtitles,
      settings: renderSettings,
      customization: subtitleCustomization,
      status: shouldStartImmediately ? 'processing' : 'pending',
      progress: 0,
      timestamp: Date.now(), // Store as timestamp number, not formatted string
      outputPath: null,
      error: null
    };

    // Always add to queue for display
    setRenderQueue(prev => {
      const nextQueue = [queueItem, ...prev];
      renderQueueRef.current = nextQueue;
      return nextQueue;
    });

    // If not currently rendering, start this one immediately
    if (shouldStartImmediately) {
      isRenderingRef.current = true;
      setCurrentQueueItem(queueItem);
      await handleStartRender(queueItem);
    }
  };

  // Simple function to start next pending render
  const startNextPendingRender = async () => {
    // Find the next pending item
    const nextItem = renderQueueRef.current.find(item => item.status === 'pending');
    if (!nextItem || isRenderingRef.current) return;

    // Mark as processing and start
    setRenderQueue(prev => {
      const nextQueue = prev.map(item =>
        item.id === nextItem.id ? { ...item, status: 'processing' } : item
      );
      renderQueueRef.current = nextQueue;
      return nextQueue;
    });
    isRenderingRef.current = true;
    setCurrentQueueItem(nextItem);
    await handleStartRender(nextItem);
  };

  startNextPendingRenderRef.current = startNextPendingRender;

  useEffect(() => {
    if (!selectedVideoFile || currentQueueItem || isRenderingRef.current) return undefined;
    if (!renderQueueRef.current.some(item => item.status === 'pending')) return undefined;

    const timer = setTimeout(() => {
      startNextPendingRenderRef.current?.();
    }, 0);

    return () => clearTimeout(timer);
  }, [selectedVideoFile, renderQueue, currentQueueItem]);

  // Start rendering
  const handleStartRender = async (queueItem = null) => {
    // Create abort controller for this render
    const controller = new AbortController();
    setAbortController(controller);

    try {
      setRenderingState(true);
      setRenderProgress(0);
      setRenderStatus(t('videoRendering.starting', 'Starting render...'));
      setError('');
      setRenderedVideoUrl('');

      // Validate inputs
      if (!selectedVideoFile) {
        throw new Error(t('videoRendering.noVideoSelected', 'Please select a video file'));
      }

      const currentSubtitles = getCurrentSubtitles();
      if (!currentSubtitles || currentSubtitles.length === 0) {
        throw new Error(t('videoRendering.noSubtitles', 'No subtitles available'));
      }

      // Upload video file if it's a File object
      setRenderStatus(t('videoRendering.startingRenderer', 'Starting video renderer...'));
      await ensureVideoRenderer();

      let audioFile;
      if (selectedVideoFile instanceof File) {
        setRenderStatus(t('videoRendering.uploadingVideo', 'Uploading video...'));
        audioFile = await uploadFileToRenderer(selectedVideoFile, 'video');
      } else if (selectedVideoFile && typeof selectedVideoFile === 'object' && selectedVideoFile.url) {
        // If it's the actual video URL from the player
        if (selectedVideoFile.isActualVideo) {
          // Check if it's a blob URL
          if (selectedVideoFile.url.startsWith('blob:')) {
            setRenderStatus(t('videoRendering.convertingVideo', 'Converting video...'));
            // Convert blob URL to File and upload
            const videoFile = await convertBlobUrlToFile(selectedVideoFile.url, selectedVideoFile.name || 'video.mp4');
            setRenderStatus(t('videoRendering.uploadingVideo', 'Uploading video...'));
            audioFile = await uploadFileToRenderer(videoFile, 'video');
          } else {
            setRenderStatus(t('videoRendering.downloadingVideo', 'Downloading video...'));
            audioFile = await downloadVideoFromUrl(selectedVideoFile.url);
          }
        } else {
          throw new Error(t('videoRendering.urlNotSupported', 'URL videos not yet supported. Please upload a file.'));
        }
      } else {
        throw new Error(t('videoRendering.invalidVideoFile', 'Invalid video file. Please select a valid video file.'));
      }

      // Upload narration audio if selected and get HTTP URL
      let narrationUrl = null;
      if (selectedNarration === 'generated') {
        setRenderStatus(t('videoRendering.preparingNarration', 'Preparing narration...'));
        const narrationBlobUrl = await getNarrationAudioUrl();
        if (narrationBlobUrl) {
          setRenderStatus(t('videoRendering.uploadingNarration', 'Uploading narration...'));

          // Handle blob URLs for narration audio
          let narrationFileObj;
          if (narrationBlobUrl.startsWith('blob:')) {
            // Convert blob URL to File object (client-side)
            const narrationResponse = await fetch(narrationBlobUrl);
            const narrationBlob = await narrationResponse.blob();
            narrationFileObj = new File([narrationBlob], 'narration.wav', { type: 'audio/wav' });
          } else {
            // Handle HTTP URLs
            const narrationResponse = await fetch(narrationBlobUrl);
            if (!narrationResponse.ok) {
              throw new Error('Failed to download narration from URL');
            }
            const narrationBlob = await narrationResponse.blob();
            narrationFileObj = new File([narrationBlob], 'narration.wav', { type: 'audio/wav' });
          }

          // Upload the file to renderer and get HTTP URL
          const uploadedNarrationFilename = await uploadFileToRenderer(narrationFileObj, 'audio');
          narrationUrl = `${VIDEO_RENDERER_URL}/uploads/${uploadedNarrationFilename}`;
        }
      }

      // Prepare render request
      const renderRequest = {
        compositionId: 'subtitled-video',
        audioFile: audioFile,
        lyrics: currentSubtitles,
        metadata: {
          ...renderSettings,
          subtitleCustomization: queueItem.customization // Include subtitle customization in metadata
        },
        narrationUrl: narrationUrl, // Use HTTP URL instead of blob URL
        isVideoFile: true
      };

      setRenderStatus(t('videoRendering.rendering', 'Rendering video...'));

      // The renderer may have been restarted while files were being prepared.
      await ensureVideoRenderer();

      // Send the POST request for rendering
      const response = await fetch(`${VIDEO_RENDERER_URL}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(renderRequest),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Render request failed: ${response.status}`);
      }

      // Capture the render ID from response headers
      const renderId = response.headers.get('X-Render-ID');
      console.log('Response headers:', Array.from(response.headers.entries()));
      console.log('Extracted render ID:', renderId);
      if (renderId) {
        setCurrentRenderId(renderId);
        console.log('Render started with ID:', renderId);
      } else {
        console.warn('No render ID found in response headers');
      }

      // Handle Server-Sent Events
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        // Check if the request was aborted
        if (controller.signal.aborted) {
          console.log('Stream reading aborted');
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.status === 'queued') {
                const targetQueueItem = queueItem || currentQueueItem;
                if (targetQueueItem) {
                  setRenderQueue(prev => prev.map(item =>
                    item.id === targetQueueItem.id
                      ? { ...item, status: 'pending', queuePosition: data.queuePosition || 1 }
                      : item
                  ));
                }
                setRenderStatus(t('videoRendering.waitingForRenderer', 'Waiting for renderer slot #{{position}}...', {
                  position: data.queuePosition || 1
                }));
              } else if (data.status === 'started') {
                const targetQueueItem = queueItem || currentQueueItem;
                if (targetQueueItem) {
                  setRenderQueue(prev => prev.map(item =>
                    item.id === targetQueueItem.id
                      ? { ...item, status: 'processing', queuePosition: 0 }
                      : item
                  ));
                }
                setRenderStatus(t('videoRendering.rendering', 'Rendering video...'));
              }

              // Handle Chrome download progress for first-time users
              if (data.chromeDownload) {
                const { downloaded, total } = data.chromeDownload;
                const downloadProgress = Math.round((downloaded / total) * 100);
                setRenderProgress(downloadProgress);
                setRenderStatus(t('videoRendering.downloadingChrome', 'First-time setup: Downloading Chrome browser... {{progress}}%', {
                  progress: downloadProgress
                }));
              }
              // Handle bundling progress
              else if (data.bundling) {
                setRenderProgress(10);
                setRenderStatus(t('videoRendering.bundling', 'Preparing video components...'));
              }
              // Handle composition selection
              else if (data.composition) {
                setRenderProgress(20);
                setRenderStatus(t('videoRendering.selectingComposition', 'Setting up video composition...'));
              }
              // Handle regular render progress - update queue item instead of global state
              else if (data.progress !== undefined) {
                const progressPercent = Math.round(data.progress * 100);

                // Simple debug to see if frame data is received
                if (data.renderedFrames && data.durationInFrames) {
                  console.log(`Main render frames: ${data.renderedFrames}/${data.durationInFrames}`);
                }

                // Update the queue item's progress (use passed queueItem or fallback to currentQueueItem)
                const targetQueueItem = queueItem || currentQueueItem;
                if (targetQueueItem) {
                  setRenderQueue(prev => prev.map(item =>
                    item.id === targetQueueItem.id
                      ? {
                          ...item,
                          progress: progressPercent,
                          renderedFrames: data.renderedFrames,
                          durationInFrames: data.durationInFrames,
                          phase: data.phase,
                          phaseDescription: data.phaseDescription
                        }
                      : item
                  ));
                }

                // Keep legacy progress for any remaining external displays (but we'll remove these)
                setRenderProgress(progressPercent);

                // Use more detailed status messages based on phase
                if (data.phase === 'encoding' || data.phaseDescription) {
                  setRenderStatus(data.phaseDescription || t('videoRendering.encodingFrames', 'Encoding and stitching frames...'));
                } else if (data.renderedFrames && data.durationInFrames) {
                  setRenderStatus(t('videoRendering.renderingFramesDetailed', 'Rendering frames: {{rendered}}/{{total}}', {
                    rendered: data.renderedFrames,
                    total: data.durationInFrames
                  }));
                } else {
                  setRenderStatus(t('videoRendering.renderingFrames', 'Processing video frames...'));
                }
              }

              if (data.status === 'complete' && data.videoUrl) {
                setRenderedVideoUrl(data.videoUrl);
                setRenderStatus(t('videoRendering.complete', 'Render complete!'));
                setRenderProgress(100);

                // Update the queue item as completed (use passed queueItem or fallback to currentQueueItem)
                const targetQueueItem = queueItem || currentQueueItem;
                if (targetQueueItem) {
                  setRenderQueue(prev => prev.map(item =>
                    item.id === targetQueueItem.id
                      ? { ...item, status: 'completed', progress: 100, outputPath: data.videoUrl }
                      : item
                  ));
                }

                // Render complete - reset state and start next
                setCurrentQueueItem(null);
                setTimeout(() => startNextPendingRender(), 1000);
                break;
              }

              if (data.status === 'cancelled') {
                setRenderStatus(t('videoRendering.cancelled', 'Render cancelled'));
                setRenderProgress(0);

                // Update the queue item as cancelled (use passed queueItem or fallback to currentQueueItem)
                const targetQueueItem = queueItem || currentQueueItem;
                if (targetQueueItem) {
                  setRenderQueue(prev => prev.map(item =>
                    item.id === targetQueueItem.id
                      ? { ...item, status: 'failed', progress: 0, error: 'Render was cancelled' }
                      : item
                  ));
                }
                break;
              }

              if (data.status === 'error') {
                const errorMessage = data.error || t('videoRendering.unknownError', 'Unknown error occurred');

                // Update the queue item as failed (use passed queueItem or fallback to currentQueueItem)
                const targetQueueItem = queueItem || currentQueueItem;
                if (targetQueueItem) {
                  setRenderQueue(prev => prev.map(item =>
                    item.id === targetQueueItem.id
                      ? { ...item, status: 'failed', error: errorMessage }
                      : item
                  ));
                }

                throw new Error(errorMessage);
              }
            } catch (parseError) {
              console.warn('Failed to parse SSE data:', parseError);
            }
          }
        }
      }

    } catch (error) {
      console.error('Render error:', error);

      // Check if this was an abort (cancellation)
      if (error.name === 'AbortError') {
        console.log('Render was aborted');
        setRenderStatus(t('videoRendering.cancelled', 'Render cancelled'));
        setRenderProgress(0);

        // Update queue item as cancelled (use passed queueItem or fallback to currentQueueItem)
        const targetQueueItem = queueItem || currentQueueItem;
        if (targetQueueItem) {
          setRenderQueue(prev => prev.map(item =>
            item.id === targetQueueItem.id
              ? { ...item, status: 'failed', progress: 0, error: 'Render was cancelled' }
              : item
          ));
        }
      } else {
        setError(error.message);
        setRenderStatus(t('videoRendering.failed', 'Render failed'));

        // Update queue item as failed (use passed queueItem or fallback to currentQueueItem)
        const targetQueueItem = queueItem || currentQueueItem;
        if (targetQueueItem) {
          setRenderQueue(prev => prev.map(item =>
            item.id === targetQueueItem.id
              ? { ...item, status: 'failed', error: error.message }
              : item
          ));
        }
      }
    } finally {
      setRenderingState(false);
      setCurrentRenderId(null);
      setAbortController(null);

      // Render finished - reset state and start next
      setCurrentQueueItem(null);
      setTimeout(() => startNextPendingRender(), 1000);
    }
  };

  // Cancel rendering
  const handleCancelRender = async () => {
    // First, abort the fetch request if we have an abort controller
    if (abortController) {
      abortController.abort();
    }

    // Update status immediately to show cancellation is in progress
    setRenderStatus(t('videoRendering.cancelling', 'Cancelling render...'));

    if (!currentRenderId) {
      setRenderingState(false);
      setRenderStatus(t('videoRendering.cancelled', 'Render cancelled'));
      setAbortController(null);
      setCurrentQueueItem(null);
      setTimeout(() => startNextPendingRender(), 1000);
      return;
    }

    try {
      // Call the cancel endpoint on the server
      const response = await fetch(`${VIDEO_RENDERER_URL}/cancel-render/${currentRenderId}`, {
        method: 'POST'
      });

      if (response.ok) {
        // Don't set isRendering to false here - let the stream reading loop handle it
        // when it receives the cancelled status or when the abort happens
      } else {
        const errorText = await response.text();
        console.error('Failed to cancel render:', errorText);
        setRenderStatus(t('videoRendering.cancelFailed', 'Failed to cancel render'));
        // Force cleanup on server cancel failure
        setRenderingState(false);
        setCurrentRenderId(null);
        setAbortController(null);
        setCurrentQueueItem(null);
        setTimeout(() => startNextPendingRender(), 1000);
      }
    } catch (error) {
      console.error('Error cancelling render:', error);
      setRenderStatus(t('videoRendering.cancelError', 'Error cancelling render'));
      // Force cleanup on error
      setRenderingState(false);
      setCurrentRenderId(null);
      setAbortController(null);
      setCurrentQueueItem(null);
      setTimeout(() => startNextPendingRender(), 1000);
    }
  };

  // Simple queue management functions

  const removeFromQueue = (id) => {
    setRenderQueue(prev => prev.filter(item => item.id !== id));
  };

  const clearQueue = () => {
    setRenderQueue(prev => prev.filter(item => item.status === 'processing'));
  };

  const retryQueueItem = (id) => {
    // Mark as pending and start next render if not currently rendering
    setRenderQueue(prev => prev.map(item =>
      item.id === id ? { ...item, status: 'pending', progress: 0, error: null } : item
    ));

    if (!isRendering) {
      setTimeout(() => startNextPendingRender(), 100);
    }
  };

  // No automatic queue processing - simple render history display

  return (
    <div
      ref={sectionRef}
      className={`video-rendering-section ${isCollapsed ? 'collapsed' : 'expanded'} ${isDragging ? 'dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Header - matching background-generator-header */}
      <div className="video-rendering-header">
        <div className="header-left">
          <h2>{t('videoRendering.title', 'Video Rendering')}</h2>
        </div>
        <button
          className="collapse-button"
          onClick={() => {
            // Toggle collapsed state - matches BackgroundImageGenerator pattern
            const newCollapsedState = !isCollapsed;
            setIsCollapsed(newCollapsedState);

            // Set userHasCollapsed flag when user manually collapses
            if (newCollapsedState) {
              setUserHasCollapsed(true);
            } else {
              // Reset the flag when user manually expands
              setUserHasCollapsed(false);
            }
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <h3>{t('videoRendering.dropVideo', 'Drop video file here')}</h3>
          </div>
        </div>
      )}

      {/* Collapsed content */}
      {isCollapsed ? (
        <div className="video-rendering-collapsed-content">
          <p className="helper-message">
            {t('videoRendering.helperMessage', 'Configure video rendering settings and generate your final video with subtitles and narration')}
          </p>
        </div>
      ) : (
        /* Expanded content */
        <div className="video-rendering-content">
          {/* First row: Video Input, Subtitle Source, and Narration Audio in one line */}
          <div className="input-selection-row">
            {/* Video Input */}
            <div className="video-input-compact">
              <h4>{t('videoRendering.videoInput', 'Video Input')}</h4>
              {selectedVideoFile ? (
                <div className="selected-video-info">
                  <span className="video-name">
                    {(selectedVideoFile instanceof File ? selectedVideoFile.name :
                      (selectedVideoFile.name || selectedVideoFile.title || 'Current Video'))}
                  </span>
                  {selectedVideoFile.isActualVideo && (
                    <span className="video-source-indicator">
                      {t('videoRendering.fromPlayer', '(from video player)')}
                    </span>
                  )}
                  <button
                    className="pill-button secondary"
                    onClick={() => document.getElementById('video-upload-input').click()}
                  >
                    {t('videoRendering.changeVideo', 'Change')}
                  </button>
                </div>
              ) : (
                <div className="upload-drop-zone">
                  <button
                    className="pill-button primary"
                    onClick={() => document.getElementById('video-upload-input').click()}
                  >
                    {t('videoRendering.selectVideo', 'Select Video File')}
                  </button>
                  <span className="drop-text">
                    {t('videoRendering.orDragDrop', 'or drag and drop here')}
                  </span>
                </div>
              )}
              <input
                id="video-upload-input"
                type="file"
                accept="video/*,audio/*"
                onChange={handleVideoUpload}
                style={{ display: 'none' }}
              />
            </div>

            {/* Subtitle Selection */}
            <div className="subtitle-selection-compact">
              <h4>
                {t('videoRendering.subtitleSource', 'Subtitle Source')}
                <div
                  className="help-icon-container"
                  title={t('videoRendering.subtitleSourceHelp', 'You can use the Upload SRT/JSON button to upload your own subtitle files')}
                >
                  <svg className="help-icon" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                </div>
              </h4>
              <div className="radio-group">
                <div className="radio-option">
                  <input
                    type="radio"
                    id="subtitle-original"
                    value="original"
                    checked={selectedSubtitles === 'original'}
                    onChange={(e) => setSelectedSubtitles(e.target.value)}
                    disabled={!subtitlesData || subtitlesData.length === 0}
                  />
                  <label htmlFor="subtitle-original">
                    {t('videoRendering.originalSubtitles', 'Original Subtitles')}
                    <span className="item-count">
                      ({subtitlesData ? subtitlesData.length : 0} {t('videoRendering.items', 'items')})
                    </span>
                  </label>
                </div>
                <div className="radio-option">
                  <input
                    type="radio"
                    id="subtitle-translated"
                    value="translated"
                    checked={selectedSubtitles === 'translated'}
                    onChange={(e) => setSelectedSubtitles(e.target.value)}
                    disabled={!translatedSubtitles || translatedSubtitles.length === 0}
                  />
                  <label htmlFor="subtitle-translated">
                    {t('videoRendering.translatedSubtitles', 'Translated Subtitles')}
                    <span className="item-count">
                      ({translatedSubtitles ? translatedSubtitles.length : 0} {t('videoRendering.items', 'items')})
                    </span>
                  </label>
                </div>
              </div>

              {/* Original Audio Volume Control */}
              <div className="compact-volume-control">
                <label className="volume-label">{t('videoRendering.originalAudioVolume', 'Original Audio Volume')}: {renderSettings.originalAudioVolume}%</label>
                <StandardSlider
                  value={renderSettings.originalAudioVolume}
                  onChange={(value) => setRenderSettings(prev => ({ ...prev, originalAudioVolume: parseInt(value) }))}
                  min={0}
                  max={100}
                  step={1}
                  orientation="Horizontal"
                  size="XSmall"
                  state="Enabled"
                  width="compact"
                  showValueIndicator={false} // Using custom label
                  showIcon={false}
                  showStops={false}
                  className="original-audio-volume-slider"
                  id="original-audio-volume"
                  ariaLabel={t('videoRendering.originalAudioVolume', 'Original Audio Volume')}
                />
              </div>
            </div>

            {/* Narration Selection */}
            <div className="narration-selection-compact">
              <h4>{t('videoRendering.narrationSource', 'Narration Audio')}</h4>
              <div className="radio-group">
                <div className="radio-option">
                  <input
                    type="radio"
                    id="narration-none"
                    value="none"
                    checked={selectedNarration === 'none'}
                    onChange={(e) => setSelectedNarration(e.target.value)}
                  />
                  <label htmlFor="narration-none">
                    {t('videoRendering.noNarration', 'No Narration')}
                  </label>
                </div>
                {isAlignedNarrationAvailable() && (
                  <div className="radio-option">
                    <input
                      type="radio"
                      id="narration-generated"
                      value="generated"
                      checked={selectedNarration === 'generated'}
                      onChange={(e) => setSelectedNarration(e.target.value)}
                    />
                    <label htmlFor="narration-generated">
                      {t('videoRendering.alignedNarration', 'Aligned Narration (ready)')}
                    </label>
                  </div>
                )}

                {/* Narration status and refresh button - only show when narration is not aligned but available */}
                {!isAlignedNarrationAvailable() && (
                  <div className="narration-status-container">
                    <span
                      className={`narration-status ${!hasNarrationSegments() ? 'disabled' : 'not-aligned'}`}
                    >
                      {hasNarrationSegments()
                        ? t('videoRendering.narrationNotAligned', 'Narration not aligned')
                        : t('videoRendering.noNarrationGenerated', 'No narration generated')
                      }
                    </span>
                    <button
                      type="button"
                      className="refresh-icon-button"
                      onClick={handleRefreshNarration}
                      disabled={isRefreshingNarration || !hasNarrationSegments()}
                      style={{
                        animation: (hasNarrationSegments() && !isRefreshingNarration)
                          ? 'breathe 2s ease-in-out infinite'
                          : 'none'
                      }}
                      title={
                        !hasNarrationSegments()
                          ? t('videoRendering.generateNarrationFirst', 'Generate narration first')
                          : t('videoRendering.refreshNarration', 'Click to align narration for video rendering')
                      }
                    >
                      {isRefreshingNarration ? (
                        <svg className="spinner" viewBox="0 0 24 24" style={{ animation: 'rotate 1.5s linear infinite' }}>
                          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3"></circle>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}

              </div>

              {/* Narration Volume Control */}
              <div className="compact-volume-control">
                <label className="volume-label">{t('videoRendering.narrationVolume', 'Narration Volume')}: {renderSettings.narrationVolume}%</label>
                <StandardSlider
                  value={renderSettings.narrationVolume}
                  onChange={(value) => setRenderSettings(prev => ({ ...prev, narrationVolume: parseInt(value) }))}
                  min={0}
                  max={100}
                  step={1}
                  orientation="Horizontal"
                  size="XSmall"
                  state={selectedNarration === 'none' ? "Disabled" : "Enabled"}
                  width="compact"
                  showValueIndicator={false} // Using custom label
                  showIcon={false}
                  showStops={false}
                  className="narration-volume-slider"
                  id="narration-volume"
                  ariaLabel={t('videoRendering.narrationVolume', 'Narration Volume')}
                />
              </div>
            </div>
          </div>

          {/* Second row: Video Preview and Subtitle Customization side by side */}
          <div
            ref={containerRef}
            className="preview-customization-row"
            style={{
              '--left-panel-width': `${leftPanelWidth}%`,
              '--right-panel-width': `${100 - leftPanelWidth}%`
            }}
          >
            {/* Video Preview Panel */}
            <div
              className="video-preview-panel"
              style={{ flex: `0 0 ${leftPanelWidth}%` }}
              tabIndex={0}
            >
              <RemotionVideoPreview
                videoFile={selectedVideoFile}
                subtitles={getCurrentSubtitles()}
                narrationAudioUrl={isAlignedNarrationAvailable() ? window.alignedNarrationCache?.url : null}
                subtitleCustomization={{
                  ...subtitleCustomization,
                  resolution: renderSettings.resolution,
                  frameRate: renderSettings.frameRate
                }}
                originalAudioVolume={renderSettings.originalAudioVolume}
                narrationVolume={renderSettings.narrationVolume}
              />
            </div>

            {/* Resizable Divider */}
            <div
              className="panel-resizer"
              onMouseDown={handleMouseDown}
            ></div>

            {/* Subtitle Customization Panel */}
            <div
              className="customization-panel"
              style={{ flex: `0 0 ${100 - leftPanelWidth}%` }}
            >
              <SubtitleCustomizationPanel
                customization={subtitleCustomization}
                onChange={setSubtitleCustomization}
              />
            </div>
          </div>



          {/* Render Settings and Controls - compact single row */}
          <div className="rendering-row">
            <div className="row-label">
              <label>{t('videoRendering.resolution', 'Resolution')}</label>
            </div>
            <div className="row-content">
              <select
                value={renderSettings.resolution}
                onChange={(e) => setRenderSettings(prev => ({ ...prev, resolution: e.target.value }))}
                className="setting-select"
                style={{ marginRight: '1rem' }}
              >
                <option value="360p">360p</option>
                <option value="480p">480p</option>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="1440p">1440p</option>
                <option value="4K">4K</option>
                <option value="8K">8K</option>
              </select>

              <label style={{ marginRight: '0.5rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                {t('videoRendering.frameRate', 'Frame Rate')}:
              </label>
              <select
                value={renderSettings.frameRate}
                onChange={(e) => setRenderSettings(prev => ({ ...prev, frameRate: parseInt(e.target.value) }))}
                className="setting-select"
                style={{ marginRight: '1rem' }}
              >
                <option value={24}>24 FPS (Cinema)</option>
                <option value={25}>25 FPS (PAL)</option>
                <option value={30}>30 FPS (Standard)</option>
                <option value={50}>50 FPS (PAL High)</option>
                <option value={60}>60 FPS (Smooth)</option>
                <option value={120}>120 FPS (High Speed)</option>
              </select>

              <button
                className="pill-button primary"
                onClick={handleRender}
                disabled={!selectedVideoFile || getCurrentSubtitles().length === 0}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                {t('videoRendering.render', 'Render')}
              </button>

              {/* Cancel button for current render - only show when actively rendering */}
              {isRendering && currentQueueItem && (
                <button
                  className="pill-button cancel"
                  onClick={handleCancelRender}
                  style={{ marginLeft: '0.5rem' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="6" y="6" width="12" height="12"></rect>
                  </svg>
                  {t('videoRendering.cancel', 'Cancel Current')}
                </button>
              )}

            </div>
          </div>

          {/* Progress and errors are now shown in the queue items instead of here */}

          {/* Rendered videos are now accessible through the queue items */}

          {/* Queue Manager - full width grid layout */}
          <div className="rendering-row queue-row">
            <QueueManagerPanel
              queue={renderQueue}
              currentQueueItem={currentQueueItem}
              onRemoveItem={removeFromQueue}
              onClearQueue={clearQueue}
              onRetryItem={retryQueueItem}
              onCancelItem={handleCancelRender}
              isExpanded={true}
              onToggle={() => {}}
              gridLayout={true}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoRenderingSection;
