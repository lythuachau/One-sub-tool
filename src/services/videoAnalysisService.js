/**
 * Service for analyzing videos with Gemini before splitting
 */

import { fileToBase64 } from '../utils/fileUtils';
import { createVideoAnalysisSchema, addResponseSchema } from '../utils/schemaUtils';
import { addThinkingConfig } from '../utils/thinkingBudgetUtils';
import { persistGeminiModelFallback, resolveGeminiModel } from './gemini/modelDiscovery';
import i18n from '../i18n/i18n';
import { createRequestController, removeRequestController } from './gemini/requestManagement';
import { getNextAvailableKey } from './gemini/keyManager';
import { createGeminiApiError } from './gemini/errorUtils';
import { requestGeminiWithModelFallback } from './gemini/modelRequest';

// Translation function shorthand
const t = (key, fallback) => i18n.t(key, fallback);

// Store the active abort controller for video analysis
let activeAnalysisController = null;

// Maximum number of terminology items to keep to prevent localStorage overflow
const MAX_TERMINOLOGY_ITEMS = 50;

/**
 * Abort any active video analysis request
 */
export const abortVideoAnalysis = () => {
  if (activeAnalysisController) {

    activeAnalysisController.controller.abort(new DOMException('Video analysis was cancelled', 'AbortError'));
    activeAnalysisController = null;
    return true;
  }
  return false;
};

/**
 * Sanitize and limit the size of the analysis result to prevent localStorage overflow
 * @param {Object} analysisResult - The raw analysis result from Gemini
 * @returns {Object} - The sanitized analysis result
 */
const sanitizeAnalysisResult = (analysisResult) => {
  if (!analysisResult) return null;

  try {
    // Create a deep copy to avoid modifying the original
    const sanitized = JSON.parse(JSON.stringify(analysisResult));

    // Ensure we have the required structure
    if (!sanitized.recommendedPreset) {
      sanitized.recommendedPreset = {
        id: 'general',
        reason: 'Default preset selected due to missing recommendation'
      };
    }

    if (!sanitized.transcriptionRules) {
      sanitized.transcriptionRules = {};
    }

    // Limit terminology items if there are too many
    if (sanitized.transcriptionRules.terminology &&
        Array.isArray(sanitized.transcriptionRules.terminology) &&
        sanitized.transcriptionRules.terminology.length > MAX_TERMINOLOGY_ITEMS) {

      sanitized.transcriptionRules.terminology = sanitized.transcriptionRules.terminology.slice(0, MAX_TERMINOLOGY_ITEMS);

      // Add a note about truncation
      if (!sanitized.transcriptionRules.additionalNotes) {
        sanitized.transcriptionRules.additionalNotes = [];
      }
      sanitized.transcriptionRules.additionalNotes.push(
        `Note: The terminology list was truncated from the original analysis as it was too large.`
      );
    }

    return sanitized;
  } catch (error) {
    console.error('Error sanitizing analysis result:', error);
    return {
      recommendedPreset: {
        id: 'general',
        reason: 'Default preset selected due to sanitization error'
      },
      transcriptionRules: {
        additionalNotes: ['Error sanitizing analysis result. Using default settings.']
      }
    };
  }
};

/**
 * Analyzes a video with Gemini to determine the best prompt preset and generate transcription rules
 * @param {File} videoFile - The video file to analyze
 * @param {Function} onStatusUpdate - Callback for status updates
 * @returns {Promise<Object>} - Analysis results
 */
