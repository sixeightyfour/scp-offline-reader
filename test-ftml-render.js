async function main() {
  globalThis.location = {
    href: 'file:///ftml-node-test',
    origin: 'file://',
    protocol: 'file:',
    host: '',
    hostname: '',
    pathname: '/ftml-node-test'
  };

  const ftml = await import('@r74tech/ftml-wasm');

  if (typeof ftml.init === 'function') {
    await ftml.init();
  }

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

  const info = {
    page: 'test-page',
    site: 'scp-wiki',
    title: 'Test Page',
    score: 0,
    rating: 0,
    tags: [],
    language: 'en'
  };

  const result = ftml.renderHTML(source, info, 'page');

  console.log('Result keys:', Object.keys(result));
  console.log('HTML output:');
  console.log(result.html);
  console.log('Meta:');
  console.log(result.meta);
  console.log('Backlinks:');
  console.log(result.backlinks);
}

main().catch((err) => {
  console.error('FTML render test failed:');
  console.error(err && (err.stack || err));
  process.exit(1);
});
