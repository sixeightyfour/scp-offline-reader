const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const sharp = require('sharp');
const { ipcRenderer } = require('electron');

const sidebarList = document.getElementById('scpList');
const searchInput = document.getElementById('searchInput');
const groupSelect = document.getElementById('groupSelect');
const stats = document.getElementById('stats');

const pageTitle = document.getElementById('page-title');
const pageContent = document.getElementById('page-content');
const appMeta = document.getElementById('app-meta');
const imageStrip = document.getElementById('image-strip');
const offlineStatus = document.getElementById('offlineStatus');

const speakBtn = document.getElementById('speakBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');

const downloadCompressedBtn = document.getElementById('downloadCompressedBtn');
const downloadHdBtn = document.getElementById('downloadHdBtn');
const refreshOfflineBtn = document.getElementById('refreshOfflineBtn');

let entries = [];
let filteredEntries = [];
let currentEntry = null;
let currentGroup = 'all';

const entryLookup = new Map();

const APP_PATHS = ipcRenderer.sendSync('app:get-paths');

console.log('APP_PATHS', APP_PATHS);

console.log('APP_PATHS', APP_PATHS);

const CONTENT_DIR = APP_PATHS.contentDir;
const USER_DATA_DIR = APP_PATHS.userDataDir;
const USER_CACHE_DIR = APP_PATHS.userCacheDir;
const USER_MANIFEST_PATH = APP_PATHS.userManifestPath;
const BUNDLED_CACHE_DIR = APP_PATHS.bundledCacheDir;
const BUNDLED_MANIFEST_PATH = APP_PATHS.bundledManifestPath;

