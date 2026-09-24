import { getCurrentKey } from './keyManager';
import { listGeminiModels } from './models/modelSelector';
import { createRequestController, removeRequestController, fetchGemini } from './requestManagement';

const MODEL_LIST_CACHE_MS = 5 * 60 * 1000;
const MODEL_PROBE_CACHE_MS = 10 * 60 * 1000;
const TRANSIENT_MODEL_PROBE_CACHE_MS = 60 * 1000;
const MODEL_PROBE_CONCURRENCY = 1;
const VERIFIED_MODEL_CACHE_MS = 10 * 60 * 1000;
const VERIFIED_MODELS_STORAGE_KEY = 'gemini_verified_models_v1';
const FALLBACK_MODELS = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];
const SPECIALIZED_MODEL_MARKERS = [
  'image',
  'lyria',
  'tts',
  'transcribe',
  'embedding',
  'aqa',
  'robotics',
  'deep-research',
  'computer-use',
  'customtools'
];

let modelListCache = null;
let modelListFetchedAt = 0;
let modelListKey = null;
const modelProbeCache = new Map();
const runtimeUsableModels = new Map();

const normalizeModelId = (name) => name?.replace(/^models\//, '') || '';

const toModelOption = (model) => {
  const id = normalizeModelId(model.name || model.id);
  return {
    id,
    name: model.displayName || id,
    description: model.description || '',
    supportedGenerationMethods: model.supportedGenerationMethods || []
  };
};

const isGenerationModel = (model) => {
  if (!model?.supportedGenerationMethods?.includes('generateContent')) {
    return false;
  }

  const modelId = normalizeModelId(model.name || model.id).toLowerCase();
  const displayName = String(model.displayName || '').toLowerCase();
  return modelId.startsWith('gemini-') &&
    !SPECIALIZED_MODEL_MARKERS.some((marker) => modelId.includes(marker)) &&
    !displayName.includes('nano banana') &&
    !displayName.includes('embedding');
};

const fallbackOptions = () => FALLBACK_MODELS.map((id) => ({
  id,
  name: id,
  description: 'Provider fallback model',
  supportedGenerationMethods: ['generateContent', 'countTokens']
}));

const getApiKeyHint = (apiKey) => apiKey ? `${apiKey.length}:${apiKey.slice(-4)}` : '';

const readStoredVerifiedModelResult = (apiKey = getCurrentKey()) => {
  if (typeof localStorage === 'undefined' || !apiKey) return null;

  try {
    const stored = JSON.parse(localStorage.getItem(VERIFIED_MODELS_STORAGE_KEY) || 'null');
    if (!stored || stored.apiKeyHint !== getApiKeyHint(apiKey)) return null;
    return stored.result || null;
  } catch (error) {
    console.warn('Could not read cached Gemini model check:', error.message);
    return null;
  }
};

const readVerifiedModelResult = (apiKey = getCurrentKey()) => {
  const result = readStoredVerifiedModelResult(apiKey);
  if (!result?.checkedAt || Date.now() - result.checkedAt > VERIFIED_MODEL_CACHE_MS) {
    return null;
  }
  return result;
};

const writeVerifiedModelResult = (apiKey, result) => {
  if (typeof localStorage === 'undefined' || !apiKey || !result) return;

  try {
    localStorage.setItem(VERIFIED_MODELS_STORAGE_KEY, JSON.stringify({
      apiKeyHint: getApiKeyHint(apiKey),
      checkedAt: result.checkedAt,
      result
    }));
    const unavailable503Models = new Set(
      (result.unavailableModels || [])
        .filter((model) => model.statusCode === 503 || model.errorCode === 503 || model.errorStatus === 'UNAVAILABLE')
        .map((model) => normalizeModelId(model.id))
    );
    const fallbackModel = preferredOrder(result.usableModels || [], '')[0] || null;
    if (fallbackModel) {
      ['gemini_model', 'video_processing_model', 'video_analysis_model', 'translation_model'].forEach((storageKey) => {
        const currentModel = normalizeModelId(localStorage.getItem(storageKey));
        if (unavailable503Models.has(currentModel)) {
          persistGeminiModelFallback(currentModel, fallbackModel, [storageKey]);
        }
      });
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gemini-models-checked', {
        detail: { checkedAt: result.checkedAt }
      }));
    }
  } catch (error) {
    console.warn('Could not cache Gemini model check:', error.message);
  }
};

export const getCachedGeminiModelResult = (apiKey = getCurrentKey()) => readVerifiedModelResult(apiKey);

