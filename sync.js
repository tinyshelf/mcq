// Cross-device progress sync: a passphrase-encrypted GitHub token plus one secret gist.
// Loaded as a plain script in the browser (window.MCQSync) and as a CommonJS module by the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MCQSync = factory();
})(this, () => {
  'use strict';

  // ---------- token encryption (sync.json is public, so only the passphrase protects it) ----------
  const ITER = 600000; // PBKDF2 rounds: makes each offline passphrase guess slow
  const subtle = () => globalThis.crypto.subtle;
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

  async function deriveKey(passphrase, salt, iterations) {
    const base = await subtle().importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // secret: { token, gist }. The gist id is sealed too: anyone holding it can read the gist and see its owner.
  async function encrypt(secret, passphrase) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ITER);
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(secret)));
    return { v: 2, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }

  async function decrypt(blob, passphrase) {
    const key = await deriveKey(passphrase, unb64(blob.salt), blob.iter);
    let plain;
    try {
      plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
    } catch {
      throw new Error('Wrong passphrase');
    }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ---------- merging progress from two devices ----------
  // Progress document: { v, resetAt, stats: {questionKey: {c, w, last, t}}, session, sessionT }
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

  function clean(d) {
    d = isObj(d) ? d : {};
    return {
      resetAt: num(d.resetAt),
      stats: isObj(d.stats) ? d.stats : {},
      session: isObj(d.session) ? d.session : null,
      sessionT: num(d.sessionT),
    };
  }

  // Newest answer wins per question; answers older than the latest reset are dropped.
  // The most recently touched quiz session wins, so finishing or discarding a quiz also syncs.
  function merge(a, b) {
    a = clean(a);
    b = clean(b);
    const resetAt = Math.max(a.resetAt, b.resetAt);
    const stats = {};
    for (const src of [a, b]) { // a first: it wins ties and keeps its key order
      for (const [k, s] of Object.entries(src.stats)) {
        if (!isObj(s) || num(s.t) < resetAt) continue;
        if (!stats[k] || num(s.t) > num(stats[k].t)) stats[k] = s;
      }
    }
    const newer = b.sessionT > a.sessionT ? b : a;
    return { v: 1, resetAt, stats, session: newer.session, sessionT: newer.sessionT };
  }

  // ---------- GitHub gist storage ----------
  const API = 'https://api.github.com';
  const FILE = 'mcq-progress.json';

  // Key-order independent JSON, to tell whether the merge changed anything.
  const canon = (x) => JSON.stringify(x, (k, v) => (isObj(v)
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]]))
    : v));

  function syncError(message, code) { const e = new Error(message); e.code = code; return e; }

  // Default fetch is wrapped: browsers throw "Illegal invocation" when fetch is called unbound.
  function client(token, fetchImpl = (...args) => fetch(...args)) {
    async function api(method, path, body) {
      const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
      if (body) headers['Content-Type'] = 'application/json';
      let res;
      try {
        // no-store: GitHub marks GETs cacheable for 60 s, which would hide the other device's latest push
        res = await fetchImpl(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
      } catch {
        throw syncError('Could not reach GitHub. Check the connection; progress is kept on this device meanwhile.', 'offline');
      }
      if (res.status === 401) throw syncError('GitHub rejected the token (deleted or expired?). Run setup again with a new token.', 'auth');
      if (res.status === 404) throw syncError('Progress gist not found, or the token lacks gist access. Run setup again.', 'missing');
      if (!res.ok) throw syncError('GitHub error ' + res.status + (res.status === 403 ? ': the token may lack gist access, or too many requests.' : '. Try again later.'), 'http');
      return res.json();
    }

    const fileBody = (doc) => ({ files: { [FILE]: { content: JSON.stringify(doc) } } });

    async function find() {
      const list = await api('GET', '/gists?per_page=100');
      const hit = list.find((g) => g.files && g.files[FILE]);
      return hit ? hit.id : null;
    }

    async function create(doc) {
      const g = await api('POST', '/gists', Object.assign({ description: 'MCQ quiz progress (synced by the quiz site)', public: false }, fileBody(doc)));
      return g.id;
    }

    async function read(id) {
      const f = ((await api('GET', '/gists/' + id)).files || {})[FILE];
      if (!f) return null;
      let text = f.content;
      if (f.truncated) text = await (await fetchImpl(f.raw_url, { cache: 'no-store' })).text(); // only above 1 MB
      try { return JSON.parse(text); } catch { return null; }
    }

    async function write(id, doc) { await api('PATCH', '/gists/' + id, fileBody(doc)); }

    // Download, merge with local progress, upload only if something changed.
    // getLocal runs after the download so answers given while it was in flight are included.
    async function sync(id, getLocal) {
      const remote = await read(id);
      const merged = merge(getLocal(), remote);
      if (canon(merged) !== canon(remote)) await write(id, merged);
      return merged;
    }

    return { find, create, read, sync };
  }

  return { encrypt, decrypt, merge, client };
});
