// Materials and studio colours ("moods"). Each subject has its own list; the director drifts between them.

export type Rgb = [number, number, number]; // linear sRGB

export type Mood = {
  name: string;
  backDark: Rgb; // backdrop in shadow
  backLight: Rgb; // backdrop where the spotlight falls
  key: Rgb; // main light (upper left)
  rim: Rgb; // back light that outlines the snake
  ambient: Rgb; // light bouncing around the room
  body: Rgb; // main colour: scales or fur
  pattern: Rgb; // second colour: the cobra's cross bands
  patternAmount: number;
  belly: Rgb; // throat plates, or the rat's lighter belly fur
  skin: Rgb; // bare skin: ears, paws, tail
  nose: Rgb;
  whisker: Rgb;
  cavity: Rgb; // colour deep in the gaps between scales or strokes
  iris: Rgb;
  metal: number; // 0 stone / glaze … 1 metal
  roughness: number; // 0 mirror … 1 matte
  wrap: number; // light soaking into the surface (jade, porcelain, fur)
  fur: number; // 0 hard surface … 1 soft fur sheen that runs along the strands
};

/** "#ff71ce" → linear sRGB. */
export function hex(h: string): Rgb {
  const n = parseInt(h.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

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
