// Renders a timelapse video: frames spread evenly over a stretch of scene time, encoded by ffmpeg.
//   node scripts/timelapse.ts [--url http://localhost:5173/] [--out timelapse.mp4]
//     [--from 0] [--to 3600] [--length 60] [--fps 30] [--size 1920x1080]
// --from / --to are scene seconds; --length is video seconds. Defaults: one hour → one minute.
// Put ?seed= or ?mood= in --url to pick which hour you get. Needs the dev server (npm run dev) and ffmpeg.
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { openPage, sleep } from './cdp.ts';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173/' },
    out: { type: 'string', default: 'timelapse.mp4' },
    from: { type: 'string', default: '0' },
    to: { type: 'string', default: '3600' },
    length: { type: 'string', default: '60' },
    fps: { type: 'string', default: '30' },
    size: { type: 'string', default: '1920x1080' },
  },
});
const from = Number(args.from);
const to = Number(args.to);
const fps = Number(args.fps);
const frames = Math.max(1, Math.round(Number(args.length) * fps));
const [width, height] = args.size.split('x').map(Number);
const url = new URL(args.url);
url.searchParams.set('capture', '');

console.log(`${frames} frames, ${((to - from) / frames).toFixed(2)} scene seconds apart → ${args.out}`);

const ffmpeg = spawn(
  'ffmpeg',
  ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', args.out],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const encoded = new Promise<number>((resolve) => ffmpeg.on('close', resolve));
const write = (chunk: Buffer) =>
  new Promise<void>((resolve) => (ffmpeg.stdin.write(chunk) ? resolve() : ffmpeg.stdin.once('drain', resolve)));

const page = await openPage(url.href, width, height);
try {
  const deadline = Date.now() + 120_000;
  while (!(await page.evaluate("typeof window.renderAt === 'function'"))) {
    if (Date.now() > deadline) throw new Error(`page never became ready\n${page.logs.join('\n')}`);
    await sleep(300);
  }

  const started = Date.now();
  for (let i = 0; i < frames; i++) {
    const t = from + ((to - from) * i) / frames;
    // Draw this moment, then wait one frame so it reaches the screen before the capture.
    await page.evaluate(`new Promise((done) => { renderAt(${t}); requestAnimationFrame(() => done(0)); })`);
    const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 95 });
    await write(Buffer.from(shot.data, 'base64'));
    if ((i + 1) % fps === 0 || i + 1 === frames) {
      const perFrame = (Date.now() - started) / (i + 1);
      const left = Math.round((perFrame * (frames - i - 1)) / 1000);
      process.stdout.write(`\r${i + 1}/${frames} frames · ${Math.floor(left / 60)}m${String(left % 60).padStart(2, '0')}s left   `);
    }
  }
  process.stdout.write('\n');
  for (const line of page.logs) console.log(line);
} finally {
  page.close();
  ffmpeg.stdin.end();
}
const code = await encoded;
if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
console.log(`saved ${args.out}`);
