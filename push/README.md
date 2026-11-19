# sbs-push: the notification sender

When one person adds something to the logbook, the other person's phone gets a notification. The site is static and cannot send one itself, so this small Cloudflare Worker does it. It never sees the log or its key: the page sends it the other phones' addresses and a short message, and it passes the message on, encrypted. The free Cloudflare plan is plenty.

## Deploy, once

You need Node 20 or newer. Run every command from the repo root unless it says otherwise.

1. Create a free account at https://dash.cloudflare.com/sign-up and confirm the email. No card or domain is needed.
2. Make the key pair. The private key goes to a file outside the repo (the tool refuses a path inside it); the public key is printed:
   ```
   node tools/vapid.js ~/sbs-vapid-private.txt
   ```
   Copy the printed line (about 87 characters). That is the public key.
3. Go into this folder and sign in (a browser tab opens; allow access):
   ```
   cd push
   npx wrangler login
   ```
4. Store the private key as a secret on Cloudflare, read from the file so it never shows on screen:
   ```
   npx wrangler secret put VAPID_PRIVATE < ~/sbs-vapid-private.txt
   ```
   If it asks to create the Worker `sbs-push` first, say yes.
5. Put the public key in `wrangler.toml`, between the quotes of `VAPID_PUBLIC = ""`.
6. Deploy:
   ```
   npx wrangler deploy
   ```
   It prints the Worker's address, like `https://sbs-push.<your-name>.workers.dev`.
7. Check it: open that address in a browser. It should say `sbs-push ok`. If it says the VAPID keys are missing, redo steps 4 and 5 and deploy again.
8. Tell the site where it is: in `js/push.js`, fill in the first line, `const PUSH = { url: '<the address from step 6>', key: '<the public key from step 2>' };`, commit and push.

Keep `~/sbs-vapid-private.txt` somewhere safe (a password manager is best). Making a new key pair later works, but every phone then has to turn notifications on again.

## Change it later

Edit `worker.js`, then `npx wrangler deploy` from this folder. To test a local copy of the site, list its address in `ALLOW_ORIGINS` in `wrangler.toml`. Run the tests with `node push/test.js` from the repo root (no install needed).

## What it accepts

`POST /notify` from the site only (`https://deepak-or1.github.io`, plus `ALLOW_ORIGINS`), with up to 10 subscriptions and a message of at most 80 + 240 characters. It sends only to the known push services (Google, Mozilla, Apple, Microsoft) and answers with each service's status, so the page can forget phones that have gone. It logs nothing about messages or addresses.