ensureDir(USER_DATA_DIR);
ensureDir(USER_CACHE_DIR);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadManifest(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function loadUserManifest() {
  return loadManifest(USER_MANIFEST_PATH);
}

function loadBundledManifest() {
  return loadManifest(BUNDLED_MANIFEST_PATH);
}

function saveUserManifest(manifest) {
  fs.writeFileSync(USER_MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

function toFileUrl(filePath = '') {
  return pathToFileURL(filePath).href;
}

function toDisplaySrc(filePath = '') {
  if (!filePath) return '';
  return /^file:/i.test(filePath) ? filePath : toFileUrl(filePath);
}

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeUrl(url = '') {
  const value = String(url).trim();
  if (!value) return '';

  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `https://scp-wiki.wikidot.com${value}`;
  return value;
}

function slugify(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/+/, '')
    .replace(/[#?].*$/, '')
    .replace(/\/+$/, '');
}

function safeSlug(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'item';
}

function extractPathname(value = '') {
  try {
    const asString = String(value).trim();
    if (!asString) return '';

    if (asString.startsWith('/')) {
      return slugify(asString);
    }

    if (/^https?:\/\//i.test(asString)) {
      const url = new URL(asString);
      return slugify(url.pathname);
    }

    return slugify(asString);
  } catch {
    return slugify(value);
  }
}

function extractScpNumber(title = '', key = '') {
  const source = `${title} ${key}`;
  const match = source.match(/scp-(\d+)/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function prettifyGroupName(filename) {
  return filename
    .replace(/^content_/, '')
    .replace(/\.json$/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function addLookupAlias(alias, item) {
  const key = slugify(alias);
  if (!key) return;

  if (!entryLookup.has(key)) {
    entryLookup.set(key, item);
  }
}

function rebuildEntryLookup() {
  entryLookup.clear();

  for (const item of entries) {
    addLookupAlias(item.originalKey, item);
    addLookupAlias(item.title, item);
    addLookupAlias(item.link, item);
    addLookupAlias(item.url, item);

    const originalKeySlug = slugify(item.originalKey);
    const titleSlug = slugify(item.title);

    if (/^scp-\d+(-[a-z]+)?$/i.test(originalKeySlug)) {
      addLookupAlias(`/${originalKeySlug}`, item);
    }

    if (/^scp-\d+(-[a-z]+)?$/i.test(titleSlug)) {
      addLookupAlias(`/${titleSlug}`, item);
    }

    if (item.link) {
      addLookupAlias(`/${item.link}`, item);
    }
  }
}

function findEntryByHref(href = '') {
  const raw = String(href).trim();
  if (!raw) return null;

  const cleaned = raw.replace(/^#/, '');
  const pathOnly = extractPathname(cleaned);

  return (
    entryLookup.get(slugify(cleaned)) ||
    entryLookup.get(pathOnly) ||
    entryLookup.get(`/${pathOnly}`) ||
    null
  );
}

function isInternalWikiHref(href = '') {
  const value = String(href).trim();
  if (!value) return false;
  if (value.startsWith('#')) return true;
  if (value.startsWith('/')) return true;
  if (/^https?:\/\/scp-wiki\.wikidot\.com\//i.test(value)) return true;
  if (/^https?:\/\/scpwiki\.com\//i.test(value)) return true;
  return false;
}

function getManifestKey(mode, pageSlug, url) {
  return `${mode}::${pageSlug}::${url}`;
}

function hashUrl(url = '') {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function inferExtensionFromUrl(url = '') {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const ext = path.extname(pathname);
    if (ext && ext.length <= 6) return ext;
  } catch {}
  return '.jpg';
}

function getPageSlug(item) {
  return safeSlug(item.link || item.originalKey || item.title || 'page');
}

function recordToAbsolutePath(record, rootDir) {
  if (!record || !record.localPath || !rootDir) return null;
  const absolutePath = path.join(rootDir, record.localPath);
  return fs.existsSync(absolutePath) ? absolutePath : null;
}

function tryManifestLookup(manifest, item, url, rootDir) {
  const pageSlug = getPageSlug(item);
  const hdKey = getManifestKey('hd', pageSlug, url);
  const compressedKey = getManifestKey('compressed', pageSlug, url);

  const hdPath = recordToAbsolutePath(manifest[hdKey], rootDir);
  if (hdPath) return hdPath;

  const compressedPath = recordToAbsolutePath(manifest[compressedKey], rootDir);
  if (compressedPath) return compressedPath;

  return null;
}

function findBundledCachedImage(url, item) {
  const pageSlug = getPageSlug(item);
  const pageDir = path.join(BUNDLED_CACHE_DIR, pageSlug);

  if (!fs.existsSync(pageDir)) return null;

  const base = hashUrl(url);
  const candidates = fs.readdirSync(pageDir);

  const hd = candidates.find(name => name.startsWith(`${base}-hd.`));
  if (hd) return path.join(pageDir, hd);

  const compressed = candidates.find(name => name.startsWith(`${base}-compressed.`));
  if (compressed) return path.join(pageDir, compressed);

  return null;
}

function findUserCachedImage(url, item) {
  const pageSlug = getPageSlug(item);
  const pageDir = path.join(USER_CACHE_DIR, pageSlug);

  if (!fs.existsSync(pageDir)) return null;

  const base = hashUrl(url);
  const candidates = fs.readdirSync(pageDir);

  const hd = candidates.find(name => name.startsWith(`${base}-hd.`));
  if (hd) return path.join(pageDir, hd);

  const compressed = candidates.find(name => name.startsWith(`${base}-compressed.`));
  if (compressed) return path.join(pageDir, compressed);

  return null;
}

function getPreferredLocalAbsolutePath(url, item) {
  const normalized = normalizeUrl(url);
  if (!normalized || !item) return null;

  const userManifest = loadUserManifest();
  const bundledManifest = loadBundledManifest();

  return (
    tryManifestLookup(userManifest, item, normalized, USER_DATA_DIR) ||
    tryManifestLookup(bundledManifest, item, normalized, CONTENT_DIR) ||
    findUserCachedImage(normalized, item) ||
    findBundledCachedImage(normalized, item) ||
    null
  );
}

function buildImageRecord(url, item, mode, extOverride = '') {
  const normalized = normalizeUrl(url);
  const pageSlug = getPageSlug(item);
  const ext = extOverride || inferExtensionFromUrl(normalized);
  const filename = `${hashUrl(normalized)}${mode === 'hd' ? '-hd' : '-compressed'}${ext}`;
  const relPath = path.join('image-cache', pageSlug, filename);
  const absDir = path.join(USER_CACHE_DIR, pageSlug);
  const absPath = path.join(USER_DATA_DIR, relPath);

  ensureDir(absDir);

  return {
    normalized,
    pageSlug,
    relPath,
    absPath
  };
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

async function cacheImage(url, item, mode = 'compressed') {
  const existingAbsolutePath = getPreferredLocalAbsolutePath(url, item);
  if (existingAbsolutePath) {
    return existingAbsolutePath;
  }

  const manifest = loadUserManifest();
  const record = buildImageRecord(url, item, mode);
  const key = getManifestKey(mode, record.pageSlug, record.normalized);

  if (manifest[key] && manifest[key].localPath) {
    const existing = path.join(USER_DATA_DIR, manifest[key].localPath);
    if (fs.existsSync(existing)) {
      return existing;
    }
  }

  const buffer = await downloadBuffer(record.normalized);

  if (mode === 'compressed') {
    const jpgPath = record.absPath.replace(path.extname(record.absPath), '.jpg');

    await sharp(buffer)
      .rotate()
      .resize({ width: 1400, withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toFile(jpgPath);

    record.relPath = record.relPath.replace(path.extname(record.relPath), '.jpg');
    record.absPath = jpgPath;
  } else {
    fs.writeFileSync(record.absPath, buffer);
  }

  manifest[key] = {
    sourceUrl: record.normalized,
    localPath: record.relPath.replace(/\\/g, '/'),
    mode,
    page: record.pageSlug,
    savedAt: new Date().toISOString()
  };

  saveUserManifest(manifest);
  return record.absPath;
}

function getEntryImageUrls(item) {
  const urls = new Set();

  if (Array.isArray(item.images)) {
    for (const src of item.images) {
      const normalized = normalizeUrl(src);
      if (normalized) urls.add(normalized);
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(item.raw_content || '', 'text/html');

  doc.querySelectorAll('img[src]').forEach(img => {
    const normalized = normalizeUrl(img.getAttribute('src') || '');
    if (normalized) urls.add(normalized);
  });

  return [...urls];
}

function sanitizeHtml(rawHtml = '', item = null) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  doc.querySelectorAll('script, iframe, object, embed').forEach(el => el.remove());
  doc.querySelectorAll('.preview').forEach(el => el.remove());

  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value || '';

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      }

      if ((name === 'href' || name === 'src') && value.trim().toLowerCase().startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    });
  });

  doc.querySelectorAll('a[href]').forEach(a => {
    const rawHref = a.getAttribute('href') || '';
    const normalizedHref = normalizeUrl(rawHref);

    if (normalizedHref) {
      a.setAttribute('href', normalizedHref);
    }

    a.removeAttribute('target');
    a.removeAttribute('rel');

    if (isInternalWikiHref(rawHref) || isInternalWikiHref(normalizedHref)) {
      const match = findEntryByHref(rawHref) || findEntryByHref(normalizedHref);

      if (match) {
        a.dataset.offlineKey = match.key;
        a.classList.add('offline-internal-link');
      } else {
        a.classList.add('offline-missing-link');
        a.title = 'This wiki link is not available in the offline archive.';
      }
    }
  });

  doc.querySelectorAll('img[src]').forEach(img => {
    const src = normalizeUrl(img.getAttribute('src') || '');
    if (!src) return;

    if (item) {
      const localAbsolutePath = getPreferredLocalAbsolutePath(src, item);
      if (localAbsolutePath) {
        img.setAttribute('src', toDisplaySrc(localAbsolutePath));
      } else {
        img.setAttribute('src', src);
      }
    } else {
      img.setAttribute('src', src);
    }

    img.setAttribute('loading', 'lazy');
  });

  const page = doc.querySelector('#page-content');
  return page ? page.innerHTML : doc.body.innerHTML;
}

function extractTextForSpeech(rawHtml = '') {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  doc.querySelectorAll('script, style, iframe, object, embed').forEach(el => el.remove());
  doc.querySelectorAll('.preview').forEach(el => el.remove());

  doc.querySelectorAll('img').forEach(img => {
    const alt = img.getAttribute('alt');
    img.replaceWith(doc.createTextNode(alt ? ` Image: ${alt}. ` : ' '));
  });

  const root = doc.querySelector('#page-content') || doc.body;

  return (root.textContent || '')
    .replace(/\s+/g, ' ')
    .replace(/‡ Licensing \/ Citation/gi, ' ')
    .replace(/Hide Licensing \/ Citation/gi, ' ')
    .trim();
}

function chooseVoice() {
  const voices = speechSynthesis.getVoices();

  return (
    voices.find(v => /^en/i.test(v.lang) && /zira|david|mark|aria|guy|jenny/i.test(v.name)) ||
    voices.find(v => /^en/i.test(v.lang)) ||
    voices[0] ||
    null
  );
}

function speakCurrentArticle() {
  if (!currentEntry) return;

  const text = extractTextForSpeech(currentEntry.raw_content || '');
  if (!text) return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = chooseVoice();
  if (voice) utterance.voice = voice;

  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  utterance.onend = () => {
    pauseBtn.textContent = 'Pause';
  };

  utterance.onerror = () => {
    pauseBtn.textContent = 'Pause';
  };

  speechSynthesis.speak(utterance);
}

function pauseOrResumeSpeech() {
  if (speechSynthesis.speaking && !speechSynthesis.paused) {
    speechSynthesis.pause();
    pauseBtn.textContent = 'Resume';
  } else if (speechSynthesis.paused) {
    speechSynthesis.resume();
    pauseBtn.textContent = 'Pause';
  }
}

function stopSpeech() {
  speechSynthesis.cancel();
  pauseBtn.textContent = 'Pause';
}

function loadAllJsonFiles() {
  const appDir = CONTENT_DIR;
  console.log('Loading content from:', CONTENT_DIR);
  const files = fs.readdirSync(appDir)
    .filter(name => /^content_.*\.json$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	console.log('Content files found:', files);

  if (!files.length) {
    throw new Error('No content_*.json files found.');
  }

  const merged = [];

  for (const file of files) {
    const fullPath = path.join(appDir, file);

    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn(`Skipping ${file}: JSON root is not an object.`);
        continue;
      }

      const group = file.replace(/\.json$/i, '');
      const groupLabel = prettifyGroupName(file);

      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue;

        merged.push({
          key: `${group}::${key}`,
          originalKey: key,
          title: value.title || key,
          creator: value.creator || 'Unknown',
          tags: Array.isArray(value.tags) ? value.tags : [],
          images: Array.isArray(value.images) ? value.images : [],
          url: normalizeUrl(value.url || ''),
          link: value.link || '',
          raw_content: value.raw_content || '',
          raw_source: value.raw_source || '',
          rating: value.rating ?? 'N/A',
          group,
          groupLabel,
          sourceFile: file,
          scpNumber: extractScpNumber(value.title || '', key)
        });
      }
    } catch (err) {
      console.error(`Failed loading ${file}:`, err);
    }
  }

  merged.sort((a, b) => {
    if (a.scpNumber !== b.scpNumber) return a.scpNumber - b.scpNumber;
    return a.title.localeCompare(b.title);
  });

  entries = merged;
  filteredEntries = [...entries];
  rebuildEntryLookup();
}

function buildGroupDropdown() {
  const groups = [...new Map(entries.map(item => [item.group, item.groupLabel])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));

  groupSelect.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All Files';
  groupSelect.appendChild(allOption);

  for (const [value, label] of groups) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    groupSelect.appendChild(option);
  }

  groupSelect.value = currentGroup;
}

function applyFilters() {
  const q = (searchInput.value || '').trim().toLowerCase();

  filteredEntries = entries.filter(item => {
    const groupMatch = currentGroup === 'all' || item.group === currentGroup;
    if (!groupMatch) return false;

    if (!q) return true;

    const haystack = [
      item.originalKey,
      item.title,
      item.creator,
      item.groupLabel,
      item.link,
      ...item.tags
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(q);
  });

  stats.textContent = `${filteredEntries.length} article(s) shown / ${entries.length} total`;
  drawSidebarList(filteredEntries);

  if (currentEntry && !filteredEntries.some(item => item.key === currentEntry.key)) {
    if (filteredEntries.length) {
      renderArticle(filteredEntries[0], { pushHistory: false });
    } else {
      pageTitle.textContent = 'No matching articles';
      appMeta.textContent = 'Try changing the search or file filter.';
      imageStrip.innerHTML = '';
      pageContent.innerHTML = '';
      currentEntry = null;
    }
  }
}

function drawSidebarList(list) {
  sidebarList.innerHTML = '';

  if (!list.length) {
    sidebarList.innerHTML = '<div style="padding:8px 4px;">No matching articles.</div>';
    return;
  }

  for (const item of list) {
    const link = document.createElement('a');
    link.href = '#';
    link.className = `scp-link${currentEntry && currentEntry.key === item.key ? ' active' : ''}`;

    link.innerHTML = `
      <div class="scp-link-title">${escapeHtml(item.title)}</div>
      <div class="scp-link-sub">${escapeHtml(item.groupLabel)}</div>
    `;

    link.addEventListener('click', (e) => {
      e.preventDefault();
      renderArticle(item);
      drawSidebarList(filteredEntries);
    });

    sidebarList.appendChild(link);
  }
}

function wireLinks(root) {
  root.querySelectorAll('a[href]').forEach(a => {
    if (a.dataset.wired === 'true') return;
    a.dataset.wired = 'true';

    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href') || '';
      const offlineKey = a.dataset.offlineKey || '';

      if (offlineKey) {
        const item = entries.find(entry => entry.key === offlineKey);
        if (item) {
          e.preventDefault();
          renderArticle(item);
          drawSidebarList(filteredEntries);
          return;
        }
      }

      if (!href || href === '#') {
        e.preventDefault();
        return;
      }

      if (href.startsWith('#')) {
        const id = href.slice(1);
        if (!id) return;

        const target = document.getElementById(id) || pageContent.querySelector(`[id="${CSS.escape(id)}"]`);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        ipcRenderer.invoke('app:open-external', href);
      }
    });
  });
}

function wireCollapsibles(root = document) {
  const blocks = root.querySelectorAll('.collapsible-block');

  blocks.forEach(block => {
    const folded = block.querySelector('.collapsible-block-folded');
    const unfolded = block.querySelector('.collapsible-block-unfolded');

    if (!folded || !unfolded) return;

    if (!block.dataset.wired) {
      block.dataset.wired = 'true';
      unfolded.style.display = 'none';
      folded.style.cursor = 'pointer';
      unfolded.style.cursor = 'pointer';

      folded.addEventListener('click', () => {
        folded.style.display = 'none';
        unfolded.style.display = 'block';
      });

      unfolded.addEventListener('click', () => {
        unfolded.style.display = 'none';
        folded.style.display = 'block';
      });
    }
  });
}

function openLocalOrRemoteImage(src) {
  if (!currentEntry) return;

  const localAbsolutePath = getPreferredLocalAbsolutePath(src, currentEntry);

  if (localAbsolutePath) {
    ipcRenderer.invoke('app:open-path', localAbsolutePath);
  } else {
    const remoteUrl = normalizeUrl(src);
    if (/^https?:\/\//i.test(remoteUrl)) {
      ipcRenderer.invoke('app:open-external', remoteUrl);
    }
  }
}

function renderImages(images) {
  imageStrip.innerHTML = '';

  if (!Array.isArray(images) || !images.length) return;

  for (const src of images) {
    const normalized = normalizeUrl(src);
    if (!normalized) continue;

    const img = document.createElement('img');
    const localAbsolutePath = currentEntry ? getPreferredLocalAbsolutePath(normalized, currentEntry) : null;
    img.src = localAbsolutePath ? toDisplaySrc(localAbsolutePath) : normalized;
    img.loading = 'lazy';

    img.addEventListener('click', () => {
      openLocalOrRemoteImage(normalized);
    });

    imageStrip.appendChild(img);
  }
}

function updateHistory(item) {
  if (!item) return;

  const slug = item.link || item.originalKey || item.title || 'article';
  const hash = `#${encodeURIComponent(slug)}`;

  if (location.hash !== hash) {
    history.pushState({ key: item.key }, '', hash);
  }
}

function updateOfflineStatus(item) {
  if (!item) {
    offlineStatus.textContent = '';
    return;
  }

  const urls = getEntryImageUrls(item);
  if (!urls.length) {
    offlineStatus.textContent = 'No images detected for this page.';
    return;
  }

  let availableCount = 0;
  let bundledCount = 0;
  let userCount = 0;

  for (const url of urls) {
    const userPath = findUserCachedImage(url, item);
    const bundledPath = findBundledCachedImage(url, item);
    const anyPath = getPreferredLocalAbsolutePath(url, item);

    if (anyPath) availableCount++;
    if (bundledPath) bundledCount++;
    if (userPath) userCount++;
  }

  offlineStatus.textContent = `Offline images available: ${availableCount}/${urls.length} | bundled: ${bundledCount} | user-downloaded: ${userCount}`;
}

function renderArticle(item, options = {}) {
  const { pushHistory = true } = options;

  currentEntry = item;
  stopSpeech();

  const tags = Array.isArray(item.tags) && item.tags.length ? item.tags.join(', ') : 'None';
  const safeHtml = sanitizeHtml(item.raw_content || '', item);

  pageTitle.textContent = item.title || item.originalKey;

  appMeta.innerHTML = `
    <div><strong>Author:</strong> ${escapeHtml(item.creator || 'Unknown')}</div>
    <div><strong>Source file:</strong> ${escapeHtml(item.sourceFile || 'Unknown')}</div>
    <div><strong>URL:</strong> ${
      item.url
        ? `<a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a>`
        : 'N/A'
    }</div>
    <div><strong>Tags:</strong> ${escapeHtml(tags)}</div>
    <div><strong>Rating:</strong> ${escapeHtml(String(item.rating ?? 'N/A'))}</div>
  `;

  renderImages(item.images);
  pageContent.innerHTML = safeHtml;

  wireLinks(appMeta);
  wireLinks(pageContent);
  wireCollapsibles(pageContent);

  pageContent.querySelectorAll('img[src]').forEach(img => {
    const displayedSrc = img.getAttribute('src') || '';
    const originalSrc = [...getEntryImageUrls(item)].find(url => {
      return displayedSrc === url || displayedSrc.endsWith(path.basename(url));
    });

    img.addEventListener('click', () => {
      openLocalOrRemoteImage(originalSrc || displayedSrc);
    });
  });

  updateOfflineStatus(item);

  if (pushHistory) {
    updateHistory(item);
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderInitialArticleFromHash() {
  const hash = decodeURIComponent((location.hash || '').replace(/^#/, '').trim());
  if (!hash) return false;

  const item = findEntryByHref(hash) || findEntryByHref(`/${hash}`);
  if (!item) return false;

  renderArticle(item, { pushHistory: false });
  drawSidebarList(filteredEntries);
  return true;
}

async function cacheCurrentPage(mode = 'compressed') {
  if (!currentEntry) return;

  const urls = getEntryImageUrls(currentEntry);
  if (!urls.length) {
    updateOfflineStatus(currentEntry);
    return;
  }

  downloadCompressedBtn.disabled = true;
  downloadHdBtn.disabled = true;
  refreshOfflineBtn.disabled = true;

  offlineStatus.textContent = mode === 'hd'
    ? 'Downloading HD images for this page...'
    : 'Caching compressed images for this page...';

  let success = 0;
  let failed = 0;

  try {
    for (const url of urls) {
      try {
        await cacheImage(url, currentEntry, mode);
        success++;
      } catch (err) {
        console.error(`Failed ${mode} cache for ${url}:`, err);
        failed++;
      }
    }

    renderArticle(currentEntry, { pushHistory: false });
    offlineStatus.textContent = `${mode === 'hd' ? 'HD download' : 'Compressed cache'} complete: ${success} saved, ${failed} failed`;
  } finally {
    downloadCompressedBtn.disabled = false;
    downloadHdBtn.disabled = false;
    refreshOfflineBtn.disabled = false;
  }
}

async function cacheAllPagesCompressed() {
  if (!entries.length) {
    offlineStatus.textContent = 'No entries loaded.';
    return;
  }

  downloadCompressedBtn.disabled = true;
  downloadHdBtn.disabled = true;
  refreshOfflineBtn.disabled = true;

  let pageCount = 0;
  let imageTotal = 0;
  let success = 0;
  let failed = 0;

  try {
    for (const entry of entries) {
      pageCount++;

      const urls = getEntryImageUrls(entry);
      if (!urls.length) {
        offlineStatus.textContent = `Caching compressed images: page ${pageCount}/${entries.length} | no images on this page`;
        continue;
      }

      imageTotal += urls.length;

      for (const url of urls) {
        offlineStatus.textContent = `Caching compressed images: page ${pageCount}/${entries.length} | saved ${success} | failed ${failed}`;

        try {
          await cacheImage(url, entry, 'compressed');
          success++;
        } catch (err) {
          failed++;
          console.error(`Compressed cache failed for ${entry.title} -> ${url}`, err);
        }
      }
    }

    offlineStatus.textContent = `Compressed archive cache complete: ${success}/${imageTotal} images saved, ${failed} failed across ${pageCount} pages`;

    if (currentEntry) {
      renderArticle(currentEntry, { pushHistory: false });
    }
  } finally {
    downloadCompressedBtn.disabled = false;
    downloadHdBtn.disabled = false;
    refreshOfflineBtn.disabled = false;
  }
}

function init() {
  try {
    loadAllJsonFiles();
    buildGroupDropdown();

    groupSelect.addEventListener('change', () => {
      currentGroup = groupSelect.value;
      applyFilters();
    });

    searchInput.addEventListener('input', applyFilters);

    speakBtn.addEventListener('click', speakCurrentArticle);
    pauseBtn.addEventListener('click', pauseOrResumeSpeech);
    stopBtn.addEventListener('click', stopSpeech);

    downloadCompressedBtn.addEventListener('click', cacheAllPagesCompressed);
    downloadHdBtn.addEventListener('click', () => cacheCurrentPage('hd'));
    refreshOfflineBtn.addEventListener('click', () => {
      if (currentEntry) {
        renderArticle(currentEntry, { pushHistory: false });
      }
    });

    applyFilters();

    if (filteredEntries.length) {
      if (!renderInitialArticleFromHash()) {
        renderArticle(filteredEntries[0], { pushHistory: false });
      }
      drawSidebarList(filteredEntries);
    } else {
      pageTitle.textContent = 'No SCP files found';
      appMeta.textContent = 'Nothing was loaded.';
      pageContent.innerHTML = '';
    }

    console.log(`Loaded ${entries.length} entries.`);
  } catch (err) {
    console.error(err);
    pageTitle.textContent = 'Failed to load SCP files';
    appMeta.textContent = 'Check the console for details.';
    pageContent.innerHTML = `<pre>${escapeHtml(err.stack || err.message)}</pre>`;
  }
}

window.addEventListener('beforeunload', stopSpeech);

window.addEventListener('popstate', (event) => {
  const key = event.state?.key;
  if (!key) {
    renderInitialArticleFromHash();
    return;
  }

  const item = entries.find(entry => entry.key === key);
  if (item) {
    renderArticle(item, { pushHistory: false });
    drawSidebarList(filteredEntries);
  }
});

speechSynthesis.onvoiceschanged = () => {};

init();