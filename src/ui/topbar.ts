export interface TopbarState {
  filename: string; lineCount: number; fileSize: number;
  badCount: number; matchCount: number | null; searching: boolean;
  mode: 'json' | 'transcript'; transcriptAvailable: boolean;
  errorsActive: boolean;
}
export interface TopbarHandlers {
  onSearch: (q: string) => void; onModeToggle: () => void;
  onThemeToggle: () => void; onNewFile: () => void; onErrorsClick: () => void;
}

const fmtSize = (n: number) =>
  n > 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB`
  : n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB`
  : `${(n / 1024).toFixed(1)} KB`;

export function createTopbar(el: HTMLElement, h: TopbarHandlers) {
  el.innerHTML = `
    <span class="readout" id="tb-file"></span>
    <span class="readout" id="tb-lines"></span>
    <span class="readout" id="tb-size"></span>
    <button class="readout danger" id="tb-errors" hidden></button>
    <input id="tb-search" type="search" placeholder='search — text, role:assistant, tokens>500'
           spellcheck="false" autocomplete="off" />
    <span class="readout" id="tb-matches" hidden></span>
    <button id="tb-mode" hidden></button>
    <button id="tb-theme" aria-label="toggle theme">◐</button>
    <button id="tb-new">new file</button>
  `;
  const $ = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;
  let t = 0;
  ($('tb-search') as HTMLInputElement).addEventListener('input', (e) => {
    clearTimeout(t);
    t = window.setTimeout(() => h.onSearch((e.target as HTMLInputElement).value), 150);
  });
  $('tb-mode').addEventListener('click', h.onModeToggle);
  $('tb-theme').addEventListener('click', h.onThemeToggle);
  $('tb-new').addEventListener('click', h.onNewFile);
  $('tb-errors').addEventListener('click', h.onErrorsClick);

  return function update(s: TopbarState): void {
    $('tb-file').textContent = s.filename;
    $('tb-lines').textContent = `${s.lineCount.toLocaleString()} lines`;
    $('tb-size').textContent = fmtSize(s.fileSize);
    const err = $('tb-errors') as HTMLButtonElement;
    err.hidden = s.badCount === 0;
    // every line is bad — filtering to "errors only" would show the exact same list, a no-op toggle
    const filterIsNoOp = s.badCount > 0 && s.badCount === s.lineCount;
    err.disabled = filterIsNoOp;
    err.textContent = filterIsNoOp ? `${s.badCount} bad` : s.errorsActive ? 'back to full list' : `${s.badCount} bad`;
    err.classList.toggle('active', s.errorsActive && !filterIsNoOp);
    const matches = $('tb-matches');
    matches.hidden = s.matchCount === null;
    matches.textContent = s.searching ? `${s.matchCount} matches…` : `${s.matchCount} matches`;
    const mode = $('tb-mode');
    mode.hidden = !s.transcriptAvailable;
    mode.textContent = s.mode === 'json' ? 'transcript view' : 'json view';
  };
}
