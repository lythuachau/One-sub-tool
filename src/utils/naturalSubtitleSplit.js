export const countWords = text => {
  const clean = String(text || '').trim();
  if (!clean) return 0;
  if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(clean))
    return [...clean.replace(/[\s\p{P}]/gu, '')].length;
  return clean.split(/\s+/u).length;
};

export const smartSplitText = (text, targetWords = 8) => {
  if (!text) return [{ text, wordCount: 0 }];
  const target = Math.max(6, Number(targetWords) || 8);
  const result = [];
  const split = value => {
    const total = countWords(value);
    if (total <= target || total < 12) {
      result.push({ text: value, wordCount: total });
      return;
    }
    const candidates = [];
    for (const match of value.matchAll(/[.!?。！？,，;；:：](?:["”’»)]*)\s*|\s+(?=(?:nhưng|tuy nhiên|vì vậy|do đó|sau đó|trong khi|mặc dù|bởi vì|còn nếu)\s)/giu)) {
      const punctuation = /^[.!?。！？,，;；:：]/u.test(match[0]);
      const position = match.index + match[0].trimEnd().length;
      if (/[.,]/.test(match[0][0]) && /\d/.test(value[match.index - 1] || '')
        && /\d/.test(value[match.index + 1] || '')) continue;
      if (match[0][0] === '.' && /(?:\b(?:TS|ThS|PGS|GS|Mr|Mrs|Dr)|TP|v\.v)$/iu.test(value.slice(0, match.index))) continue;
      const left = value.slice(0, position).trim();
      const right = value.slice(position).trim();
      const a = countWords(left), b = countWords(right);
      if (a < 6 || b < 6) continue;
      if (/(?:không chỉ là|không những|của|với|là|để|và|hoặc|một|những|các)\s*[,;:]?$/iu.test(left)) continue;
      const strength = /^[.!?。！？]/u.test(match[0]) ? 0 : punctuation ? 1 : 2;
      candidates.push({ left, right, score: strength * target + Math.abs(a - target) });
    }
    candidates.sort((a, b) => a.score - b.score);
    if (!candidates.length) {
      result.push({ text: value, wordCount: total });
      return;
    }
    split(candidates[0].left);
    split(candidates[0].right);
  };
  split(text.trim());
  return result;
};
