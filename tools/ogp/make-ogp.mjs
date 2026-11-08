// OGP画像（public/ogp.png、1200×630）を作る
// 使い方: npm run dev（別ターミナル）→ npm run ogp
// 1. 決まった乱数でゲームを始め、前に割り込んだあおり車に前方ミサイルが当たって爆発した瞬間を撮る（吹き出しは消す）
// 2. その絵を背景に、タイトル・遊び方・URLを重ねて撮る
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT ?? 'public/ogp.png';
const SEED = Number(process.env.SEED ?? 3);
const AFTER_FIRE = Number(process.env.AFTER_FIRE ?? 10); // 発射から何コマ後を撮るか（1/60秒単位）
const W = 1200;
const H = 630;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=metal', '--enable-gpu'] });

// 1. 背景
const game = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
game.on('pageerror', (e) => errors.push(String(e)));
await game.goto(URL);
await game.waitForFunction(() => window.__game);
await game.evaluate((seed) => {
  const g = window.__game;
  g.audio.setMuted?.(true);
  g.start(seed);
  g.manual(true);
}, SEED);
// 3D画面を横に広く描き、道路の中心が右寄り（文字と重ならない位置）に来るようにする
const VIEW = { w: 1560, h: 680, left: 0, top: -30 };
await game.addStyleTag({
  content: `#game > :not(canvas){display:none!important} .screen{display:none!important}
#app{inset:auto!important;width:${VIEW.w}px!important;height:${VIEW.h}px!important;left:${VIEW.left}px!important;top:${VIEW.top}px!important}`,
});
await game.evaluate(() => {
  window.dispatchEvent(new Event('resize'));
  window.__game.renderer.rearQuad.visible = false; // 後方モニターは写さない
});
// 前に割り込んできたあおり車（車間14m、真ん中の車線）を置き、前へ撃つ
await game.evaluate((n) => {
  const g = window.__game;
  const w = g.world();
  g.step(60);
  w.cars.length = 0;
  w.missiles.length = 0;
  const p = w.player;
  p.x = 0;
  p.targetLane = 1;
  const a = w.spawnAori('frontWeave', 1, p.z + 13, true);
  a.x = 0;
  a.color = 0xd0201a; // 目立つ赤
  a.aggressive = true;
  a.mode = 'hold';
  a.speed = p.speed;
  a.flashing = true;
  w.addCar('normal', 'truck', 0, p.z + 45, p.speed - 3);
  w.addCar('normal', 'sedan', 2, p.z - 10, p.speed + 1);
  g.step(10);
  w.cars.find((c) => c.kind === 'aori').x = 0;
  // 少しズームして、撃たれるあおり車を大きく写す
  const cam = g.renderer.camera;
  cam.fov = 42;
  cam.updateProjectionMatrix();
  g.tap('fireF');
  // 爆発の粒は描くたびに動くので、1コマずつ進める
  for (let i = 0; i < n; i++) g.step(1);
  // 撃退した車の吹き出し（「反省中…」）は写さない
  for (const v of g.renderer.cars.values()) if (v.bubble) v.bubble.visible = false;
  g.renderer.render(true);
}, AFTER_FIRE);
await game.waitForTimeout(200);
const bg = (await game.screenshot()).toString('base64');
if (errors.length) throw new Error(errors.join('\n'));

// 2. 文字を重ねる
const card = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await card.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; position: relative;
  font-family: 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif; color: #fff; }
.bg { position: absolute; inset: 0; background: url(data:image/png;base64,${bg}) center/cover; }
.shade { position: absolute; inset: 0;
  background: linear-gradient(90deg, rgba(8,14,28,.94) 0%, rgba(8,14,28,.82) 34%, rgba(8,14,28,.3) 56%, rgba(8,14,28,0) 70%); }
.text { position: absolute; left: 60px; top: 56px; width: 600px; }
.kicker { margin: 0; font-size: 24px; letter-spacing: .14em; font-weight: 800; color: #9fd0ff; }
h1 { margin: 22px 0 0; display: flex; align-items: center; gap: 22px; }
.stop { display: inline-grid; place-items: center; width: 164px; aspect-ratio: 1; font-size: 36px;
  font-family: 'Arial Black', 'Helvetica Neue', sans-serif; font-weight: 900; color: #fff; background: #d7141a;
  border-radius: 50%; box-shadow: inset 0 0 0 7px #fff, inset 0 0 0 12px #d7141a, 0 6px 18px rgba(0,0,0,.5);
  transform: rotate(-12deg); }
.name { font-size: 84px; line-height: 1.05; font-weight: 900; color: #ffd84a; text-shadow: 0 6px 0 #a8331a, 0 10px 30px rgba(0,0,0,.6); }
.lead { margin: 30px 0 0; font-size: 31px; line-height: 1.5; font-weight: 800; color: #eef3fb; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
.lead em { font-style: normal; color: #ff6a4d; }
.url { position: absolute; left: 60px; bottom: 44px; font-size: 24px; font-weight: 700; color: #b4c2d6; letter-spacing: .02em; }
</style></head><body>
<div class="bg"></div><div class="shade"></div>
<div class="text">
  <p class="kicker">東名高速 東京IC → 名古屋IC</p>
  <h1><span class="stop">STOP!</span><span class="name">あおり<br>運転</span></h1>
  <p class="lead">あおってきた車だけを<br><em>ミサイルで撃退</em>しろ！</p>
</div>
<div class="url">game.chozo.net/stop-aori/</div>
</body></html>`);
await card.waitForTimeout(100);
fs.mkdirSync('public', { recursive: true });
await card.screenshot({ path: OUT });
await browser.close();
console.log(OUT);
