const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const sharp = require('sharp');

const APP_DIR = __dirname;
const CACHE_DIR = path.join(APP_DIR, 'image_cache');
const MANIFEST_PATH = path.join(APP_DIR, 'image-manifest.json');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function normalizeUrl(url = '') {
  const value = String(url).trim();
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `https://scp-wiki.wikidot.com${value}`;
  return value;
}

function safeSlug(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'item';
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

function hashUrl(url = '') {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function getManifestKey(mode, pageSlug, url) {
  return `${mode}::${pageSlug}::${url}`;
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const normalized = normalizeUrl(url);
    const client = normalized.startsWith('https:') ? https : http;

    client.get(normalized, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(downloadBuffer(res.headers.location));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${normalized} (${res.statusCode})`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function getAllContentFiles() {
  return fs.readdirSync(APP_DIR)
    .filter(name => /^content_.*\.json$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function extractUrlsFromHtml(html = '') {
  const urls = new Set();
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const normalized = normalizeUrl(match[1]);
    if (normalized) urls.add(normalized);
  }

  return [...urls];
}

async function main() {
  const manifest = loadManifest();
  const contentFiles = getAllContentFiles();

  let totalPages = 0;
  let totalImages = 0;
  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of contentFiles) {
    const fullPath = path.join(APP_DIR, file);
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      totalPages++;

      const pageSlug = safeSlug(value.link || key || value.title || 'page');
      const pageDir = path.join(CACHE_DIR, pageSlug);

      if (!fs.existsSync(pageDir)) {
        fs.mkdirSync(pageDir, { recursive: true });
      }

      const urls = new Set();

      if (Array.isArray(value.images)) {
        for (const src of value.images) {
          const normalized = normalizeUrl(src);
          if (normalized) urls.add(normalized);
        }
      }

      for (const src of extractUrlsFromHtml(value.raw_content || '')) {
        urls.add(src);
      }

      for (const url of urls) {
        totalImages++;
        const manifestKey = getManifestKey('compressed', pageSlug, url);

        if (
          manifest[manifestKey] &&
          manifest[manifestKey].localPath &&
          fs.existsSync(path.join(APP_DIR, manifest[manifestKey].localPath))
        ) {
          skipped++;
          continue;
        }

        try {
          const buffer = await downloadBuffer(url);
          const filename = `${hashUrl(url)}-compressed.jpg`;
          const relPath = path.join('image_cache', pageSlug, filename).replace(/\\/g, '/');
          const absPath = path.join(APP_DIR, relPath);

          await sharp(buffer)
            .rotate()
            .resize({ width: 1400, withoutEnlargement: true })
            .jpeg({ quality: 72, mozjpeg: true })
            .toFile(absPath);

          manifest[manifestKey] = {
            sourceUrl: url,
            localPath: relPath,
            mode: 'compressed',
            page: pageSlug,
            savedAt: new Date().toISOString()
          };

          saved++;
          saveManifest(manifest);
          console.log(`Saved: ${pageSlug} -> ${url}`);
        } catch (err) {
          failed++;
          console.error(`Failed: ${pageSlug} -> ${url}`);
          console.error(err.message);
        }
      }
    }
  }

  console.log('\nDone.');
  console.log(`Pages scanned: ${totalPages}`);
  console.log(`Images found: ${totalImages}`);
  console.log(`Saved: ${saved}`);
  console.log(`Skipped existing: ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});