#!/usr/bin/env node
// Tests for the push relay (push/worker.js) and the key tool (tools/vapid.js): node push/test.js (Node 24, no
// dependencies). The Worker's fetch export is called directly; a node:http server on 127.0.0.1 stands in for a push
// service, and what it receives is decrypted here by a separate receiver written on node:crypto (ECDH, HMAC-based HKDF,
// AES-GCM open, padding check), not on the Worker's WebCrypto code. Nothing leaves the machine.
'use strict';
const http = require('http'), crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const assert = require('assert/strict');

const ROOT = path.resolve(__dirname, '..'), SITE = 'https://deepak-or1.github.io', DEV = 'http://localhost:8123';
const b64 = s => Buffer.from(s, 'base64url');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n     ')); }
}

// ---------- the receiver: RFC 8291 decryption on node:crypto ----------
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
function receive(body, uaPriv, uaPub, auth) {
  body = Buffer.from(body);
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  assert.equal(idlen, 65, 'keyid is the 65-byte sender key'); assert.ok(ct.length <= rs, 'one record');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(uaPriv);
  const secret = ecdh.computeSecret(asPub);
  const ikm = hmac(hmac(auth, secret), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const pt = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  let i = pt.length - 1; while (i >= 0 && pt[i] === 0) i--;
  assert.equal(pt[i], 2, 'last-record delimiter 0x02');
  return pt.subarray(0, i);
}
function newSub(endpoint) { // a browser's side of a subscription
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16), pub = ecdh.getPublicKey();
  return { priv: ecdh.getPrivateKey(), pub, auth, json: { endpoint, keys: { p256dh: pub.toString('base64url'), auth: auth.toString('base64url') } } };
}
function checkJwt(header, publicKey, aud) {
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header || '');
  assert.ok(m, 'Authorization is "vapid t=<jwt>, k=<key>": ' + header);
  assert.equal(m[4], publicKey, 'k is the VAPID public key');
  assert.deepEqual(JSON.parse(b64(m[1])), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(b64(m[2])), now = Date.now() / 1000;
  assert.equal(claims.aud, aud, 'aud is the endpoint origin');
  assert.ok(claims.exp > now + 11 * 3600 && claims.exp <= now + 24 * 3600, 'exp about 12 h ahead: ' + (claims.exp - now));
  assert.equal(claims.sub, 'https://deepak-or1.github.io/7x7/', 'sub defaults to the site');
  const p = b64(publicKey), key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: p.subarray(1, 33).toString('base64url'), y: p.subarray(33).toString('base64url') } });
  assert.ok(crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key, dsaEncoding: 'ieee-p1363' }, b64(m[3])), 'ES256 signature verifies with the public key');
}