export const analyzeVideoWithGemini = async (videoFile, onStatusUpdate) => {
  const { requestId, signal, controller } = createRequestController({ type: 'video-analysis' });
  activeAnalysisController = { requestId, controller };
  try {
    const geminiApiKey = getNextAvailableKey();
    if (!geminiApiKey) {
      throw new Error('Gemini API key not found');
    }

    // Get the selected model from localStorage or use the default
    const requestedModel = localStorage.getItem('video_analysis_model') || '';
    const MODEL = await resolveGeminiModel(requestedModel, geminiApiKey);
    if (requestedModel !== MODEL) {
      console.warn(`[VideoAnalysis] Model ${requestedModel || '(default)'} is unavailable; using ${MODEL}`);
      persistGeminiModelFallback(requestedModel, MODEL, ['video_analysis_model']);
    }

    // Get video duration
    onStatusUpdate({ message: t('input.preparingVideoAnalysis', 'Preparing video for analysis...'), type: 'loading' });
    let videoDuration = 0;
    try {
      // Import dynamically to avoid circular dependencies
      const { getVideoDuration } = await import('../utils/durationUtils');
      videoDuration = await getVideoDuration(videoFile, { signal });

    } catch (error) {
      if (error.name === 'AbortError' || signal.aborted) {
        throw error;
      }
      console.warn('Could not determine video duration:', error);
    }

    // Convert the video file to base64
    const base64Data = await fileToBase64(videoFile, { signal });

    // Determine how comprehensive the rule set should be based on video length
    const isLongVideo = videoDuration > 600; // More than 10 minutes
    const isVeryLongVideo = videoDuration > 1800; // More than 30 minutes

    // Create the request data with the analysis prompt
    const analysisPrompt = `You are an expert video and audio content analyzer. This video is ${Math.round(videoDuration)} seconds long (${Math.round(videoDuration/60)} minutes). Analyze this video and provide:

1. The most suitable transcription preset for this content from the following options:
   - general: General purpose transcription
   - focus-lyrics: Focus on lyrics (for music videos, songs)
   - extract-text: Extract visible text (for presentations, tutorials with text)
   - describe-video: Describe video content (for visual content description)
   - diarize-speakers: Identify different speakers (for multi-person conversations)
   - chaptering: Create chapters based on content (for long-form content)

2. A detailed rule set for consistent transcription. ${isLongVideo ? 'Since this is a longer video, provide as many detailed rules as possible to ensure consistency across the entire transcription.' : ''} ${isVeryLongVideo ? 'This is a very long video, so an extremely comprehensive rule set is essential - aim for at least 5-10 items in each applicable category.' : ''} Include (only if applicable):
   - Atmosphere: Description of the setting or context
   - Terminology: List of specialized terms and proper nouns with definitions (${isLongVideo ? 'provide as many as you can identify' : 'provide key terms'})
   - Speaker Identification: Descriptions of different speakers (${isLongVideo ? 'be very detailed about voice characteristics, speaking patterns, and any identifying features' : 'basic identification'})
   - Formatting and Style Conventions: How to format specific content (${isLongVideo ? 'be comprehensive and specific' : 'basic guidelines'})
   - Spelling, Grammar, and Punctuation: Special rules for this content (${isLongVideo ? 'include all exceptions and special cases' : 'key rules only'})
   - Relationships and Social Hierarchy: Information about relationships between people
   - Any other aspects that would help ensure consistent, high-quality transcription

Provide your analysis in a structured format that can be used to guide the transcription process.`;

    // Create the request data
    let requestData = {
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: analysisPrompt },
            {
              inlineData: {
                mimeType: videoFile.type,
                data: base64Data
              }
            }
          ]
        }
      ]
    };

    // Add response schema for structured output
    requestData = addResponseSchema(requestData, createVideoAnalysisSchema());

    // Disable thinking for video analysis to avoid token conflicts with complex schemas
    requestData = addThinkingConfig(requestData, MODEL, { enableThinking: false });

    onStatusUpdate({ message: t('input.analyzingVideo', 'Analyzing video content...'), type: 'loading' });

    // Call the Gemini API
    const { response, model: responseModel } = await requestGeminiWithModelFallback({
      model: MODEL,
      apiKey: geminiApiKey,
      requestData,
      signal,
      storageKeys: ['video_analysis_model'],
      enableThinking: false
    });

    if (!response.ok) {
      throw await createGeminiApiError(response, responseModel);
    }

    const data = await response.json();

    // Check if content was blocked by Gemini
    if (data?.promptFeedback?.blockReason) {
      console.error('Content blocked by Gemini:', data.promptFeedback);
      throw new Error(t('errors.contentBlocked', 'Video content is not safe and was blocked by Gemini'));
    }

    // Check if this is a structured JSON response
    let analysisResult;
    if (data.candidates?.[0]?.content?.parts?.[0]?.structuredJson) {
      analysisResult = data.candidates[0].content.parts[0].structuredJson;
    } else {
      // If not structured, try to parse the text response
      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!resultText) {
        throw new Error('No analysis returned from Gemini');
      }

      // Try to parse the text as JSON
      try {
        analysisResult = JSON.parse(resultText);
      } catch (e) {
        console.error('Failed to parse analysis as JSON:', e);
        // Create a simplified object with the raw text
        analysisResult = {
          rawResponse: resultText.substring(0, 1000), // Limit the size of raw response
          recommendedPreset: {
            id: 'general',
            reason: 'Default preset selected due to parsing error'
          },
          transcriptionRules: {
            additionalNotes: [resultText.substring(0, 1000) + '... (truncated)']
          }
        };
      }
    }

    // Sanitize the result to prevent localStorage overflow
    const sanitizedResult = sanitizeAnalysisResult(analysisResult);


    return sanitizedResult;
  } catch (error) {
    console.error('Error analyzing video:', error);

    // Check if this is an abort error
    if (error.name === 'AbortError' || signal.aborted) {
      const abortError = new Error('Video analysis was cancelled');
      abortError.name = 'AbortError';
      throw abortError;
    }

    throw error;
  } finally {
    removeRequestController(requestId);
    activeAnalysisController = null;
  }
};
