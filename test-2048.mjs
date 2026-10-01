// 2048 逻辑自检 + UI 冒烟测试：node test-2048.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const gameFile = existsSync(join(here, '2048.html')) ? '2048.html' : 'index.html';
const html = readFileSync(join(here, gameFile), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: 未找到内联脚本'); process.exit(1); }
const src = m[1];

// ---- 纯逻辑沙箱（无 DOM） ----
const fakeWindow = {};
new Function('window', src)(fakeWindow);
const Logic = fakeWindow.GAME;
if (!Logic) { console.error('FAIL: 未导出 GAME'); process.exit(1); }

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('ok - ' + name);
  } catch (e) {
    fail += 1;
    console.error('FAIL - ' + name);
    console.error('  ' + (e && e.message));
  }
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sumBoard(b) { let s = 0; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s += b[r][c]; return s; }
function isPow2(v) { return v > 0 && (v & (v - 1)) === 0; }

// 移动后沿 dir 方向应已"压实"：0 只能出现在远离边缘的一端
function isPacked(b, dir) {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (b[r][c] !== 0) continue;
      if (dir === 'left') { for (let c2 = c + 1; c2 < 4; c2++) if (b[r][c2] !== 0) return false; }
      else if (dir === 'right') { for (let c2 = 0; c2 < c; c2++) if (b[r][c2] !== 0) return false; }
      else if (dir === 'up') { for (let r2 = r + 1; r2 < 4; r2++) if (b[r2][c] !== 0) return false; }
      else { for (let r2 = 0; r2 < r; r2++) if (b[r2][c] !== 0) return false; }
    }
  }
  return true;
}

function randomBoard(rand) {
  const b = Logic.emptyBoard();
  const n = Math.floor(rand() * 17);
  const cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) cells.push([r, c]);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rand() * cells.length);
    const cell = cells.splice(idx, 1)[0];
    b[cell[0]][cell[1]] = Math.pow(2, 1 + Math.floor(rand() * 11)); // 2..2048
  }
  return b;
}

// ---- slideLine 基础用例 ----
await check('slideLine [2,2,2,0] -> [4,2,0,0]', () => assert.deepEqual(Logic.slideLine([2,2,2,0]).result, [4,2,0,0]));
await check('slideLine [2,0,2,0] -> [4,0,0,0]', () => assert.deepEqual(Logic.slideLine([2,0,2,0]).result, [4,0,0,0]));
await check('slideLine [4,4,4,4] -> [8,8,0,0]', () => assert.deepEqual(Logic.slideLine([4,4,4,4]).result, [8,8,0,0]));
await check('slideLine [2,2,4,4] -> [4,8,0,0]', () => assert.deepEqual(Logic.slideLine([2,2,4,4]).result, [4,8,0,0]));
await check('slideLine [0,2,4,4] -> [2,8,0,0]', () => assert.deepEqual(Logic.slideLine([0,2,4,4]).result, [2,8,0,0]));
await check('slideLine [4,2,2,0] -> [4,4,0,0]', () => assert.deepEqual(Logic.slideLine([4,2,2,0]).result, [4,4,0,0]));
await check('slideLine [0,0,0,0] -> [0,0,0,0]', () => assert.deepEqual(Logic.slideLine([0,0,0,0]).result, [0,0,0,0]));
await check('slideLine [4,4,4,4] 有 2 个合并', () => assert.equal(Logic.slideLine([4,4,4,4]).merges.length, 2));
await check('slideLine [2,2,2,0] 合并信息', () => {
  const r = Logic.slideLine([2,2,2,0]);
  assert.equal(r.merges.length, 1);
  assert.deepEqual(r.merges[0], { a: 0, b: 1, to: 0, value: 4 });
});

