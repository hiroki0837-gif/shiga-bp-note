import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine, Legend
} from "recharts";

/* ============================================================
   受付端末（しが血圧ノート／心不全手帳 共通）
   患者さんが自分でQRをかざす → 読み取り → 自動で印刷
   ============================================================ */

/* ブラウザ標準の保存領域を使う（プレビュー環境では既定の storage をそのまま使用） */
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      try { const v = window.localStorage.getItem(key); return v === null ? null : { key, value: v }; }
      catch { return null; }
    },
    async set(key, value) {
      try { window.localStorage.setItem(key, value); } catch { /* 容量超過など */ }
      return { key, value };
    },
    async delete(key) {
      try { window.localStorage.removeItem(key); } catch { /* なければよい */ }
      return { key, deleted: true };
    },
    async list(prefix = "") {
      const keys = [];
      try { for (let i = 0; i < window.localStorage.length; i++) { const k = window.localStorage.key(i); if (k.startsWith(prefix)) keys.push(k); } } catch { /* 無視 */ }
      return { keys, prefix };
    },
  };
}

/* ---------- 見た目 ---------- */
const C = {
  paper: "#F1FAFF", card: "#FFFFFF", ink: "#2B3646", inkSoft: "#46525F",
  line: "#D9E9F6", morning: "#E08A3C", evening: "#1B77CB", good: "#33A165",
  alert: "#CC6455", alertBg: "#FDF6F4", tint: "#F1FAFF", tintDeep: "#D9ECFB",
};
const FONT = '"Meiryo","メイリオ",sans-serif';
const NUM = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum"' };
const APP_VERSION = "1.1.0";

/* ---------- 日付 ---------- */
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const fmtMD = (s) => { const d = parseISO(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtWD = (s) => WD[parseISO(s).getDay()];
const startOfWeekMon = (s) => addDays(s, -((parseISO(s).getDay() + 6) % 7));
const slotText = (v) => {
  if (v == null || v === "" || v === "99") return "";
  const m = Number(v) * 15;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
const pad = (n, l) => String(Math.max(0, Math.round(Number(n) || 0))).padStart(l, "0").slice(-l);
const checksum = (t) => pad([...t].reduce((a, c) => a + +c, 0) % 97, 2);
const SEX_TEXT = { 1: "女性", 2: "男性", 3: "回答なし" };
const idText = (v) => (v && v.length === 10 ? `${v.slice(0, 4)}-${v.slice(4, 7)}-${v.slice(7)}` : "—");
const MED_SLOTS = [["mA", "朝"], ["mN", "昼"], ["mP", "夕"], ["mB", "寝る前"]];
const planList = (plan) => MED_SLOTS.filter(([k]) => (plan || {})[k]);

/* ============================================================
   QRコード読み取り（数字モード想定・外部ライブラリなし）
   画像 → 二値化 → 位置検出パターン → 射影変換 → 格子読み取り → 復号
   ============================================================ */

/* ---- GF(256) ---- */
const DEXP = new Uint8Array(512), DLOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { DEXP[i] = x; DLOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) DEXP[i] = DEXP[i - 255];
})();

/* ---- ブロックごとの適応二値化 ---- */
function qrBinarize(gray, w, h) {
  const BS = 8;
  const bw = Math.max(1, Math.ceil(w / BS)), bh = Math.max(1, Math.ceil(h / BS));
  const means = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0, n = 0, mn = 255, mx = 0;
      for (let y = by * BS; y < Math.min(h, by * BS + BS); y++) {
        for (let x = bx * BS; x < Math.min(w, bx * BS + BS); x++) {
          const v = gray[y * w + x];
          sum += v; n++;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      let m = n ? sum / n : 128;
      if (mx - mn < 24) m = mn - 1;           // ほぼ均一なブロックは明色扱い
      means[by * bw + bx] = m;
    }
  }
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const by = Math.min(bh - 1, y >> 3);
    for (let x = 0; x < w; x++) {
      const bx = Math.min(bw - 1, x >> 3);
      // 近傍5x5ブロックの平均でしきい値を決める
      let s = 0, c = 0;
      for (let j = Math.max(0, by - 2); j <= Math.min(bh - 1, by + 2); j++) {
        for (let i = Math.max(0, bx - 2); i <= Math.min(bw - 1, bx + 2); i++) { s += means[j * bw + i]; c++; }
      }
      bits[y * w + x] = gray[y * w + x] < s / c ? 1 : 0;   // 1 = 暗
    }
  }
  return bits;
}

/* ---- 位置検出パターン（1:1:3:1:1）の探索 ---- */
function qrRuns(get, n) {
  const out = [];
  let val = get(0), start = 0;
  for (let i = 1; i < n; i++) {
    const v = get(i);
    if (v !== val) { out.push({ v: val, s: start, l: i - start }); val = v; start = i; }
  }
  out.push({ v: val, s: start, l: n - start });
  return out;
}
function qrRatioOK(l) {
  const total = l[0] + l[1] + l[2] + l[3] + l[4];
  if (total < 7) return 0;
  const m = total / 7, tol = m * 0.55;
  if (Math.abs(l[0] - m) <= tol && Math.abs(l[1] - m) <= tol && Math.abs(l[2] - 3 * m) <= 3 * tol &&
      Math.abs(l[3] - m) <= tol && Math.abs(l[4] - m) <= tol) return m;
  return 0;
}

function qrFindFinders(bits, w, h) {
  const cands = [];
  const step = Math.max(1, Math.floor(h / 400));

  for (let y = 0; y < h; y += step) {
    const rr = qrRuns((i) => bits[y * w + i], w);
    for (let i = 0; i + 4 < rr.length; i++) {
      if (rr[i].v !== 1) continue;
      const l = [rr[i].l, rr[i + 1].l, rr[i + 2].l, rr[i + 3].l, rr[i + 4].l];
      const m = qrRatioOK(l);
      if (!m) continue;
      const cx = Math.round(rr[i + 2].s + rr[i + 2].l / 2);
      // 縦方向も同じ比率か確かめ、中心を求め直す
      const cr = qrRuns((j) => bits[j * w + cx], h);
      let k = 0, acc = 0;
      while (k < cr.length && cr[k].s + cr[k].l <= y) k++;
      if (k < 2 || k + 2 >= cr.length || cr[k].v !== 1) continue;
      const lv = [cr[k - 2].l, cr[k - 1].l, cr[k].l, cr[k + 1].l, cr[k + 2].l];
      const mv = qrRatioOK(lv);
      if (!mv) continue;
      const cy = Math.round(cr[k].s + cr[k].l / 2);
      cands.push({ x: cx, y: cy, m: (m + mv) / 2 });
    }
  }

  const groups = [];
  for (const c of cands) {
    const g = groups.find((q) => Math.hypot(q.x / q.n - c.x, q.y / q.n - c.y) < Math.max(2, c.m));
    if (g) { g.x += c.x; g.y += c.y; g.m += c.m; g.n++; }
    else groups.push({ x: c.x, y: c.y, m: c.m, n: 1 });
  }
  return groups.map((g) => {
    const cx = g.x / g.n, cy = g.y / g.n, mm = g.m / g.n;
    // 中央の暗い3x3ブロックの重心で中心を精密化する
    const r = Math.max(1, Math.round(mm * 1.5));
    let sx = 0, sy = 0, n = 0;
    for (let y = Math.max(0, Math.round(cy - r)); y <= Math.min(h - 1, Math.round(cy + r)); y++) {
      for (let x = Math.max(0, Math.round(cx - r)); x <= Math.min(w - 1, Math.round(cx + r)); x++) {
        if (bits[y * w + x]) { sx += x; sy += y; n++; }
      }
    }
    const fx = n > 3 ? sx / n : cx, fy = n > 3 ? sy / n : cy;
    return { x: fx, y: fy, m: mm, n: g.n };
  }).sort((a, b) => b.n - a.n);
}

/* ---- 3点の並びを決める（左上・右上・左下） ---- */
function qrOrderFinders(f) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const [ab, bc, ca] = [d(f[0], f[1]), d(f[1], f[2]), d(f[2], f[0])];
  let tl, p, q;
  if (bc >= ab && bc >= ca) { tl = f[0]; p = f[1]; q = f[2]; }
  else if (ca >= ab && ca >= bc) { tl = f[1]; p = f[0]; q = f[2]; }
  else { tl = f[2]; p = f[0]; q = f[1]; }
  // 外積で右上／左下を決める
  const cross = (p.x - tl.x) * (q.y - tl.y) - (p.y - tl.y) * (q.x - tl.x);
  return cross < 0 ? { tl, tr: q, bl: p } : { tl, tr: p, bl: q };
}

/* ---- 射影変換 ---- */
function qrSquareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
  const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
  if (dx3 === 0 && dy3 === 0) {
    return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  }
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / den;
  const a23 = (dx1 * dy3 - dx3 * dy1) / den;
  return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0,
          y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1];
}
function qrInv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [e * i - f * h, c * h - b * i, b * f - c * e,
          f * g - d * i, a * i - c * g, c * d - a * f,
          d * h - e * g, b * g - a * h, a * e - b * d];
}
function qrMul3(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return r;
}
const qrApplyT = (m, x, y) => {
  const d = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / d, (m[3] * x + m[4] * y + m[5]) / d];
};
function qrQuadToQuad(src, dst) {
  const s = qrSquareToQuad(...src), t = qrSquareToQuad(...dst);
  return qrMul3(t, qrInv3(s));
}

