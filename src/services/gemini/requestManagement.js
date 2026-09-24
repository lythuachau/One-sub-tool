/**
 * Request management for Gemini API
 * Handles abort controllers and request tracking
 */

// Registry for every cancellable operation, including non-fetch promises.
const activeAbortControllers = new Map();

let geminiRequestQueue = Promise.resolve();

const createAbortError = (reason = 'Operation cancelled by user') => {
    const error = new Error(String(reason));
    error.name = 'AbortError';
    return error;
};

export const enqueueGeminiRequest = (task, signal) => {
    const run = () => {
        if (signal?.aborted) {
            return Promise.reject(createAbortError(signal.reason));
        }
        return task();
    };

    const queuedTask = geminiRequestQueue.then(run, run);
    geminiRequestQueue = queuedTask.catch(() => undefined);
    return queuedTask;
};

export const fetchGemini = (url, options = {}) => (
    enqueueGeminiRequest(() => fetch(url, options), options.signal)
);

const parseRetryDelayMs = (value) => {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)s$/i);
    return match ? Math.max(0, Math.round(Number(match[1]) * 1000)) : null;
};

const readRetryMetadata = async (response) => {
    if (response.status !== 429) return { isDailyQuota: false, retryAfterMs: null };
    try {
        const data = await response.clone().json();
        const details = data?.error?.details || [];
        const violations = details
            .filter((detail) => String(detail?.['@type'] || '').endsWith('QuotaFailure'))
            .flatMap((detail) => Array.isArray(detail.violations) ? detail.violations : []);
        const quotaText = violations
            .flatMap((item) => [item.quotaId, item.quotaMetric])
            .filter(Boolean)
            .join(' ');
        const retryInfo = details.find((detail) => String(detail?.['@type'] || '').endsWith('RetryInfo'));
        return {
            isDailyQuota: /per.?day|daily|requestsperday|tokensperday|generate.*per.*day/i.test(`${quotaText} ${data?.error?.message || ''}`),
            retryAfterMs: parseRetryDelayMs(retryInfo?.retryDelay)
        };
    } catch (error) {
        return { isDailyQuota: false, retryAfterMs: null };
    }
};

const getRetryAfterMs = (response, fallbackMs, providerRetryAfterMs = null) => {
    const value = response.headers.get('Retry-After');
    if (!value) return providerRetryAfterMs ?? fallbackMs;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.min(Math.max(0, seconds * 1000), 60000);
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.min(Math.max(0, timestamp - Date.now()), 60000) : fallbackMs;
};

const waitForRetry = (delayMs, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
        reject(createAbortError(signal.reason));
        return;
    }

    const timeoutId = setTimeout(resolve, delayMs);
    signal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(createAbortError(signal.reason));
    }, { once: true });
});

export const fetchGeminiWithRetry = async (
    url,
    options = {},
    { maxRetries = 3, retryableStatuses: configuredRetryableStatuses = [429, 500, 502, 503, 504] } = {}
) => {
    const retryableStatuses = new Set(configuredRetryableStatuses);
    const fallbackDelays = [5000, 15000, 45000];

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const response = await fetchGemini(url, options);
        if (!retryableStatuses.has(response.status) || attempt >= maxRetries) {
            return response;
        }

        const retryMetadata = await readRetryMetadata(response);
        if (retryMetadata.isDailyQuota) {
            return response;
        }

        const delayMs = getRetryAfterMs(
            response,
            fallbackDelays[Math.min(attempt, fallbackDelays.length - 1)],
            retryMetadata.retryAfterMs
        );
        console.warn(`[GeminiAPI] transient HTTP ${response.status}; retry ${attempt + 1}/${maxRetries} in ${Math.round(delayMs / 1000)}s`);
        response.body?.cancel?.();
        await waitForRetry(delayMs, options.signal);
    }

    throw new Error('Gemini request retry limit reached');
};

// Global flag to indicate when processing should be completely stopped
let _processingForceStopped = false;

/**
 * Get the current state of the processing force stopped flag
 * @returns {boolean} - Whether processing has been force stopped
 */
export const getProcessingForceStopped = () => _processingForceStopped;

/**
 * Set the processing force stopped flag
 * @param {boolean} value - New value for the flag
 */
export const setProcessingForceStopped = (value) => {
    _processingForceStopped = value;

};

/**
 * Create a new request ID and abort controller
 * @returns {Object} - Object containing requestId and signal
 */
export const registerAbortableOperation = ({ operationId, controller = null, cancel = null, metadata = {} } = {}) => {
    const id = operationId || `operation_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    activeAbortControllers.set(id, { controller, cancel, metadata });
    return id;
};

export const unregisterAbortableOperation = (operationId) => {
    if (operationId) {
        activeAbortControllers.delete(operationId);
    }
};

export const createRequestController = (metadata = {}) => {
    const requestId = `request_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const controller = new AbortController();
    registerAbortableOperation({ operationId: requestId, controller, metadata });
    return { requestId, signal: controller.signal, controller };
};

/**
 * Remove a request controller from the active map
 * @param {string} requestId - ID of the request to remove
 */
export const removeRequestController = (requestId) => {
    unregisterAbortableOperation(requestId);
};

/**
 * Abort all ongoing Gemini API requests
 * @returns {boolean} - Whether any requests were aborted
 */
export const abortAllRequests = (reason = 'Operation cancelled by user') => {
    const hadActiveOperations = activeAbortControllers.size > 0;
    setProcessingForceStopped(true);

    for (const { controller, cancel } of activeAbortControllers.values()) {
        try {
            if (controller && !controller.signal.aborted) {
                controller.abort(reason);
            }
            if (typeof cancel === 'function') {
                cancel(reason);
            }
        } catch (error) {
            console.error('Error cancelling operation:', error);
        }
    }

    activeAbortControllers.clear();

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gemini-requests-aborted', {
            detail: { reason, hadActiveOperations }
        }));
    }

    return hadActiveOperations;
};
