/* worker.js — Memora (ingest + IndexedDB + streaming search) */

let db;
const DB_NAME = 'memora-db';
const DB_VERSION = 3; // bump
const STORE = 'messages';

/* ===========================
   IndexedDB
   =========================== */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      let store;
      if (!db.objectStoreNames.contains(STORE)) {
        store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      } else {
        store = req.transaction.objectStore(STORE);
      }
      try { store.createIndex('thread_id', 'thread_id'); } catch {}
      try { store.createIndex('timestamp', 'timestamp'); } catch {}
      try { store.createIndex('role', 'role'); } catch {}
      try { store.createIndex('text', 'text'); } catch {}
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e);
  });
}
async function getStore(mode = 'readonly') {
  if (!db) await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}
async function addMessages(msgs) {
  if (!msgs || !msgs.length) return;
  const store = await getStore('readwrite');
  await new Promise((resolve, reject) => {
    let pending = msgs.length;
    msgs.forEach((m) => {
      try {
        store.put(m).onsuccess = () => { if (--pending === 0) resolve(); };
      } catch (err) { reject(err); }
    });
  });
}
async function getAllMessages() {
  const store = await getStore();
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = (e) => rej(e);
  });
}
async function clearDb() {
  const store = await getStore('readwrite');
  return new Promise((res, rej) => {
    const req = store.clear();
    req.onsuccess = () => res();
    req.onerror = (e) => rej(e);
  });
}

/* ===========================
   Parsing helpers
   =========================== */
function coerceThreadId(conv, i) {
  return conv.id || conv.conversation_id || (conv.title && `title:${conv.title}`) || `conv-${i}`;
}
function normalizeMessage(tid, role, text, ts) {
  return {
    thread_id: tid || '(no thread)',
    role: role || 'unknown',
    text: text || '',
    timestamp: ts || null
  };
}

function parseConversationsArray(arr) {
  const out = [];
  for (let i=0;i<arr.length;i++) {
    const conv = arr[i];
    const tid = coerceThreadId(conv, i);
    if (conv.mapping && typeof conv.mapping === 'object') {
      for (const node of Object.values(conv.mapping)) {
        const m = node?.message;
        if (!m) continue;
        const role = m.author?.role || 'unknown';
        let text = '';
        if (Array.isArray(m.content?.parts)) text = m.content.parts.join(' ');
        else if (typeof m.content === 'string') text = m.content;
        const ts = m.create_time || conv.create_time || conv.update_time || null;
        out.push(normalizeMessage(tid, role, text, ts));
      }
      continue;
    }
    if (Array.isArray(conv.messages)) {
      for (const mm of conv.messages) {
        out.push(normalizeMessage(
          tid,
          mm.role || mm.author || 'unknown',
          mm.text || mm.content || '',
          mm.timestamp || mm.create_time || null
        ));
      }
      continue;
    }
  }
  return out;
}

