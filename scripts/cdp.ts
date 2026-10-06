// Starts headless Chrome and talks to one page over the DevTools protocol.
// Shared by scripts/snap.ts and scripts/timelapse.ts.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Page = {
  send(method: string, params?: object): Promise<any>;
  /** Runs an expression in the page and returns its value (awaits promises). */
  evaluate(expression: string): Promise<any>;
  /** Console errors, warnings and exceptions seen so far. */
  logs: string[];
  close(): void;
};

export async function openPage(url: string, width: number, height: number): Promise<Page> {
  const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0', // Chrome picks a free port and writes it to the profile
      `--user-data-dir=${profile}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let socketUrl = '';
  for (let i = 0; i < 100 && !socketUrl; i++) {
    try {
      const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      const pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      socketUrl = pages.find((p) => p.type === 'page')?.webSocketDebuggerUrl ?? '';
    } catch {
      // Chrome is still starting
    }
    if (!socketUrl) await sleep(100);
  }
  if (!socketUrl) {
    chrome.kill();
    throw new Error('Chrome did not start');
  }

  const ws = new WebSocket(socketUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1;
  const pending = new Map<number, (v: any) => void>();
  const logs: string[] = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result ?? msg.error);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      logs.push(`console.${msg.params.type}: ${msg.params.args.map((a: any) => a.value ?? a.description).join(' ')}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    }
  });
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression: string) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });

  return {
    send,
    evaluate,
    logs,
    close() {
      ws.close();
      chrome.kill();
    },
  };
}