/* ---- 位置合わせパターンの探索（1:1:1:1:1） ---- */
function qrFindAlignment(bits, w, h, ex, ey, mod) {
  const r = Math.max(6, Math.ceil(mod * 12));
  const x0 = Math.max(0, Math.round(ex - r)), x1 = Math.min(w, Math.round(ex + r));
  const y0 = Math.max(0, Math.round(ey - r)), y1 = Math.min(h, Math.round(ey + r));
  if (x1 - x0 < 5 || y1 - y0 < 5) return [];
  const found = [];
  for (let y = y0; y < y1; y++) {
    const rr = qrRuns((i) => bits[(x0 + i) + y * w], x1 - x0);
    for (let i = 0; i + 4 < rr.length; i++) {
      if (rr[i].v !== 1) continue;
      const l = [rr[i].l, rr[i + 1].l, rr[i + 2].l, rr[i + 3].l, rr[i + 4].l];
      // 外側の暗い部分は隣のデータとつながることがあるので、中央3つで判定する
      const m = (l[1] + l[2] + l[3]) / 3, tol = m * 0.7;
      if (Math.abs(l[1] - m) > tol || Math.abs(l[2] - m) > tol || Math.abs(l[3] - m) > tol) continue;
      if (l[0] < m * 0.4 || l[4] < m * 0.4) continue;
      if (m < mod * 0.5 || m > mod * 2) continue;
      const cx = x0 + rr[i + 2].s + rr[i + 2].l / 2;
      // 縦方向にも 1:1:1:1:1 が並ぶことを確かめる（データ部の偶然の一致を除く）
      const xi = Math.round(cx);
      const cr = qrRuns((j) => bits[j * w + xi], h);
      let k = 0;
      while (k < cr.length && cr[k].s + cr[k].l <= y) k++;
      if (k < 2 || k + 2 >= cr.length || cr[k].v !== 1) continue;
      const lv = [cr[k - 2].l, cr[k - 1].l, cr[k].l, cr[k + 1].l, cr[k + 2].l];
      const tv = (lv[1] + lv[2] + lv[3]) / 3, tvt = tv * 0.7;
      if (Math.abs(lv[1] - tv) > tvt || Math.abs(lv[2] - tv) > tvt || Math.abs(lv[3] - tv) > tvt) continue;
      if (lv[0] < tv * 0.4 || lv[4] < tv * 0.4) continue;
      if (tv < mod * 0.5 || tv > mod * 2) continue;
      const cy = cr[k].s + cr[k].l / 2;
      const d = Math.hypot(cx - ex, cy - ey);
      if (!found.some((q) => Math.hypot(q.x - cx, q.y - cy) < mod)) found.push({ x: cx, y: cy, d });
    }
  }
  return found.sort((a, b) => a.d - b.d).slice(0, 12);
}

/* ---- 形式情報 ---- */
function qrBchFormatEnc(d0) {
  let d = d0 << 10;
  for (let i = 14; i >= 10; i--) if ((d >> i) & 1) d ^= 0x537 << (i - 10);
  return ((d0 << 10) | d) ^ 0x5412;
}
const QR_FORMAT_TABLE = (() => { const t = []; for (let i = 0; i < 32; i++) t.push(qrBchFormatEnc(i)); return t; })();
function qrReadFormat(m, size) {
  const at = (r, c) => m[r * size + c];
  const seqA = [];
  for (let i = 0; i <= 5; i++) seqA.push(at(8, i));
  seqA.push(at(8, 7)); seqA.push(at(8, 8)); seqA.push(at(7, 8));
  for (let i = 5; i >= 0; i--) seqA.push(at(i, 8));
  const seqB = [];
  for (let i = 0; i < 7; i++) seqB.push(at(size - 1 - i, 8));
  for (let i = 7; i >= 0; i--) seqB.push(at(8, size - 1 - i));
  const val = (seq) => seq.reduce((a, b, i) => a | (b << (14 - i)), 0);
  const pick = (v) => {
    let best = -1, bd = 99;
    QR_FORMAT_TABLE.forEach((t, i) => {
      let d = 0, x = t ^ v;
      while (x) { d += x & 1; x >>= 1; }
      if (d < bd) { bd = d; best = i; }
    });
    return bd <= 3 ? { data: best, dist: bd } : null;
  };
  const a = pick(val(seqA)), b = pick(val(seqB));
  const r = !a ? b : !b ? a : (a.dist <= b.dist ? a : b);
  if (!r) return null;
  return { ecl: (r.data >> 3) & 3, mask: r.data & 7 };
}

const MASKS_D = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const ALIGN_D = ["","6,18","6,22","6,26","6,30","6,34","6,22,38","6,24,42","6,26,46","6,28,50","6,30,54","6,32,58","6,34,62","6,26,46,66","6,26,48,70","6,26,50,74","6,30,54,78","6,30,56,82","6,30,58,86","6,34,62,90","6,28,50,72,94","6,26,50,74,98","6,30,54,78,102","6,28,54,80,106","6,32,58,84,110","6,30,58,86,114","6,34,62,90,118","6,26,50,74,98,122","6,30,54,78,102,126","6,26,52,78,104,130","6,30,56,82,108,134","6,34,60,86,112,138","6,30,58,86,114,142","6,34,62,90,118,146","6,30,54,78,102,126,150","6,24,50,76,102,128,154","6,28,54,80,106,132,158","6,32,58,84,110,136,162","6,26,54,82,110,138,166","6,30,58,86,114,142,170"];

function qrReservedMap(v) {
  const size = v * 4 + 17;
  const res = new Uint8Array(size * size);
  const set = (r, c) => { if (r >= 0 && c >= 0 && r < size && c < size) res[r * size + c] = 1; };
  const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) set(r0 + r, c0 + c); };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  if (v > 1) {
    const co = ALIGN_D[v - 1].split(",").map(Number);
    for (const r of co) for (const c of co) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc);
    }
  }
  for (let i = 0; i < size; i++) { set(6, i); set(i, 6); }
  set(size - 8, 8);
  for (let i = 0; i <= 8; i++) { set(8, i); set(i, 8); }
  for (let i = size - 8; i < size; i++) set(8, i);
  for (let i = size - 7; i < size; i++) set(i, 8);
  if (v >= 7) {
    for (let i = 0; i < 18; i++) {
      set(Math.floor(i / 3), size - 11 + (i % 3));
      set(size - 11 + (i % 3), Math.floor(i / 3));
    }
  }
  return res;
}

const ECB_D = {
  L: [[7,1,19,0,0],[10,1,34,0,0],[15,1,55,0,0],[20,1,80,0,0],[26,1,108,0,0],[18,2,68,0,0],[20,2,78,0,0],[24,2,97,0,0],[30,2,116,0,0],[18,2,68,2,69],[20,4,81,0,0],[24,2,92,2,93],[26,4,107,0,0],[30,3,115,1,116],[22,5,87,1,88],[24,5,98,1,99],[28,1,107,5,108],[30,5,120,1,121],[28,3,113,4,114],[28,3,107,5,108],[28,4,116,4,117],[28,2,111,7,112],[30,4,121,5,122],[30,6,117,4,118],[26,8,106,4,107],[28,10,114,2,115],[30,8,122,4,123],[30,3,117,10,118],[30,7,116,7,117],[30,5,115,10,116],[30,13,115,3,116],[30,17,115,0,0],[30,17,115,1,116],[30,13,115,6,116],[30,12,121,7,122],[30,6,121,14,122],[30,17,122,4,123],[30,4,122,18,123],[30,20,117,4,118],[30,19,118,6,119]],
  M: [[10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],[16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44],[30,1,50,4,51],[22,6,36,2,37],[22,8,37,1,38],[24,4,40,5,41],[24,5,41,5,42],[28,7,45,3,46],[28,10,46,1,47],[26,9,43,4,44],[26,3,44,11,45],[26,3,41,13,42],[26,17,42,0,0],[28,17,46,0,0],[28,4,47,14,48],[28,6,45,14,46],[28,8,47,13,48],[28,19,46,4,47],[28,22,45,3,46],[28,3,45,23,46],[28,21,45,7,46],[28,19,47,10,48],[28,2,46,29,47],[28,10,46,23,47],[28,14,46,21,47],[28,14,46,23,47],[28,12,47,26,48],[28,6,47,34,48],[28,29,46,14,47],[28,13,46,32,47],[28,40,47,7,48],[28,18,47,31,48]],
};
const ECL_NAME = { 0: "M", 1: "L", 2: "H", 3: "Q" };

/* ---- 誤り訂正（Berlekamp-Massey + Forney） ---- */
const qrDmul = (a, b) => (a === 0 || b === 0 ? 0 : DEXP[DLOG[a] + DLOG[b]]);
const qrDinv = (a) => DEXP[255 - DLOG[a]];
function qrRsCorrect(msg, ecLen) {
  const n = msg.length;
  const synd = new Uint8Array(ecLen);
  let bad = false;
  for (let i = 0; i < ecLen; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s = qrDmul(s, DEXP[i]) ^ msg[j];
    synd[i] = s; if (s) bad = true;
  }
  if (!bad) return msg;

  let lam = [1], b = [1], L = 0, m = 1, bb = 1;
  const xorPoly = (p, q) => {
    const r = new Array(Math.max(p.length, q.length)).fill(0);
    for (let i = 0; i < r.length; i++) r[i] = (p[i] || 0) ^ (q[i] || 0);
    return r;
  };
  for (let r = 0; r < ecLen; r++) {
    let d = synd[r];
    for (let i = 1; i <= L; i++) d ^= qrDmul(lam[i] || 0, synd[r - i]);
    if (d === 0) { m++; continue; }
    const scale = qrDmul(d, qrDinv(bb));
    const shifted = new Array(m).fill(0).concat(b.map((x) => qrDmul(x, scale)));
    if (2 * L <= r) { const t = lam; lam = xorPoly(lam, shifted); b = t; L = r + 1 - L; bb = d; m = 1; }
    else { lam = xorPoly(lam, shifted); m++; }
  }
  const errPos = [];
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let j = 0; j < lam.length; j++) v ^= qrDmul(lam[j], DEXP[(255 - ((i * j) % 255)) % 255]);
    if (v === 0) errPos.push(n - 1 - i);
  }
  const deg = lam.length - 1;
  if (errPos.length === 0 || errPos.length !== deg) return null;

  // Ω(x) = S(x)Λ(x) mod x^ecLen
  const S = Array.from(synd);
  const om = new Array(ecLen).fill(0);
  for (let i = 0; i < ecLen; i++) for (let j = 0; j < lam.length; j++) {
    if (i + j < ecLen) om[i + j] ^= qrDmul(S[i], lam[j]);
  }
  const out = Uint8Array.from(msg);
  for (const pos of errPos) {
    const xi = DEXP[(n - 1 - pos) % 255];
    const xinv = qrDinv(xi);
    let o = 0, p = 1;
    for (let i = 0; i < ecLen; i++) { o ^= qrDmul(om[i], p); p = qrDmul(p, xinv); }
    let dl = 0; p = 1;
    for (let i = 1; i < lam.length; i += 2) { dl ^= qrDmul(lam[i], p); p = qrDmul(qrDmul(p, xinv), xinv); }
    if (dl === 0) return null;
    out[pos] ^= qrDmul(xi, qrDmul(o, qrDinv(dl)));
  }
  // 検算
  for (let i = 0; i < ecLen; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s = qrDmul(s, DEXP[i]) ^ out[j];
    if (s) return null;
  }
  return out;
}

