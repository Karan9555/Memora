/* worker.js — parser + local DB + progress-aware streaming search */

let db;
const DB_NAME = 'neurosyn-archive';
const DB_VER = 3; // bump if schema changes

// ---------- DB init ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('threads')) {
        const s = d.createObjectStore('threads', { keyPath: 'id' });
        s.createIndex('byTitle', 'title', { unique: false });
        s.createIndex('byCreated', 'created_at', { unique: false });
      }
      if (!d.objectStoreNames.contains('messages')) {
        const s = d.createObjectStore('messages', { keyPath: 'id' });
        s.createIndex('byThread', 'thread_id', { unique: false });
        s.createIndex('byTs', 'timestamp', { unique: false });
      }
      if (!d.objectStoreNames.contains('feedback')) {
        const s = d.createObjectStore('feedback', { keyPath: 'id' });
        s.createIndex('byMessage', 'message_id', { unique: false });
      }
      if (!d.objectStoreNames.contains('users')) {
        d.createObjectStore('users', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

// ---------- small DB helpers ----------
function put(store, obj) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).put(obj);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function bulkPut(store, arr) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const o of arr) s.put(o);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function clearAll() {
  return new Promise((resolve, reject) => {
    const t = db.transaction(['threads','messages','feedback','users'], 'readwrite');
    t.objectStore('threads').clear();
    t.objectStore('messages').clear();
    t.objectStore('feedback').clear();
    t.objectStore('users').clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function listThreads() {
  return new Promise((resolve, reject) => {
    const t = db.transaction('threads', 'readonly');
    const req = t.objectStore('threads').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function getMessagesByThread(tid) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('messages', 'readonly');
    const idx = t.objectStore('messages').index('byThread');
    const req = idx.getAll(IDBKeyRange.only(tid));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function countMessages() {
  return new Promise((resolve, reject) => {
    const t = db.transaction('messages', 'readonly');
    const store = t.objectStore('messages');
    const req = store.count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

// ---------- parsing helpers ----------
function normalizeText(htmlOrMd='') {
  return htmlOrMd.replace(/<br\s*\/?>/gi, '\n')
                 .replace(/<[^>]*>/g, '')
                 .replace(/\s+\n/g, '\n')
                 .trim();
}

function extractParts(m) {
  const content = m?.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content?.parts)) {
    return content.parts.map(p => typeof p === 'string' ? p : (p?.text ?? '')).join('\n').trim();
  }
  if (typeof content?.text === 'string') return content.text;
  return String(content || '');
}

function toISO(ts) {
  if (!ts) return '';
  if (typeof ts === 'number') {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString();
  }
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

// ---------- ingestion ----------
async function parseAndIngest(name, text) {
  const lower = name.toLowerCase();

  if (lower === 'user.json') {
    try {
      const j = JSON.parse(text);
      await put('users', { id: 'me', ...j });
      postMessage({ type:'status', msg:'user.json loaded' });
    } catch (e) {
      postMessage({ type:'error', msg:`user.json parse error ${e}` });
    }
    return;
  }

  if (lower === 'message_feedback.json') {
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : (j?.message_feedback || []);
      const rows = arr.map((r, i) => ({
        id: r.id || `fb_${i}`,
        message_id: r.message_id || r.messageId || '',
        rating: r.rating || r.label || '',
        comment: r.comment || '',
        timestamp: toISO(r.created_at || r.timestamp || '')
      }));
      await bulkPut('feedback', rows);
      postMessage({ type:'status', msg:`message_feedback.json: ${rows.length} items` });
    } catch (e) {
      postMessage({ type:'error', msg:`message_feedback.json parse error ${e}` });
    }
    return;
  }

  if (lower === 'chat.html') {
    const cleaned = normalizeText(text);
    const tid = `html_${Date.now()}`;
    await put('threads', { id: tid, title: 'chat.html transcript', created_at: new Date().toISOString() });
    await put('messages', { id: `${tid}_0`, thread_id: tid, role: 'system', text: cleaned, timestamp: '' });
    postMessage({ type:'status', msg:'chat.html ingested as single thread' });
    const threads = await listThreads();
    postMessage({ type:'THREADS', threads });
    return;
  }

  if (lower === 'conversations.json') {
    let root;
    try { root = JSON.parse(text); }
    catch {
      // JSONL fallback
      const lines = text.split(/\r?\n/).filter(Boolean);
      root = lines.map(l => JSON.parse(l));
    }

    // normalize to array of conversations
    let conversations = [];
    if (Array.isArray(root)) conversations = root;
    else {
      const candidates = [
        root?.conversations, root?.items, root?.threads, root?.data,
        root?.conversation_data, root?.archived_conversations, root?.shared_conversations
      ].filter(Boolean);
      conversations = Array.isArray(candidates[0]) ? candidates[0] : [];
    }

    if (!Array.isArray(conversations) || conversations.length === 0) {
      postMessage({ type:'error', msg:'conversations.json: no conversations found (unknown format)' });
      return;
    }

    let tcount = 0, mcount = 0;

    for (const c of conversations) {
      const tid = c.id || c.conversation_id || crypto.randomUUID();
      const title = c.title || c.summary || c.name || `Thread ${tid.slice(-6)}`;
      const created = c.create_time || c.created_at || c.createTime || c.started_at || '';
      await put('threads', { id: tid, title, created_at: toISO(created) });

      const messages = c.messages || c.mapping || c.logs || c.msgs || c.entries || [];
      let flat = [];

      if (Array.isArray(messages)) {
        flat = messages.map((m, i) => {
          const role = m.author?.role || m.role || 'assistant';
          const text = extractParts(m) || m.text || '';
          const ts = toISO(m.create_time || m.created_at || m.timestamp || m.time);
          const mid = m.id || `${i}`;
          return { id: `${tid}_${mid}`, thread_id: tid, role, text, timestamp: ts };
        });
      } else if (messages && typeof messages === 'object') {
        // mapping shape: { [id]: { message: {...}, parent, children } }
        for (const k of Object.keys(messages)) {
          const node = messages[k];
          const msg = node?.message || node;
          if (!msg) continue;
          const role = msg.author?.role || msg.role || 'assistant';
          const parts = extractParts(msg) || msg.text || '';
          const ts = toISO(msg.create_time || msg.created_at || msg.timestamp);
          flat.push({ id: `${tid}_${k}`, thread_id: tid, role, text: parts, timestamp: ts });
        }
      }

      flat = flat
        .filter(x => x.text && x.text.trim())
        .map(x => ({ ...x, text: x.text.trim().slice(0, 20000) }));

      if (flat.length) {
        for (let i = 0; i < flat.length; i += 300) {
          await bulkPut('messages', flat.slice(i, i + 300));
        }
        mcount += flat.length;
      }
      tcount += 1;
      postMessage({ type:'status', msg:`Ingested thread: ${title} (${flat.length} msgs)` });
    }

    postMessage({ type:'status', msg:`Done. Threads: ${tcount}, Messages: ${mcount}` });
    const threads = await listThreads();
    postMessage({ type:'THREADS', threads });
    return;
  }

  postMessage({ type:'status', msg:`Skipped file: ${name}` });
}

// ---------- basic keyword search (fallback) ----------
function keywordSearchAll(q, limit = 300) {
  q = q.toLowerCase();
  return new Promise((resolve, reject) => {
    const t = db.transaction('messages', 'readonly');
    const store = t.objectStore('messages');
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      const hits = [];
      for (const m of all) {
        const txt = (m.text || '').toLowerCase();
        if (txt.includes(q)) hits.push(m);
        if (hits.length >= limit) break;
      }
      resolve(hits);
    };
    req.onerror = () => reject(req.error);
  });
}

// ---------- streaming search with progress ----------
let activeSearchId = 0;

async function streamSearchWithProgress(payload) {
  const { query, batch = 100, maxMatches = 2000, forRecall = false, searchId } = payload;
  const q = (query || '').toLowerCase();
  activeSearchId = searchId;

  // Announce total (for determinate progress)
  let total = 0;
  try { total = await countMessages(); } catch {}
  postMessage({ type:'SEARCH_META', total, query, forRecall, searchId });

  return new Promise((resolve, reject) => {
    const t = db.transaction('messages', 'readonly');
    const store = t.objectStore('messages');
    const req = store.openCursor();

    let scanned = 0, matched = 0;
    let out = [];
    let tick = 0;

    const emitProgress = () => {
      postMessage({ type:'SEARCH_PROGRESS', query, scanned, matched, total, searchId });
    };

    req.onsuccess = (e) => {
      if (activeSearchId !== searchId) { resolve(); return; } // canceled by new search
      const cursor = e.target.result;
      if (cursor) {
        scanned++;
        const val = cursor.value;
        const txt = (val.text || '').toLowerCase();
        if (txt.includes(q)) {
          out.push(val);
          matched++;
          if (out.length >= batch) {
            postMessage({ type:'SEARCH_BATCH', query, batch: out, done: false, forRecall, searchId });
            out = [];
          }
          if (matched >= maxMatches) {
            if (out.length) postMessage({ type:'SEARCH_BATCH', query, batch: out, done: false, forRecall, searchId });
            postMessage({ type:'SEARCH_BATCH', query, batch: [], done: true, forRecall, searchId });
            emitProgress();
            resolve();
            return;
          }
        }
        if (++tick % 200 === 0) emitProgress(); // throttle UI noise
        cursor.continue();
      } else {
        if (out.length) postMessage({ type:'SEARCH_BATCH', query, batch: out, done: false, forRecall, searchId });
        postMessage({ type:'SEARCH_BATCH', query, batch: [], done: true, forRecall, searchId });
        emitProgress();
        resolve();
      }
    };

    req.onerror = () => reject(req.error);
  });
}

// ---------- message router ----------
self.onmessage = async (e) => {
  const { type, payload } = e.data;
  if (!db) await openDb();

  try {
    if (type === 'CLEAR_DB') {
      await clearAll();
      postMessage({ type:'status', msg:'IndexedDB cleared.' });
      postMessage({ type:'THREADS', threads: [] });
      return;
    }

    if (type === 'INGEST_FILE') {
      await parseAndIngest(payload.name, payload.text);
      return; // parseAndIngest will post THREADS if relevant
    }

    if (type === 'LIST_THREADS') {
      const threads = await listThreads();
      postMessage({ type:'THREADS', threads });
      return;
    }

    if (type === 'FETCH_THREAD') {
      const msgs = await getMessagesByThread(payload.tid);
      postMessage({ type:'THREAD_MSGS', tid: payload.tid, messages: msgs });
      return;
    }

    if (type === 'SEARCH') {
      const hits = await keywordSearchAll(payload.query, payload.limit || 300);
      postMessage({ type:'SEARCH_RESULTS', query: payload.query, results: hits });
      return;
    }

    if (type === 'SEARCH_STREAM') {
      await streamSearchWithProgress(payload);
      return;
    }
  } catch (err) {
    postMessage({ type:'error', msg: String(err) });
  }
};