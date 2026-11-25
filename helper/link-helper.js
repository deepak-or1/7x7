// Seven by Seven link helper: a Cloudflare Worker. The app's search accepts a pasted Maps link; the short kind a phone's Share
// button gives (maps.apple/p/…, maps.app.goo.gl/…) hides the place behind a redirect a web page is not allowed to read. This
// follows that redirect and answers with the full link it leads to: { url, lat?, lon? }. Nothing else:
//   - it only ever requests Apple or Google Maps addresses (never an address of the caller's choosing), so it is not a general proxy
//   - it never returns a page's content, only the final link and, when the link lacks them, the coordinates found in the page
//   - it only answers the app's own site (and a local preview), keeps nothing and logs nothing
//   GET /?u=<short link>   →  200 { url, lat?, lon? }   |  4xx { error }
const SITES = ['https://deepak-or1.github.io'], LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const plain = u => u.port === '' && !u.username && !u.password; // no port, no user info
const isShort = u => plain(u) && (u.hostname === 'maps.app.goo.gl' || (u.hostname === 'goo.gl' && u.pathname.toLowerCase().startsWith('/maps')) || (u.hostname === 'maps.apple' && u.pathname.toLowerCase().startsWith('/p/')));
const isGoogle = u => u.hostname === 'maps.google.com' || (/^(www\.)?google\.com$/.test(u.hostname) && u.pathname.toLowerCase().startsWith('/maps'));
const isFull = u => plain(u) && (u.hostname === 'maps.apple.com' || isGoogle(u));
const hasPoint = u => /!3d-?\d{1,3}\.\d+!4d-?\d{1,3}\.\d+/.test(u.href) || /\/@-?\d{1,3}\.\d+,-?\d{1,3}\.\d+/.test(u.pathname) || /[?&](coordinate|ll|q|query|center)=-?\d{1,3}\.\d+(,|%2C)-?\d{1,3}\.\d+/i.test(u.search);
const okLL = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0);

async function resolve(raw) {
  let u; try { u = new URL(raw); } catch (e) { return [400, { error: 'not a link' }]; }
  if (u.protocol !== 'https:' || !isShort(u)) return [400, { error: 'not a short Maps link' }];
  for (let hop = 0; hop < 5; hop++) {
    if (u.hostname === 'consent.google.com' && u.searchParams.get('continue')) { try { u = new URL(u.searchParams.get('continue')); } catch (e) { break; } continue; } // the cookie notice: the link is in its `continue`
    if (u.protocol !== 'https:') break;
    if (isFull(u)) return [200, await finish(u)];
    if (!isShort(u)) break; // it led somewhere that is not Maps: stop, and say nothing of where
    const res = await fetch(u.href, { redirect: 'manual', headers: { 'User-Agent': UA } }), loc = res.headers.get('location');
    if (res.status < 300 || res.status > 399 || !loc) break;
    try { u = new URL(loc, u); } catch (e) { break; }
  }
  return [422, { error: 'the link did not lead to a place' }];
}
// a Google link that names the place but not where it is: the page itself has the point. Best effort, never followed elsewhere
async function finish(u) {
  const out = { url: u.href };
  if (hasPoint(u) || !isGoogle(u)) return out;
  try {
    const res = await fetch(u.href, { redirect: 'manual', headers: { 'User-Agent': UA } });
    if (res.status !== 200) return out;
    const html = (await res.text()).slice(0, 1500000);
    const m = /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(html) || /center=(-?\d{1,3}\.\d+)%2C(-?\d{1,3}\.\d+)/.exec(html) || /\/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(html);
    if (m && okLL(+m[1], +m[2])) { out.lat = +m[1]; out.lon = +m[2]; }
  } catch (e) {}
  return out;
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '', ok = SITES.includes(origin) || LOCAL.test(origin);
    const head = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (ok) head['Access-Control-Allow-Origin'] = origin;
    const say = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: head });
    if (!ok) return say(403, { error: 'not for this site' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...head, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return say(405, { error: 'GET only' });
    const raw = new URL(request.url).searchParams.get('u') || '';
    if (!raw || raw.length > 300) return say(400, { error: 'not a link' });
    try { const [status, body] = await resolve(raw); return say(status, body); } catch (e) { return say(502, { error: 'could not follow the link' }); }
  },
};
