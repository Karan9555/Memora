/* app.js — Memora (Puter-only summarize + robust global auth delegation)
   Requires in index.html (before this file):
   <script src="https://js.puter.com/v2/"></script>
*/

/* ===========================
   Puter SDK guard
   =========================== */
function ensurePuter() {
  if (typeof window !== 'undefined' && window.puter && typeof window.puter === 'object') return window.puter;
  throw new Error('Puter SDK not available: ensure <script src="https://js.puter.com/v2/"></script> loads before app.js and isn’t blocked.');
}

/* Works whether isSignedIn is sync (boolean) or async (Promise<boolean>) */
async function safeIsSignedIn() {
  try {
    const fn = window.puter?.auth?.isSignedIn;
    if (typeof fn !== 'function') return false;
    const v = fn(); // may be boolean or Promise
    return !!(v && typeof v.then === 'function' ? await v : v);
  } catch {
    return false;
  }
}

/* Optional banner for missing SDK (non-fatal) */
function showSdkBanner(msg) {
  if (document.getElementById('puterSdkBanner')) return;
  const div = document.createElement('div');
  div.id = 'puterSdkBanner';
  div.style.cssText = 'position:fixed;bottom:8px;left:8px;right:8px;background:#7f1d1d;color:#fff;padding:10px;border-radius:8px;border:1px solid #b91c1c;z-index:9999;font-size:13px';
  div.textContent = msg + ' — DevTools→Network: https://js.puter.com/v2/ should be 200.';
  document.body.appendChild(div);
  setTimeout(()=> div.remove(), 12000);
}

/* ===========================
   Worker init (ingest/search)
   =========================== */
const worker = new Worker('worker.js');

/* ===========================
   DOM refs
   =========================== */
const els = {
  // Controls
  searchBox:    document.getElementById('searchBox'),
  searchBtn:    document.getElementById('searchBtn'),
  recallBox:    document.getElementById('recallBox'),
  recallBtn:    document.getElementById('recallBtn'),
  fileInput:    document.getElementById('fileInput'),
  dropZone:     document.getElementById('dropZone'),
  clearDb:      document.getElementById('clearDb'),
  ingestStatus: document.getElementById('ingestStatus'),

  // Options / status
  optionsBtn:   document.getElementById('optionsBtn'),
  optionsModal: document.getElementById('optionsModal'),
  closeOptions: document.getElementById('closeOptions'),
  optOpenaiKey: document.getElementById('optOpenaiKey'),
  optOpenaiModel: document.getElementById('optOpenaiModel'),
  saveOpts:     document.getElementById('saveOpts'),
  puterUserStatus: document.getElementById('puterUserStatus'),

  // Sidebar + content
  threads:      document.getElementById('threads'),
  threadList:   document.getElementById('threadList'),
  resultsPanel: document.getElementById('results'),

  // Search overlay
  searchOverlay:  document.getElementById('searchOverlay'),
  searchPanel:    document.getElementById('searchPanel'),
  searchHeader:   document.getElementById('searchHeader'),
  searchTitle:    document.getElementById('searchTitle'),
  searchProgress: document.getElementById('searchProgress'),
  searchBar:      document.querySelector('#searchProgress .bar'),
  searchCounts:   document.getElementById('searchCounts'),
  searchBody:     document.getElementById('searchBody'),
  searchGrid:     document.getElementById('searchGrid'),
  searchView:     document.getElementById('searchView'),
  loadMoreBtn:    document.getElementById('loadMoreBtn'),
  closeSearch:    document.getElementById('closeSearch'),
  mergeBtn:       document.getElementById('mergeBtn'),
  summarizePuterBtn: document.getElementById('summarizePuterBtn'),

  // Export picker
  exportPicker: document.getElementById('exportPicker'),
  exportCount:  document.getElementById('exportCount'),
  exportTitle:  document.getElementById('exportTitle'),
  exportType:   document.getElementById('exportType'),
  exportGo:     document.getElementById('exportGo'),
  exportCancel: document.getElementById('exportCancel'),

  // Puter auth gate modal
  puterAuthModal: document.getElementById('puterAuthModal'),

  // Status dock (progress UI)
  jobDock:        document.getElementById('jobStatusDock'),
  jobStatusText:  document.getElementById('jobStatusText'),
  jobProgressBar: document.getElementById('jobProgressBar'),
  jobLogs:        document.getElementById('jobLogs'),
  viewSummaryMd:  document.getElementById('viewSummaryMd'),
  viewSummaryJson:document.getElementById('viewSummaryJson'),
  cancelJob:      document.getElementById('cancelJob'),

  // Digest preview (summary MD)
  digestPreview:  document.getElementById('digestPreview'),
  digestContent:  document.getElementById('digestContent'),
  closeDigest:    document.getElementById('closeDigest'),
};

