// ゲームの調整値はすべてここにまとめる
export const kmh = (v: number) => v / 3.6;

// 車種ごとの寸法（m）
export const DIMS = {
  sedan: { length: 4.6, width: 1.8, height: 1.45 },
  compact: { length: 3.9, width: 1.7, height: 1.5 },
  suv: { length: 4.7, width: 1.9, height: 1.75 },
  minivan: { length: 4.8, width: 1.85, height: 1.9 },
  sports: { length: 4.4, width: 1.85, height: 1.25 },
  truck: { length: 8.5, width: 2.4, height: 3.2 },
  bus: { length: 11, width: 2.5, height: 3.3 },
} as const;

export const CONFIG = {
  laneWidth: 3.6,
  laneCount: 3,
  // 東京IC〜名古屋IC（約326km）を縮めたコースの長さ（m）。100km/hで約3分
  courseLength: 5400,

  player: {
    startKmh: 100,
    minKmh: 40,
    maxKmh: 140,
    accel: 7,
    brake: 14,
    lateralSpeed: 10,
    length: 4.0,
    width: 1.75,
    invuln: 2.0, // 接触後の無敵時間（秒）
  },

  missile: {
    relSpeed: 70, // 自車に対する速さ（m/s）
    range: 100, // 飛ぶ距離（m）。かわされた・外れたミサイルも、この距離までは飛んで一般車に当たる
    cooldown: 1.0, // 次に撃てるまで（秒）。前後それぞれ
    radius: 0.35,
  },

  maxMisses: 3,
  policeMisses: 2, // 覆面パトカーを撃ったときのミス数

  traffic: {
    ahead: 260, // 前方に車を置く範囲（m）
    behind: 110, // 後方に車を置く範囲（m）
    countStart: 8,
    countEnd: 14,
    spawnGap: 0.35,
  },

  // 紛らわしい車（急いでいる一般車・覆面パトカー）
  decoy: {
    first: 4,
    intervalMin: 9,
    intervalMax: 16,
    policeFrom: 0.2, // この進み具合から覆面パトカーが出る
    policeRate: 0.35,
  },

  aori: {
    first: 2, // 最初のあおり車が出る時刻（秒）
    intervalStart: 3, // 次のあおり車を出すまでの間隔（秒）序盤
    intervalEnd: 1.5, // 終盤
    activeStart: 2, // いつも絡んでいるあおり車の数 序盤
    activeEnd: 4, // 終盤
    frontRate: 0.4, // 前方から出てくる割合
    spawnBehind: 50, // 後ろから出るときの距離（m）
    spawnAhead: [70, 100], // 前方から出るときの距離（m）
    maxActs: 5, // 1台が繰り出す手口の数。超えたら走り去る
    maxLife: 45, // これを過ぎたら走り去る（秒）
    tailGap: 3.5, // 車間詰めのときの車間（m）
    tailTime: [3.5, 5.5], // 車間詰めを続ける時間（秒）
    cutGap: 5.5, // 割り込みを始める前方の車間（m）
    cutLateral: 5.5,
    brakeDecel: 9,
    brakeTime: 1.3,
    holdGap: 11, // 割り込んだあと前に居座る車間（m）
    holdTime: 1.2,
    frontWeaveTime: 5, // 前で蛇行する時間（秒）
    tapTime: 4.5, // ムダブレーキを続ける時間（秒）
    tapPeriod: 1.1, // ムダブレーキの間隔（秒）
    tapOn: 0.35, // 1回のブレーキの長さ（秒）
    tapDecel: 6,
    frontGap: 13, // 前で蛇行・ムダブレーキするときの車間（m）
    sideTime: 3, // 並走・幅寄せの時間（秒）
    swerve: 1.2, // 幅寄せで寄ってくる幅（m）
    dodgeStart: 0.15, // ミサイルをかわす確率（序盤）
    dodgeEnd: 0.5, // ミサイルをかわす確率（終盤）
    // 蛇行する幅（m）。自車の真後ろ・真ん前から約1.25m以上ずれた瞬間に撃つと外れる
    weaveStart: 1.8, // 序盤: 約3割の時間は外れる
    weaveEnd: 2.3, // 終盤: 約4〜5割の時間は外れる（隣の車線にはみ出す）
    weaveRange: 30, // 後ろからこの車間まで迫ると蛇行を始める（m）
    dodgeRange: 32, // ミサイルがこの距離まで来たら、かわすかを決める（m）
    // 自車との車間がこれより近いとかわさない（至近距離で撃てば必ず届く）
    dodgeNear: 10,
    // 車間がこれ以上離れていると、上の確率どおりにかわす（間は少しずつ上がる）
    dodgeFar: 20,
    dodgeLateral: 12,
    noSpawnLast: 250, // ゴール手前のこの距離では出さない
  },

  score: {
    defeat: 1000,
    clear: 5000,
    perLife: 1500,
    parTime: 200,
    perSecond: 25,
  },
} as const;
