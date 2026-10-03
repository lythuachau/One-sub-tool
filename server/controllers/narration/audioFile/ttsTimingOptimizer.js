const PROTECTED_TOKEN_PATTERN = /\p{N}+(?:[.,]\p{N}+)?/gu;

const SAFE_COMPACTION_RULES = [
  { pattern: /(?<![\p{L}\p{N}])chúng ta sẽ(?![\p{L}\p{N}])/giu, replacement: 'ta sẽ' },
  { pattern: /(?<![\p{L}\p{N}])chúng ta có thể(?![\p{L}\p{N}])/giu, replacement: 'ta có thể' },
  { pattern: /(?<![\p{L}\p{N}])ngày hôm nay(?![\p{L}\p{N}])/giu, replacement: 'hôm nay' },
  { pattern: /(?<![\p{L}\p{N}])có thể nói rằng(?![\p{L}\p{N}])/giu, replacement: '' },
  { pattern: /(?<![\p{L}\p{N}])để có thể(?![\p{L}\p{N}])/giu, replacement: 'để' },
  { pattern: /(?<![\p{L}\p{N}])nhằm mục đích(?![\p{L}\p{N}])/giu, replacement: 'nhằm' },
  { pattern: /(?<![\p{L}\p{N}])một cách\s+(?=(nhanh|chậm|đơn giản|rõ ràng|chính xác|hiệu quả)(?![\p{L}\p{N}]))/giu, replacement: '' },
  { pattern: /(?<![\p{L}\p{N}])và sau đó(?![\p{L}\p{N}])/giu, replacement: 'sau đó' },
  { pattern: /(?<![\p{L}\p{N}])trong thời điểm hiện tại(?![\p{L}\p{N}])/giu, replacement: 'hiện tại' },
  { pattern: /(?<![\p{L}\p{N}])được biết đến là(?![\p{L}\p{N}])/giu, replacement: 'là' }
];

const normalizeText = (text) => text.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();

const protectedTokens = (text) => (text.match(PROTECTED_TOKEN_PATTERN) || []).map(token => token.toLocaleLowerCase());

const preservesProtectedTokens = (originalText, candidateText) => {
  const originalTokens = protectedTokens(originalText);
  const candidateTokens = protectedTokens(candidateText);
  return originalTokens.every(token => candidateTokens.includes(token));
};

const compactNarrationText = (text, maxCandidates = 2) => {
  const originalText = normalizeText(String(text || ''));
  if (!originalText) return [];

  const candidates = [];
  let current = originalText;
  for (const rule of SAFE_COMPACTION_RULES) {
    const next = normalizeText(current.replace(rule.pattern, rule.replacement));
    if (next !== current && preservesProtectedTokens(originalText, next) && next.length >= 12) {
      current = next;
      if (!candidates.includes(current)) candidates.push(current);
    }
  }
  if (candidates.length > maxCandidates - 1) {
    return [candidates[0], current].filter((candidate, index, list) => candidate && list.indexOf(candidate) === index).slice(0, maxCandidates);
  }
  return candidates;
};

const getTargetDurationMs = (current, next, gapMs = 50) => {
  if (!next || !Number.isFinite(current?.start) || !Number.isFinite(next?.start)) return null;
  return Math.max(200, Math.round((next.start - current.start) * 1000) - gapMs);
};

module.exports = {
  compactNarrationText,
  getTargetDurationMs
};