// ---- 四个方向已知棋盘 ----
await check('move left', () => {
  const b = [[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  const r = Logic.move(b, 'left');
  assert.equal(r.board[0][0], 4);
  assert.equal(r.scoreGained, 4);
  assert.equal(r.moved, true);
});
await check('move right', () => {
  const b = [[0,0,2,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  const r = Logic.move(b, 'right');
  assert.equal(r.board[0][3], 4);
  assert.equal(r.scoreGained, 4);
});
await check('move up', () => {
  const b = [[2,0,0,0],[2,0,0,0],[0,0,0,0],[0,0,0,0]];
  const r = Logic.move(b, 'up');
  assert.equal(r.board[0][0], 4);
});
await check('move down', () => {
  const b = [[0,0,0,0],[0,0,0,0],[2,0,0,0],[2,0,0,0]];
  const r = Logic.move(b, 'down');
  assert.equal(r.board[3][0], 4);
});
await check('死局棋盘 move 返回不动', () => {
  const b = [[2,4,2,4],[4,2,4,2],[2,4,2,4],[4,2,4,2]];
  const r = Logic.move(b, 'left');
  assert.equal(r.moved, false);
  assert.deepEqual(r.board, b);
});

// ---- 随机棋盘 × 四方向：不变量 ----
await check('随机棋盘 move 不变量（2000 棋盘）', () => {
  const rand = rng(42);
  for (let iter = 0; iter < 2000; iter++) {
    const b = randomBoard(rand);
    for (const dir of ['left','right','up','down']) {
      const res = Logic.move(b, dir);
      for (const row of res.board) for (const v of row) assert.ok(v === 0 || isPow2(v), '数值为 2 的幂');
      assert.equal(sumBoard(b), sumBoard(res.board), '总和守恒');
      const mgSum = res.merges.reduce((s, mg) => s + mg.value, 0);
      assert.equal(res.scoreGained, mgSum, '得分 = 合并值之和');
      for (const mg of res.merges) {
        assert.equal(b[mg.a.r][mg.a.c], b[mg.b.r][mg.b.c], '合并来源相等');
        assert.equal(mg.value, b[mg.a.r][mg.a.c] * 2, '合并值 = 2x来源');
        assert.equal(res.board[mg.to.r][mg.to.c], mg.value, '落点正确');
      }
      if (!res.moved) {
        assert.deepEqual(res.board, b, '未移动则棋盘一致');
      } else {
        assert.ok(isPacked(res.board, dir), '移动后沿该方向已压实');
      }
    }
  }
});

// ---- resolveTiles 与最终棋盘一致性（UI 动画轨迹） ----
await check('随机棋盘 resolveTiles 与棋盘一致（2000 棋盘）', () => {
  const rand = rng(2024);
  for (let iter = 0; iter < 2000; iter++) {
    const b = randomBoard(rand);
    const orig = new Map();
    let id = 1;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (b[r][c] !== 0) { orig.set(id, { id, r, c, value: b[r][c] }); id += 1; }
      }
    }
    for (const dir of ['left','right','up','down']) {
      const res = Logic.move(b, dir);
      const copy = new Map();
      orig.forEach((t) => copy.set(t.id, { id: t.id, r: t.r, c: t.c, value: t.value }));
      const rt = Logic.resolveTiles(res, copy);
      for (const sv of rt.survivors) sv.tile.value = sv.value;
      assert.equal(rt.absorbed.size, res.merges.length, '被吸收棋子数 = 合并数');
      const cellMap = new Map();
      copy.forEach(function (t) {
        if (rt.absorbed.has(t.id)) return;
        const key = t.r + ',' + t.c;
        assert.ok(!cellMap.has(key), '一格至多一个棋子');
        cellMap.set(key, t);
      });
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const v = res.board[r][c];
          const t = cellMap.get(r + ',' + c);
          if (v === 0) assert.equal(t, undefined, '空格无棋子');
          else {
            assert.ok(t, '有值格有棋子');
            assert.equal(t.value, v, '棋子值与棋盘一致');
          }
        }
      }
    }
  }
});

