const PAL: Record<string, string> = {
  k: '#1a1230', y: '#ffcf4a', Y: '#e09a2c', s: '#ffd3a8', h: '#4a2b2b', r: '#ff4d5e',
  b: '#3fc6c0', B: '#23838f', d: '#3a3f7a', w: '#fff6e0', o: '#ff8a3c', O: '#b9562b',
};
function sprite(rows: string[], pal = PAL): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(...rows.map((r) => r.length));
  c.height = rows.length;
  const g = c.getContext('2d')!;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const col = pal[ch];
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }));
  return c;
}

// A rooftop courier: yellow cap, teal hoodie, orange parcel on the back.
const BODY = [
  '....kkkkk.....',
  '...kyyyyyk....',
  '..kyyyyyyyk...',
  '..kYYYYYkkkkk.',
  '..khhsssksk...',
  '..khssssksk...',
  '...kssssssk...',
  '.kkkrrrrrrk...',
  'koookbbbbbk...',
  'kowokbbbbssk..',
  'kOOOkbbbbkk...',
  '.kkkkBBBBk....',
];

export interface Sprites {
  run: HTMLCanvasElement[]; jump: HTMLCanvasElement; fall: HTMLCanvasElement;
  /** Going down, gliding and getting up: drawn at their own size, never squeezed from another pose. */
  slide: HTMLCanvasElement[];
  coin: HTMLCanvasElement[]; gold: HTMLCanvasElement[];
}

/** The runner's pictures in a costume's colours (the courier's own when none); coins never change. */
export function makeSprites(costume: Partial<Record<string, string>> = {}): Sprites {
  const pal = { ...PAL, ...costume } as Record<string, string>;
  const legs = (...rows: string[]) => sprite([...BODY, ...rows], pal);
  const coin = [
    ['.kkkkk.', 'kyyyyYk', 'kywwyYk', 'kywyyYk', 'kywyyYk', 'kyyyYYk', '.kkkkk.'],
    ['..kkk..', '.kyyYk.', '.kwyYk.', '.kwyYk.', '.kwyYk.', '.kyYYk.', '..kkk..'],
    ['...k...', '..kyk..', '..kyk..', '..kwk..', '..kyk..', '..kyk..', '...k...'],
    ['..kkk..', '.kYyyk.', '.kYywk.', '.kYywk.', '.kYywk.', '.kYYyk.', '..kkk..'],
  ];
  return {
    run: [
      legs('....kddddk....', '...kddkkddk...', '..kwwk..kwwk..', '..kkk....kkk..'),
      legs('....kddddk....', '....kdddkk....', '...kwwkdk.....', '....kkkwwk....'),
      legs('....kddddk....', '....kdddk.....', '....kdwwk.....', '....kwwkk.....'),
      legs('....kddddk....', '...kdkkddk....', '..kwk..kwwk...', '...k....kk....'),
    ],
    jump: legs('....kddddkk...', '...kddkkddwk..', '..kwwk..kkk...', '...kk.........'),
    fall: legs('...kkddddk....', '..kwddkkddk...', '...kkk..kwwk..', '.........kk...'),
    // Knees folded, legs out ahead, the parcel still on the back.
    slide: [
      sprite([
        '.......kkkkk........',
        '......kyyyyyk.......',
        '.....kyyyyyyyk......',
        '.....kYYYYYkkkkk....',
        '.....khssksskk......',
        '..kkkkkssssskk......',
        '.koookrrrrrrk.......',
        '.kowokbbbbbsskkkk...',
        '.kOOOkBBbddddddwwk..',
        '..kkkkkkkkkkkkkkkk..',
      ], pal),
      sprite([
        '....................',
        '.....kkkkk..........',
        '....kyyyyyk.........',
        '...kyyyyyyyk........',
        '...kYYYYYkkkkk......',
        '.kkkhssksskk........',
        'koookssssskk..kk....',
        'kowokrrrrbbkkkddk...',
        'kOOOkBBbbssddkddwwwk',
        '.kkkkkkkkkkkkkkkkkk.',
      ], pal),
      sprite([
        '......kkkkk.........',
        '.....kyyyyyk........',
        '....kyyyyyyyk.......',
        '....kYYYYYkkkkk.....',
        '....khssksskk.......',
        '.kkkkkssssskk.......',
        'koookrrrrrrk.kkk....',
        'kowokbbbbsskkdddk...',
        'kOOOkBBBddddkkdwwk..',
        '.kkkkkkkkkkk..kkkk..',
      ], pal),
    ],
    coin: coin.map((r) => sprite(r)),
    gold: coin.map((r) => sprite(r, { ...PAL, y: '#ff7ad9', Y: '#c23fb0' })),
  };
}
