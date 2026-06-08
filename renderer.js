const sidebarList = document.getElementById('scpList');
const searchInput = document.getElementById('searchInput');
const groupSelect = document.getElementById('groupSelect');
const stats = document.getElementById('stats');

const pageTitle = document.getElementById('page-title');
const pageContent = document.getElementById('page-content');
const appMeta = document.getElementById('app-meta');
const imageStrip = document.getElementById('image-strip');
const offlineStatus = document.getElementById('offlineStatus');

const offlineEditorToolBtn = document.getElementById('offlineEditorToolBtn');
const offlineEditorPanel = document.getElementById('offlineEditorPanel');
const closeOfflineEditorBtn = document.getElementById('closeOfflineEditorBtn');
const previewOfflineEditorBtn = document.getElementById('previewOfflineEditorBtn');
const clearOfflineEditorBtn = document.getElementById('clearOfflineEditorBtn');
const offlineEditorSource = document.getElementById('offlineEditorSource');
const offlineEditorPreview = document.getElementById('offlineEditorPreview');

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

const APP_PATHS = window.scpApp.paths;

console.log('APP_PATHS', APP_PATHS);

console.log('APP_PATHS', APP_PATHS);

const CONTENT_DIR = APP_PATHS.contentDir;
const USER_DATA_DIR = APP_PATHS.userDataDir;
const USER_CACHE_DIR = APP_PATHS.userCacheDir;
const USER_MANIFEST_PATH = APP_PATHS.userManifestPath;
const BUNDLED_CACHE_DIR = APP_PATHS.bundledCacheDir;
const BUNDLED_MANIFEST_PATH = APP_PATHS.bundledManifestPath;

const THEME_REGISTRY = {
  'scp-wiki:theme:black-highlighter-theme': {
    id: 'black-highlighter',
    name: 'Black Highlighter',
    css: "themes/black-highlighter/css/black-highlighter.css"
  },

  'theme:black-highlighter-theme': {
    id: 'black-highlighter',
    name: 'Black Highlighter',
    css: "themes/black-highlighter/css/black-highlighter.css"
  },

  'scp-wiki:theme:sigma-9': {
    id: 'sigma-9',
    name: 'Sigma-9',
    css: 'themes/sigma-main/theme.css'
  }
};

const DEFAULT_THEME = {
  id: 'default',
  name: 'Default',
  css: 'sigma-main/sigma.css'
};

function normalizeThemeInclude(includeTarget = '') {
  return String(includeTarget)
    .trim()
    .replace(/^:/, '')
    .toLowerCase();
}

function resolveTheme(includeTarget = '') {
  const key = normalizeThemeInclude(includeTarget);
  return THEME_REGISTRY[key] || DEFAULT_THEME;
}

function applyArticleTheme(theme) {
  const link = document.getElementById('article-theme-css');

  if (!link) {
    console.warn('[theme] Missing #article-theme-css link element');
    return;
  }

  if (!theme || !theme.css) {
    link.removeAttribute('href');
    console.log('[theme] Using default app theme');
    return;
  }

  const themeUrl = new URL(theme.css, window.location.href).href;

  link.href = themeUrl;

  console.log('[theme] Applied stylesheet:', themeUrl);
}

//ensureDir(USER_DATA_DIR);
//ensureDir(USER_CACHE_DIR);

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

function installFtmlCollapsibleHandler() {
  if (window.__ftmlCollapsibleHandlerInstalled) {
    return;
  }

  window.__ftmlCollapsibleHandlerInstalled = true;

  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest(
        '.wj-collapsible-button-bottom, wj-collapsible-button-bottom'
      );

      if (!button) {
        return;
      }

      const pageContent = document.getElementById('page-content');

      if (!pageContent || !pageContent.contains(button)) {
        return;
      }

      const details = button.closest('details.wj-collapsible');

      if (!details) {
        console.warn('[FTML collapsible] Bottom button has no parent details', button);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      details.open = !details.open;
    },
    true
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      const button = event.target.closest(
        '.wj-collapsible-button-bottom, wj-collapsible-button-bottom'
      );

      if (!button) {
        return;
      }

      const pageContent = document.getElementById('page-content');

      if (!pageContent || !pageContent.contains(button)) {
        return;
      }

      const details = button.closest('details.wj-collapsible');

      if (!details) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      details.open = !details.open;
    },
    true
  );
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

