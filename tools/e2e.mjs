// ブラウザでの動作確認（playwright-core + インストール済み Chrome）
// 使い方: npm run build && npm run e2e        公開URLで確かめる: npm run e2e -- https://...
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('tools/out');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let server;
let url = process.argv[2];
if (!url) {
  server = await preview({ preview: { port: 4179, strictPort: false } });
  url = server.resolvedUrls.local[0];
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK ' : 'NG '} ${name} ${info}`);
};

async function run(viewport, label, mobile = false) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${label}-1-title.png` });

  // 開始して、時間を手動で進める
  await page.click('#startBtn');
  await page.evaluate(() => {
    window.__game.manual(true);
    window.__game.start(3);
  });
  const s0 = await page.evaluate(() => window.__game.state());
  check(`${label}: 開始`, s0.phase === 'playing' && s0.state === 'playing');

  if (mobile) {
    // タッチのボタンで操作できるか
    const lane0 = (await page.evaluate(() => window.__game.state())).lane;
    await page.tap('[data-act=right]');
    const lane1 = (await page.evaluate(() => window.__game.state())).lane;
    await page.tap('[data-act=left]');
    await page.tap('[data-act=fireF]');
    const ev0 = await page.evaluate(() => {
      window.__game.step(1);
      return window.__game.drainEvents();
    });
    check(`${label}: タッチで車線変更と発射`, lane1 === lane0 + 1 && ev0.some((e) => e.type === 'fire'));
    const box = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const inView = (b) => b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
      return ['[data-act=left]', '[data-act=right]', '[data-act=fireF]', '[data-act=fireR]', '#rearview', '.panel.stat'].every((s) => inView(r(s)));
    });
    check(`${label}: ボタンとHUDが画面に収まる`, box);
    await page.evaluate(() => {
      window.__game.start(3);
    });
  }

  // あおり車が車間を詰めてくるまで進める（ぶつからないように軽く避ける）
  let tail = null;
  for (let i = 0; i < 40 && !tail; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      g.step(30);
      g.world().misses = 0;
    });
    tail = await page.evaluate(() => window.__game.state().cars.find((c) => c.kind === 'aori' && c.mode === 'tailgate'));
  }
  check(`${label}: あおり車が車間を詰めてくる`, !!tail);
  await page.evaluate(() => window.__game.step(20));
  await page.screenshot({ path: `${OUT}/${label}-2-tailgate.png` });

  // 後ろへ撃つ
  await page.evaluate(() => window.__game.tap('fireR'));
  await page.evaluate(() => window.__game.step(8));
  await page.screenshot({ path: `${OUT}/${label}-3-fire.png` });
  await page.evaluate(() => window.__game.step(30));
  const ev = await page.evaluate(() => window.__game.drainEvents());
  const hit = ev.find((e) => e.type === 'hit');
  check(`${label}: ミサイルが当たる`, !!hit, hit ? hit.result.kind : '');
  await page.screenshot({ path: `${OUT}/${label}-4-hit.png` });

  // 富士山のあたりまで進める
  await page.evaluate(() => {
    const w = window.__game.world();
    w.player.z = 5400 * 0.3;
    w.cars.length = 0;
    window.__game.step(240);
  });
  await page.screenshot({ path: `${OUT}/${label}-5-fuji.png` });

  // IC を通過しても画面に「◯◯IC通過」を出さない
  const icBanner = await page.evaluate(() => {
    const g = window.__game;
    const w = g.world();
    w.misses = 0;
    w.player.z = 5400 * 0.5;
    g.step(5);
    const b = document.getElementById('banner');
    return b.classList.contains('show') ? b.textContent : '';
  });
  check(`${label}: IC通過の表示が出ない`, !icBanner.includes('IC'), icBanner);

  // ゴール直前へ
  await page.evaluate(() => {
    const w = window.__game.world();
    w.misses = 0;
    w.player.z = 5400 - 30;
    w.player.speed = 30;
    w.defeated = 12;
    const g = window.__game;
    for (let i = 0; i < 300 && w.state !== 'clear'; i++) g.step(1);
    for (let i = 0; i < 30; i++) g.step(2); // 紙吹雪が広がるまで1コマずつ描く
  });
  const goal = await page.evaluate(() => !document.getElementById('goal').hidden);
  check(`${label}: ゴールで「名古屋IC 到着！」と紙吹雪`, goal);
  await page.screenshot({ path: `${OUT}/${label}-6a-goal.png` });
  // 結果画面で、退治した台数を数え上げてランクのハンコを押す
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 150; i++) g.step(2);
  });
  const sc = await page.evaluate(() => ({
    ...window.__game.state(),
    title: document.getElementById('rTitle').textContent,
    count: document.getElementById('rCount').textContent.replace(/\s+/g, ''),
    stamped: document.getElementById('rRank').classList.contains('stamped'),
  }));
  check(`${label}: クリア`, sc.state === 'clear' && sc.phase === 'result');
  check(`${label}: 到着と退治台数の表示`, sc.title.includes('名古屋に到着') && sc.count === '退治したあおり車両は12台です！' && sc.stamped, `${sc.title} / ${sc.count}`);
  await page.screenshot({ path: `${OUT}/${label}-6-clear.png` });

  // もう一度 → ゲームオーバー
  await page.click('#retryBtn');
  await page.evaluate(() => window.__game.manual(true));
  await page.evaluate(() => {
    const w = window.__game.world();
    for (let i = 0; i < 3; i++) {
      w.addCar('normal', 'sedan', w.player.targetLane, w.player.z + 25, w.player.speed);
      w.fire(1);
      window.__game.step(70);
    }
    window.__game.step(150);
  });
  const so = await page.evaluate(() => window.__game.state());
  check(`${label}: 3ミスでゲームオーバー`, so.state === 'over' && so.phase === 'result');
  // ゲームオーバー後は、周りの車がクラクションを鳴らしても音を出さない
  const horns = await page.evaluate(() => {
    const g = window.__game;
    let n = 0;
    const orig = g.audio.horn.bind(g.audio);
    g.audio.horn = (d) => {
      n++;
      orig(d);
    };
    const w = g.world();
    w.opts.autoSpawn = false;
    const c = w.spawnAori('tail', w.player.targetLane, w.player.z - 6);
    c.mode = 'tailgate';
    c.aggressive = true;
    g.step(300);
    g.audio.horn = orig;
    return { n, hornEvents: g.drainEvents().filter((e) => e.type === 'horn').length };
  });
  check(`${label}: ゲームオーバー後はクラクションが鳴らない`, horns.n === 0 && horns.hornEvents > 0, JSON.stringify(horns));
  await page.screenshot({ path: `${OUT}/${label}-7-over.png` });

  await page.click('#titleBtn');
  check(`${label}: タイトルへ戻る`, (await page.evaluate(() => window.__game.phase)) === 'title');
  check(`${label}: エラーなし`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

await run({ width: 1280, height: 720 }, 'pc');
await run({ width: 390, height: 844 }, 'sp-portrait', true);
await run({ width: 844, height: 390 }, 'sp-landscape', true);
await run({ width: 360, height: 640 }, 'sp-small', true);

await browser.close();
if (server) await new Promise((r) => server.httpServer.close(r));
const ng = results.filter((r) => !r.ok).length;
console.log(ng ? `${ng} 件の失敗` : 'すべて成功');
process.exit(ng ? 1 : 0);
