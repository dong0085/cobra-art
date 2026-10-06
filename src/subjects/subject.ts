// Everything that differs between animals: art, materials, layout, and which events happen.
import type { Mood } from '../director/moods.ts';
import type { EventType } from '../director/director.ts';

type Point = [number, number];
type Circle = [number, number, number]; // x, y, radius (art units)

export type Subject = {
  id: string;
  title: string;
  /** The traced art (src/art/*.svg). */
  svg: string;
  moods: Mood[];
  /** Which events happen, what they are called, and how often (weights are relative). */
  events: Partial<Record<EventType, { name: string; weight: number }>>;
  /** Where ripples may start (art units). */
  rippleOrigins: Point[];
  layout: {
    /** Fraction of the screen height the art fills. */
    fit: number;
    /** Gap under the art, as a fraction of the screen height. */
    bottom: number;
    /** Where the leftover width goes: 0 hugs the left edge, 0.5 centres. */
    across: number;
  };
  look: {
    /** Centre of the spotlight on the backdrop. */
    spot: Point;
    /** Where the key light is aimed, and how wide its pool is. */
    keyPool: Circle;
    eye: Circle;
    /** The snout, where whiskers grow from. */
    snout: Point;
    /** Part of the body that sinks into the dark: fades in from x0→x1, for y from y0→y1. Null: none. */
    fade: [number, number, number, number] | null;
    /** Soft shadow on the floor under the animal: centre x, y, radius x, y. Null: none. */
    ground: [number, number, number, number] | null;
    /** How the second colour is used: the cobra's cross bands, or a lighter belly inside a circle. */
    pattern: { kind: 'bands' } | { kind: 'belly'; zone: Circle };
    /** Bevel and dome on every block (scales), or only on small ones (eye, nose, claws). */
    bevelAll: boolean;
    /** Depth of the baked hair strands (art units); 0 for no fur. */
    strandDepth: number;
    /** How dark the pen lines get (0–1). */
    inkDarken: number;
    /** Whether the floor's darkness also falls on the animal (true when it's cut off at the bottom). */
    darkFloorOnBody: boolean;
    /** 1: crisp shadows between scales; higher softens shadows on big smooth bodies. */
    shadowSoftness: number;
  };
};
