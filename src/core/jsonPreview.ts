export interface PreviewToken { text: string; cls: 'key' | 'str' | 'num' | 'bool' | 'punct' }

/** Cheap single-pass lexer for one JSON line. Tolerant: garbage → one punct token. */
export function previewTokens(raw: string, maxLen = 160): PreviewToken[] {
  const src = raw.length > maxLen ? raw.slice(0, maxLen) : raw;
  const out: PreviewToken[] = [];
  let i = 0;
  const push = (text: string, cls: PreviewToken['cls']) => { out.push({ text, cls }); };

  if (!src.startsWith('{') && !src.startsWith('[')) {
    push(src, 'punct');
  } else {
    let punct = '';
    const flush = () => { if (punct) { push(punct, 'punct'); punct = ''; } };
    while (i < src.length) {
      const c = src[i]!;
      if (c === '"') {
        // scan string, honoring escapes; may be unterminated (truncated line)
        let j = i + 1;
        while (j < src.length && (src[j] !== '"' || src[j - 1] === '\\')) j++;
        const text = src.slice(i, Math.min(j + 1, src.length));
        // key iff next non-space char is ':'
        let k = j + 1;
        while (k < src.length && src[k] === ' ') k++;
        flush();
        push(text, src[k] === ':' ? 'key' : 'str');
        i = j + 1;
      } else if (/[-0-9]/.test(c)) {
        let j = i;
        while (j < src.length && /[-0-9.eE+]/.test(src[j]!)) j++;
        flush(); push(src.slice(i, j), 'num'); i = j;
      } else if (/[a-z]/.test(c)) {
        let j = i;
        while (j < src.length && /[a-z]/.test(src[j]!)) j++;
        const word = src.slice(i, j);
        flush(); push(word, word === 'true' || word === 'false' || word === 'null' ? 'bool' : 'punct');
        i = j;
      } else {
        punct += c; i++;
      }
    }
    flush();
  }
  if (raw.length > maxLen) {
    const last = out[out.length - 1]!;
    last.text += '…';
  }
  return out;
}
