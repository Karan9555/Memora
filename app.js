// app.js — floating results overlay + determinate progress + one-click merge/export

const worker = new Worker('worker.js');

// --------- DOM refs ---------
const els = {
  fileInput:    document.getElementById('fileInput'),
  dropZone:     document.getElementById('dropZone'),
  clearDb:      document.getElementById('clearDb'),
  status:       document.getElementById('ingestStatus'),
  threadList:   document.getElementById('threadList'),
  resultsWrap:  document.getElementById('results'),
  searchBox:    document.getElementById('searchBox'),
  searchBtn:    document.getElementById('searchBtn'),
  recallBox:    document.getElementById('recallBox'),
  recallBtn:    document.getElementById('recallBtn'),
  openaiKey:    document.getElementById('openaiKey'),
  openaiModel:  document.getElementById('openaiModel'),
  saveOpts:     document.getElementById('saveOpts'),

  // overlay
  searchOverlay:  document.getElementById('searchOverlay'),
  searchTitle:    document.getElementById('searchTitle'),
  searchView:     document.getElementById('searchView'),
  searchCounts:   document.getElementById('searchCounts'),
  searchProgress: document.getElementById('searchProgress'),
  searchBar:      document.querySelector('#searchProgress .bar'),
  searchGrid:     document.getElementById('searchGrid'),
  loadMoreBtn:    document.getElementById('loadMoreBtn'),
  closeSearch:    document.getElementById('closeSearch'),
  mergeBtn:       document.getElementById('mergeBtn'),

  // export picker
  exportPicker:   document.getElementById('exportPicker'),
  exportCount:    document.getElementById('exportCount'),
  exportTitle:    document.getElementById('exportTitle'),
  exportType:     document.getElementById('exportType'),
  exportCancel:   document.getElementById('exportCancel'),
  exportGo:       document.getElementById('exportGo'),
};

// --------- defaults / state ---------
document.body.classList.add('theme-dark');

let opts = {
  openaiKey:  localStorage.getItem('openaiKey')  || '',
  openaiModel:localStorage.getItem('openaiModel')|| 'gpt-4o-mini'
};
if (els.openaiKey)   els.openaiKey.value   = opts.openaiKey;
if (els.openaiModel) els.openaiModel.value = opts.openaiModel;

let dbStats = { threads: 0, messages: 0 };

let viewMode   = localStorage.getItem('viewMode')   || 'grid';
let maxRender  = parseInt(localStorage.getItem('maxRender')  || '240', 10); // cap to avoid jank
let batchSize  = parseInt(localStorage.getItem('batchSize')  || '100', 10);
let maxMatches = parseInt(localStorage.getItem('maxMatches') || '2000', 10);

let currentSearchId = 0;
let searchHits   = [];   // all streamed hits for current search
let renderedCount= 0;    // how many of searchHits we’ve painted
let lastQuery    = '';

// --------- utils ---------
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

let ingestCounters = { threads:0, messages:0 };
function setStatus(msg){
  // compact ingest ticker
  if (msg.startsWith('Ingested thread:')) {
    ingestCounters.threads += 1;
    const m = msg.match(/\((\d+)\s*msgs\)/); if (m) ingestCounters.messages += parseInt(m[1], 10) || 0;
    return updateReadyBadge();
  }
  if (msg.startsWith('Done. Threads:')) {
    const m = msg.match(/Threads:\s*(\d+),\s*Messages:\s*(\d+)/i);
    if (m) { ingestCounters.threads = +m[1]; ingestCounters.messages = +m[2]; }
  }
  const p = document.createElement('div'); p.textContent = msg; els.status.prepend(p);
  updateReadyBadge();
}
function updateReadyBadge(){
  let sticky = document.getElementById('stickyReady');
  if (!sticky) { sticky = document.createElement('div'); sticky.id='stickyReady'; sticky.className='badge'; els.status.appendChild(sticky); }
  const t = ingestCounters.threads || dbStats.threads, m = ingestCounters.messages || dbStats.messages;
  sticky.textContent = `Ready: Threads=${t} Messages≈${m}`;
}

