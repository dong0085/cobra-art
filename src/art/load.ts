// Reads the traced SVG (src/art/cobra.svg) into plain data.

export const KINDS = ['scale', 'ventral', 'head', 'eye', 'nostril'] as const;
export type Kind = (typeof KINDS)[number];

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
  regions: Region[]; // largest first, so nested blocks paint on top
  ink: string; // even-odd path of the line work
};

export function parseArt(svgText: string): Art {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const [, , width, height] = doc.documentElement.getAttribute('viewBox')!.split(/\s+/).map(Number);
  const regions = [...doc.querySelectorAll('path.region')].map((p) => ({
    kind: p.classList[1] as Kind,
    order: Number(p.getAttribute('data-order')),
    cx: Number(p.getAttribute('data-cx')),
    cy: Number(p.getAttribute('data-cy')),
    d: p.getAttribute('d')!,
  }));
  const ink = doc.querySelector('path.ink')!.getAttribute('d')!;
  return { width, height, regions, ink };
}
