const fs = require('fs');
const path = require('path');

const { renderWikidotSourceToHtml } = require('./ftml_render');

const CROM_ENDPOINT = 'https://api.crom.avn.sh/graphql';

// Change these back to your full range when ready.
const START = 2;
const END = 10;

const BATCH_SIZE = 15;
const REQUEST_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scpSlug(n) {
  return n < 1000 ? `scp-${String(n).padStart(3, '0')}` : `scp-${n}`;
}

function scpUrl(n) {
  return `http://scp-wiki.wikidot.com/${scpSlug(n)}`;
}

function sanitizeUnusualLineTerminators(value) {
  if (typeof value === 'string') {
    return value.replace(/\u2028/g, '\n').replace(/\u2029/g, '\n');
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeUnusualLineTerminators);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        sanitizeUnusualLineTerminators(val)
      ])
    );
  }

  return value;
}

function buildBatchQuery(numbers) {
  const parts = numbers.map((n) => {
    const alias = `p${String(n).padStart(4, '0')}`;
    const url = scpUrl(n);

    return `
      ${alias}: page(url: "${url}") {
        url
        attributions {
          user {
            name
          }
        }
        wikidotInfo {
          title
          rating
          createdAt
          tags
          source
          children {
            url
            wikidotInfo {
              source
            }
          }
        }
      }
    `;
  });

  return `query SCPBatch {\n${parts.join('\n')}\n}`;
}

