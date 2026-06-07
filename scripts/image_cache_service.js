const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { pathToFileURL } = require('url');
const defaultComponents = require('./default_components');
const { expandIncludes } = require('./include_preprocessor');

const SCP_WIKI_BASE = 'https://scp-wiki.wikidot.com';

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.svg'
]);

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30000;

let activeJob = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeSlug(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^\/+/, '')
    .replace(/[?#].*$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'page';
}

function normalizeUrl(value = '') {
  const url = String(value).trim();

  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${SCP_WIKI_BASE}${url}`;

  return url;
}

function hashUrl(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function getPageSlug(entry = {}) {
  return safeSlug(
    entry.link ||
    entry.originalKey ||
    entry.slug ||
    entry.url ||
    entry.title ||
    entry.key ||
    'page'
  );
}

function getManifestKey(mode, pageSlug, url) {
  return `${mode}::${pageSlug}::${url}`;
}

function inferExtensionFromUrl(url) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).toLowerCase();

    if (IMAGE_EXTENSIONS.has(ext)) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  } catch {
    // fall through
  }

  return '.jpg';
}

function isLikelyImageUrl(url) {
  const normalized = normalizeUrl(url);

  if (!normalized) return false;
  if (/^(data|blob|javascript):/i.test(normalized)) return false;

  try {
    const parsed = new URL(normalized);
    const ext = path.extname(parsed.pathname).toLowerCase();

    if (IMAGE_EXTENSIONS.has(ext)) return true;

    return (
      parsed.hostname.includes('wdfiles.com') ||
      parsed.hostname.includes('wikidot.com') ||
      parsed.pathname.includes('/local--files/')
    );
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}



function extractImageUrlsFromHtml(html = '') {
  const urls = new Set();
  const source = String(html || '');

  let match;

  const attrRegex = /\b(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/gi;
  while ((match = attrRegex.exec(source)) !== null) {
    const url = normalizeUrl(decodeHtmlEntities(match[1]));
    if (isLikelyImageUrl(url)) urls.add(url);
  }

  const srcsetRegex = /\bsrcset=["']([^"']+)["']/gi;
  while ((match = srcsetRegex.exec(source)) !== null) {
    const srcset = decodeHtmlEntities(match[1]);

    for (const candidate of srcset.split(',')) {
      const url = normalizeUrl(candidate.trim().split(/\s+/)[0]);
      if (isLikelyImageUrl(url)) urls.add(url);
    }
  }

  const cssUrlRegex = /url\(["']?([^"')]+)["']?\)/gi;
  while ((match = cssUrlRegex.exec(source)) !== null) {
    const url = normalizeUrl(decodeHtmlEntities(match[1]));
    if (isLikelyImageUrl(url)) urls.add(url);
  }

  return [...urls];
}

function parsePipeArgs(argsText = '') {
  const args = {};

  for (const part of String(argsText).split('|')) {
    const [rawKey, ...rawValueParts] = part.split('=');
    const key = String(rawKey || '').trim();
    const value = rawValueParts.join('=').trim();

    if (!key) continue;

    const existing = args[key];
    const existingIsVariable = /^\{\$[^}]+\}$/.test(existing || '');
    const valueIsVariable = /^\{\$[^}]+\}$/.test(value || '');

    if (
      existing === undefined ||
      existing === '' ||
      existingIsVariable ||
      (!valueIsVariable && existingIsVariable)
    ) {
      args[key] = value;
    }
  }

  return args;
}

function cleanIncludeValue(value = '', fallback = '') {
  const trimmed = String(value || '').trim();

  if (!trimmed || /^\{\$[^}]+\}$/.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}

function resolveImageBlockName(name = '', pageSlug = '') {
  const value = cleanIncludeValue(name);

  if (!value) return '';

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith('//')) {
    return `https:${value}`;
  }

  if (value.startsWith('/local--files/')) {
    return `https://scp-wiki.wdfiles.com${value}`;
  }

  if (value.startsWith('/')) {
    return `https://scp-wiki.wikidot.com${value}`;
  }

  return `https://scp-wiki.wdfiles.com/local--files/${pageSlug}/${value}`;
}

