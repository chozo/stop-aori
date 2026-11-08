import { describe, expect, it } from 'vitest';
import { CONFIG as C } from '../src/config';
import { World, laneX } from '../src/sim';

const empty = () => new World(1, { autoSpawn: false, initialTraffic: false });
const run = (w: World, sec: number, each?: () => void) => {
  for (let i = 0; i < sec * 60; i++) {
    each?.();
    w.step(1 / 60);
  }
};

describe('ミサイル', () => {
  it('あおる前に撃つとミス', () => {
    const w = empty();
    w.spawnAori('tail', 1, w.player.z - 55);
    w.fire(-1);
    run(w, 1);
    expect(w.misses).toBe(1);
    expect(w.defeated).toBe(0);
  });

  it('車間を詰めてきたあおり車を撃つと撃退', () => {
    const w = empty();
    const car = w.spawnAori('tail', 1, w.player.z - 40);
    run(w, 8, () => {
      if (car.aggressive) w.fire(-1);
    });
    expect(car.aggressive).toBe(true);
    expect(w.misses).toBe(0);
    expect(w.defeated).toBe(1);
  });

  it('前方の一般車に当てるとミス', () => {
    const w = empty();
    w.addCar('normal', 'sedan', 1, w.player.z + 40, w.player.speed);
    w.fire(1);
    run(w, 1);
    expect(w.misses).toBe(1);
    expect(w.wrongHits).toBe(1);
  });

  it('覆面パトカーに当てるとミス2', () => {
    const w = empty();
    w.addCar('police', 'sedan', 1, w.player.z + 40, w.player.speed);
    w.fire(1);
    run(w, 1);
    expect(w.misses).toBe(2);
  });

  it('別の車線の車には当たらない', () => {
    const w = empty();
    w.addCar('normal', 'sedan', 0, w.player.z + 40, w.player.speed);
    w.fire(1);
    run(w, 3);
    expect(w.misses).toBe(0);
  });

  const dodgeCase = (civilianBehind: number, aoriBehind = 30) => {
    let dodged = 0;
    let civilianHit = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = new World(seed, { autoSpawn: false, initialTraffic: false });
      w.player.z = C.courseLength - 400; // かわす確率が高い終盤
      const p = w.player;
      const aori = w.spawnAori('tail', 1, p.z - aoriBehind);
      aori.aggressive = true;
      aori.mode = 'tailgate';
      aori.speed = p.speed;
      w.addCar('normal', 'sedan', 1, aori.z - civilianBehind, p.speed);
      w.fire(-1);
      run(w, 2.5);
      if (w.events.some((e) => e.type === 'dodge')) {
        dodged++;
        if (w.wrongHits === 1) civilianHit++;
      }
    }
    return { dodged, civilianHit };
  };

  it('あおり車がかわすと、後ろの一般車に流れ弾が当たる', () => {
    for (const d of [10, 45, 75]) {
      const r = dodgeCase(d);
      expect(r.dodged).toBeGreaterThan(5);
      expect(r.civilianHit).toBe(r.dodged);
    }
  });

  it('至近距離のあおり車はミサイルをかわさない', () => {
    for (const behind of [8, 12]) {
      const r = dodgeCase(200, behind);
      expect(r.dodged).toBe(0);
    }
  });

  it('離れているあおり車は、終盤ならかなりの確率でかわす', () => {
    const r = dodgeCase(200, 40);
    expect(r.dodged).toBeGreaterThan(12); // 40回中、確率0.5前後
  });

  it('ミサイルの届く距離（100m）より先の一般車には当たらない', () => {
    const r = dodgeCase(100);
    expect(r.dodged).toBeGreaterThan(5);
    expect(r.civilianHit).toBe(0);
  });
});

describe('接触', () => {
  it('前の車にぶつかるとミス1、続けてぶつかっても無敵時間中は増えない', () => {
    const w = empty();
    w.addCar('normal', 'truck', 1, w.player.z + 12, w.player.speed - 10);
    run(w, 1.5);
    expect(w.misses).toBe(1);
  });

  it('割り込み＋急ブレーキで、車間が危険なほど詰まる', () => {
    const w = empty();
    const car = w.spawnAori('cut', 0, w.player.z - 30);
    car.targetLane = 0;
    car.x = laneX(0);
    let minGap = Infinity;
    let braked = false;
    run(w, 10, () => {
      if (car.mode === 'brake') braked = true;
      if (braked && Math.abs(car.x - w.player.x) < 1) minGap = Math.min(minGap, car.z - w.player.z - (car.length + w.player.length) / 2);
    });
    expect(car.aggressive).toBe(true);
    expect(braked).toBe(true);
    expect(minGap).toBeLessThan(2);
  });

  it('3ミスでゲームオーバー', () => {
    const w = empty();
    for (let i = 0; i < 3; i++) {
      w.addCar('normal', 'sedan', 1, w.player.z + 30, w.player.speed);
      w.fire(1);
      run(w, 1.2);
    }
    expect(w.misses).toBe(3);
    expect(w.state).toBe('over');
  });
});

describe('ミスは回復しない', () => {
  it('何台撃退しても、累計3ミスでゲームオーバー', () => {
    const w = empty();
    for (let i = 0; i < 3; i++) {
      // あおり車を4台撃退してから、一般車に1回当てる
      for (let k = 0; k < 4; k++) {
        const a = w.spawnAori('tap', 1, w.player.z + 30, true);
        a.aggressive = true;
        a.dodgeT = 99;
        w.fire(1);
        run(w, 1.1);
      }
      w.addCar('normal', 'sedan', 1, w.player.z + 30, w.player.speed);
      w.fire(1);
      run(w, 1.1);
      expect(w.misses).toBe(i + 1);
    }
    expect(w.defeated).toBe(12);
    expect(w.state).toBe('over');
  });
});

describe('ゴール', () => {
  it('名古屋ICに着くとクリアし、全ICを通過する', () => {
    const w = empty();
    w.player.z = C.courseLength - 5;
    run(w, 1);
    expect(w.state).toBe('clear');
    const ics = w.events.filter((e) => e.type === 'ic');
    expect(ics.at(-1)).toMatchObject({ name: '名古屋' });
  });
});