/* ---- ビット行列 → 文字列 ---- */
function qrDecodeMatrix(mod, size) {
  const v = (size - 17) / 4;
  if (!Number.isInteger(v) || v < 1 || v > 40) return null;
  const fmt = qrReadFormat(mod, size);
  if (!fmt) return null;
  const eclName = ECL_NAME[fmt.ecl];
  if (!ECB_D[eclName]) return null;

  const res = qrReservedMap(v);
  const mask = MASKS_D[fmt.mask];
  const m2 = Uint8Array.from(mod);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!res[r * size + c] && mask(r, c)) m2[r * size + c] ^= 1;
  }

  const bits = [];
  let row = size - 1, dir = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (;;) {
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (!res[row * size + c]) bits.push(m2[row * size + c]);
      }
      row += dir;
      if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
    }
  }
  const cw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }

  const [ecLen, n1, d1, n2, d2] = ECB_D[eclName][v - 1];
  const blocks = [];
  for (let i = 0; i < n1; i++) blocks.push({ d: d1, data: [], ec: [] });
  for (let i = 0; i < n2; i++) blocks.push({ d: d2, data: [], ec: [] });
  const maxD = Math.max(d1, d2);
  let idx = 0;
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d) b.data.push(cw[idx++]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) b.ec.push(cw[idx++]);

  const data = [];
  for (const b of blocks) {
    const full = Uint8Array.from(b.data.concat(b.ec));
    const fixed = qrRsCorrect(full, ecLen);
    if (!fixed) return null;
    for (let i = 0; i < b.d; i++) data.push(fixed[i]);
  }

  // ビット列を読む（数字モードのみ対応）
  let p = 0;
  const read = (n) => { let x = 0; for (let i = 0; i < n; i++) { const byte = data[p >> 3]; if (byte === undefined) return -1; x = (x << 1) | ((byte >> (7 - (p & 7))) & 1); p++; } return x; };
  let out = "";
  for (;;) {
    const mode = read(4);
    if (mode <= 0) break;
    if (mode !== 1) return null;
    const cci = v < 10 ? 10 : v < 27 ? 12 : 14;
    const cnt = read(cci);
    if (cnt < 0) return null;
    let left = cnt;
    while (left >= 3) { const t = read(10); if (t < 0 || t > 999) return null; out += String(t).padStart(3, "0"); left -= 3; }
    if (left === 2) { const t = read(7); if (t < 0 || t > 99) return null; out += String(t).padStart(2, "0"); }
    else if (left === 1) { const t = read(4); if (t < 0 || t > 9) return null; out += String(t); }
    if (p + 4 > data.length * 8) break;
  }
  return out || null;
}

/* ---- 入口：画像から読み取る ---- */
function decodeQR(gray, w, h) {
  const bits = qrBinarize(gray, w, h);
  const f = qrFindFinders(bits, w, h);
  if (f.length < 3) return null;

  for (let a = 0; a < Math.min(f.length, 4); a++)
    for (let b = a + 1; b < Math.min(f.length, 5); b++)
      for (let c = b + 1; c < Math.min(f.length, 6); c++) {
        const r = qrTryDecode(bits, w, h, [f[a], f[b], f[c]]);
        if (r) return r;
      }
  return null;
}

function qrTryDecode(bits, w, h, three) {
  const { tl, tr, bl } = qrOrderFinders(three);
  const mod = (tl.m + tr.m + bl.m) / 3;
  if (!(mod > 0.8)) return null;
  const dist = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(bl.x - tl.x, bl.y - tl.y)) / 2;
  let est = Math.round(dist / mod) + 7;
  switch (est & 3) {
    case 0: est++; break;
    case 2: est--; break;
    case 3: est += 2; break;
    default: break;
  }
  // 傾いているとモジュール幅を大きく見積もるので、間隔から妥当な版をすべて試す
  const cands = [];
  for (let dd = 21; dd <= 177; dd += 4) {
    const implied = dist / (dd - 7);
    if (implied < mod / 1.8 || implied > mod * 1.3) continue;
    cands.push(dd);
  }
  cands.sort((a, b) => Math.abs(a - est) - Math.abs(b - est));
  for (const dd of cands) {
    const got = qrAttempt(bits, w, h, tl, tr, bl, dist / (dd - 7), dd, (dd - 17) / 4);
    if (got) return got;
  }
  return null;
}

function qrAttempt(bits, w, h, tl, tr, bl, mod, dim, v) {

  const brx = tr.x + bl.x - tl.x, bry = tr.y + bl.y - tl.y;
  const src = [3.5, 3.5, dim - 3.5, 3.5, dim - 3.5, dim - 3.5, 3.5, dim - 3.5];
  const dst = [tl.x, tl.y, tr.x, tr.y, brx, bry, bl.x, bl.y];

  if (v > 1) {
    const co = ALIGN_D[v - 1].split(",").map(Number);
    const ac = co[co.length - 1];
    const t0 = qrQuadToQuad(src, dst);
    const [ex, ey] = qrApplyT(t0, ac + 0.5, ac + 0.5);
    for (const al of qrFindAlignment(bits, w, h, ex, ey, mod)) {
      const t = qrQuadToQuad([3.5, 3.5, dim - 3.5, 3.5, ac + 0.5, ac + 0.5, 3.5, dim - 3.5],
        [tl.x, tl.y, tr.x, tr.y, al.x, al.y, bl.x, bl.y]);
      const r = qrSampleAndDecode(bits, w, h, t, dim, mod);
      if (r) return r;
    }
  }
  return qrSampleAndDecode(bits, w, h, qrQuadToQuad(src, dst), dim, mod);
}

function qrSampleAndDecode(bits, w, h, t, dim, modSize) {
  const rad = modSize >= 4 ? 1 : 0;   // モジュールが小さいときは1画素だけ見る
  const grid = new Uint8Array(dim * dim);
  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      const [x, y] = qrApplyT(t, c + 0.5, r + 0.5);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null;
      let s = 0, n = 0;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const px = xi + dx, py = yi + dy;
        if (px >= 0 && py >= 0 && px < w && py < h) { s += bits[py * w + px]; n++; }
      }
      grid[r * dim + c] = s * 2 > n ? 1 : 0;
    }
  }
  return qrDecodeMatrix(grid, dim);
}

/* ---------- カメラでQRを読む ---------- */
function CameraScanner({ onCode, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cbRef = useRef(onCode);
  const lastRef = useRef("");
  const [err, setErr] = useState("");
  const [hint, setHint] = useState("カメラを準備しています…");
  useEffect(() => { cbRef.current = onCode; }, [onCode]);

  useEffect(() => {
    let stream = null, timer = 0, stopped = false;
    const native = typeof window !== "undefined" && "BarcodeDetector" in window;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setHint("枠の中にQRコードを入れてください");
        const det = native ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
        const cv = canvasRef.current;
        const ctx = cv.getContext("2d", { willReadFrequently: true });

        const scan = async () => {
          if (stopped) return;
          const v = videoRef.current;
          if (v && v.videoWidth) {
            let got = null;
            if (det) {
              try {
                const codes = await det.detect(v);
                if (codes && codes.length) got = String(codes[0].rawValue || "");
              } catch { /* 無視して自前の処理へ */ }
            }
            if (!got) {
              // 中央の正方形だけを切り出して読み取る
              const side = Math.min(v.videoWidth, v.videoHeight);
              const W = 480;
              cv.width = W; cv.height = W;
              ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, W, W);
              const img = ctx.getImageData(0, 0, W, W).data;
              const gray = new Uint8Array(W * W);
              for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
                gray[i] = (img[j] * 306 + img[j + 1] * 601 + img[j + 2] * 117) >> 10;
              }
              try { got = decodeQR(gray, W, W); } catch { got = null; }
            }
            if (got) {
              const digits = String(got).replace(/\D/g, "");
              if (digits && digits !== lastRef.current) {
                lastRef.current = digits;
                cbRef.current(digits);
                setHint("読み取りました。次のQRがあればかざしてください");
                setTimeout(() => { lastRef.current = ""; }, 1500);
              }
            }
          }
          timer = setTimeout(scan, 120);
        };
        scan();
      } catch {
        setErr("カメラを使えませんでした。ブラウザの許可設定を確認してください。");
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div style={{ marginTop: 12 }}>
      {err ? (
        <p style={{ fontSize: 13, color: C.alert, fontWeight: 700, lineHeight: 1.8 }}>{err}</p>
      ) : (
        <>
          <div style={{ position: "relative", maxWidth: 360, margin: "0 auto" }}>
            <video ref={videoRef} playsInline muted
              style={{
                width: "100%", aspectRatio: "4 / 3", objectFit: "cover",
                borderRadius: 3, border: `1px solid ${C.line}`, background: "#000", display: "block",
              }} />
            <div style={{ position: "absolute", inset: "14%", border: `2px solid ${C.morning}`, borderRadius: 3, pointerEvents: "none" }} />
          </div>
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <p style={{ fontSize: 12.5, color: C.inkSoft, textAlign: "center", marginTop: 8, lineHeight: 1.7 }}>
            {hint}<br />画面の明るさを上げ、まっすぐ向けると読み取りやすくなります。
          </p>
        </>
      )}
      <div className="flex justify-center" style={{ marginTop: 10 }}>
        <Btn small filled={false} onClick={onClose}>カメラを閉じる</Btn>
      </div>
    </div>
  );
}