function detectThemeInclude(source = '') {
  const raw = String(source || '');

  const includeRegex = /\[\[include\s+([^\]\s]+)(?:\s+[^\]]*)?\]\]/gi;

  let match;
  while ((match = includeRegex.exec(raw)) !== null) {
    const includeTarget = String(match[1] || '')
      .trim()
      .replace(/^:/, '')
      .toLowerCase();

    if (includeTarget.includes('theme:')) {
      return includeTarget;
    }
  }

  return null;
}

function getThemeForItem(item = {}) {
  const source = item.raw_source || item.raw_content || '';
  const includeTarget = detectThemeInclude(source);

  if (!includeTarget) {
    return resolveTheme('');
  }

  return resolveTheme(includeTarget);
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

function installFootnoteTooltipPositioning() {
  if (window.__footnoteTooltipPositioningInstalled) {
    return;
  }

  window.__footnoteTooltipPositioningInstalled = true;

  function positionTooltip(ref) {
    const tooltip = ref.querySelector('.wj-footnote-ref-tooltip');

    if (!tooltip) {
      return;
    }

    tooltip.style.left = '50%';
    tooltip.style.right = 'auto';
    tooltip.style.transform = 'translateX(-50%)';

    const article = document.getElementById('page-content');

    if (!article) {
      return;
    }

    const articleRect = article.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const overflowLeft = articleRect.left - tooltipRect.left + 12;
    const overflowRight = tooltipRect.right - articleRect.right + 12;

    if (overflowLeft > 0) {
      tooltip.style.left = `calc(50% + ${overflowLeft}px)`;
    } else if (overflowRight > 0) {
      tooltip.style.left = `calc(50% - ${overflowRight}px)`;
    }
  }

  document.addEventListener(
    'mouseover',
    (event) => {
      const ref = event.target.closest('.wj-footnote-ref');

      if (!ref) {
        return;
      }

      requestAnimationFrame(() => {
        positionTooltip(ref);
      });
    },
    true
  );

  document.addEventListener(
    'focusin',
    (event) => {
      const ref = event.target.closest('.wj-footnote-ref');

      if (!ref) {
        return;
      }

      requestAnimationFrame(() => {
        positionTooltip(ref);
      });
    },
    true
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

  //ensureDir(absDir);

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

function showOfflineEditor() {
  if (!offlineEditorPanel) return;

  offlineEditorPanel.hidden = false;

  if (pageTitle) {
    pageTitle.textContent = 'Offline Wikidot Editor';
  }

  if (appMeta) {
    appMeta.innerHTML = '<div>Preview Wikidot/FTML source locally.</div>';
  }

  if (pageContent) {
    pageContent.hidden = true;
  }

  if (imageStrip) {
    imageStrip.hidden = true;
  }

  if (offlineEditorSource && !offlineEditorSource.value.trim()) {
    offlineEditorSource.value = [
      '+ Offline Editor Test',
      '',
      '**Item #:** SCP-XXXX',
      '',
      '**Object Class:** Safe',
      '',
      '[[include component:image-block name=example.jpg|caption=Example image|width=300px]]',
      '',
      'This is //italic// and **bold** text.',
      '',
      '[[collapsible show="+ Open" hide="- Close"]]',
      'Hidden text.',
      '[[/collapsible]]'
    ].join('\n');
  }

  if (offlineStatus) {
    offlineStatus.textContent = '';
  }

  offlineEditorSource?.focus();
}

function hideOfflineEditor() {
  if (!offlineEditorPanel) return;

  offlineEditorPanel.hidden = true;

  if (pageContent) {
    pageContent.hidden = false;
  }

  if (imageStrip) {
    imageStrip.hidden = false;
  }

  if (currentEntry) {
    renderArticle(currentEntry, { pushHistory: false }).catch(console.error);
  }
}

async function previewOfflineEditorSource() {
  if (!offlineEditorSource || !offlineEditorPreview) return;

  const source = offlineEditorSource.value || '';

  if (!source.trim()) {
    offlineEditorPreview.innerHTML = '<p class="muted">Enter Wikidot source to preview.</p>';
    return;
  }

  previewOfflineEditorBtn.disabled = true;
  offlineEditorPreview.innerHTML = '<p class="muted">Rendering preview...</p>';

  try {
    const result = await window.scpApp.renderFtmlPreview(source);
    console.log('[offline-editor-preview-result]', result);

    const rawHtml =
      typeof result === 'string'
        ? result
        : result?.html ||
          result?.output ||
          result?.rendered ||
          result?.renderedHtml ||
          result?.body ||
          '';

    offlineEditorPreview.innerHTML = sanitizeHtml(rawHtml, {
      key: 'offline-editor-preview',
      originalKey: 'offline-editor-preview',
      title: 'Offline Editor Preview',
      link: 'offline-editor-preview',
      url: '',
      raw_content: rawHtml,
      raw_source: source,
      images: []
    });

    wireLinks(offlineEditorPreview);
    wireCollapsibles(offlineEditorPreview);

    if (typeof wireFtmlCollapsibles === 'function') {
      wireFtmlCollapsibles(offlineEditorPreview);
    }
  } catch (err) {
    console.error('FTML preview failed:', err);

    offlineEditorPreview.innerHTML = `
      <div class="editor-error">
        <strong>Preview failed.</strong>
        <pre>${escapeHtml(err.message || String(err))}</pre>
      </div>
    `;
  } finally {
    previewOfflineEditorBtn.disabled = false;
  }
}

function clearOfflineEditor() {
  if (offlineEditorSource) {
    offlineEditorSource.value = '';
  }

  if (offlineEditorPreview) {
    offlineEditorPreview.innerHTML = '<p class="muted">Preview output will appear here.</p>';
  }
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

async function injectComponentImageBlocks(root, item) {
  if (!root || !item) return;

  const blocks = getComponentImageBlocks(item);

  if (!blocks.length) return;

  // Avoid injecting duplicates if FTML did render the image.
  const existingSrcs = new Set(
    [...root.querySelectorAll('img[src]')].map((img) =>
      normalizeUrl(img.getAttribute('src') || '')
    )
  );

  const wrapper = document.createElement('div');
  wrapper.className = 'offline-component-image-blocks';

  for (const block of blocks) {
    const remoteUrl = normalizeUrl(block.url);

    if (!remoteUrl || existingSrcs.has(remoteUrl)) {
      continue;
    }

    const figure = document.createElement('figure');
    figure.className = 'offline-component-image-block';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.dataset.originalSrc = remoteUrl;

    try {
      img.src = await resolveCachedSrc(remoteUrl, item);
    } catch {
      img.src = remoteUrl;
    }

    if (block.width) {
      img.style.maxWidth = block.width;
    }

    img.addEventListener('click', () => {
      openLocalOrRemoteImage(img.src, remoteUrl);
    });

    figure.appendChild(img);

    if (block.caption) {
      const caption = document.createElement('figcaption');
      caption.textContent = block.caption;
      figure.appendChild(caption);
    }

    wrapper.appendChild(figure);
  }

  if (!wrapper.childNodes.length) return;

  const firstHeading = root.querySelector('h1, h2, h3');
  const firstParagraph = root.querySelector('p');

  if (firstHeading && firstHeading.nextSibling) {
    firstHeading.parentNode.insertBefore(wrapper, firstHeading.nextSibling);
  } else if (firstParagraph) {
    firstParagraph.parentNode.insertBefore(wrapper, firstParagraph);
  } else {
    root.prepend(wrapper);
  }
}

function getEntryImageUrls(item) {
  const urls = new Set();

  if (Array.isArray(item.images)) {
    for (const src of item.images) {
      const normalized = normalizeUrl(src);
      if (normalized) urls.add(normalized);
    }
  }

  for (const block of getComponentImageBlocks(item)) {
    const normalized = normalizeUrl(block.url);

    if (normalized && !/^data:image\//i.test(normalized)) {
      urls.add(normalized);
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

/*
function stopSpeech() {
  speechSynthesis.cancel();
  pauseBtn.textContent = 'Pause';
}
*/

async function loadAllJsonFiles() {
  const loadedFiles = await window.scpApp.loadContent();

  if (!Array.isArray(loadedFiles) || !loadedFiles.length) {
    throw new Error('No content_*.json files found.');
  }

  const merged = [];

  for (const file of loadedFiles) {
    const group = file.file.replace(/\.json$/i, '');
    const groupLabel = prettifyGroupName(file.file);
    const parsed = file.data;

    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;

      merged.push({
        key: `${group}::${key}`,
        originalKey: key,
        title: value.title || key,
        creator: value.creator || value.attributions?.[0] || 'Unknown',
        attributions: Array.isArray(value.attributions) ? value.attributions : [],
        tags: Array.isArray(value.tags) ? value.tags : [],
        images: Array.isArray(value.images) ? value.images : [],
        url: normalizeUrl(value.url || ''),
        link: value.link || key,
        raw_content: value.raw_content || value.raw_source || '',
        raw_source: value.raw_source || '',
        rating: value.rating ?? 'N/A',
        createdAt: value.createdAt || null,
        children: Array.isArray(value.children) ? value.children : [],
        group,
        groupLabel,
        sourceFile: file.file,
        scpNumber: extractScpNumber(value.title || '', key)
      });
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

function getComponentImageBlocks(item = {}) {
  const blocks = [];
  const rawSource = String(item.raw_source || '');

  const pageSlug = String(
    item.link ||
    item.originalKey ||
    item.key ||
    item.title ||
    ''
  )
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^\/+/, '')
    .replace(/[?#].*$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!pageSlug) return blocks;

  const includeRegex = /\[\[include\s+(?::scp-wiki:)?component:image-block\s+([^\]]+)\]\]/gi;
  let match;

  while ((match = includeRegex.exec(rawSource)) !== null) {
    const argsText = match[1] || '';
    const args = {};

    for (const part of argsText.split('|')) {
      const [rawKey, ...rawValueParts] = part.split('=');
      const key = String(rawKey || '').trim();
      const value = rawValueParts.join('=').trim();

      if (key && value) {
        args[key] = value;
      }
    }

    if (!args.name) continue;

    const filename = args.name.trim();

    blocks.push({
      url: `https://scp-wiki.wdfiles.com/local--files/${pageSlug}/${filename}`,
      filename,
      caption: args.caption || '',
      width: args.width || ''
    });
  }

  return blocks;
}

/*
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
*/

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
      <!--
      <div class="scp-link-sub">${escapeHtml(item.groupLabel)}</div>
      -->
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
  // stopSpeech();

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
  wireFtmlCollapsibles(pageContent);

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

if (window.scpApp?.onCromSyncLog) {
  window.scpApp.onCromSyncLog((payload) => {
    if (payload.level === 'error') {
      console.error(`[Crom sync] ${payload.message}`, payload.progress || payload.result || '');
    } else {
      console.log(`[Crom sync] ${payload.message}`, payload.progress || payload.result || '');
    }
  });
}

async function init() {
  try {
    await loadAllJsonFiles();

    // buildGroupDropdown();
    installFtmlCollapsibleHandler();
    installFootnoteTooltipPositioning();

    /*
    groupSelect.addEventListener('change', () => {
      currentGroup = groupSelect.value;
      applyFilters();
    });
    */

    searchInput.addEventListener('input', applyFilters);
    
    /*
    speakBtn.addEventListener('click', speakCurrentArticle);
    pauseBtn.addEventListener('click', pauseOrResumeSpeech);
    stopBtn.addEventListener('click', stopSpeech);
    */

    const syncBtn = document.getElementById('syncCromBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', syncCromDebug);
    }

    if (downloadCompressedBtn) {
      downloadCompressedBtn.addEventListener('click', () => {
        cacheCurrentPage();
      });
    } 

    if (refreshOfflineBtn) {
      refreshOfflineBtn.addEventListener('click', () => {
        cacheAllPagesCompressed();
      });
    }

    if (downloadHdBtn) {
      downloadHdBtn.addEventListener('click', () => {
        cacheAllPagesCompressed();
      });
    }

    if (offlineEditorToolBtn) {
      offlineEditorToolBtn.addEventListener('click', showOfflineEditor);
    }

    if (closeOfflineEditorBtn) {
      closeOfflineEditorBtn.addEventListener('click', hideOfflineEditor);
    }

    if (previewOfflineEditorBtn) {
      previewOfflineEditorBtn.addEventListener('click', () => {
        previewOfflineEditorSource().catch(console.error);
      });
    }

    if (clearOfflineEditorBtn) {
      clearOfflineEditorBtn.addEventListener('click', clearOfflineEditor);
    }

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

async function syncCromDebug() {
  const syncBtn = document.getElementById('syncCromBtn');
  const oldText = syncBtn ? syncBtn.textContent : '';

  try {
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing...';
    }

    appMeta.textContent = 'Syncing from Crom. Existing data remains available if this fails.';

    const result = await window.scpApp.syncCromScp();

    await loadAllJsonFiles();
    // buildGroupDropdown();
    applyFilters();

    if (filteredEntries.length) {
      renderArticle(filteredEntries[0], { pushHistory: false });
    }

    appMeta.textContent = `Crom sync complete: ${result.articleCount} articles saved.`;
  } catch (err) {
    console.error('Crom sync failed:', err);
    appMeta.textContent = `Crom sync failed. Continuing with existing local data. ${err.message || err}`;
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.textContent = oldText || 'Sync Crom';
    }
  }
}

// window.addEventListener('beforeunload', stopSpeech);

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

// ---- Image-cache runtime IPC overrides ----
// Image caching is handled by the Electron main process.
// The renderer never touches fs/path/http/https/crypto/sharp directly.

function getEntryImageUrls(item) {
  const urls = new Set();

  if (Array.isArray(item?.images)) {
    for (const src of item.images) {
      const normalized = normalizeUrl(src);
      if (normalized) urls.add(normalized);
    }
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(item?.raw_content || '', 'text/html');

    doc.querySelectorAll('img[src]').forEach((img) => {
      const normalized = normalizeUrl(img.getAttribute('src') || '');
      if (normalized) urls.add(normalized);
    });

    doc.querySelectorAll('source[srcset], img[srcset]').forEach((el) => {
      const srcset = el.getAttribute('srcset') || '';

      for (const candidate of srcset.split(',')) {
        const normalized = normalizeUrl(candidate.trim().split(/\s+/)[0]);
        if (normalized) urls.add(normalized);
      }
    });
  } catch {
    // Ignore malformed article HTML.
  }

  const rawSource = String(item?.raw_source || '');

  const absoluteImageRegex =
    /https?:\/\/[^\s"'<>|\]]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s"'<>|\]]*)?/gi;

  let match;

  while ((match = absoluteImageRegex.exec(rawSource)) !== null) {
    const normalized = normalizeUrl(match[0]);
    if (normalized) urls.add(normalized);
  }

  return [...urls];
}

async function resolveCachedSrc(src, item) {
  const normalized = normalizeUrl(src);

  if (!normalized || !item || !window.scpApp?.resolveCachedImage) {
    return normalized;
  }

  try {
    const cached = await window.scpApp.resolveCachedImage(normalized, {
      originalKey: item.originalKey,
      title: item.title,
      link: item.link,
      url: item.url,
      key: item.key
    });

    return cached || normalized;
  } catch (err) {
    console.warn('Failed to resolve cached image:', normalized, err);
    return normalized;
  }
}

function sanitizeHtml(rawHtml = '', item = null) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  doc.querySelectorAll('script, iframe, object, embed').forEach((el) => {
    el.remove();
  });

  doc.querySelectorAll('.preview').forEach((el) => {
    el.remove();
  });

  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value || '';

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      }

      if (
        (name === 'href' || name === 'src') &&
        value.trim().toLowerCase().startsWith('javascript:')
      ) {
        el.removeAttribute(attr.name);
      }
    });
  });

  doc.querySelectorAll('a[href]').forEach((a) => {
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

  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = normalizeUrl(img.getAttribute('src') || '');

    if (src) {
      img.setAttribute('src', src);
      img.dataset.originalSrc = src;
    }

    img.setAttribute('loading', 'lazy');
  });

  const page = doc.querySelector('#page-content');
  return page ? page.innerHTML : doc.body.innerHTML;
}

async function applyCachedImages(root, item) {
  if (!root || !item) return;

  const images = [...root.querySelectorAll('img[src]')];

  await Promise.all(
    images.map(async (img) => {
      const originalSrc = img.dataset.originalSrc || img.getAttribute('src') || '';
      const resolved = await resolveCachedSrc(originalSrc, item);

      if (resolved) {
        img.setAttribute('src', resolved);
      }

      img.addEventListener('click', () => {
        openLocalOrRemoteImage(resolved || originalSrc, originalSrc);
      });
    })
  );
}

function wireLinks(root) {
  root.querySelectorAll('a[href]').forEach((a) => {
    if (a.dataset.wired === 'true') return;

    a.dataset.wired = 'true';

    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href') || '';
      const offlineKey = a.dataset.offlineKey || '';

      if (offlineKey) {
        const item = entries.find((entry) => entry.key === offlineKey);

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

        const target =
          document.getElementById(id) ||
          pageContent.querySelector(`[id="${CSS.escape(id)}"]`);

        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        return;
      }

      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        window.scpApp.openExternal(href);
      }
    });
  });
}

