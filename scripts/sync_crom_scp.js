const fs = require('fs');
const path = require('path');

const { renderWikidotSourceToHtml } = require('./ftml_render');

const CROM_ENDPOINT = 'https://api.crom.avn.sh/graphql';

// Change these back to your full range when ready.
const START = 4371;
const END = 4383;

const BATCH_SIZE = 5;
const REQUEST_DELAY_MS = 1000;

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

function isCromBatchFile(filename) {
  return /^content_crom_scp_\d+_\d+\.json$/i.test(filename);
}

function batchOutputName(batchStart, batchEnd) {
  return `content_crom_scp_${batchStart}_${batchEnd}.json`;
}

function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  fs.writeFileSync(
    tmpPath,
    JSON.stringify(sanitizeUnusualLineTerminators(data), null, 2),
    'utf8'
  );

  fs.renameSync(tmpPath, filePath);
}

function combineBatchFiles(outputDir, finalOutputPath) {
  const files = fs.readdirSync(outputDir)
    .filter(isCromBatchFile)
    .sort((a, b) => {
      const [, aStart] = a.match(/^content_crom_scp_(\d+)_\d+\.json$/i) || [];
      const [, bStart] = b.match(/^content_crom_scp_(\d+)_\d+\.json$/i) || [];

      return Number(aStart || 0) - Number(bStart || 0);
    });

  const combined = {};
  let mergedFileCount = 0;
  let mergedArticleCount = 0;

  for (const filename of files) {
    const filePath = path.join(outputDir, filename);

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn(`[Crom sync] Skipping invalid batch file: ${filename}`);
        continue;
      }

      const articleCount = Object.keys(parsed).length;

      Object.assign(combined, parsed);

      mergedFileCount += 1;
      mergedArticleCount += articleCount;

      console.log(
        `[Crom sync] Merged ${filename}: ${articleCount} articles`
      );
    } catch (err) {
      console.warn(
        `[Crom sync] Failed to read batch file ${filename}; leaving it in place:`,
        err
      );
    }
  }

  console.log(
    `[Crom sync] Writing combined dataset: ${path.basename(finalOutputPath)}`
  );

  writeJsonAtomic(finalOutputPath, combined);

  console.log(
    `[Crom sync] Combined ${mergedFileCount} batch files into ${Object.keys(combined).length} unique articles`
  );

  return {
    files,
    mergedFileCount,
    mergedArticleCount,
    uniqueArticleCount: Object.keys(combined).length
  };
}

function removeBatchFiles(outputDir, files) {
  let removedCount = 0;

  for (const filename of files) {
    const filePath = path.join(outputDir, filename);

    try {
      fs.unlinkSync(filePath);
      removedCount += 1;
      console.log(`[Crom sync] Removed batch file: ${filename}`);
    } catch (err) {
      console.warn(
        `[Crom sync] Failed to remove batch file ${filename}:`,
        err
      );
    }
  }

  return removedCount;
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

async function fetchScpDataset({ outputDir, onProgress } = {}) {
  if (!outputDir) {
    throw new Error('fetchScpDataset requires outputDir');
  }

  const numbers = [];

  for (let n = START; n <= END; n += 1) {
    numbers.push(n);
  }

  console.log(`[Crom sync] Starting SCP sync: ${START} through ${END}`);
  console.log(`[Crom sync] Batch size: ${BATCH_SIZE}`);
  console.log(`[Crom sync] Total requested pages: ${numbers.length}`);

  const startedAt = Date.now();
  const totalBatches = Math.ceil(numbers.length / BATCH_SIZE);

  let totalStored = 0;

  for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
    const batch = numbers.slice(i, i + BATCH_SIZE);
    const batchStart = batch[0];
    const batchEnd = batch[batch.length - 1];
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

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
      articleCount: totalStored
    });

    try {
      const query = buildBatchQuery(batch);
      const data = await cromApiRequest(query);

      const batchOutput = {};
      let addedThisBatch = 0;
      let missingThisBatch = 0;
      let renderFailedThisBatch = 0;

      for (const n of batch) {
        const alias = `p${String(n).padStart(4, '0')}`;
        const page = await normalizePage(n, data?.[alias]);

        if (page) {
          batchOutput[scpSlug(n)] = page;
          addedThisBatch += 1;

          if (page.content_format !== 'ftml-html') {
            renderFailedThisBatch += 1;
          }
        } else {
          missingThisBatch += 1;
        }
      }

      const outputName = batchOutputName(batchStart, batchEnd);
      const outputPath = path.join(outputDir, outputName);

      console.log(
        `[Crom sync] Batch ${batchNumber}/${totalBatches}: writing ${addedThisBatch} articles to ${outputName}`
      );

      writeJsonAtomic(outputPath, batchOutput);

      totalStored += addedThisBatch;

      console.log(
        `[Crom sync] Batch ${batchNumber}/${totalBatches} complete: added ${addedThisBatch}, missing ${missingThisBatch}, render failed ${renderFailedThisBatch}, total stored ${totalStored}`
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
        articleCount: totalStored,
        outputPath
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
        articleCount: totalStored,
        error: err.message || String(err)
      });

      throw err;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

  console.log(
    `[Crom sync] Finished. Stored ${totalStored} articles in ${elapsedSeconds}s.`
  );

  return {
    articleCount: totalStored,
    generatedAt: new Date().toISOString()
  };
}

async function syncCromScpDataset(outputPath, { onProgress } = {}) {
  const outputDir = path.dirname(outputPath);

  console.log(`[Crom sync] Output directory: ${outputDir}`);

  const oldSingleFile = outputPath;

  if (fs.existsSync(oldSingleFile)) {
    console.log(`[Crom sync] Removing old single-file dataset: ${oldSingleFile}`);
    fs.unlinkSync(oldSingleFile);
  }

  const result = await fetchScpDataset({
    outputDir,
    onProgress
  });

  console.log('[Crom sync] Combining batch files...');

  onProgress?.({
    phase: 'combining',
    articleCount: result.articleCount
  });

  const combineResult = combineBatchFiles(outputDir, outputPath);

  console.log('[Crom sync] Removing temporary batch files...');

  onProgress?.({
    phase: 'cleaning',
    articleCount: combineResult.uniqueArticleCount
  });

  const removedBatchFileCount = removeBatchFiles(
    outputDir,
    combineResult.files
  );

  const finalResult = {
    outputPath,
    articleCount: combineResult.uniqueArticleCount,
    generatedAt: result.generatedAt,
    mergedBatchFileCount: combineResult.mergedFileCount,
    removedBatchFileCount
  };

  console.log('[Crom sync] Sync complete.');
  console.log('[Crom sync] Result:', finalResult);

  return finalResult;
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