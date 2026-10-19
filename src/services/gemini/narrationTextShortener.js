import { fetchGeminiWithRetry, createRequestController, removeRequestController } from './requestManagement';
import { resolveGeminiModel } from './modelDiscovery';
import { getNextAvailableKey } from './keyManager';

const extractText = data => data?.candidates?.[0]?.content?.parts
  ?.map(part => part.text || '')
  .join('')
  .trim()
  .replace(/^```(?:text)?\s*/i, '')
  .replace(/\s*```$/, '')
  .replace(/^(?:"|“)(.*)(?:"|”)$/s, '$1');

export const shortenNarrationText = async (text, externalSignal) => {
  const sourceText = String(text || '').trim();
  if (!sourceText) throw new Error('Không có văn bản để rút gọn.');

  const apiKey = getNextAvailableKey() || localStorage.getItem('gemini_api_key');
  if (!apiKey) throw new Error('Hãy thêm Gemini API key trong Cài đặt để rút gọn câu.');

  const model = await resolveGeminiModel(localStorage.getItem('gemini_model') || '', apiKey);
  const operation = createRequestController({ type: 'narration-text-shortening', model });
  const abortFromCaller = () => operation.controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const response = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: operation.signal,
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{
              text: [
                'Rewrite the narration sentence more concisely while preserving its full meaning.',
                'Keep the same language and tone. Preserve names, numbers, negation, and factual details.',
                'Do not add information, explanations, labels, or quotation marks.',
                'Return only the rewritten narration text.',
                '',
                'Text:',
                sourceText
              ].join('\n')
            }]
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 512 }
        })
      },
      { maxRetries: 2 }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message || `Gemini HTTP ${response.status}`);
    }

    const shortenedText = extractText(await response.json());
    if (!shortenedText) throw new Error('Gemini không trả về câu rút gọn.');
    return shortenedText;
  } finally {
    externalSignal?.removeEventListener('abort', abortFromCaller);
    removeRequestController(operation.requestId);
  }
};
