// Run from quiz-site/:  node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../sync.js');

// ---------- merge ----------
test('merge keeps the newest answer for each question, from either side', () => {
  const local = { stats: {
    'Q1#a': { c: 1, w: 0, last: 'R', t: 200 },
    'Q2#b': { c: 0, w: 1, last: 'W', t: 100 },
  } };
  const remote = { stats: {
    'Q1#a': { c: 1, w: 1, last: 'W', t: 150 },
    'Q2#b': { c: 1, w: 1, last: 'R', t: 300 },
    'Q3#c': { c: 1, w: 0, last: 'R', t: 50 },
  } };
  assert.deepEqual(S.merge(local, remote).stats, {
    'Q1#a': { c: 1, w: 0, last: 'R', t: 200 },
    'Q2#b': { c: 1, w: 1, last: 'R', t: 300 },
    'Q3#c': { c: 1, w: 0, last: 'R', t: 50 },
  });
});

test('merge drops answers older than the latest reset on either side', () => {
  const local = { resetAt: 500, stats: { 'Q1#a': { c: 1, w: 0, last: 'R', t: 600 } } };
  const remote = { resetAt: 0, stats: {
    'Q1#a': { c: 3, w: 2, last: 'W', t: 400 },
    'Q2#b': { c: 0, w: 1, last: 'W', t: 450 },
    'Q3#c': { c: 0, w: 1, last: 'W', t: 700 },
  } };
  const m = S.merge(local, remote);
  assert.equal(m.resetAt, 500);
  assert.deepEqual(m.stats, {
    'Q1#a': { c: 1, w: 0, last: 'R', t: 600 },
    'Q3#c': { c: 0, w: 1, last: 'W', t: 700 },
  });
});

test('merge keeps progress saved before sync existed (no timestamp) until a reset', () => {
  const legacy = { stats: { 'Q1#a': { c: 2, w: 0, last: 'R' } } };
  assert.deepEqual(S.merge(legacy, null).stats, { 'Q1#a': { c: 2, w: 0, last: 'R' } });
  assert.deepEqual(S.merge(legacy, { resetAt: 10, stats: {} }).stats, {});
});

test('merge takes the most recently touched quiz session, including a finished/discarded one', () => {
  const open = { session: { keys: ['Q1#a'], answers: {}, pos: 0, label: 'Quiz' }, sessionT: 100 };
  const closedLater = { session: null, sessionT: 200 };
  const closedEarlier = { session: null, sessionT: 50 };

  const a = S.merge(open, closedLater);
  assert.equal(a.session, null);
  assert.equal(a.sessionT, 200);

  const b = S.merge(closedEarlier, open);
  assert.deepEqual(b.session, { keys: ['Q1#a'], answers: {}, pos: 0, label: 'Quiz' });
  assert.equal(b.sessionT, 100);
});

test('merge treats a malformed remote file as empty', () => {
  const local = { resetAt: 0, stats: { 'Q1#a': { c: 1, w: 0, last: 'R', t: 5 } }, session: null, sessionT: 0 };
  for (const junk of ['oops', 42, [], { stats: 'x', sessionT: 'y', resetAt: null }]) {
    assert.deepEqual(S.merge(local, junk), { v: 1, resetAt: 0, stats: { 'Q1#a': { c: 1, w: 0, last: 'R', t: 5 } }, session: null, sessionT: 0 });
  }
});

// ---------- token encryption ----------
// The secret is the token plus the gist id: a gist id alone lets anyone read the gist and see its owner.
const SECRET = { token: 'ghp_TOKENMARK123', gist: 'GISTMARK42' };

test('the token and gist id encrypted with a passphrase decrypt with the same passphrase', async () => {
  const blob = await S.encrypt(SECRET, 'correct horse battery');
  assert.deepEqual(await S.decrypt(blob, 'correct horse battery'), { token: 'ghp_TOKENMARK123', gist: 'GISTMARK42' });
});

test('decrypting with the wrong passphrase is rejected', async () => {
  const blob = await S.encrypt(SECRET, 'correct horse battery');
  await assert.rejects(S.decrypt(blob, 'correct horse batterY'), /wrong passphrase/i);
});

test('the encrypted blob is safe to publish: fresh salt and IV, no token or gist id, slow key derivation', async () => {
  const a = await S.encrypt(SECRET, 'correct horse battery');
  const b = await S.encrypt(SECRET, 'correct horse battery');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
  assert.ok(!JSON.stringify(a).includes('TOKENMARK'));
  assert.ok(!JSON.stringify(a).includes('GISTMARK'));
  assert.ok(a.iter >= 600000, 'PBKDF2 iterations too low for a public blob: ' + a.iter);
});

