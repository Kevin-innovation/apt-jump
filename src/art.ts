import type { PowerKind } from './items';
import type { Road, Roof } from './world';

type Ctx = CanvasRenderingContext2D;
const INK = '#1a1230';
export const CLOTH = ['#ff6b81', '#59c3ff', '#ffd85a', '#9be36b'];

// Small pictures shared by the game and the map editor. x, y are the top left of the thing's box.

export function drawAc(g: Ctx, x: number, y: number, t: number): void {
  const box = (c: string, a: number, b: number, w: number, h: number) => { g.fillStyle = c; g.fillRect(x + a, y + b, w, h); };
  box(INK, -1, -1, 18, 12);
  box('#f4f1f8', 0, 0, 16, 10); box('#bdb6d2', 0, 8, 16, 2);
  box('#5a5480', 2, 1, 8, 7);
  const f = Math.floor(t * 14) % 2;
  box('#c9c3de', f ? 5 : 2, f ? 1 : 4, f ? 2 : 8, f ? 7 : 1);
  box('#ff5566', 12, 2, 2, 1); box('#8a84ac', 12, 5, 3, 1);
}

export function drawTank(g: Ctx, x: number, y: number): void {
  const box = (c: string, a: number, b: number, w: number, h: number) => { g.fillStyle = c; g.fillRect(x + a, y + b, w, h); };
  box(INK, -1, -1, 38, 28);
  box('#ffcf4a', 0, 1, 36, 24); box('#ffe79a', 2, 1, 6, 24); box('#e09a2c', 28, 1, 8, 24);
  for (let k = 6; k < 24; k += 6) box('#d48a2a', 0, k, 36, 1);
  box('#fff0b8', 0, 0, 36, 2); box('#b86a24', 12, -3, 12, 3);
  box(INK, 2, 26, 4, 5); box(INK, 30, 26, 4, 5); box(INK, 16, 26, 4, 5);
  box('#b9562b', 14, 11, 8, 5); box('#fff0b8', 16, 12, 4, 3);
}

/** A crate: slide into it or land on it to break it. */
export function drawBox(g: Ctx, x: number, y: number): void {
  const box = (c: string, a: number, b: number, w: number, h: number) => { g.fillStyle = c; g.fillRect(x + a, y + b, w, h); };
  box(INK, -1, -1, 16, 13);
  box('#c98a4b', 0, 0, 14, 12); box('#e8b370', 0, 0, 14, 2); box('#8a5530', 0, 10, 14, 2);
  for (let k = 0; k < 8; k++) box('#8a5530', 3 + k, 2 + k, 2, 1);
  box('#fff0b8', 6, 4, 2, 2);
}

/** Something hung low from above: the striped board marks the part to slide under. */
export function drawBar(g: Ctx, x: number, top: number, w: number, h: number, t: number): void {
  const bottom = top + h, board = Math.min(16, h);
  // The whole frame is solid, so all of it shows.
  g.fillStyle = 'rgba(232,70,95,.25)'; g.fillRect(x, top, w, h - board);
  g.fillStyle = INK; g.fillRect(x + 3, top, 3, h - board); g.fillRect(x + w - 6, top, 3, h - board);
  g.fillStyle = '#8c88a8'; g.fillRect(x + 4, top, 1, h - board); g.fillRect(x + w - 5, top, 1, h - board);
  g.fillStyle = INK; g.fillRect(x - 1, bottom - board - 1, w + 2, board + 1);
  g.fillStyle = '#e8465f'; g.fillRect(x, bottom - board, w, board - 1);
  for (let k = 0; k < w; k += 4) { g.fillStyle = Math.floor(k / 4) % 2 ? INK : '#ffd85a'; g.fillRect(x + k, bottom - 4, Math.min(4, w - k), 3); }
  // A blinking arrow: down is the way.
  g.fillStyle = Math.floor(t * 4) % 2 ? '#fff6e0' : '#ffd85a';
  const cx = x + Math.floor(w / 2), ay = bottom - board + 2;
  if (board >= 12) { g.fillRect(cx - 1, ay, 3, 3); g.fillRect(cx - 3, ay + 3, 7, 1); g.fillRect(cx - 2, ay + 4, 5, 1); g.fillRect(cx - 1, ay + 5, 3, 1); }
}

