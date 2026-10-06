// Show mode: full screen, no UI, cursor hidden while idle. Keyboard shortcuts.
import type GUI from 'lil-gui';
import type { Params } from '../params.ts';
import { EVENT_TYPES, type Director } from '../director/director.ts';

const IDLE_MS = 2500;

export function setupShowMode(params: Params, director: Director, panel: GUI, now: () => number, startInShow: boolean) {
  const body = document.body;
  const setShow = (on: boolean) => {
    body.classList.toggle('show', on);
    if (on) panel.hide();
  };
  setShow(startInShow);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen?.().catch(() => undefined);
      setShow(true);
    }
  };
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) setShow(false);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const key = e.key.toLowerCase();
    if (key === 'f') toggleFullscreen();
    else if (key === 'h') {
      if (panel._hidden) {
        setShow(false);
        panel.show();
      } else panel.hide();
    } else if (key === ' ') {
      params.paused = !params.paused;
      e.preventDefault();
    } else if (key === 'm') director.skipMood(now());
    else if (key === 'e') director.trigger(EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)], now());
    else if (key === 'escape') setShow(false);
  });
  document.querySelector('#canvas')?.addEventListener('dblclick', toggleFullscreen);

  let idleTimer = 0;
  window.addEventListener('pointermove', () => {
    body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => body.classList.add('idle'), IDLE_MS);
  });
}
