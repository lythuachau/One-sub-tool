import { fetchGemini } from '../requestManagement';

/**
 * Functions for selecting appropriate Gemini models
 */

/**
 * List available Gemini models
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Array>} - List of available models
 */
export const listGeminiModels = async (apiKey, { signal } = {}) => {
  try {
    if (!apiKey) {
      apiKey = localStorage.getItem('gemini_api_key');
      if (!apiKey) {
        throw new Error('Gemini API key not found');
      }
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetchGemini(apiUrl, { signal });

    if (!response.ok) {
      const rawBody = await response.text();
      let errorData = {};
      try {
        errorData = rawBody ? JSON.parse(rawBody) : {};
      } catch (parseError) {
        console.warn('[GeminiAPI] Model list error was not valid JSON:', parseError.message);
      }
      const providerError = errorData.error || {};
      const error = new Error(`Gemini API error (${response.status}): ${providerError.message || rawBody || response.statusText}`);
      error.statusCode = response.status;
      error.gemini = {
        httpStatus: response.status,
        code: providerError.code || response.status,
        status: providerError.status || response.statusText || null,
        model: 'models',
        message: providerError.message || rawBody || response.statusText,
        details: providerError.details || null,
        retryAfter: response.headers.get('Retry-After') || null
      };
      throw error;
    }

    const data = await response.json();
    return data.models || [];
  } catch (error) {
    console.error('Error listing Gemini models:', error);
    throw error;
  }
};

// Cache for supported models
let supportedModelsCache = null;

const isLiveAudioModel = (model) => {
  const methods = model.supportedGenerationMethods || [];
  const name = (model.name || '').toLowerCase();
  const hasAudioIdentity = ['native-audio', 'tts', 'audio'].some(marker => name.includes(marker));
  const isTranscriptionOnly = name.includes('transcribe');
  const supportsLiveTransport = methods.includes('bidiGenerateContent') || methods.includes('streamGenerateContent');

  return hasAudioIdentity && !isTranscriptionOnly && supportsLiveTransport;
};

/**
 * Find a suitable model for audio generation
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<string>} - Model name
 */
export const findSuitableAudioModel = async (apiKey) => {
  try {
    if (supportedModelsCache) {
      const audioModel = supportedModelsCache.find(isLiveAudioModel);

      if (audioModel) {

        return audioModel.name; // Use the full model name with path
      }
    }

    // Otherwise, fetch the list of models
    const models = await listGeminiModels(apiKey);
    supportedModelsCache = models;


    const potentialModels = models.filter(isLiveAudioModel);

    if (potentialModels.length === 0) {
      throw new Error('No Gemini Live audio model is available for this API key');
    }

    // Look for models with "live" in the name as they're more likely to support WebSocket
    const liveModel = potentialModels.find(model =>
      model.name.toLowerCase().includes('live')
    );

    if (liveModel) {
      // Use the full model name with path
      const modelName = liveModel.name;

      return modelName;
    }

    // Prefer models with "flash" in the name for faster generation
    const flashModel = potentialModels.find(model =>
      model.name.toLowerCase().includes('flash')
    );

    if (flashModel) {
      // Use the full model name with path
      const modelName = flashModel.name;

      return modelName;
    }

    // Otherwise, use the first suitable model
    // Use the full model name with path
    const modelName = potentialModels[0].name;

    return modelName;
  } catch (error) {
    console.error('Error finding suitable audio model:', error);
    throw error;
  }
};
