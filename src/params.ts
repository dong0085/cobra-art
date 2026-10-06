// Everything the tuning panel can change. Defaults are the "show" look.

export const VIEWS = {
  final: '成品',
  ids: '编号图',
  distance: '距离图',
  kinds: '类别',
  flow: '鳞片方向',
  normals: '法线',
  height: '高度',
} as const;
export type View = keyof typeof VIEWS;

export const params = {
  view: 'final' as View,
  paused: false,
  speed: 1,
  quality: 1, // render resolution scale
  events: true,
  mood: -1, // -1 = auto

  // Shape and material
  relief: 1,
  bevel: 3.2, // art units
  specular: 1,
  metalBias: 0,
  shadows: 1,

  // Studio
  spot: 1, // backdrop spotlight
  dust: 1,

  // Post
  exposure: 1,
  bloom: 0.35,
  grain: 0.6,
  vignette: 0.8,
};

export type Params = typeof params;