/* ---------- 手帳ごとのQR形式 ---------- */
const APPS = {
  "8": {
    name: "しが血圧ノート", kind: "bp", learn: 7,
    specs: {
      "1": { build: 3, tg: 6, aid: 0, demo: 0, learn: 7, plan: 0, med: 1, time: false },
      "2": { build: 3, tg: 6, aid: 0, demo: 0, learn: 7, plan: 0, med: 1, time: true },
      "3": { build: 3, tg: 6, aid: 0, demo: 0, learn: 7, plan: 4, med: 4, time: true },
      "4": { build: 3, tg: 6, aid: 0, demo: 4, learn: 7, plan: 4, med: 4, time: true },
      "5": { build: 3, tg: 6, aid: 10, demo: 4, learn: 7, plan: 4, med: 4, time: true },
      "6": { build: 3, tg: 6, aid: 10, demo: 4, learn: 7, plan: 4, med: 4, time: true, irr: 2 },
    },
    recLen: (sp) => 3 + 18 + sp.med + (sp.time ? 4 : 0) + (sp.irr || 0),
  },
  "9": {
    name: "心不全手帳", kind: "hf", learn: 21,
    specs: {
      "1": { build: 0, tg: 14, aid: 0, demo: 0, learn: 0, plan: 0, med: 3, time: false },
      "2": { build: 0, tg: 14, aid: 0, demo: 0, learn: 21, plan: 0, med: 3, time: false },
      "3": { build: 0, tg: 18, aid: 0, demo: 0, learn: 21, plan: 0, med: 3, time: false },
      "4": { build: 3, tg: 18, aid: 0, demo: 0, learn: 21, plan: 0, med: 3, time: true },
      "5": { build: 3, tg: 18, aid: 0, demo: 0, learn: 21, plan: 4, med: 4, time: true },
      "6": { build: 3, tg: 18, aid: 0, demo: 4, learn: 21, plan: 4, med: 4, time: true },
      "7": { build: 3, tg: 18, aid: 10, demo: 4, learn: 21, plan: 4, med: 4, time: true },
    },
    recLen: (sp) => 3 + 4 + 18 + 3 + sp.med + (sp.time ? 4 : 0) + (sp.irr || 0),
  },
};

function decodeChunk(code) {
  const s = (code || "").replace(/\D/g, "");
  if (s.length < 24) return { error: "コードが短すぎます" };
  const full = s.slice(0, -2), cs = s.slice(-2);
  if (checksum(full) !== cs) return { error: "うまく読み取れませんでした。もう一度かざしてください" };

  const app = APPS[full[0]];
  if (!app) return { error: "この端末では読み取れないQRコードです" };
  const body = full.slice(1);
  const spec = app.specs[body[0]];
  if (!spec) return { error: "アプリの更新が必要なQRコードです" };

  let o = 1;
  const build = spec.build ? parseInt(body.slice(o, o + spec.build), 10) : null;
  o += spec.build;
  const idx = +body.slice(o, o + 2); o += 2;
  const total = +body.slice(o, o + 2); o += 2;
  const yy = +body.slice(o, o + 2), mm = +body.slice(o + 2, o + 4), dd = +body.slice(o + 4, o + 6); o += 6;
  const startDate = `${2000 + yy}-${pad(mm, 2)}-${pad(dd, 2)}`;
  const days = +body.slice(o, o + 3); o += 3;

  const t = body.slice(o, o + spec.tg); o += spec.tg;
  const targets = app.kind === "bp"
    ? { sys: String(+t.slice(0, 3) || ""), dia: String(+t.slice(3, 6) || "") }
    : {
      weight: t.slice(0, 4) === "0000" ? "" : (parseInt(t.slice(0, 4), 10) / 10).toFixed(1),
      hr: String(+t.slice(4, 7) || ""), sys: String(+t.slice(7, 10) || ""), fluid: String(+t.slice(10, 14) || ""),
      alertW: spec.tg >= 18 && t.slice(14, 18) !== "0000" ? (parseInt(t.slice(14, 18), 10) / 10).toFixed(1) : "",
    };

  let aid = "";
  if (spec.aid) { aid = body.slice(o, o + spec.aid); o += spec.aid; }
  let demo = { age: null, sex: 0 };
  if (spec.demo) {
    const a = +body.slice(o, o + 3), sx = +body[o + 3];
    o += spec.demo;
    demo = { age: a === 999 ? null : a, sex: sx };
  }
  o += spec.learn;

  let medPlan = app.kind === "bp" ? { mA: true } : { mA: true, mN: true, mP: true };
  if (spec.plan) {
    const mp = body.slice(o, o + spec.plan); o += spec.plan;
    medPlan = {}; MED_SLOTS.forEach(([k], i) => { medPlan[k] = mp[i] === "1"; });
  }

  const RL = app.recLen(spec);
  const cnt = +body.slice(o, o + 3); o += 3;
  const rest = body.slice(o);
  if (rest.length !== cnt * RL) return { error: "うまく読み取れませんでした。もう一度かざしてください" };

  const records = {};
  for (let i = 0; i < cnt; i++) {
    const r = rest.slice(i * RL, (i + 1) * RL);
    const n = (a, b) => { const v = parseInt(r.slice(a, b), 10); return v === 0 ? "" : String(v); };
    const offset = parseInt(r.slice(0, 3), 10);
    const rec = { mA: 0, mN: 0, mP: 0, mB: 0, amT: "", pmT: "", amI: 0, pmI: 0 };
    let q = 3;
    if (app.kind === "hf") {
      rec.w = r.slice(3, 7) === "0000" ? "" : (parseInt(r.slice(3, 7), 10) / 10).toFixed(1);
      q = 7;
    }
    rec.amS = n(q, q + 3); rec.amD = n(q + 3, q + 6); rec.amH = n(q + 6, q + 9);
    rec.pmS = n(q + 9, q + 12); rec.pmD = n(q + 12, q + 15); rec.pmH = n(q + 15, q + 18);
    q += 18;
    if (app.kind === "hf") { rec.edema = +r[q]; rec.dysp = +r[q + 1]; rec.palp = +r[q + 2]; q += 3; }
    if (spec.med === 1) { rec.mA = +r[q]; q += 1; }
    else { MED_SLOTS.slice(0, spec.med).forEach(([k], i) => { rec[k] = +r[q + i]; }); q += spec.med; }
    if (spec.time) {
      rec.amT = r.slice(q, q + 2) === "99" ? "" : r.slice(q, q + 2);
      rec.pmT = r.slice(q + 2, q + 4) === "99" ? "" : r.slice(q + 2, q + 4);
      q += 4;
    }
    if (spec.irr) { rec.amI = +r[q]; rec.pmI = +r[q + 1]; }
    records[addDays(startDate, offset)] = rec;
  }
  return { app: full[0], kind: app.kind, appName: app.name, idx, total, startDate, days, targets, records, medPlan, demo, aid, build };
}

const hasData = (r) => !!(r && (r.w || r.amS || r.pmS || r.amH || r.pmH || r.amI || r.pmI || r.edema || r.dysp || r.palp || r.mA || r.mN || r.mP || r.mB));

/* ---------- 集計 ---------- */
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function stats(dates, records, plan) {
  const pick = (k) => dates.map((d) => (records[d] && records[d][k] ? Number(records[d][k]) : null)).filter((v) => v != null && !isNaN(v));
  const both = (a, b) => [...pick(a), ...pick(b)];
  const medv = dates.flatMap((d) => (records[d] ? planList(plan).map(([k]) => records[d][k]) : [])).filter((v) => v > 0);
  const ws = pick("w");
  const wd = dates.filter((d) => records[d] && records[d].w);
  let maxGain = 0;
  for (let i = 0; i < wd.length; i++) for (let j = i + 1; j < wd.length; j++) {
    if (Math.round((parseISO(wd[j]) - parseISO(wd[i])) / 86400000) > 3) break;
    maxGain = Math.max(maxGain, Number(records[wd[j]].w) - Number(records[wd[i]].w));
  }
  return {
    days: dates.filter((d) => hasData(records[d])).length,
    sys: mean(both("amS", "pmS")), dia: mean(both("amD", "pmD")), hr: mean(both("amH", "pmH")),
    amS: mean(pick("amS")), amD: mean(pick("amD")), pmS: mean(pick("pmS")), pmD: mean(pick("pmD")),
    wAvg: mean(ws), wMin: ws.length ? Math.min(...ws) : null, wMax: ws.length ? Math.max(...ws) : null, maxGain,
    adherence: medv.length ? (medv.filter((v) => v === 1).length / medv.length) * 100 : null,
    irr: dates.reduce((n, d) => n + (records[d] ? (records[d].amI ? 1 : 0) + (records[d].pmI ? 1 : 0) : 0), 0),
    edemaDays: dates.filter((d) => records[d] && records[d].edema === 2).length,
    dyspDays: dates.filter((d) => records[d] && records[d].dysp === 2).length,
    palpDays: dates.filter((d) => records[d] && records[d].palp === 2).length,
  };
}

/* ---------- 表示部品 ---------- */
function Card({ title, sub, children, style }) {
  return (
    <section style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 3, padding: "16px 16px 18px", ...style }}>
      {title && (
        <header style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: C.ink, letterSpacing: "0.06em", margin: 0, borderLeft: `4px solid ${C.evening}`, paddingLeft: 9 }}>{title}</h2>
          {sub && <p style={{ fontSize: 12.5, color: C.inkSoft, margin: "5px 0 0 13px" }}>{sub}</p>}
        </header>
      )}
      {children}
    </section>
  );
}
function Btn({ children, onClick, tone = C.ink, filled = true, small }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        padding: small ? "8px 14px" : "14px 24px", borderRadius: 3,
        fontSize: small ? 13 : 17, fontWeight: 700, cursor: "pointer",
        border: `1.5px solid ${tone}`, background: filled ? tone : "#fff", color: filled ? "#fff" : tone,
      }}>{children}</button>
  );
}

const dotCircle = (color) => (p) =>
  p.cx == null || p.cy == null ? null
    : <circle key={`c${p.index}`} cx={p.cx} cy={p.cy} r={3.2} fill={color} stroke="#fff" strokeWidth={1.8} />;

