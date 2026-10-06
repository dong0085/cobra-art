// Reads a traced SVG (src/art/*.svg) into plain data.

/** Every block kind the tracers produce, and the material the shader gives it. */
export const MATERIALS = {
  scale: 0, // body surface: cobra scales …
  fur: 0, // … or rat fur
  ventral: 1, // belly plates
  head: 2,
  eye: 3,
  nostril: 4,
  nose: 4,
  skin: 5, // ears, paws, feet, tail
  claw: 6,
} as const;
export type Kind = keyof typeof MATERIALS;

export type Region = {
  kind: Kind;
  order: number; // top-to-bottom rank within its kind
  cx: number;
  cy: number;
  d: string;
};

export type Art = {
  width: number;
  height: number;
  /** "columns": each body part is rounded on its own (cobra). "inflate": one soft balloon plus volumes (rat). */
  form: 'columns' | 'inflate';
  regions: Region[]; // largest first, so nested blocks paint on top
  ink: string; // even-odd path of the line work
  /** Extra soft bulges (lift > 0) or flattened areas (lift < 0) for the "inflate" form. */
  volumes: { lift: number; d: string }[];
  /** Whisker centre lines, root first, as [x0, y0, x1, y1, …]. */
  whiskers: number[][];
};

export function parseArt(svgText: string): Art {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  const [, , width, height] = root.getAttribute('viewBox')!.split(/\s+/).map(Number);
  const regions = [...doc.querySelectorAll('path.region')].map((p) => ({
    kind: p.classList[1] as Kind,
    order: Number(p.getAttribute('data-order')),
    cx: Number(p.getAttribute('data-cx')),
    cy: Number(p.getAttribute('data-cy')),
    d: p.getAttribute('d')!,
  }));
  const ink = doc.querySelector('path.ink')!.getAttribute('d')!;
  const volumes = [...doc.querySelectorAll('path.volume')].map((p) => ({ lift: Number(p.getAttribute('data-lift')), d: p.getAttribute('d')! }));
  const whiskers = [...doc.querySelectorAll('path.whisker')].map((p) => p.getAttribute('d')!.slice(1).split(/[L\s]+/).map(Number));
  const form = root.getAttribute('data-form') === 'inflate' ? 'inflate' : 'columns';
  return { width, height, form, regions, ink, volumes, whiskers };
}