/** A marked roof's way inside, drawn where it is solid: the opening, its floor and the ramp back up, and the glass. */
export function drawRoute(g: Ctx, x: number, roofY: number, flat: number, ramp: number, depth: number, hatch: number, broken: boolean, t: number): void {
  g.fillStyle = INK; g.fillRect(x, roofY + 6, flat, depth - 6);
  g.fillStyle = '#2c2052'; g.fillRect(x + 2, roofY + 8, flat - 4, depth - 10);
  g.fillStyle = '#493a7c';
  for (let k = 20; k < flat - 10; k += 46) g.fillRect(x + k, roofY + 14, 14, 12);
  g.fillStyle = '#ffd85a'; g.fillRect(x, roofY + depth, flat, 2);
  for (let k = 0; k < ramp; k++) {
    const top = Math.round(roofY + depth - (depth * k) / ramp);
    g.fillStyle = '#2c2052'; g.fillRect(x + flat + k, roofY, 1, top - roofY);
    g.fillStyle = Math.floor(k / 8) % 2 ? '#ffd85a' : '#fff6e0'; g.fillRect(x + flat + k, top, 1, 3);
  }
  // The pane in the deck: bright until someone goes through it.
  if (broken) {
    g.fillStyle = INK; g.fillRect(x + 6, roofY, hatch - 12, 8);
    g.fillStyle = '#bff6ff';
    for (let k = 8; k < hatch - 8; k += 9) g.fillRect(x + k, roofY + 2 + (k % 3) * 2, 3, 2);
  } else {
    g.fillStyle = INK; g.fillRect(x - 1, roofY - 2, hatch + 2, 9);
    g.fillStyle = '#7fd8f0'; g.fillRect(x, roofY - 1, hatch, 6);
    g.fillStyle = '#e8fdff';
    for (let k = 6; k < hatch - 6; k += 11) { g.fillRect(x + k, roofY, 2, 2); g.fillRect(x + k + 2, roofY + 2, 3, 1); }
  }
  // The sign that marks the building, ahead of the pane.
  // Well ahead of the pane, so it is read before it is reached.
  const sx = x - 130;
  g.fillStyle = INK; g.fillRect(sx + 26, roofY - 20, 3, 20); g.fillRect(sx - 2, roofY - 46, 60, 27);
  g.fillStyle = '#1f7f86'; g.fillRect(sx, roofY - 44, 56, 23);
  g.fillStyle = '#fff6e0'; g.font = '11px Galmuri11, sans-serif'; g.textBaseline = 'alphabetic';
  g.fillText('↓ 실내', sx + 10, roofY - 34);
  g.fillStyle = '#ffd85a'; g.fillText('보너스', sx + 12, roofY - 23);
  if (!broken && Math.floor(t * 4) % 2) { const cx = x + Math.floor(hatch / 2); g.fillStyle = '#7dfff0'; g.fillRect(cx - 1, roofY - 14, 3, 6); g.fillRect(cx - 3, roofY - 8, 7, 1); g.fillRect(cx - 1, roofY - 7, 3, 2); }
}

export function drawDrone(g: Ctx, x: number, y: number, t: number): void {
  const box = (c: string, a: number, b: number, w: number, h: number) => { g.fillStyle = c; g.fillRect(x + a, y + b, w, h); };
  box(INK, 2, 2, 12, 8); box('#e8465f', 3, 3, 10, 5); box('#a82a4a', 3, 7, 10, 2);
  box(INK, -2, 3, 5, 2); box(INK, 13, 3, 5, 2);
  box(INK, -1, 0, 1, 4); box(INK, 16, 0, 1, 4);
  const spin = Math.floor(t * 24) % 2;
  box('#dfe9ff', spin ? -4 : -2, 0, spin ? 7 : 3, 1); box('#dfe9ff', spin ? 13 : 15, 0, spin ? 7 : 3, 1);
  box('#fff6e0', 4, 4, 3, 3); box(INK, 4, 5, 2, 1);
  if (Math.floor(t * 6) % 2) box('#ffe14a', 10, 4, 2, 2);
}

