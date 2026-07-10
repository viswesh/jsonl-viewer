import { WorkerClient } from './ui/workerClient';
import { VirtualList } from './ui/virtualList';
import { initDropzone } from './ui/dropzone';
import { createTopbar, type TopbarState } from './ui/topbar';
import { renderJsonTree } from './ui/detailJson';
import { renderTranscript } from './ui/detailTranscript';
import { normalizeToMessages } from './core/detect';
import { previewTokens } from './core/jsonPreview';

const $ = (id: string) => document.getElementById(id)!;
const ROW_H = 28;

const state = {
  client: null as WorkerClient | null,
  filename: '', lineCount: 0, fileSize: 0,
  filtered: null as number[] | null,     // search hits (indices) or null = all
  badLines: new Set<number>(),
  selected: null as number | null,
  mode: 'json' as 'json' | 'transcript',
  transcriptAvailable: false,
  matchCount: null as number | null, searching: false,
  previews: new Map<number, string>(),   // LRU-ish preview cache
};

const listPane = $('list-pane');
const detailPane = $('detail-pane');

const displayTotal = () => state.filtered ? state.filtered.length : state.lineCount;
const displayToLine = (row: number) => state.filtered ? state.filtered[row]! : row;

const list = new VirtualList({
  container: listPane, rowHeight: ROW_H,
  render(row, el) {
    const line = displayToLine(row);
    const num = document.createElement('span');
    num.className = 'line-num';
    num.textContent = String(line + 1);
    el.appendChild(num);
    const body = document.createElement('span');
    body.className = 'line-preview';
    el.appendChild(body);
    if (state.badLines.has(line)) el.classList.add('bad');
    const cached = state.previews.get(line);
    if (cached !== undefined) fillPreview(body, cached);
    el.addEventListener('click', () => select(row));
  },
  onRangeChange(from, to) { void loadPreviews(from, to); },
});

function fillPreview(el: HTMLElement, raw: string): void {
  el.textContent = '';
  for (const tok of previewTokens(raw)) {
    const s = document.createElement('span');
    s.className = `tok-${tok.cls}`;
    s.textContent = tok.text;
    el.appendChild(s);
  }
}

async function loadPreviews(from: number, to: number): Promise<void> {
  if (!state.client || to < from) return;
  const lines = Array.from({ length: to - from + 1 }, (_, i) => displayToLine(from + i));
  const missing = lines.some((l) => !state.previews.has(l));
  if (!missing) return;
  // contiguous fetch across the mapped range (filtered views fetch a superset — fine, cheap)
  const lo = Math.min(...lines), hi = Math.max(...lines);
  const previews = await state.client.getLines(lo, hi);
  previews.forEach((p, i) => state.previews.set(lo + i, p));
  if (state.previews.size > 5000) state.previews.clear(); // crude LRU: full reset
  list.refresh();
}

function select(row: number): void {
  const line = displayToLine(row);
  state.selected = line;
  list.setSelected(row);
  void showDetail(line);
}

async function showDetail(line: number): Promise<void> {
  if (!state.client) return;
  const text = await state.client.getLine(line);
  if (state.selected !== line) return; // stale
  detailPane.textContent = '';
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    const err = document.createElement('p');
    err.className = 'parse-error';
    err.textContent = 'This line is not valid JSON — raw content:';
    const pre = document.createElement('pre');
    pre.textContent = text;
    detailPane.append(err, pre);
    return;
  }
  const msgs = normalizeToMessages(value);
  state.transcriptAvailable = msgs !== null;
  if (msgs && state.mode === 'transcript') renderTranscript(msgs, detailPane);
  else renderJsonTree(value, detailPane);
  updateTopbar();
}

const updateTopbar = () => topbarUpdate({
  filename: state.filename, lineCount: state.lineCount, fileSize: state.fileSize,
  badCount: state.badLines.size, matchCount: state.matchCount, searching: state.searching,
  mode: state.mode, transcriptAvailable: state.transcriptAvailable,
} satisfies TopbarState);

const topbarUpdate = createTopbar($('topbar'), {
  onSearch(q) {
    if (!state.client) return;
    if (!q.trim()) {
      state.filtered = null; state.matchCount = null; state.searching = false;
      list.setTotal(displayTotal()); updateTopbar(); return;
    }
    state.filtered = []; state.matchCount = 0; state.searching = true;
    state.client.search(q);
    updateTopbar();
  },
  onModeToggle() {
    state.mode = state.mode === 'json' ? 'transcript' : 'json';
    if (state.selected !== null) void showDetail(state.selected);
    updateTopbar();
  },
  onThemeToggle() {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'light' ? '' : 'light';
  },
  onNewFile() { location.reload(); },
  onErrorsClick() {
    state.filtered = [...state.badLines].sort((a, b) => a - b);
    state.matchCount = state.filtered.length; state.searching = false;
    list.setTotal(displayTotal()); updateTopbar();
  },
});

function loadBlob(blob: Blob, name: string): void {
  const client = new WorkerClient();
  state.client = client;
  state.filename = name;
  state.previews.clear(); state.badLines.clear();
  state.filtered = null; state.selected = null; state.matchCount = null;

  client.onIndexed = (lineCount, fileSize) => {
    state.lineCount = lineCount; state.fileSize = fileSize;
    $('landing').hidden = true;
    $('viewer').hidden = false;
    list.setTotal(lineCount);
    updateTopbar();
    client.validate(); // background bad-line sweep
    if (lineCount > 0) select(0);
  };
  client.onBadLines = (indices) => { for (const i of indices) state.badLines.add(i); updateTopbar(); list.refresh(); };
  client.onSearchHits = (_id, hits, done, scanned, total) => {
    state.filtered!.push(...hits);
    state.matchCount = state.filtered!.length;
    state.searching = !done;
    list.setTotal(displayTotal());
    updateTopbar();
    void scanned; void total; // progress display: optional polish
  };
  client.onFatal = (message) => {
    alert(message); // v1: simple; replaced by inline error panel in styling task
  };
  client.load(blob);
}

initDropzone($('dropzone'), $('demo-link'), loadBlob);

// keyboard: ↑/↓ moves selection
document.addEventListener('keydown', (e) => {
  if (state.selected === null || (e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const rows = displayTotal();
  const currentRow = state.filtered ? state.filtered.indexOf(state.selected) : state.selected;
  const next = Math.max(0, Math.min(rows - 1, currentRow + (e.key === 'ArrowDown' ? 1 : -1)));
  list.scrollToIndex(next);
  select(next);
});
