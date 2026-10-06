// The "director": decides what the scene looks like at any moment.
// Everything is a pure function of (seed, time), so ?t= can jump anywhere and nothing loops.
//
// Layers of change, from fast to slow:
//   seconds   – dust drifts, the backdrop's mottling slowly moves
//   ~1 min    – the key light and rim light wander (never from below)
//   20–90 s   – one quiet event: light sweep, scale ripple, passing shadow, eye glint, dust in the beam
//   3–5 min   – the snake slowly turns into a new material over ~40 s

import { MOODS, mixMood, type Mood } from './moods.ts';

export const EVENT_TYPES = ['sweep', 'ripple', 'shade', 'glint', 'dust'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_NAMES: Record<EventType, string> = {
  sweep: '光带扫过',
  ripple: '鳞片起伏',
  shade: '云影',
  glint: '眼神',
  dust: '浮尘',
};

type ScheduledEvent = {
  type: EventType;
  start: number;
  duration: number;
  origin: [number, number]; // art units, for the ripple
  direction: number; // 1 or -1: which way sweeps and shadows travel
};

type MoodSegment = { start: number; mood: number };

export type FrameState = {
  time: number;
  mood: Mood;
  moodName: string;
  eventName: string;
  keyDir: [number, number, number];
  rimDir: [number, number, number];
  ripple: [number, number, number, number]; // origin x, y (art), radius, front width
  rippleStrength: number;
  sweep: [number, number, number]; // bar position (reflection x), width, strength
  shade: [number, number, number]; // shadow band position (art units), width, strength
  eyeGlint: number;
  dust: number;
};

/** Small seeded RNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Where ripples start from (art units): head, hood top, throat, body. */
const RIPPLE_ORIGINS: [number, number][] = [
  [740, 200],
  [520, 120],
  [560, 420],
  [300, 600],
];

const DURATIONS: Record<EventType, [number, number]> = {
  sweep: [6, 10],
  ripple: [7, 11],
  shade: [10, 18],
  glint: [3, 5],
  dust: [12, 20],
};
const WEIGHTS: Record<EventType, number> = { sweep: 0.3, ripple: 0.2, shade: 0.2, glint: 0.15, dust: 0.15 };
const MOOD_FADE = 40;

export class Director {
  private events: ScheduledEvent[] = [];
  private moods: MoodSegment[] = [{ start: -Infinity, mood: 0 }]; // always opens on the natural king cobra
  private nextEvent: () => number;
  private nextMood: () => number;
  private eventCursor = 6; // first event a few seconds after opening
  private moodCursor = 0;
  eventsEnabled = true;
  /** When set, the mood stays here instead of drifting. */
  lockedMood: number | null = null;

  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.nextEvent = rng(seed * 7919 + 1);
    this.nextMood = rng(seed * 104729 + 3);
  }

  private pickType(r: number): EventType {
    let acc = 0;
    for (const type of EVENT_TYPES) {
      acc += WEIGHTS[type];
      if (r < acc) return type;
    }
    return 'sweep';
  }

  private makeEvent(type: EventType, start: number, r: () => number): ScheduledEvent {
    const [lo, hi] = DURATIONS[type];
    return {
      type,
      start,
      duration: lo + (hi - lo) * r(),
      origin: RIPPLE_ORIGINS[Math.floor(r() * RIPPLE_ORIGINS.length)],
      direction: r() < 0.5 ? -1 : 1,
    };
  }

  /** Extends the schedules far enough to cover time t. */
  private extend(t: number) {
    while (this.eventCursor <= t + 120) {
      const type = this.pickType(this.nextEvent());
      const event = this.makeEvent(type, this.eventCursor, this.nextEvent);
      this.events.push(event);
      this.eventCursor += Math.max(event.duration + 4, 20 + this.nextEvent() * 70);
    }
    while (this.moodCursor <= t + 600) {
      this.moodCursor += 180 + this.nextMood() * 120;
      const previous = this.moods[this.moods.length - 1].mood;
      const next = (previous + 1 + Math.floor(this.nextMood() * (MOODS.length - 1))) % MOODS.length;
      this.moods.push({ start: this.moodCursor, mood: next });
    }
  }

  /** Start an event right now (from the tuning panel). */
  trigger(type: EventType, t: number) {
    const r = rng(Math.floor(t * 1000) ^ this.seed);
    this.events.push(this.makeEvent(type, t, r));
    this.events.sort((a, b) => a.start - b.start);
  }

  /** Jump to the next mood right now. */
  skipMood(t: number) {
    this.extend(t);
    const i = this.moods.findIndex((m) => m.start > t);
    const current = this.moods[Math.max(0, i - 1)].mood;
    const next = (current + 1 + Math.floor(Math.random() * (MOODS.length - 1))) % MOODS.length;
    this.moods.splice(Math.max(1, i), 0, { start: t, mood: next });
  }

  private moodAt(t: number): Mood {
    if (this.lockedMood !== null) return MOODS[this.lockedMood];
    let i = 0;
    while (i + 1 < this.moods.length && this.moods[i + 1].start <= t) i++;
    const seg = this.moods[i];
    const from = i > 0 ? MOODS[this.moods[i - 1].mood] : MOODS[seg.mood];
    return mixMood(from, MOODS[seg.mood], smooth(clamp01((t - seg.start) / MOOD_FADE)));
  }

  frame(t: number): FrameState {
    this.extend(t);
    const mood = this.moodAt(t);

    // Lights: the key light wanders across the upper left; the rim light circles behind the snake.
    const keyAz = Math.PI / 2 + 0.6 + 0.4 * Math.sin((2 * Math.PI * t) / 97) + 0.15 * Math.sin((2 * Math.PI * t) / 41 + 1.3);
    const keyEl = 0.42 + 0.12 * Math.sin((2 * Math.PI * t) / 73 + 0.4);
    const rimAz = 0.25 + 0.35 * Math.sin((2 * Math.PI * t) / 61 + 2.1);
    const keyDir: [number, number, number] = [Math.cos(keyAz) * Math.cos(keyEl), Math.sin(keyAz) * Math.cos(keyEl), Math.sin(keyEl)];
    const rimDir: [number, number, number] = [Math.cos(rimAz) * 0.9, Math.sin(rimAz) * 0.9, -0.45];

    const state: FrameState = {
      time: t,
      mood,
      moodName: mood.name,
      eventName: '',
      keyDir,
      rimDir,
      ripple: [0, 0, -1e4, 1],
      rippleStrength: 0,
      sweep: [0, 1, 0],
      shade: [0, 1, 0],
      eyeGlint: 0,
      dust: 0,
    };
    if (!this.eventsEnabled) return state;

    for (const e of this.events) {
      if (e.start > t) break;
      if (t >= e.start + e.duration) continue;
      const p = (t - e.start) / e.duration;
      const envelope = Math.sin(Math.PI * p);
      const travel = e.direction > 0 ? p : 1 - p;
      state.eventName = EVENT_NAMES[e.type];
      if (e.type === 'sweep') state.sweep = [-1.4 + travel * 2.8, 0.14, smooth(envelope)];
      if (e.type === 'ripple') {
        state.ripple = [e.origin[0], e.origin[1], p * 1700, 110];
        state.rippleStrength = Math.sqrt(envelope);
      }
      if (e.type === 'shade') state.shade = [-700 + travel * 2600, 320, envelope];
      if (e.type === 'glint') state.eyeGlint = envelope;
      if (e.type === 'dust') state.dust = envelope;
    }
    return state;
  }
}