export function drawPigeon(g: Ctx, x: number, y: number, t: number): void {
  const box = (c: string, a: number, b: number, w: number, h: number) => { g.fillStyle = c; g.fillRect(x + a, y + b, w, h); };
  box(INK, 1, 1, 13, 8); box('#9aa3c7', 3, 3, 10, 5); box('#6f79a8', 9, 4, 5, 2);
  box('#5ec9a0', 2, 4, 3, 2); box('#b9c0dd', 1, 2, 4, 3);
  box('#ff8a3c', -2, 3, 3, 2); box('#ff3b4e', 2, 3, 1, 1);
  const up = Math.floor(t * 9) % 2;
  box(INK, 5, up ? -5 : 4, 7, 5); box('#c9d0ea', 6, up ? -4 : 5, 5, 3);
}

export function drawDiamond(g: Ctx, x: number, y: number, t: number): void {
  const px = (c: string, a: number, b: number, w: number, h: number) => { g.fillStyle = c; g.fillRect(x + a, y + b, w, h); };
  const rows = [[3, 5], [1, 9], [0, 11], [1, 9], [2, 7], [3, 5], [4, 3], [5, 1]] as const;
  rows.forEach(([a, w], i) => { px(INK, a - 1, i, w + 2, 1); px(i < 2 ? '#d8fbff' : i < 4 ? '#6ee8ff' : '#2fa8e0', a, i, w, 1); });
  px('#ffffff', 3, 1, 3, 1);
  if (Math.floor(t * 5) % 3 === 0) { px('#fff', 9, -2, 1, 5); px('#fff', 7, 0, 5, 1); }
}

export function drawQuilt(g: Ctx, x: number, y: number, w: number, style: number, t: number): void {
  g.fillStyle = INK; g.fillRect(x - 1, y - 1, w + 2, 18);
  g.fillStyle = CLOTH[style]!; g.fillRect(x, y, w, 16);
  g.fillStyle = 'rgba(255,255,255,.55)';
  for (let k = 3; k < w - 3; k += 9) g.fillRect(x + k, y + 5 + (k % 2) * 5, 3, 3);
  g.fillStyle = '#fff6e0'; g.fillRect(x, y, w, 2);
  g.fillStyle = CLOTH[(style + 1) % 4]!; g.fillRect(x + 4 + Math.round(Math.sin(t * 3 + x * 0.01)), y + 16, 7, 4);
}

/** A see-through platform on poles: it has no sides, and the street runs beneath it. */
export function drawScaffold(g: Ctx, x: number, y: number, w: number, depth: number): void {
  g.fillStyle = '#4f5a86';
  for (let k = 6; k < w; k += 34) {
    g.fillRect(x + k, y + 5, 2, depth);
    for (let d = 8; d < depth; d += 34) g.fillRect(x + k, y + d, Math.min(34, w - k), 1);
  }
  g.fillStyle = INK; g.fillRect(x, y - 1, w, 8);
  g.fillStyle = '#ffb84a'; g.fillRect(x, y, w, 5);
  g.fillStyle = '#fff0b8'; g.fillRect(x, y, w, 1);
  g.fillStyle = '#b86a24';
  for (let k = 8; k < w; k += 16) g.fillRect(x + k, y + 1, 1, 4);
}