/* ---------- 記録の表 ---------- */
function WeekGrid({ dates, records, plan, kind }) {
  const th = { border: `1px solid ${C.line}`, padding: "5px 4px", fontSize: 11, fontWeight: 700, color: C.ink, background: C.tint, whiteSpace: "nowrap" };
  const td = { border: `1px solid ${C.line}`, padding: "5px 3px", fontSize: 11.5, textAlign: "center", color: C.ink, ...NUM };
  const bp = (r, p) => (r && r[p + "S"] ? `${r[p + "S"]}/${r[p + "D"] || "-"}` : "");
  const eve = kind === "bp" ? "夜" : "夕";
  const rows = [
    [`血圧 朝`, (r) => bp(r, "am")],
    [`血圧 ${eve}`, (r) => bp(r, "pm")],
    ["脈拍 朝", (r) => (r && r.amH ? (r.amI ? `${r.amH}*` : r.amH) : "")],
    [`脈拍 ${eve}`, (r) => (r && r.pmH ? (r.pmI ? `${r.pmH}*` : r.pmH) : "")],
  ];
  if (kind === "hf") rows.unshift(["体重 (kg)", (r) => (r && r.w) || ""]);
  const symText = (v) => (v === 1 ? "ない" : v === 2 ? "ある" : "");
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left", minWidth: 84 }}>日付</th>
            {dates.map((d) => <th key={d} style={th}>{fmtMD(d)}<br /><span style={{ fontWeight: 400, color: C.inkSoft }}>({fmtWD(d)})</span></th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, get]) => (
            <tr key={name}>
              <th style={{ ...th, textAlign: "left" }}>{name}</th>
              {dates.map((d) => <td key={d} style={td}>{get(records[d]) || <span style={{ color: C.line }}>—</span>}</td>)}
            </tr>
          ))}
          {kind === "hf" && [["足のむくみ", "edema"], ["息ぐるしさ", "dysp"], ["脈の乱れ", "palp"]].map(([n, k]) => (
            <tr key={k}>
              <th style={{ ...th, textAlign: "left" }}>{n}</th>
              {dates.map((d) => {
                const v = records[d] ? records[d][k] : 0;
                return <td key={d} style={{ ...td, color: v === 2 ? C.alert : C.ink, fontWeight: v === 2 ? 800 : 400 }}>{symText(v) || "—"}</td>;
              })}
            </tr>
          ))}
          <tr>
            <th style={{ ...th, textAlign: "left" }}>服薬 {planList(plan).map(([, jp]) => jp).join("/")}</th>
            {dates.map((d) => {
              const r = records[d];
              const mk = (v) => (v === 1 ? "✓" : v === 2 ? "×" : "・");
              const col = (v) => (v === 2 ? C.alert : v === 1 ? C.good : C.line);
              const pl = planList(plan);
              return (
                <td key={d} style={td}>
                  {r ? pl.map(([k], i) => (
                    <span key={k} style={{ color: col(r[k]), fontWeight: 800 }}>{mk(r[k])}{i < pl.length - 1 ? " " : ""}</span>
                  )) : <span style={{ color: C.line }}>—</span>}
                </td>
              );
            })}
          </tr>
          <tr>
            <th style={{ ...th, textAlign: "left", color: C.inkSoft }}>記録時刻</th>
            {dates.map((d) => {
              const r = records[d];
              const a = r ? slotText(r.amT) : "", b = r ? slotText(r.pmT) : "";
              return (
                <td key={d} style={{ ...td, fontSize: 10 }}>
                  {a || b ? <>{a && <span style={{ color: C.morning }}>{a}</span>}{a && b && <br />}{b && <span style={{ color: C.evening }}>{b}</span>}</>
                    : <span style={{ color: C.line }}>—</span>}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 10, color: C.inkSoft, marginTop: 3 }}>
        脈拍の * は、血圧計に不整脈のマークが出た測定です。
      </p>
    </div>
  );
}

/* ---------- グラフ ---------- */
function Charts({ dates, records, targets, kind }) {
  const data = dates.map((d) => {
    const r = records[d] || {};
    return {
      d: fmtMD(d),
      体重: r.w ? Number(r.w) : null,
      朝上: r.amS ? Number(r.amS) : null, 朝下: r.amD ? Number(r.amD) : null,
      夕上: r.pmS ? Number(r.pmS) : null, 夕下: r.pmD ? Number(r.pmD) : null,
    };
  });
  const tsys = targets.sys ? Number(targets.sys) : null;
  const tdia = kind === "bp" && targets.dia ? Number(targets.dia) : null;
  const tw = kind === "hf" && targets.weight ? Number(targets.weight) : null;
  const taw = kind === "hf" ? (targets.alertW ? Number(targets.alertW) : tw != null ? tw + 2 : null) : null;
  const axis = { stroke: C.inkSoft, fontSize: 10 };
  const dom = (keys, extras, minPad) => {
    const v = [];
    for (const k of keys) for (const row of data) if (row[k] != null) v.push(row[k]);
    for (const e of extras) if (e != null) v.push(e);
    if (!v.length) return ["auto", "auto"];
    const lo = Math.min(...v), hi = Math.max(...v), p = Math.max(minPad, (hi - lo) * 0.15);
    return [Math.floor((lo - p) * 10) / 10, Math.ceil((hi + p) * 10) / 10];
  };
  const mark = (v, c) => ({ value: v, fontSize: 10, fontWeight: 700, fill: c, position: "right", offset: 4 });
  const head = (t) => <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, marginBottom: 4, borderLeft: `4px solid ${C.evening}`, paddingLeft: 8 }}>{t}</div>;
  const bpDomain = dom(["朝上", "朝下", "夕上", "夕下"], [tsys, tdia], 8);
  const eve = kind === "bp" ? "夜" : "夕";

  const Half = ({ title, sKey, dKey }) => (
    <div className="avoid-break">
      {head(title)}
      <div className="chart-h" style={{ height: 170 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 50, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={C.line} strokeDasharray="2 4" />
            <XAxis dataKey="d" tick={axis} interval="preserveStartEnd" />
            <YAxis domain={bpDomain} tick={axis} />
            <Legend align="center" verticalAlign="bottom" iconType="plainline" iconSize={16}
              wrapperStyle={{ fontSize: 11, paddingTop: 2, width: "100%", left: 0, textAlign: "center" }} />
            {tsys != null && <ReferenceLine y={tsys} stroke={C.good} strokeDasharray="6 4" strokeWidth={1.6} label={mark(`目標 ${tsys}`, C.good)} />}
            {tdia != null && <ReferenceLine y={tdia} stroke={C.good} strokeDasharray="6 4" strokeWidth={1.2} label={mark(`目標 ${tdia}`, C.good)} />}
            <Line name="上" dataKey={sKey} stroke={C.evening} strokeWidth={2.2} dot={dotCircle(C.evening)} connectNulls={false} />
            <Line name="下" dataKey={dKey} stroke={C.morning} strokeWidth={2.2} dot={dotCircle(C.morning)} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {kind === "hf" && (
        <div className="avoid-break">
          {head("体重 (kg)")}
          <div className="chart-h" style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 56, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={C.line} strokeDasharray="2 4" />
                <XAxis dataKey="d" tick={axis} interval="preserveStartEnd" />
                <YAxis domain={dom(["体重"], [tw, taw], 0.6)} tick={axis} />
                {taw != null && <ReferenceLine y={taw} stroke={C.alert} strokeDasharray="6 4" strokeWidth={1.4} label={mark(`目安 ${taw.toFixed(1)}`, C.alert)} />}
                {tw != null && <ReferenceLine y={tw} stroke={C.good} strokeDasharray="6 4" strokeWidth={1.6} label={mark(`目標 ${tw.toFixed(1)}`, C.good)} />}
                <Line name="体重" dataKey="体重" stroke={C.ink} strokeWidth={2.2} dot={dotCircle(C.ink)} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <Half title="朝の血圧（上と下）" sKey="朝上" dKey="朝下" />
        <Half title={`${eve}の血圧（上と下）`} sKey="夕上" dKey="夕下" />
      </div>
    </div>
  );
}

/* ---------- 印刷する紙 ---------- */
function Report({ meta, records, dates, at }) {
  const st = stats(dates, records, meta.medPlan);
  const bp = (a, b) => (a == null ? "—" : `${Math.round(a)}/${b == null ? "-" : Math.round(b)}`);
  const boxes = meta.kind === "bp"
    ? [["平均 血圧", bp(st.sys, st.dia), "mmHg"], ["朝の平均", bp(st.amS, st.amD), "mmHg"],
       ["夜の平均", bp(st.pmS, st.pmD), "mmHg"], ["平均 脈拍", st.hr == null ? "—" : Math.round(st.hr), "回/分"],
       ["目標", `${meta.targets.sys || "—"}/${meta.targets.dia || "—"}`, "未満"],
       ["服薬 達成", st.adherence == null ? "—" : Math.round(st.adherence), "%"],
       ["不整脈マーク", st.irr, "回"]]
    : [["体重 平均", st.wAvg ? st.wAvg.toFixed(1) : "—", "kg"],
       ["体重 最小〜最大", st.wMin != null ? `${st.wMin.toFixed(1)}–${st.wMax.toFixed(1)}` : "—", "kg"],
       ["3日以内 最大増加", st.maxGain ? st.maxGain.toFixed(1) : "0.0", "kg"],
       ["朝の平均血圧", bp(st.amS, st.amD), "mmHg"],
       ["服薬 達成", st.adherence == null ? "—" : Math.round(st.adherence), "%"],
       ["むくみ／息切れ", `${st.edemaDays}／${st.dyspDays}`, "日"]];

  const weeks = [];
  if (dates.length) {
    let cur = startOfWeekMon(dates[0]);
    const last = dates[dates.length - 1];
    while (cur <= last) { weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i))); cur = addDays(cur, 7); }
  }

  return (
    <div>
      <div style={{ borderBottom: `2px solid ${C.ink}`, paddingBottom: 6, marginBottom: 10 }}>
        {at && (
          <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, marginBottom: 4, ...NUM }}>
            {`${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")}`} 受付
            {meta.aid ? `　No. ${idText(meta.aid)}` : ""}
          </div>
        )}
        <div style={{ fontSize: 17, fontWeight: 800, color: C.ink }}>{meta.appName}　受診用記録</div>
        <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 3, ...NUM }}>
          {meta.startDate} 〜 {dates[dates.length - 1]}（{meta.days}日間・記録 {st.days}日）
          {meta.demo && meta.demo.age != null ? `　${meta.demo.age}歳` : ""}
          {meta.demo && meta.demo.sex ? `・${SEX_TEXT[meta.demo.sex]}` : ""}
          {meta.aid ? `　手帳番号 ${idText(meta.aid)}` : ""}
        </div>
      </div>

      <div className="flex flex-wrap gap-2" style={{ marginBottom: 12 }}>
        {boxes.map(([l, v, u]) => (
          <div key={l} style={{ border: `1px solid ${C.line}`, padding: "6px 10px", minWidth: 92 }}>
            <div style={{ fontSize: 10, color: C.inkSoft }}>{l}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, ...NUM }}>
              {v}<span style={{ fontSize: 9, fontWeight: 600, marginLeft: 3, color: C.inkSoft }}>{u}</span>
            </div>
          </div>
        ))}
      </div>

      <Charts dates={dates} records={records} targets={meta.targets} kind={meta.kind} />

      <div style={{ marginTop: 12 }}>
        {weeks.map((w, i) => (
          <div key={i} className="avoid-break" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.inkSoft, marginBottom: 3, ...NUM }}>
              {fmtMD(w[0])} 〜 {fmtMD(w[6])}
            </div>
            <WeekGrid dates={w} records={records} plan={meta.medPlan} kind={meta.kind} />
          </div>
        ))}
      </div>
    </div>
  );
}


