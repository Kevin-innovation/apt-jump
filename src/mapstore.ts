import { readMap, type GameMap } from './maps';

export interface SavedMap { id: string; map: GameMap; best: number; cleared: boolean; updated: number; /** Online copy, once published. */ sharedId?: string }

const KEY = 'apt-jump.maps.v1';
export const MAX_MAPS = 20;
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** The player's own maps, in this browser. Scores here never touch the endless mode's record. */
export class MapStore {
  maps: SavedMap[] = [];
  available = true;
  private store: Store | null = null;

  constructor(getStore: () => Store = () => window.localStorage, private now = () => Date.now()) {
    try {
      this.store = getStore();
      const raw = this.store.getItem(KEY);
      const v: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(v)) for (const m of v.slice(0, MAX_MAPS)) this.adopt(m);
    } catch { this.available = this.store !== null; }
  }

  private adopt(v: unknown): void {
    if (typeof v !== 'object' || v === null) return;
    const o = v as Record<string, unknown>;
    const { map } = readMap(o.map);
    if (!map || typeof o.id !== 'string' || o.id.length > 64 || this.get(o.id)) return;
    this.maps.push({ id: o.id, map, best: num(o.best), cleared: o.cleared === true, updated: num(o.updated), ...(typeof o.sharedId === 'string' && o.sharedId.length <= 64 ? { sharedId: o.sharedId } : {}) });
  }

  private write(): boolean {
    if (!this.store) return false;
    try {
      this.store.setItem(KEY, JSON.stringify(this.maps));
      this.available = true;
    } catch { this.available = false; }
    return this.available;
  }

  get(id: string): SavedMap | undefined { return this.maps.find((m) => m.id === id); }

  /** Adds or replaces; null when the shelf is full. */
  put(map: GameMap, id: string | null): SavedMap | null {
    const copy = structuredClone(map);
    const old = id ? this.get(id) : undefined;
    if (old) {
      // A changed course makes its old score meaningless.
      if (JSON.stringify({ ...old.map, title: '' }) !== JSON.stringify({ ...copy, title: '' })) { old.best = 0; old.cleared = false; }
      old.map = copy;
      old.updated = this.now();
      this.write();
      return old;
    }
    if (this.maps.length >= MAX_MAPS) return null;
    const made: SavedMap = { id: `m${this.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`, map: copy, best: 0, cleared: false, updated: this.now() };
    this.maps.unshift(made);
    this.write();
    return made;
  }

  link(id: string, sharedId: string): void {
    const m = this.get(id);
    if (m) { m.sharedId = sharedId; this.write(); }
  }
  unlink(sharedId: string): void {
    for (const m of this.maps) if (m.sharedId === sharedId) delete m.sharedId;
    this.write();
  }

  remove(id: string): void {
    this.maps = this.maps.filter((m) => m.id !== id);
    this.write();
  }

  /** True when the score is a new best for that map. */
  record(id: string, score: number, cleared: boolean): boolean {
    const m = this.get(id);
    if (!m) return false;
    const better = score > m.best;
    m.best = Math.max(m.best, score);
    m.cleared ||= cleared;
    this.write();
    return better;
  }
}
