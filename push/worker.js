// Seven by Seven push relay: a Cloudflare Worker that sends a Web Push to the other devices on a log. It never talks to
// the database and never sees a log key: the page reads the other devices' subscriptions itself and posts them here with
// a short message, and this encrypts the message for each one (RFC 8291, aes128gcm), signs a VAPID token (RFC 8292,
// ES256) and POSTs it to each push service. WebCrypto only, no dependencies; the pure helpers are in push/lib.js, so the
// default export holds only fetch (what the Workers runtime looks for). Deploy guide: push/README.md.
//
//   POST /notify  { subs: [{ endpoint, keys: { p256dh, auth } }], msg: { title, body, tag?, hash? } }
//              -> { results: [{ status }] } in the order of subs: the push service's HTTP status, 0 when it could not be
//                 reached, -1 when the subscription was refused here (an endpoint that is not a known push service)
//   GET /       -> a one-line health string
//
// env: VAPID_PRIVATE (secret: base64url raw 32-byte P-256 scalar), VAPID_PUBLIC (base64url 65-byte point), VAPID_SUBJECT
// (optional mailto: or https: contact), ALLOW_ORIGINS (optional comma list of extra page origins, local dev),
// ALLOW_PUSH_HOSTS (optional comma list of extra push hosts, exact host[:port], http allowed: tests only).
// Nothing about a message or an endpoint is ever logged.
import { list, concat, te, encrypt, vapidKey, vapidHeader, pushURL, check } from './lib.js';

const SITE = 'https://deepak-or1.github.io';
const MAX_BODY = 8192, MAX_PAYLOAD = 2048; // MAX_PAYLOAD: bytes of message JSON, well under the 4096 a push service must take once encrypted
const TTL = 86400, TIMEOUT = 10000;

async function send(s, payload, topic, v, env) {
  const u = pushURL(s.endpoint, env);
  if (!u) return -1;
  let body, auth;
  try { body = await encrypt(payload, s.keys); auth = await vapidHeader(v, env, u.origin); } catch (e) { return -1; } // a p256dh that is not a point on the curve
  const headers = { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', TTL: String(TTL), Urgency: 'normal', Authorization: auth };
  if (topic) headers.Topic = topic;
  try {
    const r = await fetch(u.href, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
    if (r.body) r.body.cancel().catch(() => {});
    return r.status;
  } catch (e) { return 0; }
}

async function readCapped(request) { // the body as text, or null past MAX_BODY bytes
  if (+request.headers.get('Content-Length') > MAX_BODY) return null;
  if (!request.body) return '';
  const reader = request.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > MAX_BODY) { reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  return new TextDecoder().decode(concat(...parts));
}

const reply = (status, data, h = {}) => new Response(JSON.stringify(data), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, h) });

export default {
  async fetch(request, env) {
    env = env || {};
    const url = new URL(request.url);
    if (url.pathname === '/') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed\n', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const ok = !!(await vapidKey(env));
      return new Response(ok ? 'sbs-push ok\n' : 'sbs-push running, VAPID keys missing or invalid\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname !== '/notify') return reply(404, { error: 'not found' });
    const origin = request.headers.get('Origin');
    if (!origin || ![SITE, ...list(env.ALLOW_ORIGINS)].includes(origin)) return reply(403, { error: 'origin not allowed' });
    const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: Object.assign({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }, cors) });
    if (request.method !== 'POST') return reply(405, { error: 'method not allowed' }, Object.assign({ Allow: 'POST, OPTIONS' }, cors));
    const text = await readCapped(request);
    if (text === null) return reply(413, { error: 'body too large' }, cors);
    let data; try { data = JSON.parse(text); } catch (e) { return reply(400, { error: 'body must be JSON' }, cors); }
    const req = check(data);
    if (typeof req === 'string') return reply(400, { error: req }, cors);
    const payload = te.encode(JSON.stringify(req.msg));
    if (payload.length > MAX_PAYLOAD) return reply(400, { error: 'message too large' }, cors);
    const v = await vapidKey(env);
    if (!v) return reply(500, { error: 'server keys not configured' }, cors);
    const topic = typeof req.msg.tag === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(req.msg.tag) ? req.msg.tag : ''; // RFC 8030: at most 32 base64url characters
    const results = await Promise.all(req.subs.map(s => send(s, payload, topic, v, env).catch(() => 0)));
    return reply(200, { results: results.map(status => ({ status })) }, cors);
  },
};