// ---- addRandomTile ----
await check('addRandomTile 基本行为', () => {
  const rand = rng(7);
  const b = Logic.emptyBoard();
  const t = Logic.addRandomTile(b, rand);
  assert.ok(t && (t.value === 2 || t.value === 4));
  assert.equal(b[t.r][t.c], t.value);
});
await check('addRandomTile 满盘返回 null', () => {
  const b = [[2,4,2,4],[4,2,4,2],[2,4,2,4],[4,2,4,2]];
  assert.equal(Logic.addRandomTile(b), null);
});
await check('addRandomTile 填满 16 格', () => {
  const rand = rng(99);
  const b = Logic.emptyBoard();
  for (let i = 0; i < 16; i++) assert.ok(Logic.addRandomTile(b, rand));
  assert.equal(Logic.addRandomTile(b, rand), null);
  assert.equal(b.flat().filter((v) => v !== 0).length, 16);
});

// ---- isGameOver / hasWon ----
await check('isGameOver 空棋盘为 false', () => assert.equal(Logic.isGameOver(Logic.emptyBoard()), false));
await check('isGameOver 死局为 true', () => assert.equal(Logic.isGameOver([[2,4,2,4],[4,2,4,2],[2,4,2,4],[4,2,4,2]]), true));
await check('isGameOver 有相邻相等为 false', () => {
  const b = [[2,2,4,8],[4,8,16,32],[8,16,32,64],[16,32,64,128]];
  assert.equal(Logic.isGameOver(b), false);
});
await check('hasWon', () => {
  const b = Logic.emptyBoard();
  b[0][0] = 2048;
  assert.equal(Logic.hasWon(b), true);
  assert.equal(Logic.hasWon(Logic.emptyBoard()), false);
});

// ---- 随机完整对局（正确推进棋盘） ----
await check('随机完整对局：200 局均正常结束', () => {
  const dirs = ['left','right','up','down'];
  for (let g = 0; g < 200; g++) {
    const rand = rng(5000 + g);
    let b = Logic.emptyBoard();
    Logic.addRandomTile(b, rand);
    Logic.addRandomTile(b, rand);
    let moves = 0;
    while (!Logic.isGameOver(b)) {
      let made = false;
      const order = [0,1,2,3].sort(function () { return rand() - 0.5; });
      for (let i = 0; i < 4; i++) {
        const res = Logic.move(b, dirs[order[i]]);
        if (res.moved) {
          b = res.board; // 关键：推进到新棋盘
          Logic.addRandomTile(b, rand);
          made = true;
          break;
        }
      }
      if (!made) {
        assert.equal(sumBoard(b), 0, '有空格却无合法移动（仅全空棋盘允许）');
        break;
      }
      moves += 1;
      assert.ok(moves < 50000, '对局步数异常');
    }
  }
});

// ---- UI 冒烟测试（DOM 桩） ----
function makeFakeEl() {
  return {
    style: {},
    children: [],
    className: '',
    textContent: '',
    clientWidth: 400,
    offsetWidth: 0,
    disabled: false,
    removed: false,
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      contains(c) { return this.set.has(c); }
    },
    appendChild(ch) { this.children.push(ch); return ch; },
    addEventListener() {},
    remove() { this.removed = true; },
    querySelector() { return makeFakeEl(); }
  };
}

await check('UI 冒烟：初始化 + 一次键盘移动不抛异常', async () => {
  const registry = new Map();
  const handlers = {};
  const doc = {
    getElementById(id) {
      if (!registry.has(id)) registry.set(id, makeFakeEl());
      return registry.get(id);
    },
    createElement() { return makeFakeEl(); },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  };
  const win = {
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {}
  };
  new Function('window', 'document', src)(win, doc);
  const grid = registry.get('grid');
  const layer = registry.get('layer');
  assert.equal(grid.children.length, 16, '背景 16 格');
  assert.equal(layer.children.length, 2, '初始 2 个棋子');
  assert.equal(String(registry.get('score').textContent), '0', '分数显示 0');
  assert.equal(registry.get('overlay').classList.contains('hidden'), true, '初始无弹层');
  assert.equal(handlers.keydown && handlers.keydown.length, 1, '键盘处理器已注册');
  handlers.keydown[0]({ key: 'ArrowLeft', preventDefault() {} });
  await new Promise((r) => setTimeout(r, 400));
  const count = layer.children.filter((c) => !c.removed).length;
  assert.ok(count === 2 || count === 3, '移动+生成后棋子数应为 2 或 3，实际 ' + count);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