/* ===========================
   State
   =========================== */
let currentSearchId = 0;
let searchHits = [];
let renderedCount = 0;
let lastQuery = '';
let viewMode = localStorage.getItem('viewMode') || 'grid';
let maxRender = parseInt(localStorage.getItem('maxRender') || '240', 10);
let batchSize = parseInt(localStorage.getItem('batchSize') || '100', 10);
let maxMatches = parseInt(localStorage.getItem('maxMatches') || '2000', 10);

const opts = {
  openaiKey:   localStorage.getItem('openaiKey')   || '',
  openaiModel: localStorage.getItem('openaiModel') || 'gpt-4o-mini'
};

let artifactUrls = { md: null, json: null };

/* ===========================
   Utils
   =========================== */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function setStatus(msg){
  const div = document.createElement('div');
  div.textContent = msg;
  els.ingestStatus?.prepend(div);
}
function safeName(s){ return (s||'').toLowerCase().replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,''); }
function updateProgress(scanned, total, matched){
  if (total && total > 0) {
    const pct = Math.min(100, Math.floor((scanned / total) * 100));
    els.searchBar.style.width = pct + '%';
    els.searchProgress.style.display = 'block';
  } else {
    els.searchBar.style.width = '100%';
    els.searchProgress.style.display = 'block';
  }
  els.searchCounts.textContent = `Scanned: ${scanned}${total?`/${total}`:''} · Matched: ${matched}`;
}
// Safe timestamp comparator (handles numbers, ISO strings, null)
function cmpTS(a, b) {
  const ta = typeof a === 'number' ? a : (Date.parse(a) || 0);
  const tb = typeof b === 'number' ? b : (Date.parse(b) || 0);
  return ta - tb;
}

/* ===========================
   Overlay + rendering
   =========================== */