function openLocalOrRemoteImage(displayedSrc, originalSrc = '') {
  const src = displayedSrc || originalSrc || '';
  const remoteUrl = normalizeUrl(originalSrc || displayedSrc || '');

  if (/^file:/i.test(src)) {
    // Convert only file:// URLs generated by the main process back to a path
    // for shell.openPath. If this fails, do nothing.
    try {
      const url = new URL(src);
      const filePath = decodeURIComponent(url.pathname);

      if (navigator.platform.toLowerCase().includes('win')) {
        window.scpApp.openPath(filePath.replace(/^\/([a-zA-Z]:)/, '$1'));
      } else {
        window.scpApp.openPath(filePath);
      }
    } catch (err) {
      console.warn('Failed to open cached image:', src, err);
    }

    return;
  }

  if (/^https?:\/\//i.test(remoteUrl)) {
    window.scpApp.openExternal(remoteUrl);
  }
}

async function renderImages(images) {
  imageStrip.innerHTML = '';

  if (!Array.isArray(images) || !images.length) {
    return;
  }

  for (const src of images) {
    const normalized = normalizeUrl(src);
    if (!normalized) continue;

    const img = document.createElement('img');
    img.src = await resolveCachedSrc(normalized, currentEntry);
    img.loading = 'lazy';

    img.addEventListener('click', () => {
      openLocalOrRemoteImage(img.src, normalized);
    });

    imageStrip.appendChild(img);
  }
}

