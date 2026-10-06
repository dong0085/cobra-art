// Screenshots the running dev server with headless Chrome.
//   node scripts/snap.ts <url> <out.png> [width] [height]
// Waits until the page reports it has finished baking, then prints any console errors.
import { writeFileSync } from 'node:fs';
import { openPage, sleep } from './cdp.ts';

const [url, out, width = '1600', height = '900'] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node scripts/snap.ts <url> <out.png> [width] [height]');
  process.exit(1);
}

const page = await openPage(url, Number(width), Number(height));
try {
  const deadline = Date.now() + 120_000;
  let status = '';
  while (Date.now() < deadline) {
    status = (await page.evaluate("document.querySelector('#status')?.textContent ?? ''")) ?? '';
    if (status.includes('烘焙') || status.includes('WebGL2')) break;
    await sleep(300);
  }
  await sleep(1500); // let a few frames render
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`status: ${status}`);
  for (const line of page.logs) console.log(line);
} finally {
  page.close();
}
