import '@speed-highlight/core/themes/github-dark.css';
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
  searchId: 0,                           // current live search; stale hits are dropped
  previews: new Map<number, string>(),   // LRU-ish preview cache
  errorsActive: false,                   // true when the current filter came from the errors button
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
  const lines: number[] = [];
  for (let r = from; r <= to; r++) lines.push(displayToLine(r));
  const missing = lines.filter((l) => !state.previews.has(l));
  if (!missing.length) return;
  // fetch exactly the mapped indices — a filtered view's window can span
  // millions of real lines, so a contiguous fetch would be catastrophic
  const previews = await state.client.getLinesByIndices(missing);
  if (previews.length === missing.length) { // guard against stale [] resolution
    missing.forEach((l, i) => state.previews.set(l, previews[i]!));
  }
  if (state.previews.size > 5000) state.previews.clear(); // crude LRU: full reset
  list.refresh();
}

// Called after a filter change (search apply/clear, errors filter) replaces the
// display list — never from onSearchHits, so a mid-stream batch can't yank the
// user's selection around. Mirrors initial-load behavior: select row 0 if the
// new list has rows, otherwise clear the selection and detail pane.
function resetSelectionForFilterChange(): void {
  if (displayTotal() > 0) {
    select(0);
  } else {
    state.selected = null;
    list.setSelected(null);
    detailPane.textContent = '';
  }
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
  errorsActive: state.errorsActive,
} satisfies TopbarState);

const topbarUpdate = createTopbar($('topbar'), {
  onSearch(q) {
    if (!state.client) return;
    state.errorsActive = false; // search always takes over from an errors-filtered view
    if (!q.trim()) {
      state.searchId = 0; // invalidate any in-flight search — drop its late hits
      state.filtered = null; state.matchCount = null; state.searching = false;
      list.setTotal(displayTotal()); updateTopbar();
      resetSelectionForFilterChange();
      return;
    }
    state.filtered = []; state.matchCount = 0; state.searching = true;
    state.searchId = state.client.search(q);
    list.setTotal(0); // reset filtered view + scroll to top once, at search start
    updateTopbar();
    resetSelectionForFilterChange();
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
    if (state.badLines.size === state.lineCount) return; // every line is bad — filter would be a no-op
    if (state.errorsActive) {
      // toggle off — restore the full list
      state.errorsActive = false;
      state.searchId = 0; state.filtered = null; state.matchCount = null; state.searching = false;
      list.setTotal(displayTotal()); updateTopbar();
      resetSelectionForFilterChange();
      return;
    }
    state.errorsActive = true;
    state.searchId = 0; // invalidate any in-flight search so its hits don't corrupt this view
    state.filtered = [...state.badLines].sort((a, b) => a - b);
    state.matchCount = state.filtered.length; state.searching = false;
    list.setTotal(displayTotal()); updateTopbar();
    resetSelectionForFilterChange();
    ($('tb-search') as HTMLInputElement).value = ''; // clear stale query text — errors view isn't search-driven
  },
});

function loadBlob(blob: Blob, name: string): void {
  state.client?.terminate(); // stop the previous file's worker before it can post stale state
  const client = new WorkerClient();
  state.client = client;
  state.filename = name;
  state.previews.clear(); state.badLines.clear();
  state.filtered = null; state.selected = null; state.matchCount = null;
  state.searchId = 0; // fresh client restarts its id counter — invalidate old id
  state.errorsActive = false;

  client.onIndexed = (lineCount, fileSize) => {
    state.lineCount = lineCount; state.fileSize = fileSize;
    $('landing').hidden = true;
    $('viewer').hidden = false;
    document.getElementById('seo-footer')?.setAttribute('hidden', '');
    list.setTotal(lineCount);
    updateTopbar();
    client.validate(); // background bad-line sweep
    if (lineCount > 0) select(0);
  };
  client.onBadLines = (indices) => { for (const i of indices) state.badLines.add(i); updateTopbar(); list.refresh(); };
  client.onSearchHits = (id, hits, done, _scanned, _total) => {
    if (id !== state.searchId || !state.filtered) return; // stale or superseded — drop
    state.filtered.push(...hits);
    state.matchCount = state.filtered.length;
    state.searching = !done;
    list.updateCount(displayTotal()); // no scroll reset mid-stream
    updateTopbar();
  };
  client.onFatal = (message) => {
    alert(message); // v1: simple; replaced by inline error panel in styling task
  };
  client.load(blob);
}

initDropzone($('dropzone'), $('demo-link'), loadBlob);

// draggable divider
const divider = $('divider');
divider.addEventListener('pointerdown', (e) => {
  divider.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const pct = (ev.clientX / window.innerWidth) * 100;
    listPane.style.width = `${Math.min(75, Math.max(20, pct))}%`;
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', () => divider.removeEventListener('pointermove', move), { once: true });
});

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
