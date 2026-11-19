#!/usr/bin/env node
// Makes the VAPID key pair for the push Worker (push/README.md). Prints the PUBLIC key (base64url, 65-byte uncompressed
// P-256 point) and writes the PRIVATE key (base64url, raw 32-byte scalar) to a new file outside the repo, mode 0600.
// The private key is never printed.
//
//   node tools/vapid.js <private-key-file>
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };
const arg = process.argv[2];
if (!arg || arg === '--help' || arg === '-h') fail('Usage: node tools/vapid.js <private-key-file>\n  writes the private key to that new file (outside the repo, never overwritten) and prints the public key', arg ? 0 : 2);

const file = path.resolve(arg), dir = path.dirname(file);
let realDir, realRepo;
try { realDir = fs.realpathSync(dir); } catch (e) { fail('the folder does not exist: ' + dir); }
realRepo = fs.realpathSync(path.resolve(__dirname, '..'));
if (realDir === realRepo || realDir.startsWith(realRepo + path.sep)) fail('refusing to write a private key inside the repo (' + realRepo + '); pick a path outside it, e.g. ~/sbs-vapid-private.txt');
let taken = true; try { fs.lstatSync(file); } catch (e) { taken = false; } // lstat: a dangling symlink counts as taken too
if (taken) fail('refusing to overwrite ' + file);

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const d = privateKey.export({ format: 'jwk' }).d, { x, y } = publicKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(x, 'base64url'), Buffer.from(y, 'base64url')]);
if (Buffer.from(d, 'base64url').length !== 32 || pub.length !== 65) fail('unexpected key size');

try { fs.writeFileSync(file, d, { mode: 0o600, flag: 'wx' }); fs.chmodSync(file, 0o600); } // wx: fails if anything appeared there since the check
catch (e) { fail('could not write ' + file + ': ' + e.code); }
console.error('private key written to ' + file + ' (keep it secret; it goes to Cloudflare with `npx wrangler secret put VAPID_PRIVATE`)');
console.log(pub.toString('base64url'));
