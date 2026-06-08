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

  console.log('version:', ftml.version());
  console.log('renderHTML.length:', ftml.renderHTML.length);
  console.log('renderText.length:', ftml.renderText.length);
  console.log('parse.length:', ftml.parse.length);
  console.log('preprocess.length:', ftml.preprocess.length);
  console.log('makeInfo.length:', ftml.makeInfo.length);
  console.log('Page.length:', ftml.Page.length);

  const source = '++ Test Heading\n\nThis is a paragraph.';

  const attempts = [
    ['renderHTML(source)', () => ftml.renderHTML(source)],

    ['makeInfo()', () => ftml.makeInfo()],

    ['makeInfo basic object', () => ftml.makeInfo({
      title: 'Test Page',
      score: 0,
      page: 'test-page',
      site: 'scp-wiki',
      tags: []
    })],

    ['new Page()', () => new ftml.Page()],

    ['new Page basic object', () => new ftml.Page({
      title: 'Test Page',
      score: 0,
      page: 'test-page',
      site: 'scp-wiki',
      tags: [],
      source
    })]
  ];

  for (const [label, fn] of attempts) {
    try {
      const result = fn();
      console.log(`\n--- ${label} OK ---`);
      console.log('type:', typeof result);
      console.log(result);
    } catch (err) {
      console.log(`\n--- ${label} FAILED ---`);
      console.log(err && (err.stack || err.message || String(err)));
    }
  }
}

main().catch((err) => {
  console.error('FTML inspect failed:');
  console.error(err && (err.stack || err));
  process.exit(1);
});