function extractComponentImageBlocks(rawSource = '', entry = {}) {
  const blocks = [];
  const source = String(rawSource || '');
  const pageSlug = getPageSlug(entry);

  const includeRegex =
    /\[\[include\s+(?::scp-wiki:)?component:image-block(?:-base)?\s+([^\]]+)\]\]/gi;

  let match;

  while ((match = includeRegex.exec(source)) !== null) {
    const args = parsePipeArgs(match[1] || '');
    const name = cleanIncludeValue(args.name);

    if (!name) continue;

    const url = normalizeUrl(resolveImageBlockName(name, pageSlug));

    if (!url) continue;

    blocks.push({
      url,
      filename: name,
      caption: cleanIncludeValue(args.caption),
      width: cleanIncludeValue(args.width, '300px'),
      align: cleanIncludeValue(args.align, 'right'),
      link: cleanIncludeValue(args.link, '#'),
      altText:
        cleanIncludeValue(args['alt-text']) ||
        cleanIncludeValue(args.alt) ||
        cleanIncludeValue(args.caption)
    });
  }

  return blocks;
}

function extractImageUrlsFromWikidotSource(rawSource = '') {
  const urls = new Set();
  const source = String(rawSource || '');

  let match;

  // Handles:
  // containment-image= https://scp-wiki.wdfiles.com/local--files/chaos-arts/icon.svg
  // image=http://...
  // [[image https://...]]
  // [[include ... image= https://...]]
  const absoluteUrlRegex = /https?:\/\/[^\s"'<>|\]]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s"'<>|\]]*)?/gi;
  while ((match = absoluteUrlRegex.exec(source)) !== null) {
    const url = normalizeUrl(match[0]);
    if (isLikelyImageUrl(url)) urls.add(url);
  }

  // Handles protocol-relative URLs.
  const protocolRelativeRegex = /\/\/[^\s"'<>|\]]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s"'<>|\]]*)?/gi;
  while ((match = protocolRelativeRegex.exec(source)) !== null) {
    const url = normalizeUrl(match[0]);
    if (isLikelyImageUrl(url)) urls.add(url);
  }

  // Handles local--files paths if they appear without a full domain.
  const localFilesRegex = /\/local--files\/[^\s"'<>|\]]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s"'<>|\]]*)?/gi;
  while ((match = localFilesRegex.exec(source)) !== null) {
    const url = normalizeUrl(match[0]);
    if (isLikelyImageUrl(url)) urls.add(url);
  }

  return [...urls];
}

function getEntryImageUrls(entry = {}) {
  const urls = new Set();

  if (Array.isArray(entry.images)) {
    for (const image of entry.images) {
      const url = normalizeUrl(image);
      if (isLikelyImageUrl(url)) urls.add(url);
    }
  }

  for (const url of extractImageUrlsFromHtml(entry.raw_content || '')) {
    urls.add(url);
  }

  const pageSlug = getPageSlug(entry);

  const expandedRawSource = expandIncludes(
    entry.raw_source || '',
    defaultComponents,
    {
      pageSlug,
      page: pageSlug,
      site: 'scp-wiki'
    }
  );

  for (const url of extractImageUrlsFromWikidotSource(expandedRawSource)) {
    urls.add(url);
  }

  if (Array.isArray(entry.children)) {
    for (const child of entry.children) {
      const childSlug = getPageSlug(child);

      const expandedChildSource = expandIncludes(
        child.raw_source || '',
        defaultComponents,
        {
          pageSlug: childSlug,
          page: childSlug,
          site: 'scp-wiki'
        }
      );

      for (const url of extractImageUrlsFromWikidotSource(expandedChildSource)) {
        urls.add(url);
      }
    }
  }

  return [...urls];
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveManifest(manifestPath, manifest) {
  ensureDir(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function recordToAbsolutePath(record, rootDir) {
  if (!record || !record.localPath || !rootDir) return null;

  const root = path.resolve(rootDir);
  const absolute = path.resolve(rootDir, record.localPath);

  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    return null;
  }

  return fs.existsSync(absolute) ? absolute : null;
}

function findCachedImageOnDisk(cacheDir, entry, url) {
  const pageSlug = getPageSlug(entry);
  const pageDir = path.join(cacheDir, pageSlug);

  if (!fs.existsSync(pageDir)) return null;

  const base = hashUrl(normalizeUrl(url));
  const names = fs.readdirSync(pageDir);

  const compressed = names.find(name => name.startsWith(`${base}-compressed.`));
  if (compressed) return path.join(pageDir, compressed);

  const hd = names.find(name => name.startsWith(`${base}-hd.`));
  if (hd) return path.join(pageDir, hd);

  return null;
}

function resolveCachedImage({
  url,
  entry,
  userDataDir,
  bundledDataDir
}) {
  const normalized = normalizeUrl(url);

  if (!normalized || !entry) return null;

  const pageSlug = getPageSlug(entry);

  const userManifestPath = path.join(userDataDir, 'image-manifest.json');
  const bundledManifestPath = bundledDataDir
    ? path.join(bundledDataDir, 'image-manifest.json')
    : '';

  const userManifest = loadManifest(userManifestPath);
  const bundledManifest = bundledManifestPath ? loadManifest(bundledManifestPath) : {};

  const keys = [
    getManifestKey('compressed', pageSlug, normalized),
    getManifestKey('hd', pageSlug, normalized)
  ];

  for (const key of keys) {
    const userPath = recordToAbsolutePath(userManifest[key], userDataDir);
    if (userPath) return pathToFileURL(userPath).href;

    if (bundledDataDir) {
      const bundledPath = recordToAbsolutePath(bundledManifest[key], bundledDataDir);
      if (bundledPath) return pathToFileURL(bundledPath).href;
    }
  }

  const userDiskPath = findCachedImageOnDisk(
    path.join(userDataDir, 'image_cache'),
    entry,
    normalized
  );

  if (userDiskPath) return pathToFileURL(userDiskPath).href;

  if (bundledDataDir) {
    const bundledDiskPath = findCachedImageOnDisk(
      path.join(bundledDataDir, 'image_cache'),
      entry,
      normalized
    );

    if (bundledDiskPath) return pathToFileURL(bundledDiskPath).href;
  }

  return null;
}

function downloadBuffer(url, redirectsRemaining = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const normalized = normalizeUrl(url);

    let parsed;

    try {
      parsed = new URL(normalized);
    } catch {
      reject(new Error(`Invalid URL: ${normalized}`));
      return;
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      reject(new Error(`Unsupported image URL protocol: ${parsed.protocol}`));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.get(
      parsed,
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': 'scp-offline-reader-image-cache/1.0',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      },
      res => {
        const statusCode = res.statusCode || 0;

        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          res.headers.location &&
          redirectsRemaining > 0
        ) {
          res.resume();

          const redirected = new URL(res.headers.location, normalized).href;

          downloadBuffer(redirected, redirectsRemaining - 1)
            .then(resolve)
            .catch(reject);

          return;
        }

        if (statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${statusCode} for ${normalized}`));
          return;
        }

        const chunks = [];

        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Image request timed out: ${normalized}`));
    });

    req.on('error', reject);
  });
}

async function writeImage(buffer, outputPath) {
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, buffer);
}

async function cacheOneImage({
  entry,
  url,
  userDataDir,
  mode = 'compressed',
  manifest
}) {
  const normalized = normalizeUrl(url);
  const pageSlug = getPageSlug(entry);
  const ext = inferExtensionFromUrl(normalized);
  const hash = hashUrl(normalized);

  // No sharp here. Store original bytes. This avoids native image-processing
  // dependency problems and keeps SVG/GIF intact.
  const filename = `${hash}-${mode}${ext}`;
  const relPath = path.join('image_cache', pageSlug, filename).replace(/\\/g, '/');
  const outputPath = path.join(userDataDir, relPath);

  const manifestKey = getManifestKey(mode, pageSlug, normalized);

  if (manifest[manifestKey]) {
    const existing = recordToAbsolutePath(manifest[manifestKey], userDataDir);
    if (existing) {
      return {
        status: 'skipped',
        sourceUrl: normalized,
        localFileUrl: pathToFileURL(existing).href
      };
    }
  }

  if (fs.existsSync(outputPath)) {
    manifest[manifestKey] = {
      sourceUrl: normalized,
      localPath: relPath,
      mode,
      page: pageSlug,
      savedAt: new Date().toISOString()
    };

    return {
      status: 'skipped',
      sourceUrl: normalized,
      localFileUrl: pathToFileURL(outputPath).href
    };
  }

  const buffer = await downloadBuffer(normalized);
  await writeImage(buffer, outputPath);

  manifest[manifestKey] = {
    sourceUrl: normalized,
    localPath: relPath,
    mode,
    page: pageSlug,
    bytes: buffer.length,
    savedAt: new Date().toISOString()
  };

  return {
    status: 'cached',
    sourceUrl: normalized,
    localFileUrl: pathToFileURL(outputPath).href
  };
}

function flattenContentFiles(contentFiles) {
  const entries = [];

  for (const file of contentFiles || []) {
    const data = file?.data;

    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;

    for (const [key, value] of Object.entries(data)) {
      if (!value || typeof value !== 'object') continue;

      entries.push({
        ...value,
        originalKey: key,
        key,
        sourceFile: file.file
      });
    }
  }

  return entries;
}

async function cacheImagesForEntries({
  entries,
  userDataDir,
  onProgress
}) {
  if (activeJob) {
    throw new Error('Image cache job is already running.');
  }

  const job = { cancelled: false };
  activeJob = job;

  try {
    const manifestPath = path.join(userDataDir, 'image-manifest.json');
    const manifest = loadManifest(manifestPath);

    const imageJobs = [];

    for (const entry of entries) {
      const urls = getEntryImageUrls(entry);

      for (const url of urls) {
        imageJobs.push({ entry, url });
      }
    }

    let cached = 0;
    let skipped = 0;
    let failed = 0;

    onProgress?.({
      type: 'start',
      total: imageJobs.length,
      cached,
      skipped,
      failed
    });

    for (let index = 0; index < imageJobs.length; index += 1) {
      if (job.cancelled) {
        const summary = {
          cancelled: true,
          total: imageJobs.length,
          cached,
          skipped,
          failed
        };

        onProgress?.({
          type: 'cancelled',
          ...summary
        });

        return summary;
      }

      const imageJob = imageJobs[index];

      try {
        const result = await cacheOneImage({
          entry: imageJob.entry,
          url: imageJob.url,
          userDataDir,
          mode: 'compressed',
          manifest
        });

        if (result.status === 'cached') cached += 1;
        else skipped += 1;

        saveManifest(manifestPath, manifest);

        onProgress?.({
          type: 'progress',
          index: index + 1,
          total: imageJobs.length,
          cached,
          skipped,
          failed,
          status: result.status,
          title: imageJob.entry.title || imageJob.entry.originalKey || imageJob.entry.key || '',
          sourceUrl: imageJob.url
        });
      } catch (err) {
        failed += 1;

        onProgress?.({
          type: 'progress',
          index: index + 1,
          total: imageJobs.length,
          cached,
          skipped,
          failed,
          status: 'failed',
          title: imageJob.entry.title || imageJob.entry.originalKey || imageJob.entry.key || '',
          sourceUrl: imageJob.url,
          error: err.message || String(err)
        });
      }
    }

    saveManifest(manifestPath, manifest);

    const summary = {
      cancelled: false,
      total: imageJobs.length,
      cached,
      skipped,
      failed
    };

    onProgress?.({
      type: 'done',
      ...summary
    });

    return summary;
  } finally {
    activeJob = null;
  }
}

function cancelActiveImageCacheJob() {
  if (!activeJob) return false;

  activeJob.cancelled = true;
  return true;
}

module.exports = {
  normalizeUrl,
  extractImageUrlsFromHtml,
  extractImageUrlsFromWikidotSource,
  extractComponentImageBlocks,
  getEntryImageUrls,
  flattenContentFiles,
  cacheImagesForEntries,
  cancelActiveImageCacheJob,
  resolveCachedImage
};