function openSearchOverlay(title){
  els.searchOverlay.style.display = 'flex';
  els.searchTitle.textContent = title || 'Results';
  setSearchView(viewMode);
  resetSearchContent();
}
function closeSearchOverlay(){ els.searchOverlay.style.display = 'none'; }
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
function makeCard(m){
  const card = document.createElement('div');
  card.className = viewMode === 'list' ? 'message' : 'card';

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `[${m.timestamp || ''}] ${m.thread_id || ''}`;

  const body = document.createElement('div');
  const role = (m.role || '').toUpperCase();
  const text = (m.text || '').trim();
  const short = text.length > 600 ? text.slice(0,600) + ' …' : text;
  body.innerHTML = `<span class="role">${role}:</span> <span class="${viewMode==='list'?'':'snippet'}">${escapeHtml(short)}</span>`;

  card.appendChild(meta);
  card.appendChild(body);

  if (viewMode !== 'list') {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const btn = document.createElement('button');
    btn.className = 'small';
    btn.textContent = 'Expand';
    btn.onclick = () => {
      const sn = body.querySelector('.snippet');
      if (card.classList.contains('expanded')) {
        card.classList.remove('expanded');
        if (sn) sn.textContent = short;
        btn.textContent = 'Expand';
      } else {
        card.classList.add('expanded');
        if (sn) sn.textContent = text;
        btn.textContent = 'Collapse';
      }
    };
    actions.appendChild(btn);
    card.appendChild(actions);
  }
  return card;
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

/* Sidebar threads and content */
function renderThreads(threads){
  const side = els.threads;
  const list = els.threadList;
  const header = side.querySelector('.hint') || (() => {
    const h = document.createElement('div'); h.className='hint'; side.insertBefore(h, list); return h;
  })();
  header.textContent = `Threads (${threads.length}) • click “Show list” in sidebar`;

  list.innerHTML = '';
  threads.forEach((t,i) => {
    const li = document.createElement('li');
    li.textContent = `${String(i+1).padStart(3,'0')} — ${t.title || '(untitled)'}`;
    li.title = t.id;
    li.onclick = () => worker.postMessage({ type:'FETCH_THREAD', payload:{ tid: t.id } });
    list.appendChild(li);
  });
}
function renderMessages(msgs, heading){
  const target = els.resultsPanel;
  target.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = `[${heading}] ${msgs.length} messages\n\n` + msgs.map(m =>
    `[${m.timestamp || ''}] ${m.role || ''}: ${m.text || ''}`
  ).join('\n');
  target.appendChild(pre);
}

/* ===========================
   Export helpers
   =========================== */
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
    arr.sort((a,b)=> cmpTS(a.timestamp, b.timestamp));
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
    arr.sort((a,b)=> cmpTS(a.timestamp, b.timestamp));
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
  const filenameBase = `merge_${safeName(title)}`;
  if (!searchHits.length) { alert('No results to export. Run a search first.'); return; }
  if (type === 'txt') { exportText(buildTranscript(searchHits), `${filenameBase}.txt`, 'text/plain'); return; }
  if (type === 'md')  { exportText(buildMarkdown(searchHits, title), `${filenameBase}.md`, 'text/markdown'); return; }
  if (type === 'json'){ exportText(JSON.stringify(searchHits), `${filenameBase}.json`, 'application/json'); return; }
  if (type === 'jsonl'){
    const lines = searchHits.map(m => JSON.stringify(m)).join('\n');
    exportText(lines, `${filenameBase}.jsonl`, 'application/x-ndjson'); return;
  }
  if (type === 'pdf') {
    const html = buildHTMLTranscript(searchHits, title);
    const w = window.open('', '_blank'); if (!w) return alert('Popup blocked. Allow popups to export PDF.');
    w.document.open(); w.document.write(html); w.document.close(); w.focus(); w.print(); return;
  }
}

/* ===========================
   Puter-only Summarizer (no keys, no jobs)
   =========================== */
async function summarizeViaPuter(topic, hits, onProgress) {
  ensurePuter();
  const signed = await safeIsSignedIn();
  if (!signed) await puter.auth.signIn({ attempt_temp_user_creation: true });

  // Compact text → chunks
  const MAX_CHARS = 12000; // conservative for mobile
  const chunks = [];
  let buf = '';
  for (const m of hits) {
    const line = `[${m.thread_id}] ${m.role || 'role'}: ${m.text || ''}\n`;
    if ((buf.length + line.length) > MAX_CHARS) { chunks.push(buf); buf = ''; }
    buf += line;
  }
  if (buf) chunks.push(buf);

  const partials = [];
  const saved = (localStorage.getItem('openaiModel') || '').trim();
  const model = saved && !/openai|gpt-4o/i.test(saved) ? saved : undefined; // let Puter choose default if needed

  // Per-chunk summaries
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(Math.round((i / Math.max(1,chunks.length)) * 80), `Summarizing chunk ${i+1}/${chunks.length}…`);
    const prompt = [
      { role: 'system', content:
        `You are an information archivist. Summarize the following chat excerpts about "${topic}".
Return concise bullet points of: key ideas, decisions & rationale, definitions/terms, frameworks/lists, open questions,
contrasts/alternatives, and timeline notes. Reference thread_ids when helpful.` },
      { role: 'user', content: chunks[i] }
    ];
    const res = await puter.ai.chat(prompt, { model, temperature: 0.2 });
    const text = res?.content ?? res?.message?.content ?? String(res ?? '');
    partials.push(text);
  }

  onProgress?.(88, 'Synthesizing final digest…');

  // Final synthesis
  const synthPrompt = [
    { role: 'system', content:
      `Combine and deduplicate partial summaries into one canonical Markdown digest for "${topic}".
Include sections: 1) Key points 2) Definitions/terms 3) Frameworks/lists 4) Decisions & rationale
5) Open questions 6) Cross-links 7) Timeline evolution. Keep it tight and well-structured.` },
    { role: 'user', content: partials.map((s,i)=>`--- PART ${i+1} ---\n${s}`).join('\n\n') }
  ];
  const finalRes = await puter.ai.chat(synthPrompt, { model, temperature: 0.2 });
  const finalMd = finalRes?.content ?? finalRes?.message?.content ?? '# Summary\n\n(Empty)';

  const json = { topic, total_messages: hits.length, chunks: chunks.length, method: 'puter.ai.chat', partials };
  return { md: finalMd, json };
}