export const getCachedUsableGeminiModels = (apiKey = getCurrentKey()) => {
  const result = readVerifiedModelResult(apiKey);
  return result?.usableModels || [];
};

export const getDefaultGeminiModels = () => fallbackOptions();

export const persistGeminiModelFallback = (failedModel, fallbackModel, storageKeys = []) => {
  if (typeof localStorage === 'undefined' || !failedModel || !fallbackModel) return;
  storageKeys.forEach((storageKey) => {
    if (normalizeModelId(localStorage.getItem(storageKey)) === normalizeModelId(failedModel)) {
      localStorage.setItem(storageKey, normalizeModelId(fallbackModel));
    }
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gemini-model-fallback', {
      detail: {
        failedModel: normalizeModelId(failedModel),
        fallbackModel: normalizeModelId(fallbackModel),
        storageKeys
      }
    }));
  }
};

const dedupeModels = (models) => {
  const seen = new Set();
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
};

export const getDiscoveredGeminiModels = async ({ force = false, apiKey: providedApiKey = null, signal } = {}) => {
  const apiKey = providedApiKey || getCurrentKey();
  const now = Date.now();

  if (!apiKey) {
    return fallbackOptions();
  }

  if (
    !force &&
    modelListCache &&
    modelListKey === apiKey &&
    now - modelListFetchedAt < MODEL_LIST_CACHE_MS
  ) {
    return modelListCache;
  }

  try {
    const models = await listGeminiModels(apiKey, { signal });
    const discovered = dedupeModels(models
      .filter(isGenerationModel)
      .map(toModelOption)
      .filter((model) => model.id));

    if (discovered.length === 0) {
      throw new Error('No Gemini models supporting generateContent were returned');
    }

    modelListCache = discovered;
    modelListFetchedAt = now;
    modelListKey = apiKey;
    return discovered;
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') {
      throw error;
    }
    console.warn('Gemini model discovery failed; using fallback models:', error.message);
    return modelListCache && modelListKey === apiKey ? modelListCache : fallbackOptions();
  }
};

const probeModel = async (modelId, apiKey, { force = false, parentSignal } = {}) => {
  const cacheKey = `${apiKey}:${modelId}`;
  const now = Date.now();
  const cached = modelProbeCache.get(cacheKey);

  const cacheDuration = cached?.transient ? TRANSIENT_MODEL_PROBE_CACHE_MS : MODEL_PROBE_CACHE_MS;
  if (!force && cached && now - cached.checkedAt < cacheDuration) {
    return {
      usable: cached.usable,
      status: cached.status,
      message: cached.message,
      errorCode: cached.errorCode,
      errorStatus: cached.errorStatus
    };
  }

  const { requestId, signal, controller } = createRequestController({
    type: 'model-check',
    modelId
  });
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      abortFromParent();
    } else {
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
  }

  try {
    const response = await fetchGemini(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Translate OK to Vietnamese and return one subtitle.' }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 16,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  original: { type: 'string' },
                  translated: { type: 'string' }
                },
                required: ['original', 'translated']
              }
            }
          }
        }),
        signal
      }
    );

    const usable = response.ok;
    let message = '';
    let errorCode = null;
    let errorStatus = '';
    if (!usable) {
      try {
        const errorData = await response.json();
        message = errorData?.error?.message || response.statusText;
        errorCode = errorData?.error?.code || response.status;
        errorStatus = errorData?.error?.status || '';
      } catch (error) {
        message = response.statusText;
        errorCode = response.status;
      }
    }
    modelProbeCache.set(cacheKey, {
      usable,
      checkedAt: now,
      status: response.status,
      message,
      errorCode,
      errorStatus,
      transient: [429, 500, 502, 503, 504].includes(response.status)
    });
    return {
      usable,
      status: response.status,
      message,
      errorCode,
      errorStatus
    };
  } catch (error) {
    if (parentSignal?.aborted || signal.aborted) {
      throw error;
    }
    modelProbeCache.set(cacheKey, {
      usable: false,
      checkedAt: now,
      status: 0,
      message: error.message,
      errorCode: null,
      errorStatus: '',
      transient: true
    });
    return {
      usable: false,
      status: 0,
      message: error.message,
      errorCode: null,
      errorStatus: ''
    };
  } finally {
    if (parentSignal) {
      parentSignal.removeEventListener('abort', abortFromParent);
    }
    removeRequestController(requestId);
  }
};

const mapWithConcurrency = async (items, mapper, concurrency) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return results;
};

