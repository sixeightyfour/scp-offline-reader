let ftmlModulePromise = null;

const defaultComponents = require('./default_components');
const { expandIncludes } = require('./include_preprocessor');

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

function safePageSlug(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^\/+/, '')
    .replace(/[?#].*$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parsePipeArgs(argsText = '') {
  const args = {};

  for (const part of String(argsText).split('|')) {
    const [rawKey, ...rawValueParts] = part.split('=');
    const key = String(rawKey || '').trim();
    const value = rawValueParts.join('=').trim();

    if (!key) continue;

    // Wikidot include defaults often appear as duplicate params:
    // width={$width}|width=300px
    // align={$align}|align=right
    //
    // Keep the first concrete value. If the existing value is unresolved
    // like {$width}, allow a later concrete default to replace it.
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

function isUnresolvedVariable(value = '') {
  return /^\{\$[^}]+\}$/.test(String(value).trim());
}

function cleanIncludeValue(value = '', fallback = '') {
  const trimmed = String(value || '').trim();

  if (!trimmed || isUnresolvedVariable(trimmed)) {
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

function buildImageBlockReplacement(args, pageSlug) {
  const name = cleanIncludeValue(args.name);
  if (!name) return '';

  const imageUrl = resolveImageBlockName(name, pageSlug);
  if (!imageUrl) return '';

  const caption = cleanIncludeValue(args.caption);
  const width = cleanIncludeValue(args.width, '300px');
  const align = cleanIncludeValue(args.align, 'right');
  const link = cleanIncludeValue(args.link, '#');
  const altText =
    cleanIncludeValue(args['alt-text']) ||
    cleanIncludeValue(args.alt) ||
    caption ||
    '';

  const safeAlign = align.replace(/[^a-zA-Z0-9_-]/g, '') || 'right';

  const imageArgs = [];

  imageArgs.push(imageUrl);

  if (altText) {
    imageArgs.push(`alt="${altText.replace(/"/g, '&quot;')}"`);
  }

  if (link) {
    imageArgs.push(`link="${link.replace(/"/g, '&quot;')}"`);
  }

  return [
    `[[div class="scp-image-block block-${safeAlign}" style="width:${width};"]]`,
    `[[image ${imageArgs.join(' ')}]]`,
    `[[div class="scp-image-caption"]]`,
    caption,
    `[[/div]]`,
    `[[/div]]`
  ].join('\n');
}

function expandImageBlockIncludes(source = '', info = {}) {
  const pageSlug = safePageSlug(
    info.page ||
    info.slug ||
    info.key ||
    info.link ||
    info.url ||
    ''
  );

  if (!pageSlug) return source;

  let output = String(source || '');

  // Common direct include:
  // [[include component:image-block name=foo.jpg|caption=Foo]]
  output = output.replace(
    /\[\[include\s+(?::scp-wiki:)?component:image-block\s+([^\]]+)\]\]/gi,
    (_match, argsText) => {
      const args = parsePipeArgs(argsText);
      return buildImageBlockReplacement(args, pageSlug);
    }
  );

  // Less common direct include of the base component:
  // [[include :scp-wiki:component:image-block-base name=foo.jpg|...]]
  output = output.replace(
    /\[\[include\s+(?::scp-wiki:)?component:image-block-base\s+([^\]]+)\]\]/gi,
    (_match, argsText) => {
      const args = parsePipeArgs(argsText);
      return buildImageBlockReplacement(args, pageSlug);
    }
  );

  return output;
}

function normalizeFtmlSource(source, info = {}) {
  if (typeof source !== 'string') return '';

  return expandImageBlockIncludes(source, info)
    .replace(/\\\r?\n/g, ' ')
    .replace(/\[\[include\s+:scp-wiki:theme:[^\]]+\]\]/gi, '')
    .replace(/\[\[include\s+:scp-wiki:component:(?!image-block\b)(?!image-block-base\b)[^\]]+\]\]/gi, '')
    .replace(/\[\[include\s+component:(?!image-block\b)(?!image-block-base\b)[^\]]+\]\]/gi, '');
}


async function renderWikidotSourceToHtml(source, info = {}) {
  const ftml = await getFtml();

  const pageSlug = safePageSlug(
    info.page ||
    info.slug ||
    info.key ||
    info.link ||
    info.url ||
    ''
  );

  const includeStore = {
    ...defaultComponents,
    ...(info.includeStore || {})
  };

  const sourceWithIncludes = expandIncludes(source, includeStore, {
    pageSlug,
    page: pageSlug,
    site: info.site || 'scp-wiki'
  });

  const cleanSource = normalizeFtmlSource(sourceWithIncludes, info);

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