/** The street, its lamps and the striped ramp, down to the bottom of the view. */
export function drawRoad(g: Ctx, d: Road, cx: number, cy: number, H: number, night: number): void {
  const x = Math.round(d.x - cx), y = Math.round(d.y - cy);
  const flat = Math.round(d.rampStart - d.x), total = Math.round(d.rampEnd - d.x);
  if (y > H) return;
  const asphalt = night > 0.5 ? '#23264a' : '#4a3f63';
  g.fillStyle = night > 0.5 ? '#4a4f8a' : '#8a7a9c';
  for (let k = 40; k < flat; k += 130) {
    g.fillRect(x + k, y - 46, 2, 46); g.fillRect(x + k, y - 46, 14, 2);
    if (night > 0.3) { g.fillStyle = '#ffe9a8'; g.fillRect(x + k + 9, y - 44, 5, 2); g.fillStyle = '#4a4f8a'; }
  }
  g.fillStyle = asphalt; g.fillRect(x, y, total, H - y + 4);
  g.fillStyle = '#fff6e0'; g.fillRect(x, y, flat, 1);
  g.fillStyle = '#c9b8c0'; g.fillRect(x, y + 1, flat, 3);
  g.fillStyle = '#ffd85a';
  for (let k = 10; k < flat - 10; k += 30) g.fillRect(x + k, y + 13, 16, 2);
  // Arrows that point the way back up.
  g.fillStyle = '#7dfff0';
  for (let k = flat - 70; k > 0 && k > flat - 190; k -= 40) for (let i = 0; i < 5; i++) g.fillRect(x + k + i, y - 10 - (4 - i), 2, (4 - i) * 2 + 2);
  const run = total - flat, rise = d.y - d.rampY;
  for (let k = 0; k < run; k++) {
    const top = Math.round(y - (rise * k) / run);
    g.fillStyle = asphalt; g.fillRect(x + flat + k, top, 1, H - top + 4);
    g.fillStyle = Math.floor(k / 10) % 2 ? '#7dfff0' : '#fff6e0'; g.fillRect(x + flat + k, top, 1, 3);
  }
}

/** Marks the edge of a roof whose gap has a street below, before the runner commits. */
export function drawRoadSign(g: Ctx, r: Roof, x: number, y: number, t: number): void {
  for (let k = 0; k < 48; k++) { g.fillStyle = Math.floor(k / 6) % 2 ? INK : '#ffd85a'; g.fillRect(x + r.w - 48 + k, y, 1, 4); }
  const sx = x + r.w - 110;
  g.fillStyle = INK; g.fillRect(sx + 20, y - 24, 3, 24); g.fillRect(sx - 2, y - 46, 48, 23);
  g.fillStyle = '#2a9d6a'; g.fillRect(sx, y - 44, 44, 19);
  g.fillStyle = '#fff6e0';
  g.font = '11px Galmuri11, sans-serif';
  g.textBaseline = 'alphabetic';
  g.fillText('↓차', sx + 4, y - 30);
  const b = Math.floor(t * 4) % 2;
  g.fillRect(sx + 34, y - 41 + b, 3, 8); g.fillRect(sx + 31, y - 35 + b, 9, 2); g.fillRect(sx + 33, y - 33 + b, 5, 2);
}

export function drawFlag(g: Ctx, x: number, y: number, t: number): void {
  g.fillStyle = INK; g.fillRect(x - 1, y - 61, 4, 61);
  g.fillStyle = '#fff6e0'; g.fillRect(x, y - 60, 2, 60);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
    g.fillStyle = (i + j) % 2 ? INK : '#fff6e0';
    g.fillRect(x + 2 + i * 5, y - 60 + j * 5 + Math.round(Math.sin(t * 5 + i) * 1.2), 5, 5);
  }
}

export function drawWarning(g: Ctx, x: number, y: number, t: number): void {
  if (Math.floor(t * 7) % 2) return;
  g.fillStyle = INK; g.fillRect(x - 7, y - 8, 14, 16);
  g.fillStyle = '#ff4d5e'; g.fillRect(x - 6, y - 7, 12, 14);
  g.fillStyle = '#fff6e0'; g.fillRect(x - 1, y - 5, 3, 6); g.fillRect(x - 1, y + 3, 3, 2);
}

