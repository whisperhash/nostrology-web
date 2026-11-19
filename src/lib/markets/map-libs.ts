// Everything the /marketplaces bubble maps run in the browser, in ONE module that
// BubbleMap.svelte imports dynamically when a map mounts. Vite therefore splits Leaflet,
// MapLibre GL, the bridge between them and their CSS into a chunk of their own (about 325 KB
// gzipped, plus MapLibre's worker below at about 150 KB), which a visitor who never opens
// Geography or Shipping never downloads. Both files are immutable and cached for a year.
//
// All three are devDependencies on purpose: they are bundled for the client and never run
// on the server, so the runtime image (`pnpm install --prod`) does not install them.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 ships as ES modules only and starts its worker from a URL. Its default, a file
// next to its own module, does not exist once Vite has bundled it, so the worker is built as
// its own self-contained file and its URL handed over before any map is created. `?worker&url`
// and not `?url`: the worker imports a sibling chunk (maplibre-gl-shared.mjs) that a plain
// asset URL would leave behind, and the map would mount but never draw a tile.
// https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';

setWorkerUrl(workerUrl);

export { L, maplibreGL };
