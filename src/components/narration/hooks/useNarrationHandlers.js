import { transcribeAudio } from '../../../services/transcriptionService';
import {
  uploadReferenceAudio,
  saveRecordedAudio,
  extractAudioSegment,
  getAudioUrl,
  generateNarration,
  cancelNarrationGeneration
} from '../../../services/narrationService';
import { NARRATION_METHODS } from '../narrationMethods';

/**
 * Custom hook for narration handlers
 * @param {Object} params - Parameters
 * @returns {Object} - Narration handlers
 */
const useNarrationHandlers = ({
  fileInputRef,
  mediaRecorderRef,
  audioChunksRef,
  referenceAudio,
  referenceText,
  setReferenceAudio,
  setReferenceText,
  setRecordedAudio,
  setIsRecording,
  setIsExtractingSegment,
  setIsRecognizing,
  setError,
  autoRecognize,
  segmentStartTime,
  segmentEndTime,
  videoPath,
  onReferenceAudioChange,
  getSelectedSubtitles,
  advancedSettings,
  setIsGenerating,
  isGenerating,
  setGenerationStatus,
  setGenerationResults,
  generationResults,
  currentAudio,
  setCurrentAudio,
  setIsPlaying,
  statusRef,
  t,
  subtitleSource,
  translatedSubtitles,
  vieneuVoiceMode,
  vieneuVoice,
  isPlaying,
  selectedNarrationModel,
  originalLanguage,
  translatedLanguage,
  setRetryingSubtitleId,
  useGroupedSubtitles,
  setUseGroupedSubtitles,
  groupedSubtitles
}) => {
  // Handle file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    try {
      let result;

      // First upload the file without transcription
      result = await uploadReferenceAudio(file, referenceText);

      // If auto-recognize is enabled and upload was successful, transcribe the audio
      if (autoRecognize && result && result.success) {
        setIsRecognizing(true);

        try {
          // Set a timeout to prevent waiting too long (10 seconds)
          const recognitionTimeout = setTimeout(() => {
            setIsRecognizing(false);
            setError(t('narration.recognitionTimeout', 'Voice recognition is taking too long. Please try again or enter text manually.'));
          }, 10000); // Reduced from 30s to 10s for faster feedback

          // Create a blob from the file for transcription

          try {
            const transcriptionResult = await transcribeAudio(file);


            // Add transcription data to the result
            result.reference_text = transcriptionResult.text;
            result.is_english = transcriptionResult.is_english;
            result.language = transcriptionResult.language;

            // Log the language detection result

          } catch (transcriptionError) {
            console.error('Error during file upload transcription:', transcriptionError);

            // If it's an API key error, show a specific message
            if (transcriptionError.message.includes('API key')) {
              setError(transcriptionError.message);
            } else {
              // For other errors, just log it
              console.error('Transcription error:', transcriptionError);
            }
          }

          // Clear the timeout
          clearTimeout(recognitionTimeout);

          // Reset recognizing state
          setIsRecognizing(false);
        } catch (error) {
          console.error('Error transcribing uploaded audio:', error);
          setIsRecognizing(false);
          // Don't throw the error, just log it and continue with the uploaded audio
        }
      }

      if (result && result.success) {

        const audioUrl = getAudioUrl(result.filename);


        const newReferenceAudio = {
          filepath: result.filepath,
          filename: result.filename,
          url: audioUrl,
          language: result.language || (result.is_english === false ? 'a non-English language' : 'English')
        };

        setReferenceAudio(newReferenceAudio);

        // Update reference text if auto-recognize is enabled or it was empty and we got it from transcription
        const finalReferenceText = (autoRecognize || (!referenceText && result.reference_text)) ? result.reference_text : referenceText;
        if (autoRecognize || (!referenceText && result.reference_text)) {
          setReferenceText(finalReferenceText);
        }

        // Cache reference audio immediately after upload
        try {
          const getCurrentMediaId = () => {
            const currentVideoUrl = localStorage.getItem('current_video_url');
            const currentFileUrl = localStorage.getItem('current_file_url');

            if (currentVideoUrl) {
              const match = currentVideoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
              return match ? match[1] : null;
            } else if (currentFileUrl) {
              return localStorage.getItem('current_file_cache_id');
            }
            return null;
          };

          const mediaId = getCurrentMediaId();
          if (mediaId) {
            const referenceAudioCache = {
              mediaId,
              timestamp: Date.now(),
              referenceAudio: {
                filename: newReferenceAudio.filename,
                text: finalReferenceText || '',
                url: newReferenceAudio.url,
                filepath: newReferenceAudio.filepath
              }
            };

            localStorage.setItem('reference_audio_cache', JSON.stringify(referenceAudioCache));
            console.log('Cached reference audio immediately after upload');
          }
        } catch (error) {
          console.error('Error caching reference audio after upload:', error);
        }

        // Notify parent component
        if (onReferenceAudioChange) {
          onReferenceAudioChange({
            filepath: result.filepath,
            filename: result.filename,
            text: result.reference_text || referenceText,
            language: result.language || (result.is_english === false ? 'a non-English language' : 'English')
          });
        }
      } else if (result) {
        setError(result.error || t('narration.uploadError', 'Error uploading reference audio'));
      }
    } catch (error) {
      setError(error.message || t('narration.uploadError', 'Error uploading reference audio'));
    }
  };

  // Handle recording start
  const startRecording = async () => {
    try {
      setError(''); // Clear any previous errors
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      mediaRecorderRef.current = new MediaRecorder(stream);

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {

        if (audioChunksRef.current.length === 0) {
          setError(t('narration.noAudioData', 'No audio data recorded'));
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);

        setRecordedAudio({
          blob: audioBlob,
          url: audioUrl
        });

        // Save the recorded audio
        try {
          let result;

          // Set recognizing state if auto-recognize is enabled
          if (autoRecognize) {
            setIsRecognizing(true);

            // Set a timeout to prevent waiting too long (10 seconds)
            const recognitionTimeout = setTimeout(() => {
              setIsRecognizing(false);
              setError(t('narration.recognitionTimeout', 'Voice recognition is taking too long. Please try again or enter text manually.'));
            }, 10000); // Reduced from 30s to 10s for faster feedback

            try {
              // Use direct transcription with Gemini API
              try {
                // First transcribe the audio directly
                const transcriptionResult = await transcribeAudio(audioBlob);
                // Then save the audio file with the transcription text
                result = await saveRecordedAudio(audioBlob, transcriptionResult.text);

                // Add transcription data to the result
                result.reference_text = transcriptionResult.text;
                result.is_english = transcriptionResult.is_english;
                result.language = transcriptionResult.language;
              } catch (transcriptionError) {
                // If it's an API key error, show a specific message
                if (transcriptionError.message.includes('API key')) {
                  setError(transcriptionError.message);

                  // Save the audio without transcription
                  result = await saveRecordedAudio(audioBlob, '');
                } else {
                  // For other errors, just rethrow
                  throw transcriptionError;
                }
              }

              // Clear the timeout since we got a response
              clearTimeout(recognitionTimeout);

              // Reset recognizing state
              setIsRecognizing(false);
            } catch (error) {
              // Clear the timeout and reset state on error
              clearTimeout(recognitionTimeout);
              setIsRecognizing(false);
              throw error; // Re-throw to be caught by the outer catch block
            }
          } else {
            // If auto-recognize is disabled, just save with the existing text
            result = await saveRecordedAudio(audioBlob, referenceText);
          }

          if (result && result.success) {
            const newReferenceAudio = {
              filepath: result.filepath,
              filename: result.filename,
              url: getAudioUrl(result.filename),
              language: result.language || (result.is_english === false ? 'a non-English language' : 'English')
            };

            setReferenceAudio(newReferenceAudio);

            // Update reference text if auto-recognize is enabled or it was empty and we got it from transcription
            const finalReferenceText = (autoRecognize || (!referenceText && result.reference_text)) ? result.reference_text : referenceText;
            if (autoRecognize || (!referenceText && result.reference_text)) {
              setReferenceText(finalReferenceText);
            }

            // Cache reference audio immediately after recording
            try {
              const getCurrentMediaId = () => {
                const currentVideoUrl = localStorage.getItem('current_video_url');
                const currentFileUrl = localStorage.getItem('current_file_url');

                if (currentVideoUrl) {
                  const match = currentVideoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                  return match ? match[1] : null;
                } else if (currentFileUrl) {
                  return localStorage.getItem('current_file_cache_id');
                }
                return null;
              };

              const mediaId = getCurrentMediaId();
              if (mediaId) {
                const referenceAudioCache = {
                  mediaId,
                  timestamp: Date.now(),
                  referenceAudio: {
                    filename: newReferenceAudio.filename,
                    text: finalReferenceText || '',
                    url: newReferenceAudio.url,
                    filepath: newReferenceAudio.filepath
                  }
                };

                localStorage.setItem('reference_audio_cache', JSON.stringify(referenceAudioCache));
                console.log('Cached reference audio immediately after recording');
              }
            } catch (error) {
              console.error('Error caching reference audio after recording:', error);
            }

            // Notify parent component
            if (onReferenceAudioChange) {
              onReferenceAudioChange({
                filepath: result.filepath,
                filename: result.filename,
                text: result.reference_text || referenceText,
                language: result.language || (result.is_english === false ? 'a non-English language' : 'English')
              });
            }
          } else if (result) {
            setError(result.error || t('narration.recordingError', 'Error saving recorded audio'));
          }
        } catch (error) {
          setError(error.message || t('narration.recordingError', 'Error saving recorded audio'));
        }
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      setError(error.message || t('narration.microphoneError', 'Error accessing microphone'));
    }
  };

  // Handle recording stop
  const stopRecording = () => {
    if (mediaRecorderRef.current && setIsRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      // Stop all audio tracks
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    }
  };

  // Handle segment extraction
  const extractSegment = async () => {
    if (!videoPath) {
      setError(t('narration.noVideoError', 'No video available for segment extraction'));
      return;
    }

    if (!segmentStartTime || !segmentEndTime) {
      setError(t('narration.timeRangeError', 'Please specify both start and end times'));
      return;
    }

    setIsExtractingSegment(true);
    setError('');

    try {
      let result;

      // First extract the segment without transcription
      result = await extractAudioSegment(videoPath, segmentStartTime, segmentEndTime);

      // If auto-recognize is enabled, transcribe the extracted segment
      if (autoRecognize && result && result.success) {
        setIsRecognizing(true);

        // Create a blob from the extracted audio URL
        try {
          // Set a timeout to prevent waiting too long (10 seconds)
          const recognitionTimeout = setTimeout(() => {
            setIsRecognizing(false);
            setError(t('narration.recognitionTimeout', 'Voice recognition is taking too long. Please try again or enter text manually.'));
          }, 10000); // Reduced from 30s to 10s for faster feedback

          // Fetch the audio file
          const audioUrl = getAudioUrl(result.filename);
          const response = await fetch(audioUrl, {
            mode: 'cors',
            credentials: 'include',
            headers: {
              'Accept': 'audio/*'
            }
          });
          const audioBlob = await response.blob();

          // Transcribe the audio
          try {
            const transcriptionResult = await transcribeAudio(audioBlob);
            // Add transcription data to the result
            result.reference_text = transcriptionResult.text;
            result.is_english = transcriptionResult.is_english;
            result.language = transcriptionResult.language;
          } catch (transcriptionError) {
            // If it's an API key error, show a specific message
            if (transcriptionError.message.includes('API key')) {
              setError(transcriptionError.message);
            }
          }

          // Clear the timeout
          clearTimeout(recognitionTimeout);

          // Reset recognizing state
          setIsRecognizing(false);
        } catch (error) {
          setIsRecognizing(false);
          // Don't throw the error, just continue with the extracted audio
        }
      }

      if (result && result.success) {
        const newReferenceAudio = {
          filepath: result.filepath,
          filename: result.filename,
          url: getAudioUrl(result.filename),
          language: result.language || (result.is_english === false ? 'a non-English language' : 'English')
        };

        setReferenceAudio(newReferenceAudio);

        // Update reference text if auto-recognize is enabled or we got it from transcription
        const finalReferenceText = (autoRecognize || result.reference_text) ? result.reference_text : referenceText;
        if (autoRecognize || result.reference_text) {
          setReferenceText(finalReferenceText);
        }

        // Cache reference audio immediately after extraction
        try {
          const getCurrentMediaId = () => {
            const currentVideoUrl = localStorage.getItem('current_video_url');
            const currentFileUrl = localStorage.getItem('current_file_url');

            if (currentVideoUrl) {
              const match = currentVideoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
              return match ? match[1] : null;
            } else if (currentFileUrl) {
              return localStorage.getItem('current_file_cache_id');
            }
            return null;
          };

          const mediaId = getCurrentMediaId();
          if (mediaId) {
            const referenceAudioCache = {
              mediaId,
              timestamp: Date.now(),
              referenceAudio: {
                filename: newReferenceAudio.filename,
                text: finalReferenceText || '',
                url: newReferenceAudio.url,
                filepath: newReferenceAudio.filepath
              }
            };

            localStorage.setItem('reference_audio_cache', JSON.stringify(referenceAudioCache));
            console.log('Cached reference audio immediately after extraction');
          }
        } catch (error) {
          console.error('Error caching reference audio after extraction:', error);
        }

        // Notify parent component
        if (onReferenceAudioChange) {
          onReferenceAudioChange({
            filepath: result.filepath,
            filename: result.filename,
            text: result.reference_text || referenceText,
            language: result.language || (result.is_english === false ? 'a non-English language' : 'English')
          });
        }
      } else if (result) {
        setError(result.error || t('narration.extractionError', 'Error extracting audio segment'));
      }
    } catch (error) {
      setError(t('narration.extractionError', 'Error extracting audio segment'));
    } finally {
      setIsExtractingSegment(false);
    }
  };

  // Clear reference audio
  const clearReferenceAudio = () => {
    setReferenceAudio(null);
    setRecordedAudio(null);
    setReferenceText('');

    // Clear reference audio cache
    try {
      localStorage.removeItem('reference_audio_cache');
      console.log('Cleared reference audio cache');
    } catch (error) {
      console.error('Error clearing reference audio cache:', error);
    }

    // Notify parent component
    if (onReferenceAudioChange) {
      onReferenceAudioChange(null);
    }
  };

  // Generate narration for all subtitles
  const handleGenerateNarration = async () => {
    // Clear all caches and files for fresh generation
    const { clearNarrationCachesAndFiles } = await import('../utils/cacheManager');
    await clearNarrationCachesAndFiles(setGenerationResults);

    const needsReferenceAudio = vieneuVoiceMode === 'reference';
    if (needsReferenceAudio && (!referenceAudio || !referenceAudio.filepath)) {
      setError(t('narration.noReferenceError', 'Please set up reference audio using one of the options above'));
      return;
    }

    if (vieneuVoiceMode === 'preset' && !vieneuVoice) {
      setError(t('narration.vieneuNoPresetVoice', 'Please choose a VieNeu preset voice'));
      return;
    }

    // Check if a subtitle source has been selected
    if (!subtitleSource) {
      setError(t('narration.noSourceSelectedError', 'Please select a subtitle source (Original or Translated)'));
      return;
    }

    // Get the appropriate subtitles based on the selected source
    // If grouped subtitles are available and enabled, use them instead
    const useGrouped = window.useGroupedSubtitles && window.groupedSubtitles && window.groupedSubtitles.length > 0;
    const selectedSubtitles = useGrouped ? window.groupedSubtitles : getSelectedSubtitles();

    if (!selectedSubtitles || selectedSubtitles.length === 0) {
      // If translated subtitles are selected but not available, show a specific error
      if (subtitleSource === 'translated' && (!translatedSubtitles || translatedSubtitles.length === 0)) {
        setError(t('narration.noTranslatedSubtitlesError', 'No translated subtitles available. Please translate the subtitles first or select original subtitles.'));
      } else {
        setError(t('narration.noSubtitlesError', 'No subtitles available for narration'));
      }
      return;
    }

    setIsGenerating(true);
    setGenerationStatus(t('narration.preparingGeneration', 'Preparing to generate narration...'));
    setError('');
    setGenerationResults([]);

    try {
      // Prepare subtitles with IDs for tracking
      const subtitlesWithIds = selectedSubtitles.map((subtitle, index) => ({
        ...subtitle,
        id: subtitle.id || index + 1
      }));

      // Update state immediately if we're generating grouped subtitles
      if (useGroupedSubtitles && groupedSubtitles && groupedSubtitles.length > 0) {
        // Initialize empty grouped narrations in window object
        window.groupedNarrations = [];
        window.useGroupedSubtitles = true;
        // Update the React state to reflect that we're now using grouped subtitles
        setUseGroupedSubtitles(true);
        console.log(`Updated state to use grouped subtitles immediately at VieNeu-TTS generation start`);
      }

      // Add subtitle source to generation status message
      const sourceText = subtitleSource === 'original' ?
        t('narration.originalSubtitles', 'original subtitles') :
        t('narration.translatedSubtitles', 'translated subtitles');

      setGenerationStatus(
        t('narration.generatingNarrationWithSource', 'Generating narration for {{count}} {{source}}...', {
          count: subtitlesWithIds.length,
          source: sourceText
        })
      );

      // Prepare advanced settings for the API - only include supported parameters
      const apiSettings = {
        // Convert string values to appropriate types
        speechRate: parseFloat(advancedSettings.speechRate),
        nfeStep: parseInt(advancedSettings.nfeStep),
        swayCoef: parseFloat(advancedSettings.swayCoef),
        cfgStrength: parseFloat(advancedSettings.cfgStrength),
        removeSilence: advancedSettings.removeSilence,
        // Note: sampleRate is controlled by the selected local TTS engine.
        // It's only used in the UI for user preference
        batchSize: advancedSettings.batchSize === 'all' ? subtitlesWithIds.length : parseInt(advancedSettings.batchSize),
        // Include the selected model ID
        modelId: selectedNarrationModel,
        voice: vieneuVoiceMode === 'preset' ? vieneuVoice : undefined
      };

      // Handle seed
      if (!advancedSettings.useRandomSeed) {
        apiSettings.seed = advancedSettings.seed;
      }

      // Save settings to localStorage
      localStorage.setItem('narration_advanced_settings', JSON.stringify(advancedSettings));

      // Generate narration with streaming response
      const tempResults = [];

      // Define callbacks for the streaming response
      const handleProgress = (message, current, total, subtitle_id, subtitle_text) => {
        // Log the progress message for debugging


        // Create a more detailed status message if we have subtitle text
        let statusMessage = message;
        if (subtitle_text) {
          statusMessage = `${message} - "${subtitle_text}"`;
        }

        // Update the status with the progress message
        setGenerationStatus(statusMessage);

        // If we have current results, make sure they're displayed
        if (tempResults.length > 0) {
          setGenerationResults([...tempResults]);
        }
      };

      const handleResult = (result, progress, total) => {
        // Add the result to the temporary results array
        tempResults.push(result);

        // Update the UI with the current results
        // This ensures each result is shown immediately as it's received

        setGenerationResults([...tempResults]);

        // Update window.groupedNarrations incrementally if we're generating grouped subtitles
        if (useGroupedSubtitles && groupedSubtitles && groupedSubtitles.length > 0) {
          window.groupedNarrations = [...tempResults];
        }

        // Update the status to show which subtitle is being processed
        setGenerationStatus(
          t(
            'narration.generatingProgressWithId',
            'Generated {{progress}} of {{total}} narrations (ID: {{id}})...',
            {
              progress,
              total,
              id: result.subtitle_id
            }
          )
        );
      };

      const handleError = (error) => {
        // Check if this is a cancellation error
        if (error.cancelled) {
          setError(t('narration.generationCancelled', 'Narration generation cancelled by user'));
          return;
        }

        // Handle other errors
        if (typeof error === 'object' && error.error) {
          setError(`${t('narration.generationError', 'Error generating narration')}: ${error.error}`);
        } else if (typeof error === 'string') {
          setError(`${t('narration.generationError', 'Error generating narration')}: ${error}`);
        } else {
          setError(t('narration.generationError', 'Error generating narration'));
        }
      };

      const handleComplete = (results) => {
        setGenerationStatus(t('narration.generationComplete', 'Narration generation complete'));
        // Ensure we have the final results
        setGenerationResults(results);

        // Cache narrations and reference audio to localStorage for VieNeu-TTS
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
          if (mediaId && referenceAudio) {
            // Create cache entry with narrations and reference audio
            const cacheEntry = {
              mediaId,
              timestamp: Date.now(),
              narrations: results.map(result => ({
                subtitle_id: result.subtitle_id,
                filename: result.filename,
                success: result.success,
                text: result.text,
                method: NARRATION_METHODS.VIENEU
              })),
              referenceAudio: {
                filename: referenceAudio.filename,
                text: referenceAudio.text || '',
                url: referenceAudio.url,
                filepath: referenceAudio.filepath
              }
            };

            // Save to localStorage
            localStorage.setItem('f5tts_narrations_cache', JSON.stringify(cacheEntry));
            console.log('Cached VieNeu-TTS narrations and reference audio');
          }
        } catch (error) {
          console.error('Error caching VieNeu-TTS narrations:', error);
        }

        // Update state if we generated narrations for grouped subtitles
        if (useGroupedSubtitles && groupedSubtitles && groupedSubtitles.length > 0) {
          // Store as grouped narrations in window object
          window.groupedNarrations = [...results];
          window.useGroupedSubtitles = true;
          // Update the React state to reflect that we're now using grouped subtitles
          setUseGroupedSubtitles(true);
          console.log(`Stored ${results.length} VieNeu-TTS grouped narrations and updated state`);
        } else {
          // Store as original/translated narrations
          if (subtitleSource === 'original') {
            window.originalNarrations = [...results];
          } else {
            window.translatedNarrations = [...results];
          }
          window.useGroupedSubtitles = false;
        }
      };

      // Call the generateNarration function with callbacks
      const result = await generateNarration(
        needsReferenceAudio ? referenceAudio.filepath : null,
        needsReferenceAudio ? (referenceAudio.text || referenceText) : '',
        subtitlesWithIds,
        apiSettings,
        handleProgress,
        handleResult,
        handleError,
        handleComplete
      );

      if (!result || !result.success) {
        setError(result?.error || t('narration.generationError', 'Error generating narration'));
      }
    } catch (error) {
      setError(t('narration.generationError', 'Error generating narration'));
    } finally {
      setIsGenerating(false);
    }
  };

  // Play a specific narration audio
  const playAudio = (result) => {
    // Stop current audio if playing
    if (isPlaying && currentAudio && currentAudio.id === result.subtitle_id) {
      setIsPlaying(false);
      return;
    }

    // Play new audio
    setCurrentAudio({
      id: result.subtitle_id,
      url: getAudioUrl(result.filename)
    });
    setIsPlaying(true);
  };

  // Download all narration audio as a zip file
  const downloadAllAudio = async () => {
    // Check if we have any generation results
    if (!generationResults || generationResults.length === 0) {
      alert(t('narration.noResults', 'No narration results to download'));
      return;
    }

    // Create a loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.style.position = 'fixed';
    loadingIndicator.style.top = '50%';
    loadingIndicator.style.left = '50%';
    loadingIndicator.style.transform = 'translate(-50%, -50%)';
    loadingIndicator.style.padding = '20px';
    loadingIndicator.style.background = 'rgba(0, 0, 0, 0.7)';
    loadingIndicator.style.color = 'white';
    loadingIndicator.style.borderRadius = '5px';
    loadingIndicator.style.zIndex = '9999';
    loadingIndicator.textContent = t('narration.downloading', 'Downloading audio files...');
    document.body.appendChild(loadingIndicator);

    try {
      // Get the server URL from the narration service
      const { SERVER_URL } = require('../../../config');

      // Extract filenames from generation results
      const filenames = generationResults.map(result => result.filename);


      // Create a download link with the filenames as query parameters
      const downloadUrl = `${SERVER_URL}/api/narration/download-all`;

      // Use fetch API to download the file

      const response = await fetch(downloadUrl, {
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/octet-stream'
        },
        body: JSON.stringify({ filenames })
      });


      // Check if the response is successful
      if (!response.ok) {
        // Try to parse error message if it's JSON
        try {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to download audio files');
        } catch (jsonError) {
          // If it's not JSON, use the status text
          throw new Error(`Failed to download audio files: ${response.statusText}`);
        }
      }

      // Get the blob from the response
      const blob = await response.blob();


      // Create a URL for the blob
      const url = URL.createObjectURL(blob);

      // Create a temporary anchor element
      const a = document.createElement('a');
      a.href = url;
      a.download = 'narration_audio.zip';
      a.target = '_blank'; // Open in a new tab to avoid redirecting
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error('Error downloading all audio:', error);
      alert(t('narration.downloadError', `Error downloading audio files: ${error.message}`));
    } finally {
      // Remove loading indicator
      document.body.removeChild(loadingIndicator);
    }
  };

  // Download aligned narration audio (one file)
  const downloadAlignedAudio = async () => {
    // Check if we have any generation results
    if (!generationResults || generationResults.length === 0) {
      alert(t('narration.noResults', 'No narration results to download'));
      return;
    }

    // Create a loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.style.position = 'fixed';
    loadingIndicator.style.top = '50%';
    loadingIndicator.style.left = '50%';
    loadingIndicator.style.transform = 'translate(-50%, -50%)';
    loadingIndicator.style.padding = '20px';
    loadingIndicator.style.background = 'rgba(0, 0, 0, 0.7)';
    loadingIndicator.style.color = 'white';
    loadingIndicator.style.borderRadius = '5px';
    loadingIndicator.style.zIndex = '9999';
    loadingIndicator.textContent = t('narration.downloading', 'Downloading audio file...');
    document.body.appendChild(loadingIndicator);

    try {
      // Get the server URL from the narration service
      const { SERVER_URL } = require('../../../config');

      // Get all subtitles from the video for timing information
      // Check if we're using grouped subtitles (same logic as VideoRenderingSection.js)
      const isUsingGroupedSubtitles = window.useGroupedSubtitles || false;
      const allSubtitles = isUsingGroupedSubtitles && window.groupedSubtitles ?
        window.groupedSubtitles :
        (window.subtitlesData || window.originalSubtitles || window.subtitles || []);

      // First try to get subtitles from the getSelectedSubtitles function if no grouped subtitles
      if (allSubtitles.length === 0) {
        const selectedSubtitles = getSelectedSubtitles();
        if (selectedSubtitles && Array.isArray(selectedSubtitles) && selectedSubtitles.length > 0) {
          allSubtitles.push(...selectedSubtitles);
        }
      }

      // Also try translated subtitles if no other subtitles found
      if (allSubtitles.length === 0 && window.translatedSubtitles && Array.isArray(window.translatedSubtitles)) {
        allSubtitles.push(...window.translatedSubtitles);
      }

      console.log(`Download aligned: Using ${isUsingGroupedSubtitles ? 'grouped' : 'individual'} subtitles. Found ${allSubtitles.length} subtitles.`);

      // Create a map for faster lookup
      const subtitleMap = {};
      allSubtitles.forEach(sub => {
        if (sub.id !== undefined) {
          subtitleMap[sub.id] = sub;
        }
      });



      // Prepare the data for the aligned narration with correct timing
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
            console.log(`Download aligned: Handling grouped subtitle ${subtitleId} with ${result.original_ids.length} original IDs`);

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

              console.log(`Download aligned: Created synthetic timing for grouped subtitle ${subtitleId}: start=${start}, end=${end}`);
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



      // Create a download link
      const downloadUrl = `${SERVER_URL}/api/narration/download-aligned`;

      // Use fetch API to download the file

      const response = await fetch(downloadUrl, {
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
        // Import and check for duration notification
        const { checkAudioAlignmentFromResponse } = await import('../../../utils/audioAlignmentNotification.js');
        checkAudioAlignmentFromResponse(response);
      }


      // Check if the response is successful
      if (!response.ok) {
        // Try to parse error message if it's JSON
        try {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to download aligned audio');
        } catch (jsonError) {
          // If it's not JSON, use the status text
          throw new Error(`Failed to download aligned audio: ${response.statusText}`);
        }
      }

      // Get the blob from the response
      const blob = await response.blob();


      // Create a URL for the blob
      const url = URL.createObjectURL(blob);

      // Create a temporary anchor element
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aligned_narration.wav';
      a.target = '_blank'; // Open in a new tab to avoid redirecting
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error('Error downloading aligned audio:', error);
      alert(t('narration.downloadError', `Error downloading aligned audio file: ${error.message}`));
    } finally {
      // Remove loading indicator
      document.body.removeChild(loadingIndicator);
    }
  };

  // Cancel narration generation
  const cancelGeneration = () => {
    if (isGenerating) {
      const cancelled = cancelNarrationGeneration();
      if (cancelled) {

        // We don't set isGenerating to false here because the abort will trigger the error handler
        // which will set isGenerating to false
      } else {

      }
    }
  };

  // Retry narration generation for a specific subtitle
  const retryF5TTSNarration = async (subtitleId) => {
    const needsReferenceAudio = vieneuVoiceMode === 'reference';
    if (needsReferenceAudio && !referenceAudio) {
      setError(t('narration.noReferenceAudioError', 'Please upload or record reference audio first'));
      return;
    }

    if (vieneuVoiceMode === 'preset' && !vieneuVoice) {
      setError(t('narration.vieneuNoPresetVoice', 'Please choose a VieNeu preset voice'));
      return;
    }

    // Get the appropriate subtitles based on the selected source
    // If grouped subtitles are available and enabled, use them instead
    const useGrouped = window.useGroupedSubtitles && window.groupedSubtitles && window.groupedSubtitles.length > 0;
    const selectedSubtitles = useGrouped ? window.groupedSubtitles : getSelectedSubtitles();

    if (!selectedSubtitles || selectedSubtitles.length === 0) {
      setError(t('narration.noSubtitlesError', 'No subtitles available for narration'));
      return;
    }

    // Find the subtitle with the given ID
    const subtitleToRetry = selectedSubtitles.find(subtitle =>
      (subtitle.id || subtitle.index) === subtitleId
    );

    if (!subtitleToRetry) {
      console.error(`Subtitle with ID ${subtitleId} not found`);
      return;
    }

    // Set retrying state
    setRetryingSubtitleId(subtitleId);

    // Clear any previous errors
    setError('');

    // Set status for this specific retry
    setGenerationStatus(t('narration.retryingGeneration', 'Retrying narration generation for subtitle {{id}}...', { id: subtitleId }));

    try {
      // CRITICAL FIX: Force reset the aligned narration before retrying
      // This ensures that the aligned narration will be regenerated with the new audio

      if (window.resetAlignedNarration) {
        window.resetAlignedNarration();
      }

      // Prepare subtitle with ID for tracking
      const subtitleWithId = {
        ...subtitleToRetry,
        id: subtitleToRetry.id || subtitleToRetry.index || subtitleId,
        // Add a flag to force regeneration of aligned narration
        forceRegenerate: true
      };

      // Prepare advanced settings for the API - only include supported parameters
      const apiSettings = {
        // Convert string values to appropriate types
        speechRate: parseFloat(advancedSettings.speechRate),
        nfeStep: parseInt(advancedSettings.nfeStep),
        swayCoef: parseFloat(advancedSettings.swayCoef),
        cfgStrength: parseFloat(advancedSettings.cfgStrength),
        removeSilence: advancedSettings.removeSilence,
        // Include the selected model ID
        modelId: selectedNarrationModel,
        voice: vieneuVoiceMode === 'preset' ? vieneuVoice : undefined,
        // CRITICAL FIX: Add a flag to skip clearing the output directory
        skipClearOutput: true
      };

      // Handle seed
      if (!advancedSettings.useRandomSeed) {
        apiSettings.seed = advancedSettings.seed;
      }

      // Import the narration service functions
      const { generateNarration } = await import('../../../services/narrationService');

      // Define callbacks for the streaming response
      const handleProgress = (message) => {
        setGenerationStatus(`${message} (ID: ${subtitleId})`);
      };

      const handleResult = (result) => {
        // Add a flag to force regeneration of aligned narration
        result.forceRegenerate = true;

        // Add a timestamp to the result to help identify retried narrations
        result.retriedAt = Date.now();

        // Update the results array by replacing the old result with the new one
        setGenerationResults(prevResults => {
          const updatedResults = prevResults.map(prevResult =>
            prevResult.subtitle_id === subtitleId ? result : prevResult
          );

          // Update the global narration references to ensure video player uses the latest version
          if (subtitleSource === 'original') {
            // Update window.originalNarrations
            window.originalNarrations = [...updatedResults];

            // Also update the global narrations array if it exists
            if (window.subtitlesData && window.narrations) {
              // Find and update the narration in the global narrations array
              const globalIndex = window.narrations.findIndex(n => n.subtitle_id === result.subtitle_id);
              if (globalIndex !== -1) {
                window.narrations[globalIndex] = result;

              }
            }

            // Also update localStorage
            try {
              // Extract only the necessary information to avoid localStorage quota issues
              const essentialData = updatedResults.map(result => ({
                subtitle_id: result.subtitle_id,
                filename: result.filename,
                success: result.success,
                text: result.text
              }));
              localStorage.setItem('originalNarrations', JSON.stringify(essentialData));
            } catch (e) {
              console.error('Error storing updated originalNarrations in localStorage:', e);
            }

          } else {
            // Update window.translatedNarrations
            window.translatedNarrations = [...updatedResults];

            // Also update the global narrations array if it exists
            if (window.subtitlesData && window.narrations) {
              // Find and update the narration in the global narrations array
              const globalIndex = window.narrations.findIndex(n => n.subtitle_id === result.subtitle_id);
              if (globalIndex !== -1) {
                window.narrations[globalIndex] = result;

              }
            }

            // Also update localStorage
            try {
              // Extract only the necessary information to avoid localStorage quota issues
              const essentialData = updatedResults.map(result => ({
                subtitle_id: result.subtitle_id,
                filename: result.filename,
                success: result.success,
                text: result.text
              }));
              localStorage.setItem('translatedNarrations', JSON.stringify(essentialData));
            } catch (e) {
              console.error('Error storing updated translatedNarrations in localStorage:', e);
            }

          }

          // Dispatch a custom event to notify other components about the updated narration
          const event = new CustomEvent('narration-retried', {
            detail: {
              source: subtitleSource,
              narration: result,
              narrations: updatedResults,
              timestamp: Date.now(), // Add timestamp to ensure the event is treated as new
              forceRegenerate: true // Add flag to force regeneration of aligned narration
            }
          });
          window.dispatchEvent(event);

          // Removed automatic regeneration of aligned narration
          // Users must now manually click the "Refresh Narration" button to regenerate aligned narration

          return updatedResults;
        });
      };

      const handleError = (error) => {
        console.error(`Error retrying narration for subtitle ${subtitleId}:`, error);
        setError(t('narration.retryError', 'Error retrying narration for subtitle {{id}}', { id: subtitleId }));
      };

      // Generate narration for the single subtitle
      await generateNarration(
        needsReferenceAudio ? referenceAudio.filepath : null,
        needsReferenceAudio ? (referenceAudio.text || referenceText) : '',
        [subtitleWithId], // Pass as an array with a single subtitle
        apiSettings,
        handleProgress,
        handleResult,
        handleError,
        () => {
          setGenerationStatus(t('narration.retryComplete', 'Retry complete for subtitle {{id}}', { id: subtitleId }));
        }
      );
    } catch (error) {
      console.error(`Error retrying narration for subtitle ${subtitleId}:`, error);
      setError(t('narration.retryError', 'Error retrying narration for subtitle {{id}}', { id: subtitleId }));
    } finally {
      // Clear retrying state regardless of success or failure
      setRetryingSubtitleId(null);
    }
  };

  // Retry all failed narrations
  const retryFailedNarrations = async () => {
    const needsReferenceAudio = vieneuVoiceMode === 'reference';
    if (needsReferenceAudio && !referenceAudio) {
      setError(t('narration.noReferenceAudioError', 'Please upload or record reference audio first'));
      return;
    }

    if (vieneuVoiceMode === 'preset' && !vieneuVoice) {
      setError(t('narration.vieneuNoPresetVoice', 'Please choose a VieNeu preset voice'));
      return;
    }

    // Get the appropriate subtitles based on the selected source
    const selectedSubtitles = getSelectedSubtitles();

    if (!selectedSubtitles || selectedSubtitles.length === 0) {
      setError(t('narration.noSubtitlesError', 'No subtitles available for narration'));
      return;
    }

    // Find all failed narrations
    const failedNarrations = generationResults.filter(result => !result.success);

    if (failedNarrations.length === 0) {
      setError(t('narration.noFailedNarrationsError', 'No failed narrations to retry'));
      return;
    }

    // Clear any previous errors
    setError('');

    // Set status for retrying failed narrations
    setGenerationStatus(t('narration.retryingFailedNarrations', 'Retrying {{count}} failed narrations...', { count: failedNarrations.length }));

    // Process each failed narration one by one
    for (let i = 0; i < failedNarrations.length; i++) {
      const failedNarration = failedNarrations[i];
      const subtitleId = failedNarration.subtitle_id;

      // Find the subtitle with the given ID
      const subtitleToRetry = selectedSubtitles.find(subtitle =>
        (subtitle.id || subtitle.index) === subtitleId
      );

      if (!subtitleToRetry) {
        console.error(`Subtitle with ID ${subtitleId} not found`);
        continue;
      }

      // Set retrying state
      setRetryingSubtitleId(subtitleId);

      // Update status
      setGenerationStatus(t('narration.retryingFailedNarrationProgress', 'Retrying failed narration {{current}} of {{total}} (ID: {{id}})...', {
        current: i + 1,
        total: failedNarrations.length,
        id: subtitleId
      }));

      try {
        // Retry the VieNeu-TTS segment with the current reference voice.
        // CRITICAL FIX: Force reset the aligned narration before retrying

        if (window.resetAlignedNarration) {
          window.resetAlignedNarration();
        }

        // Prepare subtitle with ID for tracking
        const subtitleWithId = {
          ...subtitleToRetry,
          id: subtitleToRetry.id || subtitleToRetry.index || subtitleId,
          forceRegenerate: true
        };

        // Prepare advanced settings for the API
        const apiSettings = {
          speechRate: parseFloat(advancedSettings.speechRate),
          nfeStep: parseInt(advancedSettings.nfeStep),
          swayCoef: parseFloat(advancedSettings.swayCoef),
          cfgStrength: parseFloat(advancedSettings.cfgStrength),
          removeSilence: advancedSettings.removeSilence,
          modelId: selectedNarrationModel,
          voice: vieneuVoiceMode === 'preset' ? vieneuVoice : undefined,
          skipClearOutput: true
        };

        // Handle seed
        if (!advancedSettings.useRandomSeed) {
          apiSettings.seed = advancedSettings.seed;
        }

        // Import the narration service functions
        const { generateNarration } = await import('../../../services/narrationService');

        // Generate narration for the single subtitle
        await generateNarration(
          needsReferenceAudio ? referenceAudio.filepath : null,
          needsReferenceAudio ? (referenceAudio.text || referenceText) : '',
          [subtitleWithId], // Pass as an array with a single subtitle
          apiSettings,
          (message) => setGenerationStatus(`${message} (ID: ${subtitleId})`),
          (result) => {
            // Add flags and timestamp
            result.forceRegenerate = true;
            result.retriedAt = Date.now();

            // Update the results array
            setGenerationResults(prevResults => {
              const updatedResults = prevResults.map(prevResult =>
                prevResult.subtitle_id === subtitleId ? result : prevResult
              );

              // Update global references
              if (subtitleSource === 'original') {
                window.originalNarrations = [...updatedResults];
                try {
                  // Extract only the necessary information to avoid localStorage quota issues
                  const essentialData = updatedResults.map(result => ({
                    subtitle_id: result.subtitle_id,
                    filename: result.filename,
                    success: result.success,
                    text: result.text
                  }));
                  localStorage.setItem('originalNarrations', JSON.stringify(essentialData));
                } catch (e) {
                  console.error('Error storing updated originalNarrations in localStorage:', e);
                }
              } else {
                window.translatedNarrations = [...updatedResults];
                try {
                  // Extract only the necessary information to avoid localStorage quota issues
                  const essentialData = updatedResults.map(result => ({
                    subtitle_id: result.subtitle_id,
                    filename: result.filename,
                    success: result.success,
                    text: result.text
                  }));
                  localStorage.setItem('translatedNarrations', JSON.stringify(essentialData));
                } catch (e) {
                  console.error('Error storing updated translatedNarrations in localStorage:', e);
                }
              }

              // Dispatch events
              window.dispatchEvent(new CustomEvent('narration-retried', {
                detail: {
                  source: subtitleSource,
                  narration: result,
                  narrations: updatedResults,
                  timestamp: Date.now(),
                  forceRegenerate: true
                }
              }));

              // Removed automatic regeneration of aligned narration
              // Users must now manually click the "Refresh Narration" button to regenerate aligned narration

              return updatedResults;
            });
          },
          (error) => {
            console.error(`Error retrying narration for subtitle ${subtitleId}:`, error);
          },
          () => {
            setGenerationStatus(t('narration.retryComplete', 'Retry complete for subtitle {{id}}', { id: subtitleId }));
          }
        );

        // Add a small delay between retries to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error retrying narration for subtitle ${subtitleId}:`, error);
        // Continue with the next failed narration
      }
    }

    // Clear retrying state
    setRetryingSubtitleId(null);

    // Update status
    setGenerationStatus(t('narration.retryingFailedNarrationsComplete', 'Completed retrying all failed narrations'));
  };

  // Handle example audio selection
  const handleExampleSelect = async (result) => {
    try {
      if (result.success) {
        const audioUrl = getAudioUrl(result.filename);

        setReferenceAudio({
          filepath: result.filepath,
          filename: result.filename,
          url: audioUrl
        });

        // Update reference text if provided
        if (result.reference_text) {
          setReferenceText(result.reference_text);
        }

        // Notify parent component
        if (onReferenceAudioChange) {
          onReferenceAudioChange({
            filepath: result.filepath,
            filename: result.filename,
            text: result.reference_text || referenceText
          });
        }
      } else {
        console.error('Example upload failed:', result.error);
        setError(result.error || t('narration.uploadError', 'Error uploading example audio'));
      }
    } catch (error) {
      console.error('Error handling example selection:', error);
      setError(t('narration.uploadError', 'Error uploading example audio'));
    }
  };

  return {
    handleFileUpload,
    startRecording,
    stopRecording,
    extractSegment,
    clearReferenceAudio,
    handleGenerateNarration,
    playAudio,
    downloadAllAudio,
    downloadAlignedAudio,
    cancelGeneration,
    retryF5TTSNarration,
    retryFailedNarrations,
    handleExampleSelect
  };
};

export default useNarrationHandlers;