/** 9x9 pictures on the item capsules: '#' main colour, 'o' light, 'x' ink. */
const POWER_ART: Record<PowerKind, { color: string; rows: string[] }> = {
  boost: { color: '#ffd85a', rows: ['.....##..', '....##...', '...##....', '..######.', '....###..', '....##...', '...##....', '...#.....', '..#......'] },
  magnet: { color: '#ff5d6c', rows: ['oo.....oo', 'oo.....oo', '##.....##', '##.....##', '##.....##', '##.....##', '.##...##.', '.#######.', '..#####..'] },
  shield: { color: '#9be36b', rows: ['..#####..', '.##ooo##.', '##o####..', '#o######.', '#o######.', '#########', '#########', 'ooooooooo', '.........'] },
  double: { color: '#ff9be6', rows: ['.......#.', '......#.#', '#.#.....#', '#.#....#.', '.#....###', '#.#......', '#.#......', '.........', '.........'] },
  recharge: { color: '#7dfff0', rows: ['....#....', '...###...', '..#####..', '....#....', '....#....', '...###...', '..#####..', '.#######.', '.........'] },
  keep: { color: '#ffb84a', rows: ['..#####..', '.#.....#.', '.#.....#.', '#########', '####o####', '###ooo###', '####o####', '####o####', '#########'] },
  glider: { color: '#6ec8ff', rows: ['.........', '....#....', '..#####..', '#########', '.o..#..o.', '..o.#.o..', '...o#o...', '....#....', '...###...'] },
  slowmo: { color: '#b8a8ff', rows: ['..#####..', '.#ooooo#.', '#ooo#ooo#', '#ooo#ooo#', '#ooo##oo#', '#ooooooo#', '.#ooooo#.', '..#####..', '.........'] },
  fever: { color: '#ff7a3d', rows: ['..ooooo..', '..#####..', '..##o##..', '..#ooo#..', '..##o##..', '..#o#o#..', '..#####..', '..#####..', '..ooooo..'] },
  amulet: { color: '#ff6b81', rows: ['...o.o...', '....o....', '.##...##.', '####.####', '#o#######', '#o#######', '.#######.', '..#####..', '...###...'] },
  rush: { color: '#f5c440', rows: ['..#####..', '.#ooooo#.', '#oo###oo#', '#o#ooooo#', '#oo###oo#', '#ooooo#o#', '#oo###oo#', '.#ooooo#.', '..#####..'] },
  hook: { color: '#d8dbe5', rows: ['....#....', '....#....', '#...#...#', '##..#..##', '.##.#.##.', '..#####..', '....#....', '...ooo...', '...o.o...'] },
};

/** An item capsule; x, y is its middle. */
export function drawPower(g: Ctx, kind: PowerKind, x: number, y: number, t: number): void {
  const a = POWER_ART[kind];
  const cx = Math.round(x), cy = Math.round(y + Math.sin(t * 3 + x * 0.03) * 2);
  g.fillStyle = INK; g.fillRect(cx - 8, cy - 6, 17, 13); g.fillRect(cx - 6, cy - 8, 13, 17);
  g.fillStyle = a.color; g.fillRect(cx - 7, cy - 5, 15, 11); g.fillRect(cx - 5, cy - 7, 11, 15);
  g.fillStyle = '#2c2052'; g.fillRect(cx - 6, cy - 5, 13, 11); g.fillRect(cx - 5, cy - 6, 11, 13);
  a.rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.') return;
    g.fillStyle = ch === 'o' ? '#fff6e0' : a.color;
    g.fillRect(cx - 4 + i, cy - 4 + j, 1, 1);
  }));
  if (Math.floor(t * 3 + x) % 3 === 0) { g.fillStyle = '#fff'; g.fillRect(cx + 5, cy - 8, 1, 3); g.fillRect(cx + 4, cy - 7, 3, 1); }
}
export const powerColor = (kind: PowerKind) => POWER_ART[kind].color;