(async () => {
  const worker = (await import(pathToFileURL(path.join(__dirname, 'worker.js')).href)).default;
  const { encrypt } = worker.internals;

  // ---------- RFC 8291 Appendix A ----------
  const RFC = {
    plain: 'When I grow up, I want to be a watermelon',
    asPriv: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    asPub: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    uaPriv: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    uaPub: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    ecdh: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
    body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  };
  await test('RFC 8291 A: the example keys are consistent (public from private, shared secret)', () => {
    for (const [pr, pu] of [[RFC.asPriv, RFC.asPub], [RFC.uaPriv, RFC.uaPub]]) { const e = crypto.createECDH('prime256v1'); e.setPrivateKey(b64(pr)); assert.equal(e.getPublicKey().toString('base64url'), pu); }
    const e = crypto.createECDH('prime256v1'); e.setPrivateKey(b64(RFC.uaPriv));
    assert.equal(e.computeSecret(b64(RFC.asPub)).toString('base64url'), RFC.ecdh);
  });
  await test('RFC 8291 A: the Worker\'s encryption gives exactly the RFC\'s body', async () => {
    const p = b64(RFC.asPub);
    const privateKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: RFC.asPriv, x: p.subarray(1, 33).toString('base64url'), y: p.subarray(33).toString('base64url') }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const out = await encrypt(new TextEncoder().encode(RFC.plain), { p256dh: new Uint8Array(b64(RFC.uaPub)), auth: new Uint8Array(b64(RFC.auth)) }, { salt: new Uint8Array(b64(RFC.salt)), local: { privateKey, publicRaw: new Uint8Array(p) } });
    assert.equal(Buffer.from(out).toString('base64url'), RFC.body);
  });
  await test('RFC 8291 A: the test\'s receiver decrypts the RFC\'s body', () => {
    assert.equal(receive(b64(RFC.body), b64(RFC.uaPriv), b64(RFC.uaPub), b64(RFC.auth)).toString(), RFC.plain);
  });

  // ---------- tools/vapid.js ----------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbs-push-test-')), keyFile = path.join(tmp, 'vapid-private.txt');
  let vapid = null;
  const runVapid = file => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'vapid.js'), file], { encoding: 'utf8' });
  await test('vapid.js writes a 32-byte private key (mode 0600) and prints only the 65-byte public key', () => {
    const r = runVapid(keyFile);
    assert.equal(r.status, 0, r.stderr);
    const pub = r.stdout.trim(), priv = fs.readFileSync(keyFile, 'utf8');
    assert.equal(b64(pub).length, 65); assert.equal(b64(pub)[0], 4); assert.match(pub, /^[\w-]+$/);
    assert.equal(b64(priv).length, 32);
    assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
    assert.ok(!r.stdout.includes(priv) && !r.stderr.includes(priv), 'private key never printed');
    const e = crypto.createECDH('prime256v1'); e.setPrivateKey(b64(priv));
    assert.equal(e.getPublicKey().toString('base64url'), pub, 'the pair matches');
    vapid = { VAPID_PUBLIC: pub, VAPID_PRIVATE: priv };
  });
  await test('vapid.js refuses to overwrite and to write inside the repo', () => {
    const before = fs.readFileSync(keyFile, 'utf8'), r = runVapid(keyFile);
    assert.notEqual(r.status, 0); assert.equal(fs.readFileSync(keyFile, 'utf8'), before); assert.equal(r.stdout, '');
    for (const f of [path.join(ROOT, 'vapid-private.txt'), path.join(ROOT, 'push', 'vapid-private.txt')]) {
      const q = runVapid(f);
      assert.notEqual(q.status, 0); assert.match(q.stderr, /inside the repo/); assert.ok(!fs.existsSync(f)); assert.equal(q.stdout, '');
    }
  });
  if (!vapid) { console.log(`\n${pass} passed, ${fail + 1} failed (no keys, stopping)`); process.exit(1); }

  // ---------- the mock push service ----------
  const got = [];
  const srv = http.createServer((req, res) => {
    const parts = [];
    req.on('data', c => parts.push(c)).on('end', () => {
      got.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(parts) });
      const status = req.url.startsWith('/gone') ? 410 : req.url.startsWith('/moved') ? 301 : 201;
      res.writeHead(status, status === 301 ? { Location: 'http://127.0.0.1:1/elsewhere' } : {}); res.end('x');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const host = '127.0.0.1:' + srv.address().port, mock = 'http://' + host;
  const dead = await new Promise(r => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r('127.0.0.1:' + p)); }); });
  const env = Object.assign({ ALLOW_ORIGINS: DEV, ALLOW_PUSH_HOSTS: host + ',' + dead }, vapid);

  let calls = 0; const realFetch = globalThis.fetch;
  globalThis.fetch = (...a) => { calls++; return realFetch(...a); };
  const call = (body, o = {}) => worker.fetch(new Request('https://sbs-push.example.workers.dev' + (o.path || '/notify'), {
    method: o.method || 'POST', headers: Object.assign(o.origin === null ? {} : { Origin: o.origin || SITE }, o.headers || {}), body: o.method && o.method !== 'POST' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }), o.env || env);
  const msg = { title: 'Ana logged Tartine', body: 'Mission · a bakery', tag: 'spot-added', hash: '#spot/tartine' };

  await test('round trip: the mock receives a payload the receiver decrypts to the message, with a valid VAPID token', async () => {
    const s = newSub(mock + '/ok/1'); got.length = 0;
    const r = await call({ subs: [s.json], msg: Object.assign({ extra: 'dropped' }, msg) });
    assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), SITE);
    assert.deepEqual(await r.json(), { results: [{ status: 201 }] });
    assert.equal(got.length, 1); const g = got[0];
    assert.equal(g.method, 'POST'); assert.equal(g.path, '/ok/1');
    assert.equal(g.headers['content-encoding'], 'aes128gcm'); assert.equal(g.headers.ttl, '86400'); assert.equal(g.headers.urgency, 'normal'); assert.equal(g.headers.topic, 'spot-added');
    assert.deepEqual(JSON.parse(receive(g.body, s.priv, s.pub, s.auth)), msg);
    checkJwt(g.headers.authorization, vapid.VAPID_PUBLIC, mock);
  });
  await test('a tag that is not a valid Topic sends no Topic header; a fresh salt and sender key per message', async () => {
    const s = newSub(mock + '/ok/2'); got.length = 0;
    await call({ subs: [s.json, s.json], msg: { title: 'Hi', tag: 'not a topic!' } });
    assert.equal(got.length, 2); assert.equal(got[0].headers.topic, undefined);
    assert.notDeepEqual(got[0].body.subarray(0, 86), got[1].body.subarray(0, 86));
    for (const g of got) assert.deepEqual(JSON.parse(receive(g.body, s.priv, s.pub, s.auth)), { title: 'Hi', body: '', tag: 'not a topic!' });
  });
  await test('a 410 from the push service comes back as status 410; a redirect is not followed', async () => {
    got.length = 0;
    const r = await call({ subs: [newSub(mock + '/gone').json, newSub(mock + '/moved').json], msg });
    assert.deepEqual(await r.json(), { results: [{ status: 410 }, { status: 301 }] });
    assert.equal(got.length, 2);
  });
  await test('one unreachable subscription among two still delivers the other', async () => {
    const s = newSub(mock + '/ok/3'); got.length = 0;
    const r = await call({ subs: [newSub('http://' + dead + '/x').json, s.json], msg });
    assert.deepEqual(await r.json(), { results: [{ status: 0 }, { status: 201 }] });
    assert.equal(got.length, 1); assert.deepEqual(JSON.parse(receive(got[0].body, s.priv, s.pub, s.auth)), msg);
  });
  await test('endpoints that are not known push services get -1 and no request', async () => {
    const eps = ['https://evil.example.com/x', 'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'https://push.apple.com.evil.net/x', 'https://notify.windows.com/x', 'not a url', 'https://' + host + '.evil.net/x', 'ftp://' + host + '/x'];
    calls = 0; got.length = 0;
    const r = await call({ subs: eps.map(e => newSub(e).json), msg });
    assert.deepEqual(await r.json(), { results: eps.map(() => ({ status: -1 })) });
    assert.equal(calls, 0); assert.equal(got.length, 0);
    const { pushURL } = worker.internals;
    for (const e of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/QGx', 'https://wns2-by3p.notify.windows.com/w/?token=abc']) assert.ok(pushURL(e, {}), 'accepted: ' + e);
  });

  // ---------- refusals: each answers the stated status and sends nothing ----------
  const good = () => ({ subs: [newSub(mock + '/ok/r').json], msg: Object.assign({}, msg) });
  const edit = fn => { const b = good(); fn(b); return b; };
  const big = edit(b => { b.msg.body = 'x'.repeat(8300); });
  const cases = [
    ['no Origin', good(), { origin: null }, 403],
    ['an Origin not on the list', good(), { origin: 'https://evil.example' }, 403],
    ['a look-alike Origin', good(), { origin: 'https://deepak-or1.github.io.evil.net' }, 403],
    ['GET /notify', null, { method: 'GET' }, 405],
    ['PUT /notify', null, { method: 'PUT' }, 405],
    ['body over 8 KB', big, {}, 413],
    ['body over 8 KB (by Content-Length)', big, { headers: { 'Content-Length': '9000' } }, 413],
    ['not JSON', '{nope', {}, 400],
    ['a JSON array', [], {}, 400],
    ['subs missing', edit(b => { delete b.subs; }), {}, 400],
    ['subs empty', edit(b => { b.subs = []; }), {}, 400],
    ['11 subs', edit(b => { b.subs = Array.from({ length: 11 }, () => newSub(mock + '/ok/r').json); }), {}, 400],
    ['msg missing', edit(b => { delete b.msg; }), {}, 400],
    ['title missing', edit(b => { delete b.msg.title; }), {}, 400],
    ['title a number', edit(b => { b.msg.title = 7; }), {}, 400],
    ['title 81 chars', edit(b => { b.msg.title = 't'.repeat(81); }), {}, 400],
    ['body 241 chars', edit(b => { b.msg.body = 'b'.repeat(241); }), {}, 400],
    ['body an object', edit(b => { b.msg.body = {}; }), {}, 400],
    ['tag 65 chars', edit(b => { b.msg.tag = 'g'.repeat(65); }), {}, 400],
    ['hash 201 chars', edit(b => { b.msg.hash = '#' + 'h'.repeat(200); }), {}, 400],
    ['hash without #', edit(b => { b.msg.hash = 'spot/x'; }), {}, 400],
    ['hash a URL', edit(b => { b.msg.hash = 'https://evil.example/#x'; }), {}, 400],
    ['endpoint not a string', edit(b => { b.subs[0].endpoint = 5; }), {}, 400],
    ['endpoint over 1024 chars', edit(b => { b.subs[0].endpoint = mock + '/' + 'e'.repeat(1030); }), {}, 400],
    ['keys missing', edit(b => { delete b.subs[0].keys; }), {}, 400],
    ['p256dh 64 bytes', edit(b => { b.subs[0].keys.p256dh = b64(b.subs[0].keys.p256dh).subarray(1).toString('base64url'); }), {}, 400],
    ['p256dh not starting 0x04', edit(b => { const k = b64(b.subs[0].keys.p256dh); k[0] = 5; b.subs[0].keys.p256dh = k.toString('base64url'); }), {}, 400],
    ['p256dh in standard base64', edit(b => { b.subs[0].keys.p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 0xfb)]).toString('base64'); }), {}, 400],
    ['auth 15 bytes', edit(b => { b.subs[0].keys.auth = crypto.randomBytes(15).toString('base64url'); }), {}, 400],
    ['auth not base64url', edit(b => { b.subs[0].keys.auth = '!!!!!!!!!!!!!!!!!!!!!!'; }), {}, 400],
  ];
  for (const [name, body, o, want] of cases) {
    await test(`refused with ${want}: ${name}`, async () => {
      calls = 0; got.length = 0;
      const r = await call(body, o);
      assert.equal(r.status, want);
      assert.equal(calls, 0, 'no outbound request'); assert.equal(got.length, 0);
      if (want === 403) assert.equal(r.headers.get('access-control-allow-origin'), null);
    });
  }
  await test('an off-curve p256dh gets -1 for that sub only', async () => {
    const bad = newSub(mock + '/ok/x').json; bad.keys.p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
    calls = 0; const r = await call({ subs: [bad, newSub(mock + '/ok/y').json], msg });
    assert.deepEqual(await r.json(), { results: [{ status: -1 }, { status: 201 }] }); assert.equal(calls, 1);
  });
  await test('OPTIONS preflight from an allowed origin (the dev list) is answered with CORS headers', async () => {
    calls = 0; const r = await call(null, { method: 'OPTIONS', origin: DEV });
    assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), DEV);
    assert.match(r.headers.get('access-control-allow-methods'), /POST/); assert.match(r.headers.get('access-control-allow-headers'), /Content-Type/i);
    assert.equal(calls, 0);
  });
  await test('OPTIONS from another origin gets 403', async () => {
    const r = await call(null, { method: 'OPTIONS', origin: 'https://evil.example' }); assert.equal(r.status, 403);
  });
  await test('without VAPID keys /notify answers 500 and sends nothing', async () => {
    calls = 0; const r = await call(good(), { env: { ALLOW_PUSH_HOSTS: host } });
    assert.equal(r.status, 500); assert.equal(calls, 0);
  });
  await test('GET / is a one-line health string with no secrets', async () => {
    const r = await call(null, { method: 'GET', path: '/', origin: null }), t = await r.text();
    assert.equal(r.status, 200); assert.equal(t, 'sbs-push ok\n'); assert.ok(!t.includes(vapid.VAPID_PRIVATE));
    const r2 = await call(null, { method: 'GET', path: '/', origin: null, env: {} });
    assert.match(await r2.text(), /^sbs-push running, VAPID keys missing/);
  });
  await test('an unknown path is 404', async () => { assert.equal((await call(null, { method: 'GET', path: '/x' })).status, 404); });

  globalThis.fetch = realFetch;
  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('fatal:', e); process.exit(1); });
