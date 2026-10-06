// Materials and studio colours. The director drifts from one to the next every few minutes.

export type Rgb = [number, number, number]; // linear sRGB

export type Mood = {
  name: string;
  backDark: Rgb; // backdrop in shadow
  backLight: Rgb; // backdrop where the spotlight falls
  key: Rgb; // main light (upper left)
  rim: Rgb; // back light that outlines the snake
  ambient: Rgb; // light bouncing around the room
  scale: Rgb; // main scale colour
  band: Rgb; // colour of the cross bands
  bandAmount: number;
  belly: Rgb; // throat plates
  cavity: Rgb; // colour deep in the gaps between scales
  iris: Rgb;
  metal: number; // 0 stone / glaze … 1 metal
  roughness: number; // 0 mirror … 1 matte
  wrap: number; // light soaking into the surface (jade, porcelain)
};

/** "#ff71ce" → linear sRGB. */
function hex(h: string): Rgb {
  const n = parseInt(h.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

export const MOODS: Mood[] = [
  {
    name: '王蛇',
    backDark: hex('#0b0907'),
    backLight: hex('#5a4634'),
    key: hex('#fff1dc'),
    rim: hex('#a9c8ff'),
    ambient: hex('#2e2922'),
    scale: hex('#2a2d19'),
    band: hex('#a08a52'),
    bandAmount: 0.6,
    belly: hex('#a8925e'),
    cavity: hex('#0a0905'),
    iris: hex('#b8802c'),
    metal: 0,
    roughness: 0.3,
    wrap: 0,
  },
  {
    name: '黑曜石',
    backDark: hex('#07080a'),
    backLight: hex('#303945'),
    key: hex('#f2f5ff'),
    rim: hex('#ffd2a0'),
    ambient: hex('#1e222a'),
    scale: hex('#0e0f12'),
    band: hex('#2c313c'),
    bandAmount: 0.4,
    belly: hex('#2a2c33'),
    cavity: hex('#000000'),
    iris: hex('#8a96a8'),
    metal: 0,
    roughness: 0.1,
    wrap: 0,
  },
  {
    name: '青铜',
    backDark: hex('#080a09'),
    backLight: hex('#3a4640'),
    key: hex('#ffe2bc'),
    rim: hex('#a8d8ff'),
    ambient: hex('#232921'),
    scale: hex('#a8743d'),
    band: hex('#5e3f22'),
    bandAmount: 0.45,
    belly: hex('#c99a5c'),
    cavity: hex('#2f6b58'),
    iris: hex('#2f6b58'),
    metal: 1,
    roughness: 0.42,
    wrap: 0,
  },
  {
    name: '翡翠',
    backDark: hex('#0a0908'),
    backLight: hex('#4d463b'),
    key: hex('#fff4e0'),
    rim: hex('#e8ffe8'),
    ambient: hex('#23291f'),
    scale: hex('#3f8a5f'),
    band: hex('#cfe6c8'),
    bandAmount: 0.35,
    belly: hex('#a9d6b0'),
    cavity: hex('#0f2a1c'),
    iris: hex('#e6d27a'),
    metal: 0,
    roughness: 0.16,
    wrap: 0.6,
  },
  {
    name: '青花',
    backDark: hex('#06070c'),
    backLight: hex('#2e3650'),
    key: hex('#f6f8ff'),
    rim: hex('#ffe0b8'),
    ambient: hex('#1d2130'),
    scale: hex('#ece8de'),
    band: hex('#1f3f8f'),
    bandAmount: 0.75,
    belly: hex('#f4f1ea'),
    cavity: hex('#1a3378'),
    iris: hex('#1f3f8f'),
    metal: 0,
    roughness: 0.14,
    wrap: 0.35,
  },
  {
    name: '鎏金',
    backDark: hex('#0c0505'),
    backLight: hex('#4f1e19'),
    key: hex('#fff0d6'),
    rim: hex('#ffb08a'),
    ambient: hex('#2a1a14'),
    scale: hex('#e0b052'),
    band: hex('#8a5a1c'),
    bandAmount: 0.3,
    belly: hex('#f0cf7a'),
    cavity: hex('#2a1406'),
    iris: hex('#3a0d0a'),
    metal: 1,
    roughness: 0.3,
    wrap: 0,
  },
];

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mixNum = (a: number, b: number, t: number) => a + (b - a) * t;

export function mixMood(a: Mood, b: Mood, t: number): Mood {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = { name: t < 0.5 ? a.name : b.name } as Mood;
  for (const key of Object.keys(a) as (keyof Mood)[]) {
    if (key === 'name') continue;
    const va = a[key];
    const vb = b[key];
    (out as any)[key] = typeof va === 'number' ? mixNum(va, vb as number, t) : mixRgb(va, vb as Rgb, t);
  }
  return out;
}
