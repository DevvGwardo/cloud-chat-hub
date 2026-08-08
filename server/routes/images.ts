import { logger } from '../lib/logger';
import { Router } from 'express';
import { sendJson } from '../lib/helpers';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const router = Router();

// Saved under ~/.hermes/images so pasted images render inline in chat
// (cloudchat-asset://hermes/...) and are readable by the hermes agent.
const IMAGES_DIR = join(homedir(), '.hermes', 'images');
const MAX_IMAGE_DECODED_SIZE = 10 * 1024 * 1024; // 10 MB decoded

// Content-addressed pasted images accumulate forever (files are never
// overwritten, so the directory grows unboundedly). Once it grows past a
// generous cap, prune the oldest files by mtime — content-addressed means a
// pruned file is regenerated on the next paste of the same image; the only
// cost is old chat history losing the inline thumbnail.
const IMAGES_DIR_MAX_BYTES = 1024 * 1024 * 1024; // 1 GiB cap
const IMAGES_DIR_TRIM_BYTES = 512 * 1024 * 1024; // trim back to 512 MiB
// Approximate directory size, lazily computed and kept fresh as files are
// written/pruned here (files written by other processes are re-counted on GC).
let imagesDirBytes: number | null = null;

function computeImagesDirBytes(): number {
  let total = 0;
  for (const entry of readdirSync(IMAGES_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    try {
      total += statSync(join(IMAGES_DIR, entry.name)).size;
    } catch {
      // file vanished between readdir and stat — ignore
    }
  }
  return total;
}

function gcImagesDirIfNeeded(): void {
  if (imagesDirBytes === null) imagesDirBytes = computeImagesDirBytes();
  if (imagesDirBytes <= IMAGES_DIR_MAX_BYTES) return;

  // Recompute so files written by other processes (e.g. the hermes agent)
  // count toward the cap too.
  imagesDirBytes = computeImagesDirBytes();
  if (imagesDirBytes <= IMAGES_DIR_MAX_BYTES) return;

  const byAge = readdirSync(IMAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      try {
        const st = statSync(join(IMAGES_DIR, e.name));
        return { name: e.name, size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((e): e is { name: string; size: number; mtimeMs: number } => e !== null)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  for (const entry of byAge) {
    if (imagesDirBytes <= IMAGES_DIR_TRIM_BYTES) break;
    try {
      unlinkSync(join(IMAGES_DIR, entry.name));
      imagesDirBytes -= entry.size;
    } catch {
      // already gone — ignore
    }
  }
  logger.warn(`[images] Pruned old pasted images (dir exceeded ${IMAGES_DIR_MAX_BYTES} bytes)`);
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

router.post('/upload', (req, res) => {
  try {
    const { data, mimeType } = req.body ?? {};

    if (typeof data !== 'string' || !data) {
      return sendJson(res, 400, { error: 'Missing base64 image data.' });
    }

    const extension = MIME_EXTENSIONS[typeof mimeType === 'string' ? mimeType : ''];
    if (!extension) {
      return sendJson(res, 400, {
        error: `Unsupported image type. Supported: ${Object.keys(MIME_EXTENSIONS).join(', ')}`,
      });
    }

    // Check the size BEFORE decoding: a 10 MB base64 body can never decode to
    // more than ~7.5 MB, so a post-decode check would be dead code — and it
    // avoids allocating the buffer for oversized payloads at all.
    const estimatedBytes = Math.ceil(data.length * 0.75);
    if (estimatedBytes > MAX_IMAGE_DECODED_SIZE) {
      return sendJson(res, 413, {
        error: `Image exceeds the 10 MB limit (~${(estimatedBytes / 1024 / 1024).toFixed(1)} MB).`,
      });
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(data, 'base64');
    } catch {
      return sendJson(res, 400, { error: 'Invalid base64 image data.' });
    }
    if (buffer.length === 0) {
      return sendJson(res, 400, { error: 'Invalid base64 image data.' });
    }
    if (buffer.length > MAX_IMAGE_DECODED_SIZE) {
      return sendJson(res, 413, { error: 'Image exceeds the 10 MB limit.' });
    }

    const hash = createHash('sha256').update(buffer).digest('hex');
    const basename = `pasted-${hash.slice(0, 16)}.${extension}`;
    const path = join(IMAGES_DIR, basename);

    mkdirSync(IMAGES_DIR, { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, buffer);
    }
    if (imagesDirBytes !== null) imagesDirBytes += buffer.length;
    try {
      gcImagesDirIfNeeded();
    } catch (err: unknown) {
      logger.warn(`[images] GC failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return sendJson(res, 200, { path });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[images] Upload error: ${msg}`);
    return sendJson(res, 500, { error: msg || 'Image upload failed.' });
  }
});

const EXTENSION_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

// Serve stored images over HTTP so non-Electron surfaces (web, mobile remote)
// can render them — cloudchat-asset:// only exists inside the Electron shell.
router.get('/file/:name', (req, res) => {
  const name = req.params.name;
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return sendJson(res, 400, { error: 'Invalid image name.' });
  }
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const mime = EXTENSION_MIMES[ext];
  if (!mime) {
    return sendJson(res, 400, { error: 'Unsupported image type.' });
  }
  const path = join(IMAGES_DIR, name);
  if (!existsSync(path)) {
    return sendJson(res, 404, { error: 'Image not found.' });
  }
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(mime).sendFile(path);
});

export function registerImagesRoute(app: Router) {
  app.use('/functions/v1/images', router);
}
