import type { AchievementStat } from './achievements';

/** 9x9 pixel pictures, one per stat: '#' is ink. Drawn as SVG squares, so they stay crisp at any size. */
const ICONS: Record<AchievementStat, readonly string[]> = {
  // A runner in full stride.
  runs: ['.....##..', '.....##..', '...####..', '..#.##.#.', '....##...', '...#..#..', '..#....#.', '.#......#', '.........'],
  // A star.
  score: ['....#....', '....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
  // A flag at the end of the road.
  distance: ['.#.......', '.#####...', '.#######.', '.#####...', '.#.......', '.#.......', '.#.......', '.#.......', '###......'],
  // Down under a bar and out again.
  slides: ['#########', '.........', '....#....', '....#....', '..#.#.#..', '...###...', '....#....', '.........', '#########'],
  // A boot coming down, and the bump it makes.
  stomps: ['..####...', '..####...', '..####...', '..######.', '..#######', '.........', '#.#.#.#.#', '.#.#.#.#.', '.........'],
  // A bolt: one move straight into the next.
  maxCombo: ['.....##..', '....##...', '...##....', '..######.', '.....##..', '....##...', '...##....', '..##.....', '.##......'],
  // A target, hit dead centre.
  perfects: ['..#####..', '.#.....#.', '#..###..#', '#.#...#.#', '#.#.#.#.#', '#.#...#.#', '#..###..#', '.#.....#.', '..#####..'],
};

const SVG = 'http://www.w3.org/2000/svg';

/** A stat's pixel icon, drawn in the text colour. */
export function statIcon(stat: AchievementStat): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 9 9');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  // One path of unit squares: the cheapest way to draw a few dozen pixels.
  path.setAttribute('d', ICONS[stat].flatMap((row, y) => [...row].map((ch, x) => (ch === '#' ? `M${x} ${y}h1v1h-1z` : ''))).join(''));
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}
