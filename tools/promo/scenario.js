// 告知動画の台本（STOP! あおり運転）。ポップで軽快に。
// 場面は window.__game.world() を通して作る（あおり車を置く・撃つ）。ゲーム本体は変えない。
// 使える操作はスキルの references/scenario-api.md。

export const config = {
  slug: 'stop-aori',
  url: 'https://game.chozo.net/stop-aori/',
  orientation: 'portrait',
  game: { width: 390, height: 720 }, // スマホ縦（全画面で遊ぶゲームなので、縦長の画面に合わせて表示される）
  serveDir: 'dist',
  gamePath: '/stop-aori/',
  // BGM は make-bgm.mjs で一から合成したポップな曲（明るい長調・BPM156）。撮影ツール既定の合成リズム（synth）は使わない
  music: { file: 'tools/promo/bgm.wav', volume: 0.16 }, // 効果音より約14dB小さく（効果音の邪魔をしない）
};

// ---- 場面づくりの道具（ゲームの window で実行する） ----

/** 周りの車を消し、自動で車を出すのを止めて、自車を真ん中の車線に置く */
const clearRoad = (p) =>
  p.eval((_, win) => {
    const w = win.__game.world();
    w.opts.autoSpawn = false;
    w.cars.length = 0;
    w.missiles.length = 0;
    w.misses = 0;
    w.player.x = 0;
    w.player.targetLane = 1;
    w.player.speed = 100 / 3.6;
  });

/** あおり車を置く。where: 'front'（前に割り込んだ）/ 'rear'（後ろから迫る）/ 'weave'（前で蛇行） */
const placeAori = (p, where, gap, color) =>
  p.eval(
    ([where, gap, color], win) => {
      const w = win.__game.world();
      const pl = w.player;
      let a;
      if (where === 'rear') {
        a = w.spawnAori('tail', 1, pl.z - gap);
        a.mode = 'tailgate';
        a.flashing = true;
      } else if (where === 'weave') {
        a = w.spawnAori('frontWeave', 1, pl.z + gap, true);
        a.mode = 'frontWeave';
      } else {
        a = w.spawnAori('frontWeave', 1, pl.z + gap, true);
        a.mode = 'hold';
      }
      a.x = 0;
      a.aggressive = true; // もうあおった（撃ってよい）
      a.speed = pl.speed;
      a.dodgeT = 99; // 動画では、かわさせない
      if (color) a.color = color;
      return a.id;
    },
    [where, gap, color],
  );

/** 一般車を置く */
const placeCar = (p, lane, gap, model = 'sedan', color) =>
  p.eval(
    ([lane, gap, model, color], win) => {
      const w = win.__game.world();
      const c = w.addCar('normal', model, lane, w.player.z + gap, w.player.speed - (gap > 0 ? 1 : -1), color);
      return c.id;
    },
    [lane, gap, model, color],
  );

/** あおり車が自車の真後ろ・真ん前に重なるまで撮りながら待つ */
const aligned = (p, max = 4) =>
  p.until((s) => s?.cars?.some((c) => c.kind === 'aori' && !c.wrecked && Math.abs(c.x - s.x) < 0.35), { max });

