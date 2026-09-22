/**
 * Functions for checking Gemini API availability
 */

import { listGeminiModels, findSuitableAudioModel } from '../models/modelSelector';

/**
 * Check if Gemini API is available
 * @returns {Promise<Object>} - Availability status
 */
export const checkGeminiAvailability = async () => {
  try {
    // Check if API key is available
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      return {
        available: false,
        error: 'Gemini API key not found',
        message: 'Please set your Gemini API key in the settings'
      };
    }

    // Try to list models to check if the API key is valid
    try {
      const models = await listGeminiModels(apiKey);

      // Check if there are any models available
      if (!models || models.length === 0) {
        return {
          available: false,
          error: 'No Gemini models available',
          message: 'No Gemini models available with your API key'
        };
      }

      // Try to find a suitable model for audio generation
      const suitableModel = await findSuitableAudioModel(apiKey);

      if (!suitableModel) {
        return {
          available: false,
          error: 'No suitable models for audio generation',
          message: 'No suitable Gemini models found for audio generation'
        };
      }

      return {
        available: true,
        model: suitableModel
      };
    } catch (error) {
      if (error.message?.includes('No Gemini Live audio model')) {
        return {
          available: false,
          error: error.message,
          message: 'Gemini narration requires a Live audio model enabled for this API key. Choose Edge TTS or gTTS, or use a key with Gemini Live audio access.'
        };
      }
      return {
        available: false,
        error: `Gemini API error: ${error.message}`,
        message: 'Invalid Gemini API key or API access issue'
      };
    }
  } catch (error) {
    console.error('Error checking Gemini availability:', error);
    return {
      available: false,
      error: error.message,
      message: 'Error checking Gemini API availability'
    };
  }
};
