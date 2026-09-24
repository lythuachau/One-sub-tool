/**
 * Utilities for video analysis
 */

import { analyzeVideoWithGemini } from '../../services/videoAnalysisService';
import { setTranscriptionRules } from '../transcriptionRulesStore';
import { createRequestController, removeRequestController } from '../../services/gemini/requestManagement';

/**
 * Analyze a video file with Gemini and handle user interaction
 * @param {File} analysisFile - The file to analyze
 * @param {Function} onStatusUpdate - Callback for status updates
 * @param {Function} t - Translation function
 * @returns {Promise<Object>} - Analysis result and user choice
 */
export const analyzeVideoAndWaitForUserChoice = async (analysisFile, onStatusUpdate, t) => {
  // Notify user about analysis
  onStatusUpdate({
    message: t('output.analyzingVideo', 'Analyzing video content...'),
    type: 'loading'
  });

  // Dispatch event to notify App.js to show the analysis modal

  const analysisEvent = new CustomEvent('videoAnalysisStarted');
  window.dispatchEvent(analysisEvent);


  try {
    // Analyze the video
    const analysisResult = await analyzeVideoWithGemini(analysisFile, onStatusUpdate);


    // Store the analysis result for the App component to use
    try {
      // Ensure the result can be properly stringified
      const resultString = JSON.stringify(analysisResult);
      // Check if the result is too large for localStorage (typically 5MB limit)
      if (resultString.length > 4 * 1024 * 1024) { // 4MB to be safe
        console.warn('Analysis result is too large for localStorage, truncating...');
        // Create a simplified version with limited terminology
        const simplifiedResult = {
          ...analysisResult,
          transcriptionRules: {
            ...analysisResult.transcriptionRules,
            // Limit terminology to first 20 items if it exists
            terminology: analysisResult.transcriptionRules.terminology ?
              analysisResult.transcriptionRules.terminology.slice(0, 20) : [],
            // Add a note about truncation
            additionalNotes: [
              ...(analysisResult.transcriptionRules.additionalNotes || []),
              'Note: The terminology list was truncated as it was too large for storage.'
            ]
          }
        };
        localStorage.setItem('video_analysis_result', JSON.stringify(simplifiedResult));
      } else {
        localStorage.setItem('video_analysis_result', resultString);
      }
    } catch (error) {
      console.error('Error storing analysis result in localStorage:', error);
      // Store a simplified version instead
      const fallbackResult = {
        recommendedPreset: {
          id: analysisResult.recommendedPreset?.id || 'general',
          reason: 'Preset from analysis (storage error occurred)'
        },
        transcriptionRules: {
          additionalNotes: ['Error storing full analysis result. Using simplified version.']
        }
      };
      localStorage.setItem('video_analysis_result', JSON.stringify(fallbackResult));
    }

    // Dispatch event with the analysis result

    const analysisCompleteEvent = new CustomEvent('videoAnalysisComplete', {
      detail: analysisResult
    });
    window.dispatchEvent(analysisCompleteEvent);


    // Force the modal to show by directly setting the state in localStorage
    localStorage.setItem('show_video_analysis', 'true');
    localStorage.setItem('video_analysis_timestamp', Date.now().toString());

    // Add a small delay to ensure the modal is shown, but only if it's not already shown
    setTimeout(() => {
      // Check if the modal should still be shown
      if (localStorage.getItem('show_video_analysis') === 'true') {

        // Dispatch events again after a delay
        const startEvent = new CustomEvent('videoAnalysisStarted');
        window.dispatchEvent(startEvent);

        const completeEvent = new CustomEvent('videoAnalysisComplete', {
          detail: analysisResult
        });
        window.dispatchEvent(completeEvent);
      } else {

      }
    }, 500);

    // Create a promise that will be resolved when the user makes a choice
    const { requestId, signal } = createRequestController({ type: 'analysis-modal' });
    const userChoicePromise = new Promise((resolve, reject) => {
      const handleUserChoice = (event) => {
        window.removeEventListener('videoAnalysisUserChoice', handleUserChoice);
        signal.removeEventListener('abort', handleAbort);
        resolve(event.detail);
      };
      const handleAbort = () => {
        window.removeEventListener('videoAnalysisUserChoice', handleUserChoice);
        const error = signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Video analysis modal was cancelled', 'AbortError');
        reject(error);
      };
      window.addEventListener('videoAnalysisUserChoice', handleUserChoice);
      signal.addEventListener('abort', handleAbort, { once: true });
    });

    try {
      const userChoice = await userChoicePromise;

      // Set the transcription rules globally
      if (userChoice.transcriptionRules) {
        setTranscriptionRules(userChoice.transcriptionRules);
      }

      return {
        analysisResult,
        userChoice
      };
    } finally {
      removeRequestController(requestId);
    }
  } catch (error) {
    console.error('Error analyzing video:', error);
    throw error;
  }
};
