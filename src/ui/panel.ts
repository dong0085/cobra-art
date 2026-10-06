// Tuning panel (press H to show / hide).
import GUI from 'lil-gui';
import { VIEWS, type Params } from '../params.ts';
import { EVENT_NAMES, EVENT_TYPES, type Director } from '../director/director.ts';
import { MOODS } from '../director/moods.ts';

export function createPanel(params: Params, director: Director, now: () => number): GUI {
  const gui = new GUI({ title: '调参 (H)' });
  const invert = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));

  gui.add(params, 'view', invert(VIEWS)).name('视图');
  gui.add(params, 'paused').name('暂停 (空格)').listen();
  gui.add(params, 'speed', 0, 4, 0.05).name('速度');
  gui.add(params, 'quality', 0.4, 1, 0.05).name('画质');

  const direct = gui.addFolder('导演');
  direct
    .add(params, 'mood', { 自动: -1, ...Object.fromEntries(MOODS.map((m, i) => [m.name, i])) })
    .name('材质')
    .onChange((v: number) => (director.lockedMood = v < 0 ? null : v));
  direct.add({ next: () => director.skipMood(now()) }, 'next').name('▶ 下一种材质 (M)');
  direct.add(params, 'events').name('随机事件').onChange((v: boolean) => (director.eventsEnabled = v));
  for (const type of EVENT_TYPES) direct.add({ go: () => director.trigger(type, now()) }, 'go').name(`▶ ${EVENT_NAMES[type]}`);

  const shape = gui.addFolder('立体感');
  shape.add(params, 'relief', 0, 2, 0.05).name('起伏');
  shape.add(params, 'bevel', 0.5, 8, 0.1).name('鳞片倒角');
  shape.add(params, 'specular', 0, 2, 0.05).name('高光');
  shape.add(params, 'metalBias', -1, 1, 0.05).name('金属感');
  shape.add(params, 'shadows', 0, 1, 0.05).name('阴影');

  const scene = gui.addFolder('暗室');
  scene.add(params, 'spot', 0, 2, 0.05).name('背景光');
  scene.add(params, 'dust', 0, 3, 0.05).name('浮尘');

  const post = gui.addFolder('后期');
  post.add(params, 'exposure', 0.4, 2, 0.05).name('曝光');
  post.add(params, 'bloom', 0, 2, 0.05).name('辉光');
  post.add(params, 'grain', 0, 2, 0.05).name('颗粒');
  post.add(params, 'vignette', 0, 1, 0.05).name('暗角');

  for (const f of [shape, scene, post]) f.close();
  return gui;
}
