export const POWER_KINDS = ['boost', 'magnet', 'shield', 'double', 'recharge', 'keep'] as const;
export type PowerKind = (typeof POWER_KINDS)[number];
export interface Power { id: number; kind: PowerKind; x: number; y: number; taken: boolean }

export const POWER_NAMES: Record<PowerKind, string> = {
  boost: '번개 신발', magnet: '동전 자석', shield: '안전모', double: '점수 2배', recharge: '점프 충전', keep: '콤보 고정',
};
export const POWER_TEXT: Record<PowerKind, string> = {
  boost: '5초 동안 세상이 1.3배 빨라지고, 새 옥상에 내릴 때마다 30점',
  magnet: '8초 동안 가까운 동전을 끌어당김',
  shield: '실외기·물탱크·방해꾼 충돌을 한 번 막음 (자동차·추락 제외)',
  double: '8초 동안 동전·점프·아이템 등 보너스 점수 2배 (미션 보상 제외)',
  recharge: '2단 점프를 바로 충전하고 공중 점프 1번 추가 (2번까지 모음)',
  keep: '10초 동안 콤보 시간이 줄지 않음',
};
/** Seconds each effect lasts; 0 means it waits until used. Counted in real time, whatever the speed. */
export const POWER_TIME: Record<PowerKind, number> = { boost: 5, magnet: 8, shield: 0, double: 8, recharge: 0, keep: 10 };
export const POWER_POINTS = 20;

/**
 * Speeding up changes how fast time passes for the runner, not how far a jump goes:
 * every jump covers exactly the same ground, so nothing becomes unreachable.
 */
export const BOOST_RATE = 1.3;
export const MAX_AIR_BONUS = 2;
export const MAGNET_RANGE = 110;
export const MAGNET_SPEED = 460;
export const DASH_POINTS = 30;