/* ===========================
   Export picker + Summarize (robust binding)
   =========================== */
function wireOverlayActions() {
  // MERGE
  if (els.mergeBtn && !els.mergeBtn._wired) {
    els.mergeBtn._wired = true;
    els.mergeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!searchHits.length) { alert('No results to merge. Run a search first.'); return; }
      els.exportCount.textContent = String(searchHits.length);
      els.exportTitle.textContent = (lastQuery || 'merged');
      els.exportType.value = 'md';
      els.exportPicker.style.display = 'flex';
    });
  }

  // EXPORT PICKER
  if (els.exportCancel && !els.exportCancel._wired) {
    els.exportCancel._wired = true;
    els.exportCancel.addEventListener('click', (e) => {
      e.preventDefault();
      els.exportPicker.style.display = 'none';
    });
  }
  if (els.exportPicker && !els.exportPicker._wired) {
    els.exportPicker._wired = true;
    els.exportPicker.addEventListener('click', (e) => {
      if (e.target === els.exportPicker) els.exportPicker.style.display = 'none';
    });
  }
  if (els.exportGo && !els.exportGo._wired) {
    els.exportGo._wired = true;
    els.exportGo.addEventListener('click', (e) => {
      e.preventDefault();
      const type = els.exportType.value;
      if (!searchHits.length) { alert('No results to export.'); return; }
      els.exportPicker.style.display = 'none';
      try { exportMergedNow(type); } catch (err) {
        console.error('Export failed:', err);
        alert('Export failed: ' + (err.message || err));
      }
    });
  }

  // SUMMARIZE (Puter-only)
  if (els.summarizePuterBtn && !els.summarizePuterBtn._wired) {
    els.summarizePuterBtn._wired = true;
    els.summarizePuterBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      if (!searchHits.length) { alert('No results to summarize. Run a search first.'); return; }

      const topic = lastQuery || 'merged';
      try {
        jobDockShow();
        jobDockSet('Preparing summary…', 1, []);
        const onProgress = (pct, label) => jobDockSet(label || 'Running…', pct, []);
        const out = await summarizeViaPuter(topic, searchHits, onProgress);

        artifactUrls.md   = URL.createObjectURL(new Blob([out.md], { type:'text/markdown' }));
        artifactUrls.json = URL.createObjectURL(new Blob([JSON.stringify(out.json, null, 2)], { type:'application/json' }));

        els.viewSummaryMd.disabled = false;
        els.viewSummaryJson.disabled = false;
        jobDockSet('Completed (Puter)', 100, []);
      } catch (e) {
        console.error('Puter summarize failed:', e);
        alert('Summarize failed: ' + (e.message || e));
        jobDockHide();
      }
    });
  }
}

