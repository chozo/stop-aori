// 東名高速の主なIC（東京ICからのおおよその距離 km）。ゲーム用の目安
export interface Ic {
  name: string;
  km: number;
}

export const ROUTE: Ic[] = [
  { name: '東京', km: 0 }, // 東名高速の起点
  { name: '東名川崎', km: 7.6 },
  { name: '横浜町田', km: 19.7 },
  { name: '厚木', km: 35.0 },
  { name: '大井松田', km: 57.9 },
  { name: '御殿場', km: 83.7 },
  { name: '沼津', km: 103.0 },
  { name: '富士', km: 128.0 },
  { name: '静岡', km: 167.7 },
  { name: '掛川', km: 214.0 },
  { name: '浜松', km: 252.0 },
  { name: '三ヶ日', km: 280.0 },
  { name: '豊川', km: 293.0 },
  { name: '岡崎', km: 310.0 },
  { name: '名古屋', km: 325.5 },
];

const START = ROUTE[0].km;
export const TOTAL_KM = ROUTE[ROUTE.length - 1].km - START;

/** 進み具合（0〜1）を東京ICからの km に直す */
export const progressToKm = (p: number) => START + Math.min(1, Math.max(0, p)) * TOTAL_KM;
/** 名古屋ICまでの残り km */
export const kmRemaining = (p: number) => TOTAL_KM * (1 - Math.min(1, Math.max(0, p)));
/** i 番目のICの進み具合 */
export const icProgress = (i: number) => (ROUTE[i].km - START) / TOTAL_KM;
/** まだ通過していない最初のIC */
export function nextIcIndex(p: number): number {
  for (let i = 1; i < ROUTE.length; i++) if (icProgress(i) > p + 1e-9) return i;
  return ROUTE.length - 1;
}
