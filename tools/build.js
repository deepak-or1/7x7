#!/usr/bin/env node
// Build steps for Seven by Seven. No bundler: this merges the sub-area JSON files into data/subareas.js
// and writes dist/artifact.html, the single-file page used for the Claude artifact (CSS and JS inlined,
// no document wrapper, because the artifact host wraps the page itself).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// 1. sub-areas
const merged = {};
for (const f of ['data/subareas_sf.json', 'data/subareas_bay.json']) {
  if (!fs.existsSync(path.join(root, f))) { console.warn('missing', f); continue; }
  Object.assign(merged, JSON.parse(read(f)));
}
const n = Object.values(merged).reduce((s, a) => s + a.length, 0);
fs.writeFileSync(path.join(root, 'data/subareas.js'), '// Sections inside each place: a seed point (lon, lat) plus a line. The map cuts the place polygon into\n// Voronoi cells around these seeds. Source files: data/subareas_sf.json and data/subareas_bay.json; build with node tools/build.js\nwindow.SUBAREAS = ' + JSON.stringify(merged) + ';\n');
console.log(`subareas.js: ${Object.keys(merged).length} places, ${n} sections`);

// 2. the artifact page
let html = read('index.html');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
let body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
let top = head
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<link rel="stylesheet" href="css\/app.css">/, () => '<style>\n' + read('css/app.css') + '\n</style>');
// the <title> first, then the viewport-fit promise (the page keeps max(16px, safe-area) side gutters in its panel)
top = top.replace(/\s*<title>Seven by Seven<\/title>\s*/, '');
top = '<title>Seven by Seven</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' + top.trim();
body = body.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => '<script>\n' + read(src).replace(/<\/script/gi, '<\\/script') + '\n</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = top + '\n' + body.trim() + '\n';
fs.writeFileSync(path.join(root, 'dist/artifact.html'), out);
console.log(`dist/artifact.html: ${(out.length / 1024).toFixed(0)} KB`);
