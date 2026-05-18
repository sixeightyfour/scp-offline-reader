let ftmlModulePromise = null;

function ensureBrowserishGlobals() {
  if (!globalThis.location) {
    globalThis.location = {
      href: 'file:///ftml-node',
      origin: 'file://',
      protocol: 'file:',
      host: '',
      hostname: '',
      pathname: '/ftml-node'
    };
  }
}

async function getFtml() {
  ensureBrowserishGlobals();

  if (!ftmlModulePromise) {
    ftmlModulePromise = import('@r74tech/ftml-wasm').then(async (ftml) => {
      if (typeof ftml.init === 'function' && !ftml.ready) {
        await ftml.init();
      }

      return ftml;
    });
  }

  return ftmlModulePromise;
}

function stripPageWrapper(html) {
  if (typeof html !== 'string') return '';

  return html
    .replace(/^<wj-body\b[^>]*>/i, '')
    .replace(/<\/wj-body>$/i, '')
    .replace(/<p>TODO:\s*module\s+[^<]+<\/p>/gi, '')
    .replace(/<div class="wj-align-right">\s*<\/div>/gi, '')
    .replace(/<div class="wj-align-left">\s*<\/div>/gi, '')
    .replace(/<div class="wj-align-center">\s*<\/div>/gi, '');
}

function normalizeFtmlSource(source) {
  if (typeof source !== 'string') return '';

  return source
    // Remove Windows/Unix line-continuation markers before FTML parses the source.
    // Wikidot commonly uses a trailing backslash to continue text on the next line.
    // If left in place, FTML can split blockquotes/lists/paragraphs incorrectly.
    .replace(/\\\r?\n/g, ' ')

    // Remove theme/component includes that are useful on Wikidot but not inside the offline reader.
    // FTML may render some includes as placeholders/errors unless an includer is configured.
    .replace(/\[\[include\s+:scp-wiki:theme:[^\]]+\]\]/gi, '')
    .replace(/\[\[include\s+:scp-wiki:component:[^\]]+\]\]/gi, '')
    .replace(/\[\[include\s+component:[^\]]+\]\]/gi, '');
}


async function renderWikidotSourceToHtml(source, info = {}) {
  const ftml = await getFtml();

  const cleanSource = normalizeFtmlSource(source);

  const pageInfo = {
    page: info.page || info.slug || info.key || 'unknown',
    site: info.site || 'scp-wiki',
    title: info.title || info.page || info.slug || 'Untitled',
    score: Number.isFinite(Number(info.score))
      ? Number(info.score)
      : Number.isFinite(Number(info.rating))
        ? Number(info.rating)
        : 0,
    rating: Number.isFinite(Number(info.rating))
      ? Number(info.rating)
      : Number.isFinite(Number(info.score))
        ? Number(info.score)
        : 0,
    tags: Array.isArray(info.tags) ? info.tags : [],
    language: info.language || 'en'
  };

  const result = ftml.renderHTML(cleanSource, pageInfo, 'page');

  return {
    html: stripPageWrapper(result.html || ''),
    meta: result.meta || [],
    backlinks: result.backlinks || {}
  };
}

module.exports = {
  renderWikidotSourceToHtml
};