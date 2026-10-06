const normalized = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

export const alignSourceWords = (subtitles, segments) => {
  const words = segments.flatMap(s => s.words || []).filter(w =>
    Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a,b) => a.start-b.start);
  return subtitles.map(s => {
    const expected = normalized(s.text);
    if (!expected) return {...s, words:[], alignmentError:'Phụ đề gốc trống'};
    const nearby = words.filter(w => w.end >= s.start - 1.5 && w.start <= s.end + 1.5);
    const candidates = [];
    for(let i=0;i<nearby.length;i++) {
      let text='';
      for(let j=i;j<nearby.length;j++) {
        text+=normalized(nearby[j].text ?? nearby[j].word);
        if(!expected.startsWith(text)) break;
        if(text===expected) { candidates.push(nearby.slice(i,j+1)); break; }
      }
    }
    if(candidates.length!==1) return {...s, words:[], alignmentError:'Chưa khớp chắc chắn lời gốc với audio; cần kiểm tra mốc câu'};
    return {...s, words:candidates[0], alignmentError:null};
  });
};