function parseChatHTML(htmlText) {
  // Best-effort only. The HTML export varies; rely on conversations.json as source of truth.
  const out = [];
  const lines = String(htmlText).split(/\r?\n/);
  const tid = 'chat-html';
  for (let i=0;i<lines.length;i++) {
    const ln = lines[i];
    const content = ln.match(/class=["']content["'][^>]*>(.*?)</i);
    if (content) {
      const clean = stripHtml(content[1]);
      if (clean) out.push(normalizeMessage(tid, 'unknown', clean, null));
    }
  }
  return out;
}
function stripHtml(s) { return String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

function parseFile(name, text) {
  const lower = name.toLowerCase();
  try {
    if (lower.endsWith('.json')) {
      const data = JSON.parse(text);

      if (Array.isArray(data)) {
        // conversations.json (common)
        return parseConversationsArray(data);
      }

      if (Array.isArray(data?.conversations)) {
        // some exports nest conversations here
        return parseConversationsArray(data.conversations);
      }

      if (Array.isArray(data?.message_feedback)) {
        // feedback has no messages; ignore
        return [];
      }

      // user.json contains profile/metadata; not messages
      postMessage({ type:'status', msg:`Unrecognized JSON structure in ${name}; skipping.` });
      return [];
    }

    if (lower.endsWith('.html')) {
      const msgs = parseChatHTML(text);
      if (!msgs.length) postMessage({ type:'status', msg:`Parsed 0 messages from ${name} (HTML parsing is best-effort).` });
      return msgs;
    }
  } catch (e) {
    postMessage({ type:'error', msg:`Failed to parse ${name}: ${e.message}` });
    return [];
  }
  postMessage({ type:'status', msg:`Unsupported file type: ${name}` });
  return [];
}

/* ===========================
   Threads & search
   =========================== */
function titleFromMessages(msgs) {
  const userMsg = msgs.find(m => (m.role || '').toLowerCase() === 'user' && m.text);
  if (userMsg) return userMsg.text.slice(0, 80);
  const any = msgs.find(m => m.text);
  return any ? any.text.slice(0, 80) : '(untitled)';
}

async function listThreads() {
  const msgs = await getAllMessages();
  const map = new Map();
  for (const m of msgs) {
    const tid = m.thread_id || '(no thread)';
    if (!map.has(tid)) map.set(tid, []);
    map.get(tid).push(m);
  }
  const threads = [];
  for (const [tid, arr] of map.entries()) {
    arr.sort((a,b)=> String(a.timestamp||'').localeCompare(String(b.timestamp||'')));
    threads.push({ id: tid, title: titleFromMessages(arr), count: arr.length });
  }
  postMessage({ type:'THREADS', threads });
}

async function fetchThread(tid) {
  const msgs = (await getAllMessages()).filter(m => (m.thread_id || '(no thread)') === tid);
  msgs.sort((a,b)=> String(a.timestamp||'').localeCompare(String(b.timestamp||'')));
  postMessage({ type:'THREAD_MSGS', tid, messages: msgs });
}

async function searchStream({ query, batch=100, maxMatches=2000, searchId }) {
  const q = (query || '').toLowerCase();
  const msgs = await getAllMessages();
  const total = msgs.length;
  postMessage({ type:'SEARCH_META', total, searchId });

  let matched = 0;
  const buf = [];

  for (let i=0; i<msgs.length; i++) {
    const m = msgs[i];
    const hay = (m.text || '').toLowerCase();
    if (q && hay.includes(q)) {
      buf.push(m);
      matched++;
      if (buf.length >= batch) {
        postMessage({ type:'SEARCH_BATCH', batch: buf.splice(0), done:false, searchId });
      }
      if (matched >= maxMatches) break;
    }
    if ((i % 500) === 0) {
      postMessage({ type:'SEARCH_PROGRESS', scanned:i, total, matched, searchId });
      await new Promise(r => setTimeout(r,0));
    }
  }
  if (buf.length) {
    postMessage({ type:'SEARCH_BATCH', batch: buf, done:false, searchId });
  }
  postMessage({ type:'SEARCH_BATCH', batch: [], done:true, searchId });
  postMessage({ type:'SEARCH_PROGRESS', scanned: total, total, matched, searchId });
}

/* ===========================
   Router
   =========================== */
onmessage = async (e) => {
  const { type, payload } = e.data || {};
  try {
    if (type === 'INGEST_FILE') {
      const { name, text } = payload || {};
      const msgs = parseFile(name, text);
      if (msgs.length) await addMessages(msgs);
      postMessage({ type:'status', msg:`Ingested ${msgs.length} messages from ${name}` });
      // NEW: refresh threads after each ingest so the sidebar updates
      await listThreads();
      return;
    }
    if (type === 'LIST_THREADS') { await listThreads(); return; }
    if (type === 'FETCH_THREAD') { await fetchThread(payload?.tid); return; }
    if (type === 'SEARCH_STREAM') { await searchStream(payload || {}); return; }
    if (type === 'CLEAR_DB') { await clearDb(); postMessage({ type:'status', msg:'DB cleared' }); await listThreads(); return; }
  } catch (err) {
    postMessage({ type:'error', msg:String(err) });
  }
};