// --------- floating overlay controls ---------
function openSearchOverlay(title){
  document.body.classList.add('modal-open');
  els.searchOverlay.style.display = 'flex';
  els.searchTitle.textContent = title || 'Results';
  els.searchView.value = viewMode;
  setSearchView(viewMode);
  resetSearchContent();
}
function closeSearchOverlay(){
  els.searchOverlay.style.display = 'none';
  document.body.classList.remove('modal-open');
}
function setSearchView(mode){
  viewMode = mode; localStorage.setItem('viewMode', viewMode);
  els.searchGrid.className = mode === 'grid' ? 'results-grid' : mode === 'row' ? 'results-row' : '';
}
function resetSearchContent(){
  els.searchGrid.innerHTML = '';
  renderedCount = 0;
  searchHits = [];
  els.searchBar.style.width = '0%';
  els.searchProgress.style.display = 'block';
  els.searchCounts.textContent = '';
}
function updateProgress(scanned, total, matched){
  if (total && total > 0) {
    const pct = Math.min(100, Math.floor((scanned / total) * 100));
    els.searchBar.style.width = pct + '%';
    els.searchProgress.style.display = 'block';
  } else {
    els.searchBar.style.width = '100%';
    els.searchProgress.style.display = 'block';
  }
  const t = total ? ` / ${total}` : '';
  els.searchCounts.textContent = `Scanned: ${scanned}${t} · Matched: ${matched}`;
}

// --------- rendering results (safe, chunked) ---------
function makeCard(m){
  const div  = document.createElement('div');
  div.className = viewMode === 'list' ? 'message' : 'card';

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `[${m.timestamp || m.ts || ''}] ${m.thread_id || ''}`;

  const body = document.createElement('div');
  const role = (m.role || '').toUpperCase();
  const text = (m.text || '').trim();
  const short = text.length > 600 ? text.slice(0,600) + ' …' : text;
  body.innerHTML = `<span class="role">${role}:</span> <span class="${viewMode==='list'?'':'snippet'}">${escapeHtml(short)}</span>`;

  div.appendChild(meta);
  div.appendChild(body);

  if (viewMode !== 'list') {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const expand = document.createElement('button');
    expand.className = 'small';
    expand.textContent = 'Expand';
    expand.onclick = () => {
      if (div.classList.contains('expanded')) {
        div.classList.remove('expanded');
        body.querySelector('.snippet').textContent = short;
        expand.textContent = 'Expand';
      } else {
        div.classList.add('expanded');
        body.querySelector('.snippet').textContent = text;
        expand.textContent = 'Collapse';
      }
    };
    actions.appendChild(expand);
    div.appendChild(actions);
  }

  return div;
}

function renderAccumulated(loadMore = 0){
  const cap = maxRender + loadMore;
  const toRender = Math.min(searchHits.length, cap) - renderedCount;
  if (toRender <= 0) return;

  const chunk = 30;
  let i = 0;
  const step = () => {
    if (i >= toRender) return;
    const slice = searchHits.slice(renderedCount + i, renderedCount + Math.min(i + chunk, toRender));
    const frag = document.createDocumentFragment();
    for (const m of slice) frag.appendChild(makeCard(m));
    els.searchGrid.appendChild(frag);
    i += chunk;
    requestAnimationFrame(step);
  };
  step();
  renderedCount += toRender;
}

function renderNext(n = 200){ renderAccumulated(n); }

// --------- sidebar: threads list (count-first, toggle list) ---------
function renderThreads(threads){
  dbStats.threads = threads.length;
  const side = document.getElementById('threads');
  const list = document.getElementById('threadList');

  // header label
  const header = side.querySelector('.hint') || (() => {
    const h = document.createElement('div'); h.className = 'hint'; h.style.display='flex'; h.style.justifyContent='space-between'; h.style.alignItems='center';
    side.insertBefore(h, list);
    return h;
  })();
  header.textContent = ''; // reset
  const label = document.createElement('div'); label.textContent = `Threads (${threads.length})`;
  const btn   = document.createElement('button'); btn.className='small'; btn.textContent='Show list';
  header.appendChild(label); header.appendChild(btn);

  // toggle behavior
  let collapsed = true;
  const renderList = () => {
    list.innerHTML = '';
    if (collapsed) return;
    threads.sort((a,b) => (a.created_at||'').localeCompare(b.created_at||''));
    for (const t of threads) {
      const li = document.createElement('li');
      li.textContent = t.title || '(untitled)';
      li.title = t.id;
      li.onclick = () => worker.postMessage({ type:'FETCH_THREAD', payload:{ tid: t.id } });
      list.appendChild(li);
    }
  };
  btn.onclick = () => { collapsed = !collapsed; btn.textContent = collapsed ? 'Show list' : 'Hide list'; renderList(); };
  renderList();
}

