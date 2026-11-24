export interface Save {
  best: number; bestDistance: number; runs: number;
  music: number; sfx: number; muted: boolean; shake: boolean;
}
export const DEFAULTS: Readonly<Save> = { best: 0, bestDistance: 0, runs: 0, music: 2, sfx: 2, muted: false, shake: true };
const KEY = 'apt-jump.v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

const count = (v: unknown, d: number, max = 1e12) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.floor(v) : d;
const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

export function parseSave(raw: string): Save {
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object') o = v as Record<string, unknown>;
  } catch { /* damaged save: use defaults */ }
  return {
    best: count(o.best, 0), bestDistance: count(o.bestDistance, 0), runs: count(o.runs, 0),
    music: count(o.music, DEFAULTS.music, 3), sfx: count(o.sfx, DEFAULTS.sfx, 3),
    muted: flag(o.muted, false), shake: flag(o.shake, true),
  };
}

/** Saves to localStorage, and keeps going in memory when that isn't possible. */
export class SaveFile {
  data: Save = { ...DEFAULTS };
  available = true;
  private store: Store | null = null;

  constructor(getStore: () => Store = () => window.localStorage) {
    try {
      this.store = getStore();
      const raw = this.store.getItem(KEY);
      if (raw) this.data = parseSave(raw);
      this.save();
    } catch { this.available = false; }
  }

  save(): void {
    if (!this.store) return;
    try {
      this.store.setItem(KEY, JSON.stringify(this.data));
      this.available = true;
    } catch { this.available = false; }
  }

  /** Records a finished run; true when it beat the old best score. */
  record(score: number, distance: number): boolean {
    const isBest = score > this.data.best;
    this.data.best = Math.max(this.data.best, score);
    this.data.bestDistance = Math.max(this.data.bestDistance, Math.floor(distance));
    this.data.runs++;
    this.save();
    return isBest;
  }
}