// Patch overlay open to wire actions reliably
const _openSearchOverlay = openSearchOverlay;
openSearchOverlay = function patchedOpenOverlay(title) {
  _openSearchOverlay(title);
  wireOverlayActions();
  const hasHits = searchHits.length > 0;
  if (els.mergeBtn) els.mergeBtn.disabled = !hasHits;
  if (els.summarizePuterBtn) els.summarizePuterBtn.disabled = !hasHits;
  els.searchOverlay.style.zIndex = '999';
};

/* ===========================
   Global auth delegation (fix for non-clicking buttons)
   =========================== */
function authModalOpen() {
  const m = els.puterAuthModal;
  if (!m) return false;
  if (m.classList.contains('hidden')) return false;
  const r = m.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(m).display !== 'none' && getComputedStyle(m).visibility !== 'hidden';
}
function inferAuthActionFrom(el) {
  if (!el) return null;
  const id = (el.id || '').toLowerCase();
  const da = (el.dataset && el.dataset.action || '').toLowerCase();
  const ar = (el.getAttribute && (el.getAttribute('aria-label') || '')).toLowerCase();
  const text = (el.textContent || '').trim().toLowerCase();

  if (id.includes('btnputerguest') || da === 'guest' || /continue\s+as\s+guest/.test(text) || /guest/.test(ar))
    return 'guest';
  if (id.includes('btnputerlogin') || da === 'login' || /^log\s*in$/.test(text) || /login/.test(ar))
    return 'login';
  if (id.includes('btnputersignup') || da === 'signup' || /create\s*account|sign\s*up/.test(text) || /signup|create/.test(ar))
    return 'signup';
  return null;
}
// One global listener—robust for any button/element inside the modal
(function wireGlobalAuthDelegation(){
  if (document._memoraAuthDelegated) return;
  document._memoraAuthDelegated = true;

  document.addEventListener('click', async (e) => {
    if (!authModalOpen()) return; // only when modal is visible
    const modal = els.puterAuthModal;
    if (!modal) return;

    // Only handle clicks inside the modal
    if (!modal.contains(e.target)) return;

    const clickable = e.target.closest('[data-action],button,a,.btn,div[role="button"]') || e.target;
    const action = inferAuthActionFrom(clickable);
    if (!action) return;

    e.preventDefault();

    try { ensurePuter(); } catch (err) {
      alert('Puter SDK not loaded. Check <script src="https://js.puter.com/v2/"></script>');
      return;
    }

    try {
      if (action === 'guest') {
        await puter.auth.signIn({ attempt_temp_user_creation: true });
      } else if (action === 'login') {
        const user = await puter.ui.authenticateWithPuter();
        if (!user) throw new Error('Authentication cancelled.');
      } else if (action === 'signup') {
        const user = await (puter.ui.authenticateWithPuter({ mode: 'signup' })
          .catch(()=> puter.ui.authenticateWithPuter()));
        if (!user) throw new Error('Signup cancelled.');
      }
      els.puterAuthModal?.classList.add('hidden');
      refreshAuthStatus();
    } catch (err) {
      alert(err?.message || 'Authentication failed.');
    }
  }, true);
})();

/* ===========================
   Puter Auth status helpers
   =========================== */
async function refreshAuthStatus(){
  try {
    ensurePuter();
    const signed = await safeIsSignedIn();
    const s = els.puterUserStatus;
    if (signed) {
      const u = (puter.auth.getUser && await puter.auth.getUser().catch(()=>null)) || null;
      if (s) s.textContent = u?.username ? `@${u.username}` : (u?.email || 'Signed in');
      els.puterAuthModal?.classList.add('hidden');
    } else {
      if (s) s.textContent = 'Not signed in';
    }
  } catch {
    const s = els.puterUserStatus; if (s) s.textContent = 'Auth unavailable';
  }
}
async function initAuthGate(){
  try {
    ensurePuter();
    const signed = await safeIsSignedIn();
    if (!signed) els.puterAuthModal?.classList.remove('hidden');
    await refreshAuthStatus();
  } catch (e) {
    showSdkBanner('Puter SDK not available');
    els.puterAuthModal?.classList.remove('hidden');
  }
}