// (optional) render single thread to content panel
function renderMessages(msgs, heading){
  const target = document.getElementById('results');
  target.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = `[${heading}] ${msgs.length} messages\n\n` + msgs.map(m =>
    `[${m.timestamp || ''}] ${m.role || ''}: ${m.text || ''}`
  ).join('\n');
  target.appendChild(pre);
}

// --------- export helpers ---------
function safeName(s){ return (s||'').toLowerCase().replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,''); }

function exportText(content, filename, mime){
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function buildTranscript(hits){
  const byThread = new Map();
  for (const m of hits) {
    const k = m.thread_id || '(no thread)';
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(m);
  }
  const lines = [];
  for (const [tid, arr] of byThread.entries()) {
    lines.push(`=== THREAD: ${tid} ===`);
    arr.sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||''));
    for (const m of arr) lines.push(`[${m.timestamp||''}] ${m.role||''}: ${m.text||''}`);
    lines.push('');
  }
  return lines.join('\n');
}
function buildMarkdown(hits, title){
  const byThread = new Map();
  for (const m of hits) {
    const k = m.thread_id || '(no thread)';
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(m);
  }
  const lines = [`# Merge: ${title}`, ''];
  for (const [tid, arr] of byThread.entries()) {
    lines.push(`## Thread ${tid}`, '');
    arr.sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||''));
    for (const m of arr) lines.push(`- **${m.role||''}** [${m.timestamp||''}]: ${m.text||''}`);
    lines.push('');
  }
  return lines.join('\n');
}
function buildHTMLTranscript(hits, title){
  const md = buildMarkdown(hits, title)
    .replace(/^# (.*)$/m, '<h1>$1</h1>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^- \*\*(.*?)\*\* \[(.*?)\]: (.*)$/gm, '<p><b>$1</b> <small>[$2]</small>: $3</p>')
    .replace(/\n/g,'\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>body{font-family:system-ui,sans-serif;padding:20px;background:#fff;color:#111} h1,h2{margin:0 0 .5em} p{margin:.3em 0}</style>
  </head><body>${md}</body></html>`;
}

function exportMergedNow(type){
  const title = lastQuery || 'merged';
  const filename = `merge_${safeName(title)}`;

  if (type === 'txt') {
    exportText(buildTranscript(searchHits), `${filename}.txt`, 'text/plain'); return;
  }
  if (type === 'md') {
    exportText(buildMarkdown(searchHits, title), `${filename}.md`, 'text/markdown'); return;
  }
  if (type === 'json') {
    exportText(JSON.stringify(searchHits, null, 2), `${filename}.json`, 'application/json'); return;
  }
  if (type === 'pdf') {
    const html = buildHTMLTranscript(searchHits, title);
    const w = window.open('', '_blank'); if (!w) return alert('Popup blocked. Allow popups to export PDF.');
    w.document.open(); w.document.write(html); w.document.close(); w.focus(); w.print(); return;
  }
}

// --------- file IO helpers ---------
function readFileAsync(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

// --------- events: import / drag-drop / options ---------
if (els.fileInput) {
  els.fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    ingestCounters = { threads:0, messages:0 };
    for (const f of files) {
      const text = await readFileAsync(f);
      worker.postMessage({ type:'INGEST_FILE', payload:{ name: f.name, text }});
    }
  });
}

['dragenter','dragover','dragleave','drop'].forEach(ev => {
  if (!els.dropZone) return;
  els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); });
});
if (els.dropZone) {
  els.dropZone.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer.files || []); if (!files.length) return;
    ingestCounters = { threads:0, messages:0 };
    for (const f of files) {
      const text = await readFileAsync(f);
      worker.postMessage({ type:'INGEST_FILE', payload:{ name: f.name, text }});
    }
  });
}

if (els.clearDb) els.clearDb.onclick = () => worker.postMessage({ type:'CLEAR_DB' });

// search & recall
if (els.searchBtn) els.searchBtn.onclick = () => {
  const q = els.searchBox.value.trim(); if (!q) return;
  lastQuery = q; currentSearchId++;
  openSearchOverlay(`Search: "${q}"`);
  worker.postMessage({ type:'SEARCH_STREAM', payload:{ query: q, batch: batchSize, maxMatches, searchId: currentSearchId }});
};
if (els.recallBtn) els.recallBtn.onclick = () => {
  const cmd = els.recallBox.value.trim();
  const kw = cmd.startsWith('$RECALL') ? cmd.slice(7).trim() : cmd;
  if (!kw) return;
  lastQuery = kw; currentSearchId++;
  openSearchOverlay(`$RECALL ${kw}`);
  worker.postMessage({ type:'SEARCH_STREAM', payload:{ query: kw, batch: Math.max(150, batchSize), maxMatches, forRecall: true, searchId: currentSearchId }});
};

// options save
if (els.saveOpts) els.saveOpts.onclick = () => {
  opts.openaiKey  = (els.openaiKey?.value || '').trim();
  opts.openaiModel= (els.openaiModel?.value || 'gpt-4o-mini').trim();
  localStorage.setItem('openaiKey',  opts.openaiKey);
  localStorage.setItem('openaiModel',opts.openaiModel);
  setStatus('Options saved.');
};

// overlay UI hooks
if (els.closeSearch) els.closeSearch.onclick = closeSearchOverlay;
if (els.searchOverlay) els.searchOverlay.addEventListener('click', (e) => { if (e.target === els.searchOverlay) closeSearchOverlay(); });
if (els.searchView) els.searchView.onchange = (e) => setSearchView(e.target.value);
if (els.loadMoreBtn) els.loadMoreBtn.onclick = () => renderNext(200);

// merge: open export picker
if (els.mergeBtn) els.mergeBtn.onclick = () => {
  if (!searchHits.length) return;
  els.exportCount.textContent = String(searchHits.length);
  els.exportTitle.textContent = (lastQuery || 'merged');
  els.exportType.value = 'txt';
  els.exportPicker.style.display = 'flex';
};

// export picker events
if (els.exportPicker) els.exportPicker.addEventListener('click', (e) => { if (e.target === els.exportPicker) els.exportPicker.style.display = 'none'; });
if (els.exportCancel) els.exportCancel.onclick = () => els.exportPicker.style.display = 'none';
if (els.exportGo) els.exportGo.onclick = () => {
  const type = els.exportType.value;
  els.exportPicker.style.display = 'none';
  exportMergedNow(type);
};

// --------- worker messages ---------
worker.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'status') return setStatus(e.data.msg);
  if (type === 'error')  { setStatus('Error: ' + e.data.msg); return; }

  if (type === 'THREADS') {
    dbStats.threads = e.data.threads.length;
    renderThreads(e.data.threads);
    return;
  }

  if (type === 'THREAD_MSGS') {
    renderMessages(e.data.messages, `Thread: ${e.data.tid}`);
    return;
  }

  if (type === 'SEARCH_META') {
    // reset bar & counts at start
    updateProgress(0, e.data.total, 0);
    return;
  }

  if (type === 'SEARCH_PROGRESS') {
    const { scanned, total, matched, searchId } = e.data;
    if (searchId !== currentSearchId) return;
    updateProgress(scanned, total, matched);
    return;
  }

  if (type === 'SEARCH_BATCH') {
    const { batch, done, searchId } = e.data;
    if (searchId !== currentSearchId) return;
    if (batch && batch.length) {
      searchHits.push(...batch);
      renderAccumulated(0);
    }
    if (done) {
      // final state: show full count; keep overlay open for merge/export
      updateProgress(searchHits.length, undefined, searchHits.length);
    }
    return;
  }
};

// --------- boot ---------
worker.postMessage({ type:'LIST_THREADS' });