async function updateOfflineStatus(item) {
  if (!item) {
    offlineStatus.textContent = '';
    return;
  }

  const urls = getEntryImageUrls(item);

  if (!urls.length) {
    offlineStatus.textContent = 'No images detected for this page.';
    return;
  }

  let cached = 0;

  for (const url of urls) {
    const resolved = await resolveCachedSrc(url, item);

    if (/^file:/i.test(resolved)) {
      cached += 1;
    }
  }

  offlineStatus.textContent = `Offline images available: ${cached}/${urls.length}`;
}

async function getRenderedArticleHtml(item = {}) {
  // Prefer already-rendered HTML if present.
  if (item.raw_content && item.raw_content.trim()) {
    return item.raw_content;
  }

  // Fall back to raw Wikidot source from Crom.
  const source = item.raw_source || '';

  if (!source.trim()) {
    return '<p><em>No article content available.</em></p>';
  }

  // Use the existing FTML render bridge.
  if (!window.scpApp || typeof window.scpApp.renderFtml !== 'function') {
    console.error('[render] window.scpApp.renderFtml is unavailable');
    return '<p><em>Renderer unavailable.</em></p>';
  }

  try {
    return await window.scpApp.renderFtml(source);
  } catch (err) {
    console.error('[render] Failed to render FTML source:', err);
    return `<pre>${escapeHtml(source)}</pre>`;
  }
}

