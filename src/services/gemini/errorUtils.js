import i18n from '../../i18n/i18n';

const DAILY_QUOTA_PATTERN = /per.?day|daily|requestsperday|tokensperday|generate.*per.*day/i;

const redactSensitiveText = (value) => String(value || '')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');

const redactSensitiveValue = (value) => {
    if (typeof value === 'string') return redactSensitiveText(value);
    if (Array.isArray(value)) return value.map(redactSensitiveValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSensitiveValue(item)]));
    }
    return value;
};

const parseDurationMs = (value) => {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)s$/i);
    return match ? Math.max(0, Math.round(Number(match[1]) * 1000)) : null;
};

const readRetryInfoMs = (details) => {
    const retryInfo = (details || []).find((detail) => String(detail?.['@type'] || '').endsWith('RetryInfo'));
    return parseDurationMs(retryInfo?.retryDelay);
};

const readRetryAfterMs = (response, details) => {
    const value = response.headers.get('Retry-After');
    if (value) {
        const seconds = Number(value);
        if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
        const timestamp = Date.parse(value);
        if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now());
    }
    return readRetryInfoMs(details);
};

const readQuotaViolations = (details) => (details || [])
    .filter((detail) => String(detail?.['@type'] || '').endsWith('QuotaFailure'))
    .flatMap((detail) => Array.isArray(detail.violations) ? detail.violations : []);

const persistGeminiError = (metadata) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem('last_gemini_error', JSON.stringify({
            occurredAt: new Date().toISOString(),
            ...metadata
        }));
    } catch (error) {
        console.warn('[GeminiAPI] Could not persist error metadata:', error.message);
    }
};

export const createGeminiApiError = async (response, model) => {
    let rawBody = '';
    let errorData = null;

    try {
        rawBody = await response.text();
        errorData = rawBody ? JSON.parse(rawBody) : null;
    } catch (parseError) {
        console.warn('[GeminiAPI] Error response was not valid JSON:', parseError.message);
    }

    const providerError = errorData?.error || {};
    const details = redactSensitiveValue(providerError.details || []);
    const quotaViolations = readQuotaViolations(details);
    const quotaMetrics = [...new Set(quotaViolations.map((item) => item.quotaMetric).filter(Boolean))];
    const quotaIds = [...new Set(quotaViolations.map((item) => item.quotaId).filter(Boolean))];
    const code = providerError.code || response.status;
    const status = providerError.status || response.statusText || null;
    const providerMessage = redactSensitiveText(providerError.message || rawBody || response.statusText || 'Unknown Gemini API error');
    const retryAfter = readRetryAfterMs(response, details);
    const dailyQuotaText = [...quotaMetrics, ...quotaIds, providerMessage].join(' ');
    const isDailyQuota = (response.status === 429 || status === 'RESOURCE_EXHAUSTED') && DAILY_QUOTA_PATTERN.test(dailyQuotaText);
    const isRateLimit = !isDailyQuota && (response.status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || /rate.?limit|too many requests/i.test(providerMessage));
    const isQuotaError = isDailyQuota || isRateLimit || /quota|resource.?exhausted/i.test(providerMessage);
    const isOverloaded = response.status === 503 || code === 503 || status === 'UNAVAILABLE' || /overloaded|high demand|temporarily unavailable/i.test(providerMessage);
    const isAuthError = response.status === 401 || response.status === 403;
    const message = isDailyQuota
        ? i18n.t('errors.apiDailyQuotaExceeded', 'Gemini daily quota is exhausted for this model. Use another verified model or wait for the quota reset.')
        : isRateLimit
            ? i18n.t('errors.apiRateLimitExceeded', 'Gemini rate limit was reached. Wait for the indicated retry time and try again.')
            : isQuotaError
                ? i18n.t('errors.apiQuotaExceeded', 'Gemini quota was exceeded. Check the project usage limits.')
                : isOverloaded
                    ? i18n.t('errors.geminiServiceUnavailable', 'Gemini is temporarily unavailable. Please retry later.')
                    : isAuthError
                        ? i18n.t('errors.geminiApiKeyInvalid', 'Gemini API key is invalid or not authorized for this request.')
                        : `Gemini API error (${response.status}): ${providerMessage}`;

    const metadata = {
        httpStatus: response.status,
        code,
        status,
        model,
        message: providerMessage,
        details,
        quota: {
            type: isDailyQuota ? 'daily' : isRateLimit ? 'rate' : isQuotaError ? 'quota' : null,
            metrics: quotaMetrics,
            ids: quotaIds,
            violations: quotaViolations
        },
        retryAfter
    };
    const error = new Error(message);
    error.name = 'GeminiApiError';
    error.statusCode = response.status;
    error.isQuotaError = isQuotaError;
    error.isDailyQuota = isDailyQuota;
    error.isRateLimit = isRateLimit;
    error.isOverloaded = isOverloaded;
    error.isAuthError = isAuthError;
    error.retryAfter = retryAfter;
    error.gemini = metadata;

    persistGeminiError(metadata);
    console.warn('[GeminiAPI] API error metadata:', metadata);
    return error;
};

export const getGeminiErrorMessage = (
    error,
    t = (key, fallback) => i18n.t(key, fallback),
    { fallbackToRaw = true } = {}
) => {
    const status = Number(error?.statusCode || error?.status || error?.gemini?.httpStatus || error?.gemini?.code);
    const providerStatus = error?.gemini?.status;
    const rawMessage = redactSensitiveText(error?.message).replace(/<[^>]*>/g, '').trim();
    let message = rawMessage;
    let categorized = false;

    if (error?.isDailyQuota || error?.gemini?.quota?.type === 'daily') {
        categorized = true;
        message = t('errors.apiDailyQuotaExceeded', 'Gemini daily quota is exhausted for this model. Use another verified model or wait for the quota reset.');
    } else if (error?.isRateLimit || error?.gemini?.quota?.type === 'rate') {
        categorized = true;
        message = t('errors.apiRateLimitExceeded', 'Gemini rate limit was reached. Wait for the indicated retry time and try again.');
    } else if (error?.isQuotaError || status === 429 || providerStatus === 'RESOURCE_EXHAUSTED' || /quota|rate.?limit|resource.?exhausted/i.test(rawMessage)) {
        categorized = true;
        message = t('errors.apiQuotaExceeded', 'Gemini quota was exceeded. Check the project usage limits.');
    } else if (error?.isOverloaded || status === 503 || providerStatus === 'UNAVAILABLE' || /high demand|overloaded|service unavailable/i.test(rawMessage)) {
        categorized = true;
        message = t('errors.geminiServiceUnavailable', 'Gemini is temporarily unavailable. Please retry later.');
    } else if (error?.isAuthError || status === 401 || status === 403) {
        categorized = true;
        message = t('errors.geminiApiKeyInvalid', 'Gemini API key is invalid or not authorized for this request.');
    }

    const metadata = error?.gemini;
    if (!categorized && !metadata && !fallbackToRaw) return null;
    if (!metadata) return message;

    const details = [
        metadata.model ? `model=${metadata.model}` : null,
        metadata.httpStatus ? `HTTP=${metadata.httpStatus}` : null,
        metadata.status ? `status=${metadata.status}` : null,
        metadata.quota?.metrics?.length ? `quota=${metadata.quota.metrics.join(',')}` : null,
        Number.isFinite(metadata.retryAfter) ? `Retry-After=${Math.ceil(metadata.retryAfter / 1000)}s` : null
    ].filter(Boolean);

    return details.length > 0 ? `${message} [${details.join('; ')}]` : message;
};