// ---------- gist client ----------
// In-memory stand-in for the GitHub gists API: same routes, status codes and response shapes we rely on.
function fakeGitHub(validToken) {
  const gists = {};
  const log = [];
  let n = 0;
  const API = 'https://api.github.com';
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const view = (g, withContent) => ({
    id: g.id, public: g.public, description: g.description,
    files: Object.fromEntries(Object.entries(g.files).map(([name, f]) => [name, Object.assign(
      { filename: name, type: 'application/json', language: 'JSON', raw_url: 'https://gist.githubusercontent.com/u/' + g.id + '/raw/' + name, size: f.content.length },
      withContent ? { truncated: false, content: f.content } : {})])),
  });
  async function fetch(url, opts = {}) {
    const method = opts.method || 'GET';
    const path = url.slice(API.length);
    log.push(method + ' ' + path);
    if ((opts.headers || {}).Authorization !== 'Bearer ' + validToken) return reply(401, { message: 'Bad credentials' });
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (method === 'GET' && /^\/gists(\?|$)/.test(path)) return reply(200, Object.values(gists).map((g) => view(g, false)));
    if (method === 'POST' && path === '/gists') {
      const id = 'gist' + ++n;
      gists[id] = { id, public: body.public, description: body.description, files: body.files };
      return reply(201, view(gists[id], true));
    }
    const m = path.match(/^\/gists\/(\w+)$/);
    if (!m || !gists[m[1]]) return reply(404, { message: 'Not Found' });
    if (method === 'GET') return reply(200, view(gists[m[1]], true));
    if (method === 'PATCH') { Object.assign(gists[m[1]].files, body.files); return reply(200, view(gists[m[1]], true)); }
    return reply(404, { message: 'Not Found' });
  }
  const content = (id) => JSON.parse(gists[id].files['mcq-progress.json'].content);
  return { fetch, gists, log, content };
}

test('create makes a secret gist that find locates and read returns', async () => {
  const gh = fakeGitHub('tok');
  const c = S.client('tok', gh.fetch);
  assert.equal(await c.find(), null);
  gh.gists.other = { id: 'other', public: true, description: 'notes', files: { 'notes.md': { content: 'hi' } } };

  const id = await c.create({ v: 1, resetAt: 0, stats: { 'Q1#a': { c: 1, w: 0, last: 'R', t: 9 } }, session: null, sessionT: 0 });
  assert.equal(gh.gists[id].public, false);
  assert.equal(await c.find(), id);
  assert.deepEqual((await c.read(id)).stats, { 'Q1#a': { c: 1, w: 0, last: 'R', t: 9 } });
});

test('sync merges both sides and stores the result in the gist', async () => {
  const gh = fakeGitHub('tok');
  const c = S.client('tok', gh.fetch);
  const id = await c.create({ v: 1, resetAt: 0, stats: { 'Q2#b': { c: 0, w: 1, last: 'W', t: 20 } }, session: null, sessionT: 0 });
  const local = { v: 1, resetAt: 0, stats: { 'Q1#a': { c: 1, w: 0, last: 'R', t: 30 } }, session: null, sessionT: 0 };

  const merged = await c.sync(id, () => local);
  const want = { 'Q1#a': { c: 1, w: 0, last: 'R', t: 30 }, 'Q2#b': { c: 0, w: 1, last: 'W', t: 20 } };
  assert.deepEqual(merged.stats, want);
  assert.deepEqual(gh.content(id).stats, want);
});

test('sync reads local progress after the download, so answers given meanwhile are kept', async () => {
  const gh = fakeGitHub('tok');
  const c = S.client('tok', gh.fetch);
  const id = await c.create({ v: 1, resetAt: 0, stats: {}, session: null, sessionT: 0 });
  let local = { stats: {} };
  const slow = async (url, opts) => { const r = await gh.fetch(url, opts); local = { stats: { 'Q1#a': { c: 1, w: 0, last: 'R', t: 40 } } }; return r; };

  const merged = await S.client('tok', slow).sync(id, () => local);
  assert.deepEqual(merged.stats, { 'Q1#a': { c: 1, w: 0, last: 'R', t: 40 } });
});

test('sync does not rewrite the gist when nothing changed', async () => {
  const gh = fakeGitHub('tok');
  const c = S.client('tok', gh.fetch);
  const doc = { v: 1, resetAt: 0, stats: { 'Q1#a': { c: 1, w: 0, last: 'R', t: 30 } }, session: null, sessionT: 0 };
  const id = await c.create(doc);
  gh.log.length = 0;

  await c.sync(id, () => ({ sessionT: 0, session: null, stats: { 'Q1#a': { t: 30, last: 'R', w: 0, c: 1 } }, resetAt: 0, v: 1 }));
  assert.deepEqual(gh.log, ['GET /gists/' + id]);
});

test('API failures carry a code the page can act on', async () => {
  const gh = fakeGitHub('tok');
  const id = await S.client('tok', gh.fetch).create({ v: 1, resetAt: 0, stats: {}, session: null, sessionT: 0 });

  await assert.rejects(S.client('revoked', gh.fetch).sync(id, () => ({})), { code: 'auth' });
  await assert.rejects(S.client('tok', gh.fetch).sync('deleted', () => ({})), { code: 'missing' });
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(S.client('tok', offline).sync(id, () => ({})), { code: 'offline' });
});
