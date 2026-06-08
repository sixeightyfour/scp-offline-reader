async function main() {
  const ftml = await import('@r74tech/ftml-wasm');

  console.log('FTML exports:', Object.keys(ftml));

  for (const [key, value] of Object.entries(ftml)) {
    console.log(`${key}: ${typeof value}`);
  }
}

main().catch((err) => {
  console.error('FTML test failed:');
  console.error(err && (err.stack || err));
  process.exit(1);
});