async function cromApiRequest(query) {
  const response = await fetch(CROM_ENDPOINT, {
    method: 'POST',
    headers: {
      'User-Agent': 'scp-offline-reader local debug sync',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error(`Crom returned HTTP ${response.status}`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(`Crom GraphQL error: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data;
}

function normalizeAttributions(rawAttributions) {
  if (!Array.isArray(rawAttributions) || rawAttributions.length === 0) {
    return ['Unknown user'];
  }

  const names = [];

  for (const item of rawAttributions) {
    const name = item?.user?.name;

    if (name && typeof name === 'string') {
      names.push(name.trim());
    }
  }

  const deduped = [...new Set(names.filter(Boolean))];

  return deduped.length ? deduped : ['Unknown user'];
}

async function renderSourceForPage(source, pageInfo) {
  if (!source || typeof source !== 'string') {
    return '';
  }

  try {
    const rendered = await renderWikidotSourceToHtml(source, pageInfo);
    return rendered.html || '';
  } catch (err) {
    console.warn('[Crom sync] FTML render failed; storing empty raw_content', {
      page: pageInfo.page,
      title: pageInfo.title,
      error: err && (err.stack || err.message || String(err))
    });

    return '';
  }
}

async function normalizePage(n, page) {
  if (!page?.wikidotInfo) return null;

  const info = page.wikidotInfo;
  const slug = scpSlug(n);
  const attributions = normalizeAttributions(page.attributions);
  const creator = attributions[0] || 'Unknown user';
  const tags = Array.isArray(info.tags) ? info.tags : [];
  const rating = info.rating ?? 0;
  const rawSource = info.source || '';

  const pageInfo = {
    page: slug,
    site: 'scp-wiki',
    title: info.title || slug.toUpperCase(),
    score: Number.isFinite(Number(rating)) ? Number(rating) : 0,
    rating: Number.isFinite(Number(rating)) ? Number(rating) : 0,
    tags,
    language: 'en'
  };

  const rawContent = await renderSourceForPage(rawSource, pageInfo);

  return {
    title: info.title || slug.toUpperCase(),
    creator,
    attributions,
    tags,
    images: [],
    url: page.url || scpUrl(n),
    link: slug,

    // Rendered HTML for the Electron reader.
    raw_content: rawContent,

    // Original Crom/Wikidot source for debugging or future conversion.
    raw_source: rawSource,

    content_format: rawContent ? 'ftml-html' : 'wikidot-source-unrendered',

    rating: info.rating ?? 'N/A',
    createdAt: info.createdAt || null,

    children: Array.isArray(info.children)
      ? info.children
          .map((child) => ({
            url: child?.url || '',
            raw_source: child?.wikidotInfo?.source || ''
          }))
          .filter((child) => child.url || child.raw_source)
      : []
  };
}

async function fetchScpDataset({ onProgress } = {}) {
  const output = {};
  const numbers = [];

  for (let n = START; n <= END; n += 1) {
    numbers.push(n);
  }

  console.log(`[Crom sync] Starting SCP sync: ${START} through ${END}`);
  console.log(`[Crom sync] Batch size: ${BATCH_SIZE}`);
  console.log(`[Crom sync] Total requested pages: ${numbers.length}`);

  const startedAt = Date.now();

  for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
    const batch = numbers.slice(i, i + BATCH_SIZE);
    const batchStart = batch[0];
    const batchEnd = batch[batch.length - 1];
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(numbers.length / BATCH_SIZE);

    console.log(
      `[Crom sync] Batch ${batchNumber}/${totalBatches}: requesting SCP-${String(batchStart).padStart(3, '0')} through SCP-${String(batchEnd).padStart(3, '0')}`
    );

    onProgress?.({
      phase: 'requesting',
      batchNumber,
      totalBatches,
      current: batchStart,
      end: batchEnd,
      done: i,
      total: numbers.length,
      articleCount: Object.keys(output).length
    });

    try {
      const query = buildBatchQuery(batch);
      const data = await cromApiRequest(query);

      let addedThisBatch = 0;
      let missingThisBatch = 0;
      let renderFailedThisBatch = 0;

      for (const n of batch) {
        const alias = `p${String(n).padStart(4, '0')}`;
        const page = await normalizePage(n, data?.[alias]);

        if (page) {
          output[scpSlug(n)] = page;
          addedThisBatch += 1;

          if (page.content_format !== 'ftml-html') {
            renderFailedThisBatch += 1;
          }
        } else {
          missingThisBatch += 1;
        }
      }

      console.log(
        `[Crom sync] Batch ${batchNumber}/${totalBatches} complete: added ${addedThisBatch}, missing ${missingThisBatch}, render failed ${renderFailedThisBatch}, total stored ${Object.keys(output).length}`
      );

      onProgress?.({
        phase: 'batch-complete',
        batchNumber,
        totalBatches,
        current: batchStart,
        end: batchEnd,
        done: Math.min(i + batch.length, numbers.length),
        total: numbers.length,
        addedThisBatch,
        missingThisBatch,
        renderFailedThisBatch,
        articleCount: Object.keys(output).length
      });
    } catch (err) {
      console.error(
        `[Crom sync] Batch ${batchNumber}/${totalBatches} failed for SCP-${String(batchStart).padStart(3, '0')} through SCP-${String(batchEnd).padStart(3, '0')}:`,
        err
      );

      onProgress?.({
        phase: 'batch-failed',
        batchNumber,
        totalBatches,
        current: batchStart,
        end: batchEnd,
        done: i,
        total: numbers.length,
        articleCount: Object.keys(output).length,
        error: err.message || String(err)
      });

      throw err;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

  console.log(
    `[Crom sync] Finished. Stored ${Object.keys(output).length} articles in ${elapsedSeconds}s.`
  );

  return output;
}

async function syncCromScpDataset(outputPath, { onProgress } = {}) {
  console.log(`[Crom sync] Output file: ${outputPath}`);

  const dataset = await fetchScpDataset({ onProgress });
  const sanitizedDataset = sanitizeUnusualLineTerminators(dataset);

  console.log(`[Crom sync] Writing ${Object.keys(sanitizedDataset).length} articles to disk...`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  fs.writeFileSync(
    outputPath,
    JSON.stringify(sanitizedDataset, null, 2),
    'utf8'
  );

  const result = {
    outputPath,
    articleCount: Object.keys(sanitizedDataset).length,
    generatedAt: new Date().toISOString()
  };

  console.log('[Crom sync] Write complete.');
  console.log('[Crom sync] Result:', result);

  return result;
}

module.exports = {
  syncCromScpDataset
};

if (require.main === module) {
  const outputPath = path.join(process.cwd(), 'content_crom_scp.json');

  syncCromScpDataset(outputPath, {
    onProgress: (progress) => {
      const start = String(progress.current).padStart(3, '0');
      const end = String(progress.end).padStart(3, '0');

      if (progress.phase === 'batch-complete') {
        console.log(
          `[Crom sync] Batch ${progress.batchNumber}/${progress.totalBatches} complete: SCP-${start} through SCP-${end}; added ${progress.addedThisBatch}, missing ${progress.missingThisBatch}, render failed ${progress.renderFailedThisBatch}, total ${progress.articleCount}`
        );
      } else if (progress.phase === 'batch-failed') {
        console.error(
          `[Crom sync] Batch ${progress.batchNumber}/${progress.totalBatches} failed: SCP-${start} through SCP-${end}; ${progress.error}`
        );
      } else {
        console.log(
          `[Crom sync] Batch ${progress.batchNumber}/${progress.totalBatches}: requesting SCP-${start} through SCP-${end}`
        );
      }
    }
  })
    .then((result) => {
      console.log('[Crom sync] Done:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Crom sync] Failed:', err);
      process.exit(1);
    });
}