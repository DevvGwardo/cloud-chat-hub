import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

// Shoelace ships its runtime assets (icons, translations) in a top-level `cdn/`
// directory inside the package. The renderer used to fetch icons from the
// jsDelivr CDN via setBasePath — which breaks offline (the app ships as a
// desktop tool) and silently drifts from package.json. Instead, this plugin
// bundles the icons into the app output at `shoelace/assets/icons/` (dev:
// served straight from node_modules) and src/main.tsx points setBasePath at
// the relative `./shoelace` — no network involved.
const SHOELACE_ICONS_SOURCE = path.resolve(
  __dirname,
  'node_modules/@shoelace-style/shoelace/cdn/assets/icons',
);

const SHOELACE_ASSET_DIR = 'shoelace/assets/icons';

/** Dev-server URL prefix the icons are served under. */
const ICONS_URL_PREFIX = '/shoelace/assets/icons/';

export function shoelaceAssetsPlugin(): Plugin {
  return {
    name: 'shoelace-assets',

    // Dev: serve the icons straight from node_modules at /shoelace/assets/icons.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!urlPath.startsWith(ICONS_URL_PREFIX)) {
          next();
          return;
        }
        const name = urlPath.slice(ICONS_URL_PREFIX.length);
        // Guard against path traversal — only serve files inside the icons dir.
        const filePath = path.join(SHOELACE_ICONS_SOURCE, name);
        if (!filePath.startsWith(SHOELACE_ICONS_SOURCE) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(filePath).pipe(res);
      });
    },

    // Build: emit every icon into <outDir>/shoelace/assets/icons/ so the
    // packaged renderer can fetch them via a relative file:// URL.
    generateBundle() {
      let files: string[];
      try {
        files = readdirSync(SHOELACE_ICONS_SOURCE);
      } catch {
        this.warn?.(
          `shoelace-assets: could not read ${SHOELACE_ICONS_SOURCE} — ` +
            'Shoelace icons will not be bundled and will fail offline.',
        );
        return;
      }
      for (const file of files) {
        if (!file.endsWith('.svg')) continue;
        this.emitFile({
          type: 'asset',
          fileName: `${SHOELACE_ASSET_DIR}/${file}`,
          source: readFileSync(path.join(SHOELACE_ICONS_SOURCE, file)),
        });
      }
    },
  };
}
