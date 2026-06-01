const { renderWikidotSourceToHtml } = require('./scripts/ftml_render');

async function main() {
  const source = `
++ Test Heading

This is a paragraph.

[[div class="content-panel standalone"]]
This is inside a Wikidot div.
[[/div]]

||~ Header 1 ||~ Header 2 ||
|| Cell 1 || Cell 2 ||

[[collapsible show="+ open" hide="- close"]]
Hidden text.
[[/collapsible]]
`;

  const result = await renderWikidotSourceToHtml(source, {
    page: 'test-page',
    title: 'Test Page',
    score: 0,
    tags: ['test']
  });

  console.log(result.html);
}

main().catch((err) => {
  console.error(err && (err.stack || err));
  process.exit(1);
});
