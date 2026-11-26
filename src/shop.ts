/**
 * The shop's catalog, shared by the page and the server: the server sells only what is listed here, at these
 * prices. Coins come from verified weekly runs only.
 */

/** The runner's colours, by the letters the sprites are drawn with: cap, cap shade, skin, hair, scarf, hoodie,
 * hoodie shade, trousers, shoes and highlights, parcel, parcel shade. The outline (k) never changes. */
export type PaletteKey = 'y' | 'Y' | 's' | 'h' | 'r' | 'b' | 'B' | 'd' | 'w' | 'o' | 'O';

export interface Costume {
  id: string;
  name: string;
  text: string;
  price: number;
  /** Colours changed from the courier's own. */
  pal: Partial<Record<PaletteKey, string>>;
  /** A few sparkles follow the runner. */
  sparkle?: string;
}

export const DEFAULT_COSTUME = 'courier';

export const COSTUMES: readonly Costume[] = [
  { id: 'courier', name: '옥상 택배원', text: '노란 모자, 청록 후드, 등에는 택배 상자', price: 0, pal: {} },
  {
    id: 'neon', name: '야광 러너', text: '밤 옥상에서 빛나는 형광 차림', price: 3000,
    pal: { y: '#7dfff0', Y: '#3fa6c0', r: '#ff9be6', b: '#3a2c6a', B: '#24193b', d: '#1a1230', o: '#7dfff0', O: '#3fa6c0' },
  },
  {
    id: 'firefighter', name: '소방관', text: '빨간 안전모와 방화복', price: 5000,
    pal: { y: '#e8465f', Y: '#a82a4a', r: '#ffd85a', b: '#c9a24a', B: '#8a6a20', d: '#5a4a30', o: '#e8465f', O: '#a82a4a' },
  },
  {
    id: 'ninja', name: '닌자', text: '검은 두건에 붉은 띠', price: 10000,
    pal: { y: '#2a2440', Y: '#140c2e', h: '#140c2e', r: '#e8465f', b: '#2a2440', B: '#1a1230', d: '#2a2440', w: '#5a5480', o: '#3a3456', O: '#24193b' },
  },
  {
    id: 'santa', name: '산타 배달부', text: '선물 자루를 멘 빨간 옷', price: 20000,
    pal: { y: '#e8465f', Y: '#fff6e0', r: '#fff6e0', b: '#e8465f', B: '#a82a4a', d: '#3a1c2a', o: '#9b6a3a', O: '#6a4422' },
  },
  {
    id: 'astronaut', name: '우주 비행사', text: '하얀 헬멧과 산소통', price: 35000,
    pal: { y: '#f4f1f8', Y: '#bdb6d2', s: '#bff6ff', h: '#7fd8f0', r: '#ff8a3c', b: '#f4f1f8', B: '#9a93ae', d: '#bdb6d2', o: '#9aa3c7', O: '#6f79a8' },
  },
  {
    id: 'cat', name: '고양이 후드', text: '주황 줄무늬 고양이 후드', price: 60000,
    pal: { y: '#ff9a3c', Y: '#c96a1f', r: '#fff6e0', b: '#ff9a3c', B: '#c96a1f', d: '#5a3a24', o: '#fff6e0', O: '#d8c8b0' },
  },
  {
    id: 'gold', name: '황금 러너', text: '온몸이 금빛, 뒤로 반짝임이 따라와요', price: 100000,
    pal: { y: '#ffe066', Y: '#c9962a', r: '#fff6c8', b: '#ffcf4a', B: '#b8862a', d: '#8a6418', w: '#fff6c8', o: '#ffe066', O: '#c9962a' },
    sparkle: '#fff6c8',
  },
];

export const costumeById = (id: string | null | undefined): Costume =>
  COSTUMES.find((c) => c.id === id) ?? COSTUMES[0]!;
