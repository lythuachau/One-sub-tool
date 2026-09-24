import { addThinkingConfig } from '../../utils/thinkingBudgetUtils';
import {
    getVerifiedGeminiFallbackModel,
    persistGeminiModelFallback,
    recordGeminiModelSuccess
} from './modelDiscovery';
import { fetchGeminiWithRetry } from './requestManagement';

const createRequestDataForModel = (requestData, model, enableThinking) => {
    const generationConfig = { ...(requestData.generationConfig || {}) };
    delete generationConfig.thinkingConfig;
    return addThinkingConfig({
        ...requestData,
        model,
        generationConfig
    }, model, { enableThinking });
};

const sendRequest = (model, apiKey, requestData, signal, retryOptions) => fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
        signal
    },
    retryOptions
);

export const requestGeminiWithModelFallback = async ({
    model,
    apiKey,
    requestData,
    signal,
    storageKeys = [],
    enableThinking = true
}) => {
    let activeModel = model;
    let activeRequestData = requestData;
    const verifiedFallbackModel = getVerifiedGeminiFallbackModel(activeModel, apiKey);
    let response = await sendRequest(
        activeModel,
        apiKey,
        activeRequestData,
        signal,
        verifiedFallbackModel ? { retryableStatuses: [429, 500, 502, 504] } : undefined
    );

    if (response.status !== 503) {
        if (response.ok) recordGeminiModelSuccess(activeModel, apiKey);
        return { response, model: activeModel };
    }

    const fallbackModel = verifiedFallbackModel;
    if (!fallbackModel) {
        return { response, model: activeModel };
    }

    response.body?.cancel?.();
    activeModel = fallbackModel;
    activeRequestData = createRequestDataForModel(requestData, activeModel, enableThinking);
    persistGeminiModelFallback(model, activeModel, storageKeys);
    console.warn(`[GeminiAPI] Model ${model} returned 503; switched to verified model ${activeModel}`);
    response = await sendRequest(activeModel, apiKey, activeRequestData, signal);
    if (response.ok) recordGeminiModelSuccess(activeModel, apiKey);
    return { response, model: activeModel };
};