/* ---------- 端末の設定（暗証番号つき） ---------- */
const TERM_KEY = "reception-terminal:v1";
const emptyConf = () => ({ salt: "", hash: "", csv: false, print: true, name: "", takeSelf: true, after: "wait", reader: "camera", auto: true, paper: "a4", orient: "portrait", big: false });
const memConf = {};
const confStore = {
  async load() {
    try { const r = await window.storage.get(TERM_KEY); return { ...emptyConf(), ...(r ? JSON.parse(r.value) : {}) }; }
    catch { return { ...emptyConf(), ...(memConf[TERM_KEY] || {}) }; }
  },
  async save(v) {
    memConf[TERM_KEY] = v;
    try { await window.storage.set(TERM_KEY, JSON.stringify(v)); } catch { /* 端末内のみ */ }
  },
};
async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  if (window.crypto && window.crypto.subtle) {
    const buf = await window.crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0x811c9dc5;
  for (const b of data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return String(h);
}
const randSalt = () => {
  const a = new Uint8Array(8);
  window.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/* ---------- 保存先フォルダ（選んだ場所に貯めていく） ---------- */
const canFolder = () => typeof window !== "undefined" && !!window.showDirectoryPicker;
const dirRef = { handle: null };

function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open("reception-terminal", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("kv");
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function saveDir(handle) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const t = db.transaction("kv", "readwrite");
      t.objectStore("kv").put(handle, "dir");
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  } catch { /* 保存できなくても、その回は使える */ }
}
async function loadDir() {
  try {
    const db = await idb();
    const h = await new Promise((res, rej) => {
      const t = db.transaction("kv", "readonly");
      const q = t.objectStore("kv").get("dir");
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    if (!h) return null;
    const perm = await h.queryPermission({ mode: "readwrite" });
    if (perm === "granted") return h;
    return h;                       // 使うときに許可を求める
  } catch { return null; }
}

/* ---------- CSVを1行ずつ足していく ---------- */
const CSV_HEAD = ["読取日時", "端末", "手帳", "手帳番号", "年齢", "性別", "日付", "曜日",
  "体重kg", "朝収縮期", "朝拡張期", "朝脈拍", "朝不整脈マーク", "朝記録時刻",
  "夕収縮期", "夕拡張期", "夕脈拍", "夕不整脈マーク", "夕記録時刻",
  "足のむくみ", "息ぐるしさ", "脈の乱れ",
  "服薬朝", "服薬昼", "服薬夕", "服薬寝る前",
  "目標収縮期", "目標拡張期", "目標体重kg"];
const symCsv = (v) => (v === 1 ? "ない" : v === 2 ? "ある" : "");
const medCsv = (v) => (v === 1 ? "飲めた" : v === 2 ? "飲み忘れた" : "");

function csvRows(meta, records, dates, termName) {
  const now = new Date();
  const stamp = `${iso(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const t = meta.targets;
  const out = [];
  for (const d of dates) {
    const r = records[d];
    if (!hasData(r)) continue;
    out.push([stamp, termName || "", meta.appName, meta.aid || "", meta.demo && meta.demo.age != null ? meta.demo.age : "",
      meta.demo && meta.demo.sex ? SEX_TEXT[meta.demo.sex] : "", d, fmtWD(d),
      r.w || "", r.amS || "", r.amD || "", r.amH || "", r.amI ? "あり" : "", slotText(r.amT),
      r.pmS || "", r.pmD || "", r.pmH || "", r.pmI ? "あり" : "", slotText(r.pmT),
      symCsv(r.edema), symCsv(r.dysp), symCsv(r.palp),
      medCsv(r.mA), medCsv(r.mN), medCsv(r.mP), medCsv(r.mB),
      t.sys || "", t.dia || "", t.weight || ""].join(","));
  }
  return out;
}

async function appendCsv(meta, records, dates, termName) {
  const rows = csvRows(meta, records, dates, termName);
  if (!rows.length) return "記録がありませんでした";
  const fname = "受診記録_累積.csv";

  if (dirRef.handle) {
    try {
      const perm = await dirRef.handle.requestPermission({ mode: "readwrite" });
      if (perm !== "granted") throw new Error("no permission");
      const fh = await dirRef.handle.getFileHandle(fname, { create: true });
      let prev = "";
      try { prev = await (await fh.getFile()).text(); } catch { prev = ""; }
      const body = prev ? prev.replace(/\r?\n$/, "") + "\r\n" + rows.join("\r\n") + "\r\n"
        : "\uFEFF" + CSV_HEAD.join(",") + "\r\n" + rows.join("\r\n") + "\r\n";
      const w = await fh.createWritable();
      await w.write(body);
      await w.close();
      return null;
    } catch {
      return "保存先に書き込めませんでした。設定でフォルダを選び直してください";
    }
  }

  // フォルダを選べない端末では、1回ぶんをダウンロードする
  try {
    const text = "\uFEFF" + CSV_HEAD.join(",") + "\r\n" + rows.join("\r\n") + "\r\n";
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `受診記録_${meta.aid || "no-id"}_${dates[dates.length - 1]}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    return null;
  } catch { return "CSVを保存できませんでした"; }
}

/* ---------- 暗証番号の入力 ---------- */
function PinPad({ title, sub, onComplete, error, onCancel }) {
  const [pin, setPin] = useState("");
  useEffect(() => { if (error) setPin(""); }, [error]);
  const push = (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => { onComplete(next); setPin(""); }, 120);
  };
  const key = { fontSize: 24, fontWeight: 700, padding: "14px 0", borderRadius: 3, border: `1.5px solid ${C.line}`, background: "#fff", color: C.ink, cursor: "pointer", ...NUM };
  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 4 }}>{sub}</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 12, margin: "14px 0 16px" }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{ width: 14, height: 14, borderRadius: 99, background: i < pin.length ? C.evening : "transparent", border: `2px solid ${i < pin.length ? C.evening : C.line}` }} />
        ))}
      </div>
      {error && <p style={{ textAlign: "center", color: C.alert, fontSize: 13.5, fontWeight: 700, margin: "0 0 10px" }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, maxWidth: 280, margin: "0 auto" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <button key={d} style={key} onClick={() => push(String(d))}>{d}</button>)}
        <button style={{ ...key, border: "none", background: "transparent", fontSize: 13, color: C.inkSoft }} onClick={onCancel}>やめる</button>
        <button style={key} onClick={() => push("0")}>0</button>
        <button style={{ ...key, fontSize: 13, color: C.inkSoft }} onClick={() => setPin(pin.slice(0, -1))}>けす</button>
      </div>
    </div>
  );
}