export const checkGeminiModels = async ({ force = false, apiKey: providedApiKey = null, signal: parentSignal } = {}) => {
  const apiKey = providedApiKey || getCurrentKey();
  const { requestId, signal, controller } = createRequestController({ type: 'model-check' });
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      abortFromParent();
    } else {
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
  }

  try {
    const discovered = await getDiscoveredGeminiModels({ force, apiKey, signal });

    if (!apiKey) {
      return {
        checkedAt: Date.now(),
        models: discovered.map((model) => ({ ...model, status: 'unknown' })),
        usableModels: [],
        unavailableModels: [],
        hasApiKey: false
      };
    }

    const models = await mapWithConcurrency(
      discovered,
      async (model) => {
        const probe = await probeModel(model.id, apiKey, { force, parentSignal: signal });
        return {
          ...model,
          status: probe.usable ? 'usable' : 'unavailable',
          statusCode: probe.status,
          errorCode: probe.errorCode,
          errorStatus: probe.errorStatus,
          errorMessage: probe.usable ? '' : probe.message
        };
      },
      MODEL_PROBE_CONCURRENCY
    );

    const result = {
      checkedAt: Date.now(),
      models,
      usableModels: models.filter((model) => model.status === 'usable'),
      unavailableModels: models.filter((model) => model.status === 'unavailable'),
      hasApiKey: true
    };
    writeVerifiedModelResult(apiKey, result);
    return result;
  } finally {
    if (parentSignal) {
      parentSignal.removeEventListener('abort', abortFromParent);
    }
    removeRequestController(requestId);
  }
};

const preferredOrder = (models, requestedModel) => {
  const ids = models.map((model) => model.id);
  const requested = requestedModel ? [requestedModel] : [];
  const preferred = FALLBACK_MODELS;
  const flashLite = ids.filter((id) => id.includes('flash-lite'));
  const flash = ids.filter((id) => id.includes('flash') && !id.includes('flash-lite'));
  return [...new Set([...requested, ...preferred, ...flashLite, ...flash, ...ids])];
};

export const getUsableGeminiModels = async ({ force = false, apiKey: providedApiKey = null } = {}) => {
  const result = await checkGeminiModels({ force, apiKey: providedApiKey });
  const usable = result.usableModels.map(({ status, ...model }) => model);

  return usable;
};

export const resolveGeminiModel = async (requestedModel = '', providedApiKey = null) => {
  const apiKey = providedApiKey || getCurrentKey();
  const cachedResult = readVerifiedModelResult(apiKey);
  const cachedModels = cachedResult?.usableModels || [];

  if (!cachedResult) {
    return normalizeModelId(requestedModel) || FALLBACK_MODELS[0];
  }

  const usableIds = new Set(cachedModels.map((model) => model.id));
  const requestedId = normalizeModelId(requestedModel);
  if (requestedId && usableIds.has(requestedId)) {
    return requestedId;
  }

  const orderedModels = preferredOrder(cachedModels, '')
    .filter((modelId) => usableIds.has(modelId));
  if (orderedModels.length > 0) {
    return orderedModels[0];
  }

  throw new Error('No verified Gemini model is currently available. Run model check again later.');
};

export const getVerifiedGeminiFallbackModel = (failedModel, providedApiKey = null) => {
  const apiKey = providedApiKey || getCurrentKey();
  const cachedModels = readStoredVerifiedModelResult(apiKey)?.usableModels || [];
  const runtimeModels = [...(runtimeUsableModels.get(apiKey) || [])].map((id) => ({ id }));
  const availableModels = dedupeModels([...cachedModels, ...runtimeModels]);
  const failedModelId = normalizeModelId(failedModel);
  const usableIds = new Set(availableModels.map((model) => normalizeModelId(model.id)));

  return preferredOrder(availableModels, '')
    .map(normalizeModelId)
    .find((modelId) => modelId && modelId !== failedModelId && usableIds.has(modelId)) || null;
};

export const recordGeminiModelSuccess = (model, providedApiKey = null) => {
  const apiKey = providedApiKey || getCurrentKey();
  const modelId = normalizeModelId(model);
  if (!apiKey || !modelId) return;
  const models = runtimeUsableModels.get(apiKey) || new Set();
  models.add(modelId);
  runtimeUsableModels.set(apiKey, models);
};

export const invalidateGeminiModelDiscovery = () => {
  modelListCache = null;
  modelListFetchedAt = 0;
  modelListKey = null;
  modelProbeCache.clear();
  runtimeUsableModels.clear();
};

export const getGeminiModelLabel = (model) => {
  const id = normalizeModelId(model?.id || model?.name);
  const displayName = String(model?.name || '').trim();
  if (displayName && displayName !== id && displayName !== `models/${id}`) {
    return `${displayName} (${id})`;
  }
  return id;
};
