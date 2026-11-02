# Seven by Seven

A trail map of San Francisco and the Bay Area: ninety places between the ocean and the hills, each cut into the sections locals actually name. Walk them, log the restaurants, bars and views you find, and keep the flags.

It is a static site: no build step, no framework.

## Run it

Open `index.html` through any static server (opening the file directly works for everything except place search and the web manifest):

```
python3 -m http.server 8123
```

## Host it

The repo ships a GitHub Pages workflow (`.github/workflows/pages.yml`). Once, in the repository settings, set **Pages → Source** to **GitHub Actions**. Every push to `main` then deploys; the workflow can also be run by hand from the Actions tab. A hosted copy is what lets the "Where am I?" button use the phone's location, which browsers block inside an embedded frame.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | the shell |
| `css/app.css` | all styling, light and dark |
| `js/map.js` | the canvas map: camera, gestures with inertia, terrain cache, labels, landmarks, hit testing |
| `js/app.js` | state, the Bay Area › region › place › section › spot hierarchy, logbook views, logging, storage |
| `js/sheet.js` | the phone bottom sheet |
| `js/geom.js` | projection, point-in-polygon, the Voronoi cut that sections a place |
| `js/glyph.js` | renderer for the 2.5D landmark glyphs |
| `js/places.js` | place search (Photon, OpenStreetMap data) |
| `data/geo.js` | boundaries and the projected canvas |
| `data/info.js` | editorial text per place |
| `data/subareas.js` | sections inside each place: a seed point plus a line, drawn as Voronoi cells clipped to the boundary |
| `data/landmarks.js` | the landmark glyphs |

## Data

Your log lives in the browser (`localStorage`) on the hosted site, with export and import under Settings; inside the Claude artifact it syncs to your account. Boundaries: SF Planning Department (San Francisco) and the US Census (elsewhere). High points: Mapzen elevation data. Place search: Photon, © OpenStreetMap contributors.