/* ---------- 設定画面 ---------- */
function SettingsPanel({ conf, setConf, onClose, onCancel, recent, onReprint }) {
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState(null);
  const [first, setFirst] = useState("");
  const [err, setErr] = useState("");
  const [dirName, setDirName] = useState(dirRef.handle ? dirRef.handle.name : "");

  const pickFolder = async () => {
    try {
      const h = await window.showDirectoryPicker({ mode: "readwrite" });
      dirRef.handle = h;
      setDirName(h.name);
      await saveDir(h);
      setMsg("保存先を設定しました");
    } catch { setMsg(""); }
  };
  const toggle = (k) => setConf({ ...conf, [k]: !conf[k] });
  const row = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" };
  const sw = (on) => ({
    padding: "10px 18px", borderRadius: 3, fontSize: 14, fontWeight: 700, cursor: "pointer",
    border: `2px solid ${on ? C.evening : C.line}`, background: on ? C.evening : "#fff", color: on ? "#fff" : C.inkSoft,
  });

  if (mode) {
    return (
      <Card title={mode === "set1" ? "暗証番号を決める" : "もう一度入力"}>
        <PinPad
          title={mode === "set1" ? "4桁の数字を入力" : "確認のためもう一度"}
          error={err}
          onCancel={() => { setMode(null); setErr(""); setFirst(""); }}
          onComplete={async (p) => {
            if (mode === "set1") { setFirst(p); setErr(""); setMode("set2"); return; }
            if (p !== first) { setErr("番号が一致しません"); setMode("set1"); return; }
            const salt = randSalt();
            setConf({ ...conf, salt, hash: await hashPin(p, salt) });
            setMode(null); setErr(""); setMsg("暗証番号を設定しました");
          }} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="この端末の動作">
        <div style={{ ...row, marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700, width: 150 }}>読み取ったら印刷する</span>
          <button style={sw(conf.print)} onClick={() => toggle("print")}>{conf.print ? "する" : "しない"}</button>
        </div>
        <div style={{ ...row, marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700, width: 150 }}>CSVも保存する</span>
          <button style={sw(conf.csv)} onClick={() => toggle("csv")}>{conf.csv ? "する" : "しない"}</button>
        </div>
        <div style={{ ...row, marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700, width: 150 }}>紙を受け取る人</span>
          <button style={sw(conf.takeSelf)} onClick={() => setConf({ ...conf, takeSelf: true })}>患者さん</button>
          <button style={sw(!conf.takeSelf)} onClick={() => setConf({ ...conf, takeSelf: false })}>医療者側</button>
        </div>
        <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, margin: "0 0 16px" }}>
          プリンタが受付にあり患者さんが自分で取る場合は「患者さん」、医療者側のプリンタに出る場合は「医療者側」を選びます。
        </p>
        <div style={row}>
          <span style={{ fontSize: 15, fontWeight: 700, width: 150 }}>読み取ったあとの案内</span>
          <button style={sw(conf.after === "wait")} onClick={() => setConf({ ...conf, after: "wait" })}>診察までお待ちください</button>
          <button style={sw(conf.after === "call")} onClick={() => setConf({ ...conf, after: "call" })}>受付にお声かけください</button>
        </div>
      </Card>

      <Card title="読み取りのしかた" sub="患者さんへの案内と画面が変わります">
        <div style={row}>
          <span style={{ fontSize: 15, fontWeight: 700, width: 150 }}>読み取る方法</span>
          <button style={sw(conf.reader === "camera")} onClick={() => setConf({ ...conf, reader: "camera" })}>カメラ</button>
          <button style={sw(conf.reader === "scanner")} onClick={() => setConf({ ...conf, reader: "scanner" })}>読み取り機</button>
        </div>
        <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 12 }}>
          「カメラ」を選ぶと端末のカメラの映像が出ます。「読み取り機」を選ぶとカメラは動かず、
          バーコードリーダーからの入力だけを待ちます。据置型の読み取り機をお使いの場合は「読み取り機」を選んでください。
        </p>
      </Card>

      <Card title="印刷のしかた" sub="どのプリンタに出すかは、端末の「通常使うプリンター」で決まります">
        <div style={{ ...row, marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700, width: 150 }}>印刷のタイミング</span>
          <button style={sw(conf.auto)} onClick={() => setConf({ ...conf, auto: true })}>読み取ったら自動</button>
          <button style={sw(!conf.auto)} onClick={() => setConf({ ...conf, auto: false })}>ボタンを押してから</button>
        </div>
        <div style={{ ...row, marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700, width: 150 }}>用紙</span>
          {[["a4", "A4"], ["a5", "A5"], ["letter", "レター"]].map(([k, l]) => (
            <button key={k} style={sw(conf.paper === k)} onClick={() => setConf({ ...conf, paper: k })}>{l}</button>
          ))}
        </div>
        <div style={{ ...row, marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700, width: 150 }}>向き</span>
          <button style={sw(conf.orient === "portrait")} onClick={() => setConf({ ...conf, orient: "portrait" })}>たて</button>
          <button style={sw(conf.orient === "landscape")} onClick={() => setConf({ ...conf, orient: "landscape" })}>よこ</button>
        </div>
        <div style={row}>
          <span style={{ fontSize: 15, fontWeight: 700, width: 150 }}>文字の大きさ</span>
          <button style={sw(!conf.big)} onClick={() => setConf({ ...conf, big: false })}>ふつう</button>
          <button style={sw(conf.big)} onClick={() => setConf({ ...conf, big: true })}>大きめ</button>
        </div>
        <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 14 }}>
          プリンタそのものはブラウザから選べません。医療者側のプリンタに出したい場合は、
          この端末の「通常使うプリンター」をそちらに設定してください。
          その都度選びたい場合は「ボタンを押してから」にすると、印刷画面が開きます
          （Chromeを <b>--kiosk-printing</b> で起動しているときは開かず、そのまま出ます）。
        </p>
        <div className="no-print" style={{ marginTop: 12 }}>
          <Btn small filled={false} onClick={() => { try { window.print(); } catch { /* 手動で */ } }}>
            テスト印刷
          </Btn>
          <span style={{ fontSize: 12, color: C.inkSoft, marginLeft: 10 }}>いまの設定で1枚出してみます</span>
        </div>
      </Card>

      <Card title="CSVの保存先" sub="選んだフォルダの「受診記録_累積.csv」に足していきます">
        {canFolder() ? (
          <>
            <div style={row}>
              <Btn small onClick={pickFolder}>フォルダを選ぶ</Btn>
              <span style={{ fontSize: 14, fontWeight: 700, color: dirName ? C.ink : C.inkSoft }}>
                {dirName ? `保存先：${dirName}` : "未設定（ダウンロードに保存されます）"}
              </span>
            </div>
            <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 10 }}>
              読み取るたびに、1日1行ずつ追記されます。同じ日が重複したときは、読取日時の新しいほうを採用してください。
            </p>
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: C.inkSoft, lineHeight: 1.9 }}>
            この端末のブラウザはフォルダ指定に対応していません（iPadのSafariなど）。
            CSVは1回ぶんずつダウンロードに保存されます。フォルダに貯めたい場合は、WindowsかMacのChromeでお使いください。
          </p>
        )}
      </Card>

      <Card title="直近の読み取り" sub="印刷に失敗したときは、ここから出し直せます">
        {(!recent || recent.length === 0)
          ? <p style={{ fontSize: 13.5, color: C.inkSoft }}>まだ読み取りがありません。</p>
          : (
            <div className="flex flex-col gap-2">
              {recent.map((r, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
                  border: `1px solid ${C.line}`, borderRadius: 3, padding: "10px 12px",
                }}>
                  <div style={{ fontSize: 13.5, color: C.ink, ...NUM }}>
                    <b>{`${r.at.getHours()}:${String(r.at.getMinutes()).padStart(2, "0")}`}</b>
                    <span style={{ marginLeft: 10 }}>{r.meta.appName}</span>
                    <span style={{ marginLeft: 10, color: C.inkSoft }}>
                      No. {idText(r.meta.aid)}
                    </span>
                  </div>
                  <Btn small filled={false} onClick={() => onReprint(r)}>もう一度印刷</Btn>
                </div>
              ))}
            </div>
          )}
        <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 12 }}>
          直近5件だけを端末のメモリに残しています。画面を閉じたり読み込み直したりすると消えます。
        </p>
      </Card>

      <Card title="端末の名前" sub="CSVに記録され、どの端末から出たか分かります">
        <input value={conf.name} onChange={(e) => setConf({ ...conf, name: e.target.value })}
          placeholder="例：外来受付1"
          style={{ padding: "10px 12px", border: `1px solid ${C.line}`, borderRadius: 3, fontSize: 15, color: C.ink, width: "100%", maxWidth: 320 }} />
      </Card>

      <Card title="暗証番号">
        <Btn small filled={false} onClick={() => { setMode("set1"); setErr(""); setFirst(""); }}>
          {conf.hash ? "暗証番号を変える" : "暗証番号を決める"}
        </Btn>
        {!conf.hash && (
          <p style={{ fontSize: 12.5, color: C.morning, fontWeight: 700, marginTop: 10 }}>
            まだ設定されていません。誰でも設定を開ける状態です。
          </p>
        )}
      </Card>

      {msg && <p style={{ fontSize: 13, color: C.good, fontWeight: 700 }}>{msg}</p>}
      <div className="flex gap-2 flex-wrap justify-end">
        <Btn onClick={onClose}>設定を保存してもどる</Btn>
        <Btn filled={false} tone={C.inkSoft} onClick={onCancel}>保存せずにもどる</Btn>
      </div>
    </div>
  );
}

