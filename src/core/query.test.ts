import { describe, it, expect } from 'vitest';
import { parseQuery, matchesLine } from './query';

const m = (raw: string, q: string, parsed?: unknown) =>
  matchesLine(raw, parseQuery(q), () => parsed ?? JSON.parse(raw));

describe('parseQuery', () => {
  it('parses text terms', () => {
    expect(parseQuery('hello world').terms).toEqual([
      { kind: 'text', value: 'hello' }, { kind: 'text', value: 'world' },
    ]);
  });
  it('parses field ops', () => {
    expect(parseQuery('role:assistant tokens>500 err:* usage.total_tokens<9').terms).toEqual([
      { kind: 'field', path: ['role'], op: ':', value: 'assistant' },
      { kind: 'field', path: ['tokens'], op: '>', value: '500' },
      { kind: 'field', path: ['err'], op: 'exists', value: '' },
      { kind: 'field', path: ['usage', 'total_tokens'], op: '<', value: '9' },
    ]);
  });
});

describe('matchesLine', () => {
  it('substring match is case-insensitive on raw', () => {
    expect(m('{"msg":"Fatal ERROR here"}', 'error')).toBe(true);
    expect(m('{"msg":"all good"}', 'error')).toBe(false);
  });
  it('field equality at top level', () => {
    expect(m('{"role":"assistant"}', 'role:assistant')).toBe(true);
    expect(m('{"role":"user"}', 'role:assistant')).toBe(false);
  });
  it('bare key matches at any depth', () => {
    expect(m('{"a":{"b":{"tokens":600}}}', 'tokens>500')).toBe(true);
  });
  it('dot path is exact', () => {
    expect(m('{"usage":{"total_tokens":42}}', 'usage.total_tokens<50')).toBe(true);
    expect(m('{"nested":{"usage":{"total_tokens":42}}}', 'usage.total_tokens<50')).toBe(false);
  });
  it('exists op', () => {
    expect(m('{"error":null}', 'error:*')).toBe(true);
    expect(m('{"ok":1}', 'error:*')).toBe(false);
  });
  it('AND across terms', () => {
    expect(m('{"role":"assistant","msg":"hi"}', 'role:assistant hi')).toBe(true);
    expect(m('{"role":"assistant","msg":"hi"}', 'role:assistant bye')).toBe(false);
  });
  it('field term on unparseable line is false, text term still works', () => {
    expect(matchesLine('not json', parseQuery('role:x'), () => undefined)).toBe(false);
    expect(matchesLine('not json', parseQuery('not'), () => undefined)).toBe(true);
  });
  it('numeric compare on non-numeric value is false', () => {
    expect(m('{"tokens":"lots"}', 'tokens>500')).toBe(false);
  });
  it('bare key first match wins in document order', () => {
    expect(m('{"x":{"tokens":1},"y":{"tokens":9}}', 'tokens<5')).toBe(true);   // finds x=1, not y=9
    expect(m('{"x":{"tokens":9},"y":{"tokens":1}}', 'tokens<5')).toBe(false);  // finds x=9 first
  });
  it('inherited prototype keys do not count as existing fields', () => {
    expect(m('{"a":1}', 'constructor:*')).toBe(false);
    expect(m('{"a":1}', 'toString:*')).toBe(false);
  });
});
