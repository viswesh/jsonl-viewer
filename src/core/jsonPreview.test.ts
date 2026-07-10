import { describe, it, expect } from 'vitest';
import { previewTokens } from './jsonPreview';

describe('previewTokens', () => {
  it('classifies keys, strings, numbers, booleans', () => {
    const toks = previewTokens('{"name":"ada","age":36,"ok":true,"x":null}');
    const by = (cls: string) => toks.filter((t) => t.cls === cls).map((t) => t.text);
    expect(by('key')).toEqual(['"name"', '"age"', '"ok"', '"x"']);
    expect(by('str')).toEqual(['"ada"']);
    expect(by('num')).toEqual(['36']);
    expect(by('bool')).toEqual(['true', 'null']);
  });
  it('respects maxLen and appends ellipsis token', () => {
    const toks = previewTokens('{"k":"' + 'v'.repeat(500) + '"}', 50);
    const total = toks.reduce((n, t) => n + t.text.length, 0);
    expect(total).toBeLessThanOrEqual(51); // 50 + '…'
    expect(toks[toks.length - 1]!.text.endsWith('…')).toBe(true);
  });
  it('never throws on garbage', () => {
    expect(() => previewTokens('not json at all')).not.toThrow();
    expect(previewTokens('not json')[0]!.cls).toBe('punct');
  });
  it('handles escaped quotes in strings', () => {
    const toks = previewTokens('{"a":"say \\"hi\\""}');
    expect(toks.find((t) => t.cls === 'str')!.text).toBe('"say \\"hi\\""');
  });
  it('handles string values ending in escaped backslash', () => {
    const toks = previewTokens('{"path":"C:\\\\Users\\\\","ok":true}');
    const by = (cls: string) => toks.filter((t) => t.cls === cls).map((t) => t.text);
    expect(by('key')).toEqual(['"path"', '"ok"']);        // "ok" recognized as a key, not swallowed
    expect(by('bool')).toEqual(['true']);
  });
  it('handles escaped backslash followed by escaped quote', () => {
    // value is  \"  (backslash then quote), i.e. JSON  "\\\""
    const toks = previewTokens('{"a":"x\\\\\\"y"}');
    expect(toks.find((t) => t.cls === 'key')!.text).toBe('"a"');
  });
});
