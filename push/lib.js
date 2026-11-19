// The push relay's pure helpers (push/worker.js imports them; push/test.js tests them): RFC 8291 encryption (aes128gcm),
// base64url, the request check, the push-service allowlist and RFC 8292 VAPID signing (ES256). WebCrypto only, no
// dependencies, no network. Nothing here is exported by the Worker itself: its default export is { fetch } alone.
const SUBJECT = 'https://deepak-or1.github.io/7x7/';
const HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'], SUFFIXES = ['.push.apple.com', '.notify.windows.com']; // js/push.js keeps the same list
const MAX_SUBS = 10, MAX_EP = 1024;
const LIM = { title: 80, body: 240, tag: 64, hash: 200 };
const RS = 4096, EXP = 12 * 3600; // RS: the aes128gcm record size; EXP: VAPID token lifetime (push services cap it at 24 h)
export const te = new TextEncoder();
const EC = { name: 'ECDH', namedCurve: 'P-256' };

export const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
export const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
export const b64u = {
  enc: b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => { // null unless s is base64url (optional = padding)
    if (typeof s !== 'string') return null;
    const t = s.replace(/=+$/, '');
    if (!/^[A-Za-z0-9_-]*$/.test(t) || t.length % 4 === 1) return null;
    try { const bin = atob(t.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(bin, c => c.charCodeAt(0)); } catch (e) { return null; }
  },
};
const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8));

// RFC 8291: one aes128gcm record for the subscription's keys. opts.salt (16 bytes) and opts.local ({ privateKey: an ECDH
// CryptoKey, publicRaw: its 65-byte point }) exist so the test can replay the RFC's example; production leaves both fresh.
export async function encrypt(plain, keys, opts = {}) {
  const ua = keys.p256dh, auth = keys.auth;
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  let local = opts.local;
  if (!local) { const kp = await crypto.subtle.generateKey(EC, true, ['deriveBits']); local = { privateKey: kp.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)) }; }
  const uaKey = await crypto.subtle.importKey('raw', ua, EC, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, concat(te.encode('WebPush: info\0'), ua, local.publicRaw), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plain, new Uint8Array([2])))); // 0x02: the last (only) record, no padding
  const head = new Uint8Array(21); head.set(salt); new DataView(head.buffer).setUint32(16, RS); head[20] = local.publicRaw.length;
  return concat(head, local.publicRaw, sealed);
}

// RFC 8292: the VAPID signing key, built once per isolate from the two env strings
let signer = null;
export async function vapidKey(env) {
  const priv = String(env.VAPID_PRIVATE || '').trim(), pub = String(env.VAPID_PUBLIC || '').trim(), id = priv + ' ' + pub;
  if (signer && signer.id === id) return signer;
  const d = b64u.dec(priv), p = b64u.dec(pub);
  if (!d || d.length !== 32 || !p || p.length !== 65 || p[0] !== 4) return null;
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: b64u.enc(d), x: b64u.enc(p.subarray(1, 33)), y: b64u.enc(p.subarray(33)), ext: false }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return (signer = { id, key, pub: b64u.enc(p) });
  } catch (e) { return null; }
}
export async function vapidHeader(v, env, aud, now = Date.now()) {
  const subj = String(env.VAPID_SUBJECT || '').trim(), sub = /^(mailto:|https:)/.test(subj) ? subj : SUBJECT;
  const part = o => b64u.enc(te.encode(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud, exp: Math.floor(now / 1000) + EXP, sub });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, te.encode(unsigned)); // raw r||s, which is what ES256 wants
  return `vapid t=${unsigned}.${b64u.enc(sig)}, k=${v.pub}`;
}

// the endpoint is a URL the Worker will POST to, so only known push services (and test hosts) are allowed
export function pushURL(endpoint, env) {
  let u; try { u = new URL(endpoint); } catch (e) { return null; }
  if (u.username || u.password) return null;
  if (list(env.ALLOW_PUSH_HOSTS).includes(u.host)) return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  if (u.protocol !== 'https:' || u.port) return null;
  const h = u.hostname.toLowerCase();
  return HOSTS.includes(h) || SUFFIXES.some(s => h.endsWith(s) && h.length > s.length) ? u : null;
}

// the request, checked; a string is the reason it was refused
export function check(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'body must be an object';
  const { subs, msg } = d;
  if (!Array.isArray(subs) || !subs.length) return 'subs must be a non-empty array';
  if (subs.length > MAX_SUBS) return 'too many subscriptions';
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return 'msg must be an object';
  const out = { title: msg.title, body: msg.body === undefined ? '' : msg.body };
  if (typeof out.title !== 'string' || !out.title || out.title.length > LIM.title) return 'bad title';
  if (typeof out.body !== 'string' || out.body.length > LIM.body) return 'bad body';
  if (msg.tag !== undefined) { if (typeof msg.tag !== 'string' || msg.tag.length > LIM.tag) return 'bad tag'; out.tag = msg.tag; }
  if (msg.hash !== undefined) { if (typeof msg.hash !== 'string' || msg.hash.length > LIM.hash || msg.hash[0] !== '#') return 'bad hash'; out.hash = msg.hash; }
  const clean = [];
  for (const s of subs) {
    if (!s || typeof s !== 'object' || typeof s.endpoint !== 'string' || !s.endpoint || s.endpoint.length > MAX_EP || !s.keys || typeof s.keys !== 'object') return 'bad subscription';
    const p256dh = b64u.dec(s.keys.p256dh), auth = b64u.dec(s.keys.auth);
    if (!p256dh || p256dh.length !== 65 || p256dh[0] !== 4 || !auth || auth.length !== 16) return 'bad subscription keys';
    clean.push({ endpoint: s.endpoint, keys: { p256dh, auth } });
  }
  return { subs: clean, msg: out };
}