export default async function scenario(p) {
  await p.seed(7);

  // 出来事に合わせた演出
  p.on('hit', (e) => {
    if (e.result.kind === 'defeat') {
      p.fx(['ドカーン！', '撃退！', 'バーン！', 'スカッ！'][Math.floor(Math.random() * 4)], { y: 0.47, size: 80 });
      p.shake(14, 0.35);
    } else {
      p.flash({ color: '#ff2a2a', strength: 0.5, dur: 0.3 });
    }
  });

  await p.call('start', 7);
  await p.skip(2.2); // 出発の案内が消えるまで撮らずに進める

  // ---- 0〜2秒: つかみ。前に割り込んだあおり車をスローで撃破 ----
  await clearRoad(p);
  await placeAori(p, 'front', 12, 0xd0201a);
  await placeCar(p, 2, 40, 'truck');
  await p.skip(0.2);
  p.zoom(1.18, 0.2, { x: 0.5, y: 0.5 });
  await p.wait(0.35);
  await p.call('tap', 'fireF');
  p.speed(0.35, { badge: false });
  await p.wait(1.25);
  p.speed(1);
  p.zoom(1, 0.3);

  // ---- 2〜5.5秒: タイトル ----
  p.title({ logo: 'logo.svg', sub: 'あおってきた車だけを\nミサイルで撃退！', dur: 3.6 });
  await p.wait(3.8);

  // ---- 本編1: 後ろからパッシング → 後ろへ撃つ ----
  await clearRoad(p);
  await placeAori(p, 'rear', 9, 0x222222);
  await placeCar(p, 0, 30, 'minivan');
  p.caption('後ろから\nパッシング！', { y: 0.31, dur: 2.4 });
  await p.wait(2.6);
  p.caption('後ろへミサイル！', { y: 0.31, dur: 1.2, color: '#ffe14d' });
  await aligned(p);
  await p.call('tap', 'fireR');
  await p.wait(1.3);

  // ---- 本編2: 割り込んで急ブレーキ → 前へ撃つ ----
  await clearRoad(p);
  await placeAori(p, 'front', 16, 0xffffff);
  await p.eval((_, win) => {
    const w = win.__game.world();
    const a = w.cars.find((c) => c.kind === 'aori');
    w.beginBrake(a);
  });
  p.caption('割り込んで\n急ブレーキ！', { y: 0.31, dur: 1.6 });
  await p.wait(0.9);
  await p.call('tap', 'fireF');
  await p.wait(1.4);

  // ---- 本編3: 前で蛇行 → 重なった瞬間に前へ撃つ ----
  await clearRoad(p);
  await placeAori(p, 'weave', 14, 0xf2f2f2);
  await placeCar(p, 2, -12, 'sedan');
  p.caption('前で蛇行運転！', { y: 0.31, dur: 2.0 });
  await p.wait(2.1);
  p.caption('重なった瞬間に撃て！', { y: 0.31, dur: 1.4, color: '#ffe14d' });
  await aligned(p);
  await p.call('tap', 'fireF');
  await p.wait(1.2);

  // ---- 本編4: 一般車に当てるとミス ----
  await clearRoad(p);
  await placeCar(p, 1, 16, 'sedan', 0x4fa3ff);
  p.caption('でも一般車に\n当てたらミス！', { y: 0.31, dur: 2.0, color: '#ffb3b3' });
  await p.wait(0.5);
  await p.call('tap', 'fireF');
  await p.wait(2.1);

  // ---- 本編5: 早送りで連続撃退 ----
  p.speed(2);
  p.caption('次々あおってくる！', { y: 0.31, dur: 1.4 });
  for (const [where, gap, color, dir] of [
    ['front', 12, 0xff8a00, 'fireF'],
    ['rear', 8, 0x6a2cff, 'fireR'],
    ['front', 13, 0x1aa35a, 'fireF'],
    ['rear', 9, 0xff3d77, 'fireR'],
  ]) {
    await clearRoad(p);
    await placeAori(p, where, gap, color);
    await p.wait(0.25);
    await aligned(p, 2);
    await p.call('tap', dir);
    await p.wait(0.55);
  }
  p.speed(1);

  // ---- クライマックス: 名古屋IC 到着 ----
  await clearRoad(p);
  await p.eval((_, win) => {
    const w = win.__game.world();
    w.player.z = 5400 - 22;
    w.defeated = 21;
  });
  p.caption('名古屋ICまで\nあと少し！', { y: 0.31, dur: 0.9 });
  await p.until((s) => s?.state === 'clear', { max: 3 });
  p.zoom(1.12, 0.35, { x: 0.5, y: 0.45 }); // 「名古屋IC 到着！」と紙吹雪を大きく
  await p.wait(2.4); // 結果画面（スコア・ランク）が出る前に切り替える
  p.zoom(1, 0.01); // 紙吹雪と「名古屋IC 到着！」（結果画面が出る前に切り替える）

  // ---- エンドカード ----
  p.endCard({ logo: 'logo.svg', sub: '東名高速を東京ICから\n名古屋ICへ', cta: '今すぐ遊べる！' });
  await p.wait(4.0);
}