/* ---------- 受付端末 ---------- */
export default function App() {
  const [chunks, setChunks] = useState({});
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState("");
  const [phase, setPhase] = useState("wait");
  const [conf, setConf] = useState(emptyConf());
  const [screen, setScreen] = useState("scan");     // scan / pin / settings
  const [pinErr, setPinErr] = useState("");
  const [csvMsg, setCsvMsg] = useState("");
  const [recent, setRecent] = useState([]);        // 直近の読み取り（端末のメモリ内のみ）
  // カメラ運用では、開始ボタンを押すまでカメラを動かさない（読み取り機運用は常時待ち受け）
  const [scanning, setScanning] = useState(false);
  const confSnap = useRef(null);
  const [job, setJob] = useState(null);            // いま印刷する内容
  const inputRef = useRef(null);
  const idleRef = useRef(null);

  useEffect(() => {
    confStore.load().then(setConf);
    loadDir().then((h) => { if (h) dirRef.handle = h; });
  }, []);
  useEffect(() => { if (screen !== "settings") confStore.save(conf); }, [conf, screen]);

  const reset = useCallback(() => {
    setChunks({}); setMeta(null); setErr(""); setPhase("wait"); setScanning(false);
    if (inputRef.current) inputRef.current.value = "";
  }, []);
  const touch = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(reset, 90000);
  }, [reset]);

  const accept = useCallback((raw) => {
    const res = decodeChunk(raw);
    if (res.error) { setErr(res.error); touch(); return; }
    setErr("");
    setMeta((prev) => {
      // 別の手帳のQRが混ざったら、そこから読み直す
      if (prev && (prev.app !== res.app || prev.startDate !== res.startDate)) setChunks({});
      return {
        app: res.app, kind: res.kind, appName: res.appName, startDate: res.startDate, days: res.days,
        targets: res.targets, total: res.total, medPlan: res.medPlan, demo: res.demo, aid: res.aid,
      };
    });
    setChunks((prev) => ({ ...prev, [res.idx]: res.records }));
    touch();
  }, [touch]);

  const merged = useMemo(() => Object.assign({}, ...Object.values(chunks)), [chunks]);
  const dates = useMemo(() => (meta ? Array.from({ length: meta.days }, (_, i) => addDays(meta.startDate, i)) : []), [meta]);
  const got = Object.keys(chunks).length;

  useEffect(() => {
    if (!meta || got < meta.total || phase !== "wait") return;
    setPhase("ready");
    setCsvMsg("");
    const entry = { at: new Date(), meta, records: merged, dates };
    setJob(entry);
    setRecent((prev) => [entry, ...prev].slice(0, 5));
  }, [meta, got, phase, merged, dates]);

  // 「印刷しています…」を一拍見せてから、CSV・印刷を実行して完了画面へ。
  // phaseを変える処理と同じeffectにタイマーを置くと、phase変更で走るクリーンアップに
  // タイマー自身が消されて、完了画面に進まなくなる
  useEffect(() => {
    if (phase !== "ready" || !job) return;
    const t = setTimeout(async () => {
      if (conf.csv) {
        const e = await appendCsv(job.meta, job.records, job.dates, conf.name);
        setCsvMsg(e || (dirRef.handle ? "CSVに追記しました" : "CSVを保存しました"));
      }
      if (conf.print && conf.auto) { try { window.print(); } catch { /* 手動で印刷 */ } }
      setPhase("printed");
    }, 700);
    return () => clearTimeout(t);
  }, [phase, job, conf]);

  useEffect(() => {
    if (phase !== "printed") return;
    const t = setTimeout(reset, 10000);
    return () => clearTimeout(t);
  }, [phase, reset]);

  useEffect(() => { touch(); return () => { if (idleRef.current) clearTimeout(idleRef.current); }; }, [touch]);

  const big = { fontSize: 32, fontWeight: 800, color: C.ink, lineHeight: 1.5 };

  return (
    <div className="term-root" style={{ fontFamily: FONT, background: C.paper, minHeight: "100vh", color: C.ink }}>
      <style>{`
        .term-root, .term-root * { font-family: ${FONT}; }
        @page { size: ${conf.paper.toUpperCase()} ${conf.orient}; margin: 10mm; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; font-size: ${conf.big ? "112%" : "100%"}; }
          body { background: #fff; }
          div[style*="overflow-x"] { overflow: visible !important; }
          table { min-width: 0 !important; width: 100% !important; font-size: 9.5px !important; }
          th, td { padding: 3px 2px !important; }
          /* 画面幅のまま描かれたグラフが紙からはみ出し、空ページになるのを防ぐ */
          html, body, .term-root, main { overflow-x: hidden !important; }
          .recharts-wrapper, .recharts-wrapper svg, .recharts-surface { width: 100% !important; max-width: 100% !important; }
          .chart-h { width: 100% !important; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
          section { break-inside: auto; page-break-inside: auto; }
        }
      `}</style>

      <div className="no-print" style={{ maxWidth: 720, margin: "0 auto", padding: "26px 18px 40px" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.inkSoft, letterSpacing: "0.16em" }}>受付端末</div>
        </div>

        {screen === "pin" ? (
          <Card>
            <PinPad title="設定を開きます" sub="暗証番号を入力してください" error={pinErr}
              onCancel={() => { setScreen("scan"); setPinErr(""); }}
              onComplete={async (p) => {
                const h = await hashPin(p, conf.salt);
                if (h === conf.hash) { setPinErr(""); confSnap.current = conf; setScreen("settings"); }
                else setPinErr("暗証番号が違います");
              }} />
          </Card>
        ) : screen === "settings" ? (
          <SettingsPanel conf={conf} setConf={setConf}
            onClose={() => { confSnap.current = null; setScreen("scan"); }}
            onCancel={() => {
              if (confSnap.current) setConf(confSnap.current);
              confSnap.current = null;
              setScreen("scan");
            }}
            recent={recent}
            onReprint={(r) => {
              setJob(r);
              setTimeout(() => { try { window.print(); } catch { /* 手動で印刷 */ } }, 300);
            }} />
        ) : phase === "printed" ? (
          <Card style={{ borderColor: C.good, borderLeft: `6px solid ${C.good}` }}>
            <div style={{ ...big, color: C.good, textAlign: "center" }}>
              {conf.takeSelf ? "用紙をお取りください" : "読み取りました"}
            </div>
            <div style={{ fontSize: 19, fontWeight: 700, color: C.ink, textAlign: "center", marginTop: 10 }}>
              {conf.after === "call" ? "受付にお声かけください" : "診察までお待ちください"}
            </div>
            {csvMsg && (
              <p style={{ fontSize: 14, fontWeight: 700, textAlign: "center", marginTop: 10, color: csvMsg.includes("できません") ? C.alert : C.good }}>
                {csvMsg}
              </p>
            )}
            <p style={{ fontSize: 16, color: C.inkSoft, textAlign: "center", marginTop: 12 }}>まもなく最初の画面に戻ります</p>
            <div className="flex justify-center gap-2 flex-wrap" style={{ marginTop: 16 }}>
              {conf.print && !conf.auto && (
                <Btn onClick={() => { try { window.print(); } catch { /* 手動で */ } }}>印刷する</Btn>
              )}
              <Btn filled={conf.auto} onClick={reset}>次の方へ</Btn>
            </div>
          </Card>
        ) : phase === "ready" ? (
          <Card style={{ borderColor: C.evening, borderLeft: `6px solid ${C.evening}` }}>
            <div style={{ ...big, textAlign: "center" }}>印刷しています…</div>
            <p style={{ fontSize: 15, color: C.inkSoft, textAlign: "center", marginTop: 10 }}>{meta && meta.appName}</p>
          </Card>
        ) : conf.reader === "camera" && !scanning ? (
          <>
            <Card style={{ borderLeft: `6px solid ${C.evening}` }}>
              <div style={{ ...big, textAlign: "center" }}>受診用QRコードの<br />読み取り</div>
              <p style={{ fontSize: 15, color: C.inkSoft, textAlign: "center", marginTop: 14, lineHeight: 1.8 }}>
                ボタンを押すとカメラが動き、読み取り画面になります
              </p>
              <div style={{ textAlign: "center", marginTop: 22 }}>
                <button onClick={() => { setScanning(true); touch(); }}
                  style={{
                    padding: "20px 30px", borderRadius: 6, border: "none", cursor: "pointer",
                    background: C.evening, color: "#fff", fontSize: 21, fontWeight: 800,
                    letterSpacing: "0.04em",
                  }}>
                  受診用QRコードの読み取りを始める
                </button>
              </div>
            </Card>

            <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 28 }}>
              <span style={{ fontSize: 11.5, color: C.inkSoft, ...NUM }}>受付端末 v{APP_VERSION}</span>
              <button onClick={() => { setPinErr(""); confSnap.current = conf; setScreen(conf.hash ? "pin" : "settings"); }}
                title="設定"
                style={{
                  border: `1px solid ${C.line}`, background: "#fff", color: C.inkSoft,
                  borderRadius: 3, width: 30, height: 26, cursor: "pointer", fontSize: 13, lineHeight: 1,
                }}>⚙</button>
            </div>
          </>
        ) : (
          <>
            <Card style={{ borderLeft: `6px solid ${C.evening}` }}>
              <div style={{ ...big, textAlign: "center" }}>受診用QRコードを<br />かざしてください</div>
              <p style={{ fontSize: 15, color: C.inkSoft, textAlign: "center", marginTop: 14, lineHeight: 1.8 }}>
                {conf.reader === "scanner"
                  ? "スマートフォンの画面を、読み取り機にかざしてください"
                  : "スマートフォンの画面を、下のカメラに向けてください"}<br />
                しが血圧ノート・心不全手帳のどちらでも読み取れます
              </p>
              {meta && (
                <div style={{ textAlign: "center", marginTop: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.evening, marginBottom: 8 }}>{meta.appName}</div>
                  <span style={{
                    display: "inline-block", padding: "10px 20px", borderRadius: 3,
                    background: C.tint, border: `2px solid ${C.evening}`,
                    fontSize: 22, fontWeight: 800, color: C.ink, ...NUM,
                  }}>{got} / {meta.total} 枚 読み取りました</span>
                  {got < meta.total && (
                    <p style={{ fontSize: 17, fontWeight: 700, color: C.morning, marginTop: 12 }}>
                      つづけて次のQRコードをかざしてください
                    </p>
                  )}
                </div>
              )}
              {err && <p style={{ fontSize: 16, fontWeight: 700, color: C.alert, textAlign: "center", marginTop: 14 }}>{err}</p>}
            </Card>

            {conf.reader === "camera" ? (
              <div style={{ marginTop: 16 }}>
                <CameraScanner onCode={accept} onClose={() => setScanning(false)} />
              </div>
            ) : (
              <div style={{ marginTop: 20, textAlign: "center" }}>
                <div style={{
                  display: "inline-block", padding: "26px 34px", borderRadius: 6,
                  border: `3px dashed ${C.evening}`, background: C.tint,
                }}>
                  <div style={{ fontSize: 46, lineHeight: 1 }}>▤</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, marginTop: 10 }}>
                    読み取り機にかざしてください
                  </div>
                </div>
              </div>
            )}

            <input ref={inputRef} autoFocus
              onBlur={(e) => setTimeout(() => e.target && e.target.focus(), 100)}
              onKeyDown={(e) => { if (e.key === "Enter") { accept(e.currentTarget.value); e.currentTarget.value = ""; } }}
              style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />

            <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 28 }}>
              <span style={{ fontSize: 11.5, color: C.inkSoft, ...NUM }}>受付端末 v{APP_VERSION}</span>
              <button onClick={() => { setPinErr(""); confSnap.current = conf; setScreen(conf.hash ? "pin" : "settings"); }}
                title="設定"
                style={{
                  border: `1px solid ${C.line}`, background: "#fff", color: C.inkSoft,
                  borderRadius: 3, width: 30, height: 26, cursor: "pointer", fontSize: 13, lineHeight: 1,
                }}>⚙</button>
            </div>
          </>
        )}
      </div>

      {job && (
        <div className="print-only" style={{ display: "none", padding: "0 12px" }}>
          <Report meta={job.meta} records={job.records} dates={job.dates} at={job.at} />
        </div>
      )}
    </div>
  );
}
