const DEFAULT_SITE = 'scp-wiki';

function normalizeComponentKey(site = DEFAULT_SITE, page = '') {
  let value = String(page || '').trim();

  value = value.replace(/^:/, '');

  if (value.startsWith(`${site}:`)) {
    value = value.slice(site.length + 1);
  }

  return value.toLowerCase();
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

function parseIncludeTarget(target = '') {
  let value = String(target || '').trim();

  if (value.startsWith(':')) {
    value = value.slice(1);
  }

  const parts = value.split(':');

  if (parts.length >= 3) {
    return {
      site: parts[0],
      page: `${parts[1]}:${parts.slice(2).join(':')}`
    };
  }

  return {
    site: DEFAULT_SITE,
    page: value
  };
}

function substituteVariables(source = '', params = {}) {
  return String(source || '').replace(/\{\$([a-zA-Z0-9_-]+)\}/g, (_match, name) => {
    const value = params[name];

    if (value === undefined || value === null || value === '') {
      return '';
    }

    return String(value);
  });
}

function cleanupExpandedInclude(source = '') {
  return String(source || '')
    // Remove broken empty attribute fragments caused by:
    // {$alt}="{$alt-text}" when alt and alt-text are absent.
    .replace(/\s+=""(?=\s|\])/g, '')

    .replace(/\s+alt=""(?=\s|\])/g, '')

    // Normalize link=# to quoted link. This is safer for FTML parsing.
    .replace(/\blink=#(?=\s|\])/g, 'link="#"')

    // Remove empty link attributes if one ever appears.
    .replace(/\s+link=""(?=\s|\])/g, '');
}

function resolveImageNames(source = '', context = {}) {
  const pageSlug = context.pageSlug || context.page || '';

  if (!pageSlug) return source;

  return String(source || '').replace(
    /\[\[image\s+([^\s\]]+)([^\]]*)\]\]/gi,
    (match, rawName, rest) => {
      const name = String(rawName || '').trim();

      if (!name || /^\{\$[^}]+\}$/.test(name)) {
        return match;
      }

      if (/^https?:\/\//i.test(name)) {
        return match;
      }

      if (name.startsWith('//')) {
        return `[[image https:${name}${rest}]]`;
      }

      if (name.startsWith('/local--files/')) {
        return `[[image https://scp-wiki.wdfiles.com${name}${rest}]]`;
      }

      if (name.startsWith('/')) {
        return `[[image https://scp-wiki.wikidot.com${name}${rest}]]`;
      }

      return `[[image https://scp-wiki.wdfiles.com/local--files/${pageSlug}/${name}${rest}]]`;
    }
  );
}

function expandIncludes(source = '', includeStore = {}, context = {}, depth = 0) {
  if (depth > 10) {
    return source;
  }

  const includeRegex = /\[\[include\s+([^\s\]]+)([^\]]*)\]\]/gi;

  return String(source || '').replace(includeRegex, (fullMatch, rawTarget, rawArgs) => {
    const target = parseIncludeTarget(rawTarget);
    const key = normalizeComponentKey(target.site, target.page);
    const record = includeStore[key];

    if (!record || !record.source) {
      return fullMatch;
    }

    const params = parsePipeArgs(rawArgs || '');

    let expanded = substituteVariables(record.source, params);

    expanded = cleanupExpandedInclude(expanded);

    expanded = expandIncludes(expanded, includeStore, context, depth + 1);

    expanded = resolveImageNames(expanded, context);

    expanded = cleanupExpandedInclude(expanded);

    return expanded;
  });
}

module.exports = {
  parsePipeArgs,
  parseIncludeTarget,
  normalizeComponentKey,
  substituteVariables,
  resolveImageNames,
  expandIncludes
};