/* ===========================
   “Job” dock reused as progress UI
   =========================== */
function jobDockShow() { els.jobDock.classList.remove('hidden'); }
function jobDockHide() { els.jobDock.classList.add('hidden'); }
function jobDockSet(status, pct, logs){
  els.jobStatusText.textContent = status || '…';
  els.jobProgressBar.style.width = `${Math.max(0, Math.min(100, pct||0))}%`;
  if (logs && logs.length) {
    els.jobLogs.innerHTML = logs.slice(-200).map(x => `<div>${escapeHtml(x)}</div>`).join('');
    els.jobLogs.scrollTop = els.jobLogs.scrollHeight;
  }
}
if (els.viewSummaryMd) els.viewSummaryMd.onclick = () => {
  if (!artifactUrls.md) { alert('Summary MD not available yet.'); return; }
  els.digestContent.innerHTML = '';
  fetch(artifactUrls.md).then(r => r.text()).then(text => {
    let html = escapeHtml(text)
      .replace(/^# (.*)$/m, '<h1>$1</h1>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^- (.*)$/gm, '<li>$1</li>')
      .replace(/\n{2,}/g, '\n\n')
      .replace(/\n/g, '<br/>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    els.digestContent.innerHTML = html;
    els.digestPreview.classList.remove('hidden');
  });
};
if (els.viewSummaryJson) els.viewSummaryJson.onclick = () => {
  if (!artifactUrls.json) { alert('Summary JSON not available yet.'); return; }
  const a = document.createElement('a'); a.href = artifactUrls.json; a.download = 'summary.json'; a.click();
};
if (els.closeDigest) els.closeDigest.onclick = () => els.digestPreview.classList.add('hidden');
if (els.cancelJob) els.cancelJob.onclick = () => { jobDockHide(); };

/* ===========================
   Events: import / drag-drop
   =========================== */
function readFileAsync(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}
if (els.fileInput) {
  els.fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
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
    for (const f of files) {
      const text = await readFileAsync(f);
      worker.postMessage({ type:'INGEST_FILE', payload:{ name: f.name, text }});
    }
  });
}
if (els.clearDb) els.clearDb.onclick = () => worker.postMessage({ type:'CLEAR_DB' });

/* ===========================
   Search / recall
   =========================== */
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

if (els.searchView) els.searchView.onchange = (e) => setSearchView(e.target.value);
if (els.loadMoreBtn) els.loadMoreBtn.onclick = () => renderNext(200);
if (els.closeSearch) els.closeSearch.onclick = closeSearchOverlay;

/* ===========================
   Worker messages
   =========================== */
worker.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'status') return setStatus(e.data.msg);
  if (type === 'error')  { setStatus('Error: ' + e.data.msg); return; }

  if (type === 'THREADS') { renderThreads(e.data.threads); return; }
  if (type === 'THREAD_MSGS') { renderMessages(e.data.messages, `Thread: ${e.data.tid}`); return; }

  if (type === 'SEARCH_META') { updateProgress(0, e.data.total, 0); return; }
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
    const hasHits = searchHits.length > 0;
    if (els.mergeBtn) els.mergeBtn.disabled = !hasHits;
    if (els.summarizePuterBtn) els.summarizePuterBtn.disabled = !hasHits;

    if (done) updateProgress(searchHits.length, undefined, searchHits.length);
    return;
  }
};

/* ===========================
   Boot
   =========================== */
(function boot(){
  try { ensurePuter(); } catch (e) { console.warn(e.message); showSdkBanner('Puter SDK not available'); }

  // Overlay view mode
  setSearchView(viewMode);

  // Close overlay by clicking outside panel
  if (els.searchOverlay) els.searchOverlay.addEventListener('click', (e) => {
    if (e.target === els.searchOverlay) closeSearchOverlay();
  });

  // Auth gate
  initAuthGate();

  // Kick worker to list threads
  worker.postMessage({ type:'LIST_THREADS' });
})();