async function renderArticle(item, options = {}) {
  const { pushHistory = true } = options;

  currentEntry = item;

  const activeTheme = getThemeForItem(item);
  console.log('[theme]', activeTheme);
  applyArticleTheme(activeTheme);

  const tags =
    Array.isArray(item.tags) && item.tags.length
      ? item.tags.join(', ')
      : 'None';

  const safeHtml = sanitizeHtml(item.raw_content || '', item);

  pageTitle.textContent = item.title || item.originalKey;

  appMeta.innerHTML = `
    <div><strong>Author:</strong> ${escapeHtml(item.creator || 'Unknown')}</div>
    <div><strong>URL:</strong> ${
      item.url ? `<a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a>` : 'N/A'
    }</div>
    <div><strong>Tags:</strong> ${escapeHtml(tags)}</div>
    <div><strong>Rating:</strong> ${escapeHtml(String(item.rating ?? 'N/A'))}</div>
  `;

  await renderImages(item.images);

  pageContent.innerHTML = safeHtml;

  // await injectComponentImageBlocks(pageContent, item);

  wireLinks(appMeta);
  wireLinks(pageContent);
  wireCollapsibles(pageContent);

  if (typeof wireFtmlCollapsibles === 'function') {
    wireFtmlCollapsibles(pageContent);
  }

  await applyCachedImages(pageContent, item);
  await updateOfflineStatus(item);

  if (pushHistory) {
    updateHistory(item);
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function cacheCurrentPage() {
  if (!currentEntry) {
    await updateOfflineStatus(currentEntry);
    return;
  }

  if (!window.scpApp?.cacheAllImages) {
    offlineStatus.textContent = 'Image cache API is unavailable.';
    return;
  }

  downloadCompressedBtn.disabled = true;
  downloadHdBtn.disabled = true;
  refreshOfflineBtn.disabled = true;

  offlineStatus.textContent = 'Caching images. This currently caches all missing images.';

  try {
    await window.scpApp.cacheAllImages();

    await renderArticle(currentEntry, { pushHistory: false });
  } catch (err) {
    console.error('Image cache failed:', err);
    offlineStatus.textContent = `Image cache failed: ${err.message || err}`;
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

  if (!window.scpApp?.cacheAllImages) {
    offlineStatus.textContent = 'Image cache API is unavailable.';
    return;
  }

  downloadCompressedBtn.disabled = true;
  downloadHdBtn.disabled = true;
  refreshOfflineBtn.disabled = true;

  try {
    offlineStatus.textContent = 'Preparing image cache...';

    const summary = await window.scpApp.cacheAllImages();

    offlineStatus.textContent =
      `Image cache complete: ${summary.cached} cached, ` +
      `${summary.skipped} skipped, ${summary.failed} failed.`;

    if (currentEntry) {
      await renderArticle(currentEntry, { pushHistory: false });
    }
  } catch (err) {
    console.error('Image cache failed:', err);
    offlineStatus.textContent = `Image cache failed: ${err.message || err}`;
  } finally {
    downloadCompressedBtn.disabled = false;
    downloadHdBtn.disabled = false;
    refreshOfflineBtn.disabled = false;
  }
}

if (window.scpApp?.onImageCacheProgress) {
  window.scpApp.onImageCacheProgress((progress) => {
    if (!offlineStatus) return;

    if (progress.type === 'start') {
      offlineStatus.textContent = `Caching images: found ${progress.total}.`;
    }

    if (progress.type === 'progress') {
      offlineStatus.textContent =
        `Caching images: ${progress.index}/${progress.total} | ` +
        `cached ${progress.cached}, skipped ${progress.skipped}, failed ${progress.failed}`;
    }

    if (progress.type === 'done') {
      offlineStatus.textContent =
        `Image cache complete: ${progress.cached} cached, ` +
        `${progress.skipped} skipped, ${progress.failed} failed.`;
    }

    if (progress.type === 'cancelled') {
      offlineStatus.textContent =
        `Image cache cancelled: ${progress.cached} cached, ` +
        `${progress.skipped} skipped, ${progress.failed} failed.`;
    }
  });
}

init();