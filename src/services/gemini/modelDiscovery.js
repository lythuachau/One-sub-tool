import { getCurrentKey } from './keyManager';
import { listGeminiModels } from './models/modelSelector';

const MODEL_LIST_CACHE_MS = 5 * 60 * 1000;
const MODEL_PROBE_CACHE_MS = 10 * 60 * 1000;
const TRANSIENT_MODEL_PROBE_CACHE_MS = 60 * 1000;
const MODEL_PROBE_TIMEOUT_MS = 12000;
const MODEL_PROBE_CONCURRENCY = 3;
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

const dedupeModels = (models) => {
  const seen = new Set();
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
};

export const getDiscoveredGeminiModels = async ({ force = false, apiKey: providedApiKey = null } = {}) => {
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
    const models = await listGeminiModels(apiKey);
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
    console.warn('Gemini model discovery failed; using fallback models:', error.message);
    return modelListCache && modelListKey === apiKey ? modelListCache : fallbackOptions();
  }
};

const probeModel = async (modelId, apiKey, { force = false } = {}) => {
  const cacheKey = `${apiKey}:${modelId}`;
  const now = Date.now();
  const cached = modelProbeCache.get(cacheKey);

  const cacheDuration = cached?.transient ? TRANSIENT_MODEL_PROBE_CACHE_MS : MODEL_PROBE_CACHE_MS;
  if (!force && cached && now - cached.checkedAt < cacheDuration) {
    return cached.usable;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MODEL_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(
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
        signal: controller.signal
      }
    );

    const usable = response.ok;
    let message = '';
    if (!usable) {
      try {
        const errorData = await response.json();
        message = errorData?.error?.message || response.statusText;
      } catch (error) {
        message = response.statusText;
      }
    }
    modelProbeCache.set(cacheKey, {
      usable,
      checkedAt: now,
      status: response.status,
      message,
      transient: [429, 500, 502, 503, 504].includes(response.status)
    });
    return usable;
  } catch (error) {
    modelProbeCache.set(cacheKey, {
      usable: false,
      checkedAt: now,
      status: 0,
      message: error.message,
      transient: true
    });
    return false;
  } finally {
    clearTimeout(timeoutId);
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

export const checkGeminiModels = async ({ force = false, apiKey: providedApiKey = null } = {}) => {
  const apiKey = providedApiKey || getCurrentKey();
  const discovered = await getDiscoveredGeminiModels({ force, apiKey });

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
    async (model) => ({
      ...model,
      status: await probeModel(model.id, apiKey, { force }) ? 'usable' : 'unavailable'
    }),
    MODEL_PROBE_CONCURRENCY
  );

  return {
    checkedAt: Date.now(),
    models,
    usableModels: models.filter((model) => model.status === 'usable'),
    unavailableModels: models.filter((model) => model.status === 'unavailable'),
    hasApiKey: true
  };
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
  const models = await getDiscoveredGeminiModels({ apiKey });

  if (!apiKey) {
    return requestedModel || models[0]?.id || FALLBACK_MODELS[0];
  }

  for (const modelId of preferredOrder(models, requestedModel)) {
    if (await probeModel(modelId, apiKey)) {
      return modelId;
    }
  }

  return requestedModel || models[0]?.id || FALLBACK_MODELS[0];
};

export const invalidateGeminiModelDiscovery = () => {
  modelListCache = null;
  modelListFetchedAt = 0;
  modelListKey = null;
  modelProbeCache.clear();
};

export const getGeminiModelLabel = (model) => {
  const id = normalizeModelId(model?.id || model?.name);
  const displayName = String(model?.name || '').trim();
  if (displayName && displayName !== id && displayName !== `models/${id}`) {
    return `${displayName} (${id})`;
  }
  return id;
};
