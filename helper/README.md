# Link helper

`link-helper.js` is the small service behind pasting a short Maps link into the app's search. A phone's Share button gives a short link (`maps.apple/p/…`, `maps.app.goo.gl/…`, `goo.gl/maps/…`) that hides the place behind a redirect, and a web page is not allowed to follow that redirect itself. The helper follows it and answers with the full link it leads to, plus the coordinates when that link has none: `GET /?u=<short link>` answers `200 { url, lat?, lon? }` or `4xx { error }`.

It is not part of the site: `index.html` and `tools/build.js` do not load it. It runs as the Cloudflare Worker `sbs-link` (`https://sbs-link.deepak-d-or1.workers.dev/`, the `HELPER` constant in `js/link.js`). To update it, paste the whole of `link-helper.js` into that Worker's code editor in the Cloudflare dashboard and deploy. Request logs are switched off for the Worker there, and the code keeps and logs nothing itself.

It refuses:

- any caller other than the live site (`https://deepak-or1.github.io`) and local previews on `localhost` or `127.0.0.1` (403)
- any method but `GET` (405; `OPTIONS` gets the CORS answer)
- a missing link, or one longer than 300 characters (400)
- anything that is not an `https` short Maps link, or one with a port or a user name or password in it (400)
- a redirect that leads anywhere but Apple or Google Maps (or to one of their addresses with a port or user info), or more than five hops (422)
- to return a page's content: only the final link, and coordinates read from a Google page when the link lacks them
