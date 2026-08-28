import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Legend
} from "recharts";

/* ============================================================
   心不全手帳（教材と日々の記録）
   - 患者モード：毎日の記録／目標値／受診日／QR出力
   - 医療者モード：QR（またはコード）読み取り → 集計・グラフ・印刷
   紙の手帳の記載項目を踏襲。イラスト・書式は独自に作り直しています。
   ============================================================ */

/* ---------- 1. デザイントークン ---------- */
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
  };
}

const C = {
  paper: "#F1FAFF",       // 湖面の淡い水色
  card: "#FFFFFF",
  ink: "#2B3646",         // 深い湖の青
  inkSoft: "#46525F",
  line: "#D9E9F6",
  morning: "#E08A3C",     // 朝（湖にのぼる陽）
  evening: "#1B77CB",     // 夕（沖の深い青）
  good: "#33A165",
  alert: "#CC6455",
  alertBg: "#FDF6F4",
  tint: "#F1FAFF",        // 表の見出しなどの薄い水色
  tintDeep: "#D9ECFB",    // 週平均など強調の水色
};
const FONT = '"Meiryo","メイリオ",sans-serif';
const NUM = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum"' };

/* ---------- 2. QRエンコーダ（数字モード・自己完結） ---------- */
const ECB = {
  L: [[7,1,19,0,0],[10,1,34,0,0],[15,1,55,0,0],[20,1,80,0,0],[26,1,108,0,0],[18,2,68,0,0],[20,2,78,0,0],[24,2,97,0,0],[30,2,116,0,0],[18,2,68,2,69],[20,4,81,0,0],[24,2,92,2,93],[26,4,107,0,0],[30,3,115,1,116],[22,5,87,1,88],[24,5,98,1,99],[28,1,107,5,108],[30,5,120,1,121],[28,3,113,4,114],[28,3,107,5,108],[28,4,116,4,117],[28,2,111,7,112],[30,4,121,5,122],[30,6,117,4,118],[26,8,106,4,107],[28,10,114,2,115],[30,8,122,4,123],[30,3,117,10,118],[30,7,116,7,117],[30,5,115,10,116],[30,13,115,3,116],[30,17,115,0,0],[30,17,115,1,116],[30,13,115,6,116],[30,12,121,7,122],[30,6,121,14,122],[30,17,122,4,123],[30,4,122,18,123],[30,20,117,4,118],[30,19,118,6,119]],
  M: [[10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],[16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44],[30,1,50,4,51],[22,6,36,2,37],[22,8,37,1,38],[24,4,40,5,41],[24,5,41,5,42],[28,7,45,3,46],[28,10,46,1,47],[26,9,43,4,44],[26,3,44,11,45],[26,3,41,13,42],[26,17,42,0,0],[28,17,46,0,0],[28,4,47,14,48],[28,6,45,14,46],[28,8,47,13,48],[28,19,46,4,47],[28,22,45,3,46],[28,3,45,23,46],[28,21,45,7,46],[28,19,47,10,48],[28,2,46,29,47],[28,10,46,23,47],[28,14,46,21,47],[28,14,46,23,47],[28,12,47,26,48],[28,6,47,34,48],[28,29,46,14,47],[28,13,46,32,47],[28,40,47,7,48],[28,18,47,31,48]],
};
const ALIGN = ["","6,18","6,22","6,26","6,30","6,34","6,22,38","6,24,42","6,26,46","6,28,50","6,30,54","6,32,58","6,34,62","6,26,46,66","6,26,48,70","6,26,50,74","6,30,54,78","6,30,56,82","6,30,58,86","6,34,62,90","6,28,50,72,94","6,26,50,74,98","6,30,54,78,102","6,28,54,80,106","6,32,58,84,110","6,30,58,86,114","6,34,62,90,118","6,26,50,74,98,122","6,30,54,78,102,126","6,26,52,78,104,130","6,30,56,82,108,134","6,34,60,86,112,138","6,30,58,86,114,142","6,34,62,90,118,146","6,30,54,78,102,126,150","6,24,50,76,102,128,154","6,28,54,80,106,132,158","6,32,58,84,110,136,162","6,26,54,82,110,138,166","6,30,58,86,114,142,170"];
const ECL_BITS = { L: 1, M: 0 };

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
function genPoly(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= gmul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly;
}
function rsEncode(data, ecLen) {
  const g = genPoly(ecLen), res = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const f = data[i] ^ res[0];
    res.copyWithin(0, 1); res[ecLen - 1] = 0;
    if (f !== 0) for (let j = 0; j < ecLen; j++) res[j] ^= gmul(g[j + 1], f);
  }
  return res;
}
const cciBits = (v) => (v < 10 ? 10 : v < 27 ? 12 : 14);
const dataCw = (v, ecl) => { const r = ECB[ecl][v - 1]; return r[1] * r[2] + r[3] * r[4]; };
const numBits = (n) => 10 * Math.floor(n / 3) + (n % 3 === 1 ? 4 : n % 3 === 2 ? 7 : 0);
function chooseVersion(n, ecl) {
  for (let v = 1; v <= 40; v++) if (numBits(n) <= dataCw(v, ecl) * 8 - 4 - cciBits(v)) return v;
  return null;
}
function buildCodewords(digits, v, ecl) {
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(1, 4); push(digits.length, cciBits(v));
  for (let i = 0; i < digits.length; i += 3) {
    const ch = digits.substr(i, 3);
    push(parseInt(ch, 10), ch.length === 3 ? 10 : ch.length === 2 ? 7 : 4);
  }
  const total = dataCw(v, ecl), maxBits = total * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; bytes.push(b); }
  const PAD = [0xec, 0x11]; let p = 0;
  while (bytes.length < total) bytes.push(PAD[p++ % 2]);
  const [ecLen, n1, d1, n2, d2] = ECB[ecl][v - 1];
  const blocks = [], ecs = []; let off = 0;
  for (let i = 0; i < n1; i++) { const b = bytes.slice(off, off + d1); off += d1; blocks.push(b); ecs.push(rsEncode(b, ecLen)); }
  for (let i = 0; i < n2; i++) { const b = bytes.slice(off, off + d2); off += d2; blocks.push(b); ecs.push(rsEncode(b, ecLen)); }
  const out = [], maxLen = Math.max(d1, d2);
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const b of ecs) out.push(b[i]);
  return out;
}
function bchFormat(d0) { let d = d0 << 10; for (let i = 14; i >= 10; i--) if ((d >> i) & 1) d ^= 0x537 << (i - 10); return ((d0 << 10) | d) ^ 0x5412; }
function bchVersion(v) { let d = v << 12; for (let i = 17; i >= 12; i--) if ((d >> i) & 1) d ^= 0x1f25 << (i - 12); return (v << 12) | d; }
const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];
function penalty(m, size) {
  const at = (r, c) => m[r * size + c]; let s = 0;
  for (let i = 0; i < size; i++) for (const d of [0, 1]) {
    let run = 1, prev = -1;
    for (let j = 0; j < size; j++) {
      const v = d === 0 ? at(i, j) : at(j, i);
      if (v === prev) { run++; if (run === 5) s += 3; else if (run > 5) s += 1; } else { run = 1; prev = v; }
    }
  }
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = at(r, c);
    if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) s += 3;
  }
  const p1 = [1,0,1,1,1,0,1,0,0,0,0], p2 = [0,0,0,0,1,0,1,1,1,0,1];
  for (let i = 0; i < size; i++) for (let j = 0; j <= size - 11; j++) for (const d of [0, 1]) {
    let a = true, b = true;
    for (let k = 0; k < 11; k++) { const v = d === 0 ? at(i, j + k) : at(j + k, i); if (v !== p1[k]) a = false; if (v !== p2[k]) b = false; }
    if (a) s += 40; if (b) s += 40;
  }
  let dark = 0; for (let i = 0; i < size * size; i++) dark += m[i];
  s += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return s;
}
function applyFormat(m, size, fmt) {
  for (let i = 0; i < 15; i++) {
    const b = (fmt >> i) & 1;
    if (i < 6) m[i * size + 8] = b;
    else if (i < 8) m[(i + 1) * size + 8] = b;
    else if (i === 8) m[8 * size + 7] = b;
    else m[8 * size + (14 - i)] = b;
    if (i < 8) m[8 * size + (size - 1 - i)] = b;
    else m[(size - 15 + i) * size + 8] = b;
  }
  m[(size - 8) * size + 8] = 1;
}
function qrMatrix(digits, ecl = "M") {
  const v = chooseVersion(digits.length, ecl);
  if (!v) throw new Error("データが長すぎます");
  const size = v * 4 + 17;
  const mods = new Uint8Array(size * size), res = new Uint8Array(size * size);
  const set = (r, c, val) => { mods[r * size + c] = val; res[r * size + c] = 1; };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const r1 = r0 + r, c1 = c0 + c;
      if (r1 < 0 || c1 < 0 || r1 >= size || c1 >= size) continue;
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark = inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      set(r1, c1, dark ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  if (v > 1) {
    const co = ALIGN[v - 1].split(",").map(Number);
    for (const r of co) for (const c of co) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
    }
  }
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0 ? 1 : 0); set(i, 6, i % 2 === 0 ? 1 : 0); }
  set(size - 8, 8, 1);
  for (let i = 0; i <= 8; i++) { if (!res[8 * size + i]) set(8, i, 0); if (!res[i * size + 8]) set(i, 8, 0); }
  for (let i = size - 8; i < size; i++) set(8, i, 0);
  for (let i = size - 7; i < size; i++) set(i, 8, 0);
  if (v >= 7) {
    const bits = bchVersion(v);
    for (let i = 0; i < 18; i++) {
      const b = (bits >> i) & 1;
      set(Math.floor(i / 3), size - 11 + (i % 3), b);
      set(size - 11 + (i % 3), Math.floor(i / 3), b);
    }
  }
  const cw = buildCodewords(digits, v, ecl), bits = [];
  for (const b of cw) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  let bi = 0, row = size - 1, dir = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (;;) {
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (!res[row * size + c]) mods[row * size + c] = bi < bits.length ? bits[bi++] : 0;
      }
      row += dir;
      if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
    }
  }
  let best = null, bestScore = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    const t = Uint8Array.from(mods);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (!res[r * size + c] && MASKS[mk](r, c)) t[r * size + c] ^= 1;
    applyFormat(t, size, bchFormat((ECL_BITS[ecl] << 3) | mk));
    const sc = penalty(t, size);
    if (sc < bestScore) { bestScore = sc; best = t; }
  }
  return { size, modules: best, version: v };
}

function QRSvg({ text, px = 260 }) {
  const m = useMemo(() => { try { return qrMatrix(text, "M"); } catch { return null; } }, [text]);
  if (!m) return <div style={{ color: C.alert }}>QRを作れませんでした</div>;
  const q = 4, total = m.size + q * 2;
  let d = "";
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++)
    if (m.modules[r * m.size + c]) d += `M${c + q} ${r + q}h1v1h-1z`;
  return (
    <svg width={px} height={px} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges"
      style={{ background: "#fff", borderRadius: 3 }}>
      <rect width={total} height={total} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/* ---------- 3. 日付ユーティリティ ---------- */
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const todayISO = () => iso(new Date());
const fmtMD = (s) => { const d = parseISO(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtWD = (s) => WD[parseISO(s).getDay()];
const startOfWeekMon = (s) => addDays(s, -((parseISO(s).getDay() + 6) % 7));

/* ---------- 3.5 教材コンテンツ ---------- */
const CHAPTERS = ["心不全を知る", "悪くしないために", "検査と治療", "くらしの工夫"];

const TOPICS = [
  { id: "t01", ch: 0, title: "心不全とはどんな病気か", body: [
    { t: "p", v: "心臓は全身に血液を送るポンプです。心不全は、そのポンプの力が落ちて、体が必要とするだけの血液を送れなくなった状態をいいます。" },
    { t: "p", v: "ひとつの病名ではなく、いろいろな心臓の病気の結果として起こる「状態」です。高血圧、心筋梗塞、弁膜症、不整脈、心筋症などが原因になります。" },
    { t: "note", v: "心不全は完治する病気ではありませんが、うまく付き合えば長く安定して過ごすことができます。" },
  ] },
  { id: "t02", ch: 0, title: "どんな症状が出るか", body: [
    { t: "p", v: "症状は大きく2つに分かれます。血液がうまく先へ流れずにたまることで起こるものと、送り出す力が足りないことで起こるものです。" },
    { t: "list", title: "血液がたまって起こる症状", v: ["息苦しい", "横になると苦しい", "夜に咳が出る", "動いたときに息が切れる", "足がむくむ", "体重が増える", "食欲がない"] },
    { t: "list", title: "送り出す力が落ちて起こる症状", v: ["疲れやすい", "体がだるい", "手足が冷たい", "血圧が下がる"] },
    { t: "note", v: "「動いたときの息切れ」「足のむくみ」「体重が増える」は、自分で早く気づけるサインです。" },
  ] },
  { id: "t03", ch: 0, title: "心不全のたどる経過", body: [
    { t: "p", v: "心不全は、良くなったり悪くなったりを繰り返しながら進みます。一度悪くなると、治療で持ち直しても心臓のダメージが少しずつ積み重なり、元の状態までは戻りにくくなります。" },
    { t: "p", v: "だからこそ、悪くなりきる前の小さな変化に気づくことが何より大切です。症状がないか軽いうちに外来を受診できれば、入院を避けられることがあります。" },
    { t: "note", v: "毎日の記録は、この「小さな変化」を見つけるためのものです。" },
  ] },

  { id: "t04", ch: 1, title: "悪くなるきっかけ", body: [
    { t: "list", v: ["薬の飲み忘れ、自己判断でのやめてしまい", "塩分・水分のとりすぎ", "かぜや肺炎などの感染", "働きすぎ、強い疲れ", "体を動かさない生活", "たばこ、お酒の飲みすぎ", "不整脈が出てくること"] },
    { t: "note", v: "多くは自分で気をつけることで防げます。ひとつずつ見ていきましょう。" },
  ] },
  { id: "t05", ch: 1, title: "薬を飲み続ける", body: [
    { t: "p", v: "心臓の薬は、飲んでもすぐには効果を感じにくいものが多く、つい自分の判断でやめたくなることがあります。しかし急に中断すると心臓の負担が一気に増え、短期間で悪化することがあります。" },
    { t: "p", v: "心不全の薬には、症状を和らげるだけでなく、入院を減らし寿命をのばす働きが確かめられているものがあります。血圧や脈が低めでも飲み続けることがあるのはそのためです。" },
    { t: "list", title: "飲み忘れを防ぐ工夫", v: ["薬をまとめる（一包化）を薬剤師に相談する", "お薬カレンダーや服薬ケースを使う", "家族と一緒に確認する", "飲んだらこのアプリでチェックする"] },
    { t: "warn", v: "気になる副作用が出たときは、自分でやめる前に医師・薬剤師に相談してください。お薬手帳とこの記録を一緒に持って受診しましょう。" },
  ] },
  { id: "t06", ch: 1, title: "塩分と食事", body: [
    { t: "p", v: "塩分をとりすぎると体に水分がたまり、心臓の負担とむくみの原因になります。1日6g未満が目安です。1食あたり約2gと考えるとわかりやすくなります。" },
    { t: "list", title: "減塩のコツ", v: ["だしのうまみ、酸味、薬味を使う", "醤油は「かける」より「つける」", "麺類の汁は残す", "干物・練り物・漬物・加工食品は控えめに", "外食は自分で調整しやすい定食を選ぶ"] },
    { t: "kv", title: "塩分1gのめやす", v: [["しょうゆ", "小さじ1"], ["減塩しょうゆ", "小さじ2"], ["味噌", "小さじ1と1/3"], ["ポン酢", "大さじ1"], ["ケチャップ", "大さじ2"], ["ウスターソース", "小さじ2"]] },
    { t: "warn", v: "減らしすぎて食が細るのも問題です。体重が落ちてきた、食欲が出ないというときは我慢せず相談してください。" },
  ] },
  { id: "t07", ch: 1, title: "水分のとり方", body: [
    { t: "p", v: "水分をとりすぎると血液の量が増え、心臓の負担になります。1日にとってよい量は、心臓の状態、薬、季節、運動量によって変わります。受診のたびに確認しましょう。" },
    { t: "list", title: "量を守る工夫", v: ["いつも使うコップの容量を測っておき、1日何杯までか決める", "ペットボトルに1日分を用意する", "外出時はマイボトルを持つ"] },
    { t: "p", v: "味噌汁やスープ、おかゆ、果物、麺の汁も水分に含まれます。汁を残したつもりでも、麺と一緒に思った以上に飲んでいます。" },
    { t: "note", v: "夏だけでなく冬も脱水になります。立ちくらみ、口の渇き、尿が少ない・濃いといったときは相談してください。のどが渇くときは、塩分をとりすぎていないか振り返ってみましょう。" },
  ] },
  { id: "t08", ch: 1, title: "たばことお酒", body: [
    { t: "p", v: "喫煙は血圧と脈拍を上げ、不整脈や動脈硬化の原因になります。禁煙は心不全の治療の一部と考えてください。" },
    { t: "list", title: "禁煙のコツ", v: ["たばこ・ライター・灰皿を捨てる", "月初めや誕生日など覚えやすい日から始める", "家族や知人に宣言する", "吸いたくなったときの代わりの行動を決めておく"] },
    { t: "p", v: "お酒は量を守れば問題にならないことが多いものの、飲みすぎは水分のとりすぎ、血圧の変動、不整脈につながります。おつまみの塩分にも注意が必要です。病状によっては飲まないほうがよい場合があるので、飲んでよい量は主治医に確認しましょう。" },
    { t: "note", v: "禁煙が難しいと感じたら、禁煙外来という選択肢があります。" },
  ] },
  { id: "t09", ch: 1, title: "感染を防ぐ", body: [
    { t: "p", v: "かぜ、肺炎、尿路感染は、心不全が悪くなるきっかけとしてよくあるものです。" },
    { t: "list", v: ["外出後、食事の前、トイレの後の手洗い（30秒以上、ていねいに）", "うがい、外出時のマスク", "口の中を清潔に保つ", "インフルエンザ・肺炎球菌ワクチンの接種"] },
    { t: "warn", v: "熱、のどの痛み、咳が出たときは我慢せず早めに受診してください。早く治すことが心不全の悪化を防ぐことにつながります。" },
  ] },
  { id: "t10", ch: 1, title: "体重をはかる", body: [
    { t: "p", v: "体に水分がたまると、症状が出るより先に体重が増えます。体重は、心不全の状態を映すいちばんわかりやすい数字です。" },
    { t: "list", title: "はかり方", v: ["毎日同じ時間に。朝起きて排尿したあとがいちばん安定します", "できるだけ薄着で、いつもと同じような服装で", "体重計は平らな床に置く", "はかったら必ず記録する"] },
    { t: "warn", v: "3日で2kg増えていたら、早めに受診してください。むくみが出てきた、尿の量が減ったと感じたときも同じです。" },
  ] },
  { id: "t11", ch: 1, title: "血圧をはかる", body: [
    { t: "p", v: "家庭ではかる血圧は、診察室ではかる血圧よりも心臓や血管の状態をよく表します。起床後と就寝前の2回、椅子に座って1〜2分休んでからはかりましょう。" },
    { t: "kv", title: "高血圧とされる値", v: [["診察室の血圧", "140/90 mmHg 以上"], ["家庭の血圧", "135/85 mmHg 以上"]] },
    { t: "p", v: "診察室と家庭で差があるときは、家庭の血圧を優先して判断します。" },
    { t: "kv", title: "目指す値（2025年の改訂で年齢によらず同じになりました）", v: [["診察室ではかった血圧", "130/80 mmHg 未満"], ["家庭ではかった血圧", "125/75 mmHg 未満"]] },
    { t: "note", v: "体力の低下やふらつきがある方では、主治医の判断でゆるやかな目標にすることがあります。ご自身の目標を確認して「目標」の画面に入れておきましょう。" },
  ] },

  { id: "t12", ch: 2, title: "心不全の検査", body: [
    { t: "kv", v: [["胸部X線", "心臓の大きさ、肺に水がたまっていないか"], ["心電図", "不整脈の有無、心臓の負担"], ["血液検査（BNPなど）", "心臓にかかっている負担の程度"], ["心エコー", "心臓の動き、弁の働き、原因と重症度"]] },
    { t: "note", v: "BNPは個人差が大きい検査です。目標とする値は人によって違うので、自分の値を主治医に聞いておきましょう。" },
  ] },
  { id: "t13", ch: 2, title: "心不全の主な薬", body: [
    { t: "kv", title: "はたらきと注意する症状", v: [
      ["ACE阻害薬・ARB・ARNI", "心臓に負担をかけるホルモンを抑える／空咳、めまい、だるさ"],
      ["β遮断薬", "働きすぎの心臓を休ませる／脈が遅くなる、だるさ、めまい"],
      ["MRA（抗アルドステロン薬）", "余分な塩分と水分を出す／だるさ、脈がとぶ"],
      ["SGLT2阻害薬", "尿から糖と水分を出す／脱水、尿路感染"],
      ["利尿薬", "むくみと息切れを和らげる／脱水、電解質の異常"],
      ["抗凝固薬・抗血小板薬", "血のかたまりを防ぐ／あざ、出血が止まりにくい"],
    ] },
    { t: "warn", v: "血圧や脈が低めでも飲み続けることがあります。自己判断で減らしたりやめたりしないでください。ワルファリンを飲んでいる方は、納豆・青汁・クロレラを控えます。" },
  ] },
  { id: "t14", ch: 2, title: "薬以外の治療", body: [
    { t: "list", title: "血管の治療", v: ["カテーテルで狭い冠動脈を広げる（風船・ステント）", "バイパス手術"] },
    { t: "list", title: "不整脈の治療", v: ["ペースメーカ（脈が遅いとき）", "植込み型除細動器（命にかかわる不整脈の予防）", "心臓再同期療法（収縮のずれを整える）", "カテーテルアブレーション"] },
    { t: "list", title: "そのほか", v: ["弁膜症に対する手術やカテーテル治療", "睡眠時無呼吸に対する呼吸の治療（CPAP・ASV）", "補助人工心臓、心臓移植", "運動療法（心臓リハビリテーション）"] },
  ] },
  { id: "t15", ch: 2, title: "心臓リハビリテーション", body: [
    { t: "p", v: "適切な運動は心臓に悪い影響を与えません。むしろ心不全の再発と死亡を減らすことがわかっています。反対に動かないでいると足の力と体力が落ち、かえって心臓が悪くなりやすくなります。" },
    { t: "list", title: "有酸素運動", v: ["歩行、自転車こぎ、体操など", "会話ができる、軽く汗ばむ程度の強さで", "20〜60分を目安に。途中で休んでも大丈夫"] },
    { t: "list", title: "筋力トレーニング", v: ["ひざのばし、ふとももあげ、スクワットなど", "10〜15回を2〜3セット", "息を止めず、ゆっくり吐きながら行う"] },
    { t: "warn", v: "むくみや息切れが強い日、体調が悪い日は休みます。運動中に胸の痛みや圧迫感、動悸やめまい、強い息切れ、冷や汗が出たときは、すぐに中止して受診してください。" },
  ] },

  { id: "t16", ch: 3, title: "便秘に気をつける", body: [
    { t: "p", v: "排便でいきむと血圧が上がり、心臓の負担になります。便秘は心不全にとって小さな問題ではありません。" },
    { t: "list", v: ["野菜、海藻、発酵食品をとる", "無理のない範囲で体を動かす", "おなかを時計回りに「の」の字にさする", "下剤を使って快適な便通を保つのは良いこと"] },
    { t: "note", v: "下剤の量の調整で困ったときは、自己判断せず相談してください。" },
  ] },
  { id: "t17", ch: 3, title: "お風呂の入り方", body: [
    { t: "p", v: "急に体が冷えたり、脈が速くなったりすると心臓の負担になります。" },
    { t: "list", v: ["40〜41℃のぬるめのお湯にする", "湯船は10分以内", "肩まで浸からず、みぞおちの高さまで", "食後30分、排泄後5分、運動の直後は避ける", "脱衣所と浴室の温度差をなくす", "サウナは主治医に確認する"] },
  ] },
  { id: "t18", ch: 3, title: "口の中を清潔に保つ", body: [
    { t: "p", v: "歯周病の菌が血液に入り、心臓の弁に感染を起こしたり（感染性心内膜炎）、動脈硬化を進めたりすることがあります。とくに弁膜症のある方は口の清潔が大切です。" },
    { t: "list", v: ["歯ブラシはやわらかめ〜ふつう。毛先が広がったら交換", "歯と歯の間は歯間ブラシで", "入れ歯は磨いてから水に浸けて保管（入れ歯に歯磨き粉は使わない）", "歯科で定期的にみてもらう"] },
  ] },
  { id: "t19", ch: 3, title: "眠りを整える", body: [
    { t: "list", v: ["起きる時間を毎日そろえる", "朝食をとる", "昼寝は30分まで", "カフェイン・お酒・たばこは寝る3〜4時間前まで", "寝る前のテレビやスマホは控える", "眠くなってから布団に入る"] },
    { t: "p", v: "年齢とともに眠る時間は短くなります。日中につらくなければ、多少短くても問題ありません。" },
    { t: "warn", v: "夜中に息苦しくて目が覚める、横になると苦しくて起き上がってしまうときは、心不全が悪くなっているサインです。すぐに受診してください。大きないびきや日中の強い眠気があるときは、睡眠時無呼吸の可能性があるので相談を。" },
  ] },
  { id: "t20", ch: 3, title: "こころの調子も大事", body: [
    { t: "p", v: "心不全とこころの不調はお互いに影響しあいます。しんどさを我慢しても心臓にはよくありません。" },
    { t: "list", title: "気づくためのめやす", v: ["眠れない、食欲がない", "気分が沈む、何をしても楽しくない", "そわそわする、イライラする", "動悸や息苦しさが続く"] },
    { t: "list", title: "できること", v: ["誰かに話して気持ちを出す", "好きなことをする時間をつくる", "散歩や外の空気で気分を変える", "ゆっくりした呼吸を繰り返す"] },
    { t: "note", v: "つらい状態が続くときは、専門のスタッフに相談できます。外来で声をかけてください。" },
  ] },
  { id: "t21", ch: 3, title: "これからのことを話し合う", body: [
    { t: "p", v: "心不全は急に悪くなることがあり、いつ何が起こるかはわかりません。話せるうちに、どんな医療やケアを望むか、どこで過ごしたいか、何を大切にしているかを、家族や医療者と話しておくことをアドバンス・ケア・プランニングといいます。" },
    { t: "p", v: "考えを共有しておくと、判断が難しい場面でも、あなたの望みに沿った選択がしやすくなります。" },
    { t: "note", v: "一度決めたら変えられないものではありません。気持ちが変わったら、そのつど伝えてください。" },
  ] },
];

/* ---------- 4. コーデック（数字のみ・QR用） ---------- */
const APP_VERSION = "1.4.0";   // 画面に出す版
const APP_BUILD = 140;         // QRに埋める3桁の版（数字のみ）
const DATA_SCHEMA = 3;         // 端末に保存するデータの世代

const SEX_CODE = { female: 1, male: 2, na: 3 };
const SEX_TEXT = { 1: "女性", 2: "男性", 3: "回答なし" };
const APP = "9";          // 8=血圧ノート@しが、9=心不全手帳
const FMT = "7";               // 現行のQR形式
const LEARN_LEN = TOPICS.length;

// 過去の形式も読めるようにレイアウトを世代ごとに保持する。
//   build: 版番号の桁数 / tg: 目標値の桁数 / learn: 学習状況の桁数
const FMT_SPECS = {
  "1": { build: 0, tg: 14, learn: 0, plan: 0, med: 3, time: false },
  "2": { build: 0, tg: 14, learn: 21, plan: 0, med: 3, time: false },
  "3": { build: 0, tg: 18, learn: LEARN_LEN, plan: 0, med: 3, time: false },
  "4": { build: 3, tg: 18, learn: LEARN_LEN, plan: 0, med: 3, time: true },
  "5": { build: 3, tg: 18, learn: LEARN_LEN, plan: 4, med: 4, time: true },
  "6": { build: 3, tg: 18, demo: 4, learn: LEARN_LEN, plan: 4, med: 4, time: true },
  "7": { build: 3, tg: 18, aid: 10, demo: 4, learn: LEARN_LEN, plan: 4, med: 4, time: true },
};
const recLen = (sp) => 3 + 4 + 18 + 3 + sp.med + (sp.time ? 4 : 0);
const RECS_PER_CHUNK = 34;
const pad = (n, l) => String(Math.max(0, Math.round(Number(n) || 0))).padStart(l, "0").slice(-l);
// 記録した時刻（15分きざみ。00〜95、未記録は空）
const nowSlot = () => {
  const d = new Date();
  return String(Math.floor((d.getHours() * 60 + d.getMinutes()) / 15)).padStart(2, "0");
};
const slotText = (v) => {
  if (v == null || v === "" || v === "99") return "";
  const m = Number(v) * 15;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

const MED_SLOTS = [["mA", "朝"], ["mN", "昼"], ["mP", "夕"], ["mB", "寝る前"]];
const emptyPlan = () => ({ mA: true, mN: true, mP: true, mB: false });
const planList = (plan) => MED_SLOTS.filter(([k]) => (plan || emptyPlan())[k]);
const emptyRec = () => ({ w: "", amS: "", amD: "", amH: "", pmS: "", pmD: "", pmH: "", edema: 0, dysp: 0, palp: 0, mA: 0, mN: 0, mP: 0, mB: 0, amT: "", pmT: "" });
const hasData = (r) => !!(r && (r.w || r.amS || r.pmS || r.amH || r.pmH || r.edema || r.dysp || r.palp || r.mA || r.mN || r.mP || r.mB));

function encRecord(rec, offset) {
  return pad(offset, 3)
    + (rec.w ? pad(Number(rec.w) * 10, 4) : "0000")
    + pad(rec.amS, 3) + pad(rec.amD, 3) + pad(rec.amH, 3)
    + pad(rec.pmS, 3) + pad(rec.pmD, 3) + pad(rec.pmH, 3)
    + String(rec.edema || 0) + String(rec.dysp || 0) + String(rec.palp || 0)
    + MED_SLOTS.map(([k]) => String(rec[k] || 0)).join("")
    + (rec.amT ? pad(rec.amT, 2) : "99") + (rec.pmT ? pad(rec.pmT, 2) : "99");
}
function decRecord(s, sp) {
  const n = (a, b) => { const v = parseInt(s.slice(a, b), 10); return v === 0 ? "" : String(v); };
  const rec = {
    w: s.slice(3, 7) === "0000" ? "" : (parseInt(s.slice(3, 7), 10) / 10).toFixed(1),
    amS: n(7, 10), amD: n(10, 13), amH: n(13, 16),
    pmS: n(16, 19), pmD: n(19, 22), pmH: n(22, 25),
    edema: +s[25], dysp: +s[26], palp: +s[27],
    mA: 0, mN: 0, mP: 0, mB: 0, amT: "", pmT: "",
  };
  let o = 28;
  MED_SLOTS.slice(0, sp.med).forEach(([k], i) => { rec[k] = +s[o + i]; });
  o += sp.med;
  if (sp.time) {
    rec.amT = s.slice(o, o + 2) === "99" ? "" : s.slice(o, o + 2);
    rec.pmT = s.slice(o + 2, o + 4) === "99" ? "" : s.slice(o + 2, o + 4);
  }
  return { offset: parseInt(s.slice(0, 3), 10), rec };
}
const checksum = (s) => pad([...s].reduce((a, c) => a + +c, 0) % 97, 2);

function encodeChunks(records, targets, startDate, days, learned, medPlan, profile) {
  const entries = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const r = records[date];
    if (hasData(r)) entries.push(encRecord(r, i));
  }
  const groups = [];
  for (let i = 0; i < entries.length; i += RECS_PER_CHUNK) groups.push(entries.slice(i, i + RECS_PER_CHUNK));
  if (groups.length === 0) groups.push([]);
  const d = parseISO(startDate);
  const ymd = pad(d.getFullYear() % 100, 2) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2);
  const tg = (targets.weight ? pad(Number(targets.weight) * 10, 4) : "0000")
    + pad(targets.hr, 3) + pad(targets.sys, 3) + pad(targets.fluid, 4)
    + (targets.alertW ? pad(Number(targets.alertW) * 10, 4) : "0000");
  const lr = TOPICS.map((t) => ((learned || {})[t.id] ? "1" : "0")).join("");
  const mp = MED_SLOTS.map(([k]) => ((medPlan || emptyPlan())[k] ? "1" : "0")).join("");
  const pr = profile || emptyProfile();
  const ageV = ageFrom(pr.birth);
  const aid = pad(pr.id || "0", 10);
  const dm = (ageV == null ? "999" : pad(ageV, 3)) + String(SEX_CODE[pr.sex] || 0);
  return groups.map((g, i) => {
    const body = APP + FMT + pad(APP_BUILD, 3) + pad(i + 1, 2) + pad(groups.length, 2) + ymd + pad(days, 3) + tg + aid + dm + lr + mp + pad(g.length, 3) + g.join("");
    return body + checksum(body);
  });
}
function decodeChunk(code) {
  const s = (code || "").replace(/\D/g, "");
  if (s.length < 20) return { error: "コードが短すぎます" };
  const full = s.slice(0, -2), cs = s.slice(-2);
  if (checksum(full) !== cs) return { error: "チェックサムが合いません。読み直してください" };
  // 先頭がアプリ種別（8/9）なら取り除く。付いていない旧版もそのまま読める
  const hasApp = full[0] === "8" || full[0] === "9";
  if (hasApp && full[0] !== APP) return { error: "ちがう手帳のQRコードです" };
  const body = hasApp ? full.slice(1) : full;

  const spec = FMT_SPECS[body[0]];
  if (!spec) return { error: "対応していない形式です。医療者側のアプリを更新してください" };

  let o = 1;
  const build = spec.build ? parseInt(body.slice(o, o + spec.build), 10) : null;
  o += spec.build;
  const idx = +body.slice(o, o + 2); o += 2;
  const total = +body.slice(o, o + 2); o += 2;
  const yy = +body.slice(o, o + 2), mm = +body.slice(o + 2, o + 4), dd = +body.slice(o + 4, o + 6); o += 6;
  const startDate = `${2000 + yy}-${pad(mm, 2)}-${pad(dd, 2)}`;
  const days = +body.slice(o, o + 3); o += 3;

  const t = body.slice(o, o + spec.tg); o += spec.tg;
  const targets = {
    weight: t.slice(0, 4) === "0000" ? "" : (parseInt(t.slice(0, 4), 10) / 10).toFixed(1),
    hr: String(+t.slice(4, 7) || ""),
    sys: String(+t.slice(7, 10) || ""),
    fluid: String(+t.slice(10, 14) || ""),
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

  const learned = {};
  if (spec.learn) {
    const lr = body.slice(o, o + spec.learn); o += spec.learn;
    TOPICS.forEach((tp, i) => { if (lr[i] === "1") learned[tp.id] = true; });
  }

  let medPlan = { mA: true, mN: true, mP: true, mB: false };
  if (spec.plan) {
    const mp = body.slice(o, o + spec.plan); o += spec.plan;
    medPlan = {}; MED_SLOTS.forEach(([k], i) => { medPlan[k] = mp[i] === "1"; });
  }

  const RL = recLen(spec);
  const cnt = +body.slice(o, o + 3); o += 3;
  const rest = body.slice(o);
  if (rest.length !== cnt * RL) return { error: "レコード長が不正です" };
  const records = {};
  for (let i = 0; i < cnt; i++) {
    const { offset, rec } = decRecord(rest.slice(i * RL, (i + 1) * RL), spec);
    records[addDays(startDate, offset)] = rec;
  }
  return { idx, total, startDate, days, targets, records, learned, medPlan, demo, aid, fmt: body[0], build, hasLearn: !!spec.learn };
}

/* ---------- 5. 保存 ---------- */
const KEY = "hf-diary:v1";
const emptySecurity = () => ({ enabled: false, salt: "", hash: "", bio: false, credId: "" });

const emptyTargets = () => ({ weight: "", hr: "", sys: "", fluid: "", alertW: "" });

// 旧版で保存されたデータを、足りない項目を補って今の形にそろえる
function migrate(d) {
  const out = { schema: DATA_SCHEMA, records: {}, targets: emptyTargets(), visits: [], learned: {}, security: emptySecurity(), medPlan: emptyPlan(), exportPrefs: emptyExportPrefs(), profile: { ...emptyProfile(), id: newAnonId() } };
  if (!d || typeof d !== "object") return out;
  out.targets = { ...out.targets, ...(d.targets || {}) };
  if (!out.targets.alertW && out.targets.weight) out.targets.alertW = (Number(out.targets.weight) + 2).toFixed(1);
  out.visits = Array.isArray(d.visits) ? d.visits : [];
  out.learned = d.learned && typeof d.learned === "object" ? d.learned : {};
  out.security = { ...emptySecurity(), ...(d.security || {}) };
  out.medPlan = { ...emptyPlan(), ...(d.medPlan || {}) };
  out.exportPrefs = { ...emptyExportPrefs(), ...(d.exportPrefs || {}) };
  out.profile = { ...emptyProfile(), ...(d.profile || {}) };
  if (!out.profile.id) out.profile.id = newAnonId();
  const src = d.records && typeof d.records === "object" ? d.records : {};
  for (const k of Object.keys(src)) out.records[k] = { ...emptyRec(), ...src[k] };
  return out;
}
const mem = {};
const store = {
  async load() {
    try { const r = await window.storage.get(KEY); return migrate(r ? JSON.parse(r.value) : null); }
    catch { return migrate(mem[KEY] || null); }
  },
  async save(v0) {
    const v = { ...v0, schema: DATA_SCHEMA };
    mem[KEY] = v;
    try { await window.storage.set(KEY, JSON.stringify(v)); } catch { /* 端末内のみ */ }
  },
};

/* ---------- 6. UI部品 ---------- */
function Card({ title, sub, children, style }) {
  return (
    <section style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 3, padding: "16px 16px 18px", ...style }}>
      {title && (
        <header style={{ marginBottom: 14 }}>
          <h2 style={{
            fontSize: 16, fontWeight: 800, color: C.ink, letterSpacing: "0.06em", margin: 0,
            borderLeft: `4px solid ${C.evening}`, paddingLeft: 9, lineHeight: 1.4,
          }}>{title}</h2>
          {sub && <p style={{ fontSize: 12.5, color: C.inkSoft, margin: "5px 0 0 13px" }}>{sub}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

function Choice({ value, onChange, options, accent = C.ink }) {
  return (
    <div className="flex gap-2">
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button key={o.v} type="button" onClick={() => onChange(on ? 0 : o.v)}
            style={{
              flex: 1, padding: "12px 6px", borderRadius: 3, fontSize: 16, fontWeight: 700,
              border: `2px solid ${on ? (o.tone || accent) : C.line}`,
              background: on ? (o.tone || accent) : "#fff",
              color: on ? "#fff" : C.inkSoft, cursor: "pointer", transition: "all .12s",
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function NumInput({ value, onChange, placeholder, unit, width = 84, step = "1" }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <input type="number" inputMode="decimal" step={step} value={value}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width, padding: "10px 8px", fontSize: 20, fontWeight: 700, textAlign: "right",
          border: `1px solid ${C.line}`, borderRadius: 3, color: C.ink, background: "#fff", ...NUM,
        }} />
      {unit && <span style={{ fontSize: 12, color: C.inkSoft }}>{unit}</span>}
    </span>
  );
}

function Btn({ children, onClick, tone = C.ink, filled = true, small, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{
        padding: small ? "8px 14px" : "13px 20px", borderRadius: 3,
        fontSize: small ? 13 : 15, fontWeight: 700, cursor: disabled ? "default" : "pointer",
        border: `1.5px solid ${tone}`, background: filled ? tone : "#fff",
        color: filled ? "#fff" : tone, opacity: disabled ? 0.4 : 1,
      }}>
      {children}
    </button>
  );
}

/* ---------- 7. 患者：きょうの記録 ---------- */
const SYM_OPTS = [{ v: 1, label: "ない", tone: C.good }, { v: 2, label: "ある", tone: C.alert }];
const MED_OPTS = [{ v: 1, label: "飲めた", tone: C.good }, { v: 2, label: "飲み忘れた", tone: C.alert }];

function TodayView({ date, setDate, rec, update, targets, plan, profile }) {
  const set = (k) => (v) => {
    const next = { ...rec, [k]: v };
    const grp = k.startsWith("am") || k === "w" ? "amT" : k.startsWith("pm") ? "pmT" : null;
    if (grp && v !== "" && v !== 0 && !next[grp] && date === todayISO()) next[grp] = nowSlot();
    update(next);
  };
  const row = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
  const label = { fontSize: 14, fontWeight: 700, color: C.ink, width: 96, flexShrink: 0 };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Btn small filled={false} onClick={() => setDate(addDays(date, -1))}>前の日</Btn>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, ...NUM }}>{fmtMD(date)}</div>
              <div style={{ fontSize: 12, color: C.inkSoft }}>（{fmtWD(date)}）</div>
            </div>
            <Btn small filled={false} disabled={date >= todayISO()} onClick={() => setDate(addDays(date, 1))}>次の日</Btn>
          </div>
          <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)}
            style={{ padding: "8px 10px", border: `1px solid ${C.line}`, borderRadius: 3, color: C.ink, fontSize: 14 }} />
        </div>
      </Card>

      <Card title="体重" sub={targets.weight ? `目標 ${targets.weight} kg ／ 受診の目安 ${alertWeight(targets).toFixed(1)} kg 以上` : "起床後・排尿後にはかりましょう"}>
        <div style={row}>
          <NumInput value={rec.w} onChange={set("w")} placeholder="--" unit="kg" width={130} step="0.1" />
          {bmiOf(rec.w, profile && profile.height) != null && (
            <span style={{ fontSize: 14, fontWeight: 700, color: C.ink, ...NUM }}>
              BMI {bmiOf(rec.w, profile.height).toFixed(1)}
              <span style={{ fontSize: 12, fontWeight: 600, color: C.inkSoft, marginLeft: 6 }}>{bmiLabel(bmiOf(rec.w, profile.height))}</span>
            </span>
          )}
        </div>
        {!(profile && profile.height) && (
          <p style={{ fontSize: 12, color: C.inkSoft, marginTop: 8 }}>「設定」で身長を入れると、BMIも出ます。</p>
        )}
      </Card>

      <Card title="血圧・脈拍">
        <div className="flex flex-col gap-4">
          {[["朝", "am", C.morning, "起きて1時間以内", "薬を飲む前"], ["夕", "pm", C.evening, "寝る前", ""]].map(([jp, p, tone, hint1, hint2]) => (
            <div key={p} style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ width: 92, flexShrink: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: tone, lineHeight: 1.3 }}>{jp}</div>
                <div style={{ fontSize: 11, color: C.inkSoft, lineHeight: 1.55, marginTop: 2 }}>
                  {hint1}{hint2 && <><br />{hint2}</>}
                </div>
              </div>
              <div className="flex gap-4 flex-wrap" style={{ flex: 1, minWidth: 220 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, marginBottom: 5 }}>血圧</div>
                  <span className="inline-flex items-baseline gap-1">
                    <NumInput value={rec[p + "S"]} onChange={set(p + "S")} placeholder="上" />
                    <span style={{ color: C.inkSoft }}>/</span>
                    <NumInput value={rec[p + "D"]} onChange={set(p + "D")} placeholder="下" unit="mmHg" />
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, marginBottom: 5 }}>脈拍</div>
                  <NumInput value={rec[p + "H"]} onChange={set(p + "H")} placeholder="--" unit="回/分" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="からだの様子">
        <div className="flex flex-col gap-4">
          <div><div style={{ ...label, width: "auto", marginBottom: 6 }}>足のむくみ</div>
            <Choice value={rec.edema} onChange={set("edema")} options={SYM_OPTS} /></div>
          <div><div style={{ ...label, width: "auto", marginBottom: 6 }}>息ぐるしさ</div>
            <Choice value={rec.dysp} onChange={set("dysp")} options={SYM_OPTS} /></div>
          <div><div style={{ ...label, width: "auto", marginBottom: 6 }}>脈が急に速くなった・遅くなった</div>
            <Choice value={rec.palp} onChange={set("palp")} options={SYM_OPTS} /></div>
        </div>
      </Card>

      <Card title="お薬" sub={planList(plan).length ? "飲めたら「飲めた」を選びます" : "「設定」で飲む回数を選んでください"}>
        <div className="flex flex-col gap-4">
          {planList(plan).map(([k, jp]) => (
            <div key={k} className="flex items-center gap-3">
              <span style={{ ...label, width: 62, fontSize: 16 }}>{jp}</span>
              <div style={{ flex: 1 }}><Choice value={rec[k]} onChange={set(k)} options={MED_OPTS} /></div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const bmiOf = (w, height) => {
  const kg = Number(w), cm = Number(height);
  if (!kg || !cm) return null;
  const v = kg / ((cm / 100) ** 2);
  return v > 5 && v < 80 ? v : null;
};
const bmiLabel = (v) => (v == null ? "" : v < 18.5 ? "やせ" : v < 25 ? "ふつう" : v < 30 ? "肥満(1度)" : "肥満(2度以上)");

/* ---------- 8. 受診の目安 ---------- */
const alertWeight = (t) => (t && t.alertW ? Number(t.alertW) : t && t.weight ? Number(t.weight) + 2 : null);
function medVals(dates, records, plan) {
  const keys = planList(plan).map(([k]) => k);
  return dates.flatMap((d) => (records[d] ? keys.map((k) => records[d][k]) : [])).filter((v) => v > 0);
}
function checkSigns(records, targets, endDate, plan) {
  const signs = [];
  const dates = Object.keys(records).filter((d) => hasData(records[d]) && d <= endDate).sort();
  const last = dates[dates.length - 1];
  if (!last) return signs;
  const w = (d) => (records[d] && records[d].w ? Number(records[d].w) : null);
  const lastW = w(last);
  if (lastW != null) {
    for (const d of dates) {
      const gap = diffDays(d, last);
      if (gap > 0 && gap <= 3 && w(d) != null && lastW - w(d) >= 2)
        signs.push(`体重が${gap}日で${(lastW - w(d)).toFixed(1)}kg増えています`);
    }
    const aw = alertWeight(targets);
    if (aw != null && lastW >= aw)
      signs.push(`体重が受診の目安（${aw.toFixed(1)}kg）に達しています`);
  }
  const recent = dates.slice(-3);
  const cnt = (k) => recent.filter((d) => records[d][k] === 2).length;
  if (cnt("edema") >= 2) signs.push("足のむくみが続いています");
  if (cnt("dysp") >= 2) signs.push("息ぐるしさが続いています");
  if (cnt("palp") >= 1) signs.push("脈の乱れを感じた日があります");
  const missed = recent.filter((d) => planList(plan).some(([k]) => records[d][k] === 2)).length;
  if (missed >= 2) signs.push("お薬を飲めない日が続いています");
  return [...new Set(signs)];
}

function SignPanel({ signs }) {
  if (!signs.length) {
    return (
      <Card style={{ borderColor: C.good }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ width: 10, height: 10, borderRadius: 99, background: C.good }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: C.good }}>気になるサインは出ていません</span>
        </div>
      </Card>
    );
  }
  return (
    <Card style={{ borderColor: C.alert, background: C.alertBg }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.alert, marginBottom: 8 }}>気になるサインがあります</div>
      <ul style={{ margin: 0, paddingLeft: 18, color: C.ink, fontSize: 14, lineHeight: 1.9 }}>
        {signs.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
      <p style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 10, lineHeight: 1.7 }}>
        受診や連絡の目安として主治医に相談してください。指示がある場合はその指示が優先されます。
      </p>
    </Card>
  );
}

/* 週ごとの表の期間えらび：直近4週は週で、それ以前は月で */
function usePeriodOptions(records) {
  return useMemo(() => {
    const mon = startOfWeekMon(todayISO());
    const weeks = [0, 1, 2, 3].map((i) => addDays(mon, -7 * i));
    const cutoff = weeks[3];
    const seen = {};
    for (const d of Object.keys(records)) {
      if (d < cutoff && hasData(records[d])) seen[d.slice(0, 7)] = true;
    }
    const months = Object.keys(seen).sort().reverse();
    return { weeks, months };
  }, [records]);
}

function weeksOf(sel) {
  if (!sel) return [];
  if (sel.type === "week") return [Array.from({ length: 7 }, (_, i) => addDays(sel.key, i))];
  const [y, m] = sel.key.split("-").map(Number);
  const first = `${y}-${pad(m, 2)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${pad(m, 2)}-${pad(lastDay, 2)}`;
  const out = [];
  let cur = startOfWeekMon(first);
  while (cur <= last) { out.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i))); cur = addDays(cur, 7); }
  return out;
}

function PeriodTabs({ options, value, onChange }) {
  const tab = (on) => ({
    padding: "9px 12px", border: `1px solid ${on ? C.ink : C.line}`, cursor: "pointer",
    background: on ? C.ink : "#fff", color: on ? "#fff" : C.inkSoft,
    fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", borderRadius: 3, ...NUM,
  });
  const same = (a, b) => a && b && a.type === b.type && a.key === b.key;
  return (
    <div className="no-print" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        <span style={{
          fontSize: 11.5, fontWeight: 700, color: C.inkSoft, whiteSpace: "nowrap",
          borderLeft: `3px solid ${C.line}`, paddingLeft: 6,
        }}>週ごと</span>
        {options.weeks.map((w) => {
          const v = { type: "week", key: w };
          return (
            <button key={w} onClick={() => onChange(v)} style={tab(same(value, v))}>
              {fmtMD(w)} 〜 {fmtMD(addDays(w, 6))}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", marginTop: 8, paddingBottom: 4 }}>
        <span style={{
          fontSize: 11.5, fontWeight: 700, color: C.inkSoft, whiteSpace: "nowrap",
          borderLeft: `3px solid ${C.line}`, paddingLeft: 6,
        }}>月ごと</span>
        {options.months.length === 0
          ? <span style={{ fontSize: 12, color: C.inkSoft }}>4週間より前の記録がたまると、ここに月のタブが出ます</span>
          : options.months.map((m) => {
            const v = { type: "month", key: m };
            const [y, mm] = m.split("-");
            return (
              <button key={m} onClick={() => onChange(v)} style={tab(same(value, v))}>
                {Number(y) === new Date().getFullYear() ? `${Number(mm)}月` : `${y}年${Number(mm)}月`}
              </button>
            );
          })}
      </div>
    </div>
  );
}

function WeekTabs({ value, onChange, options }) {
  return (
    <div className="no-print" style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 3, overflow: "hidden", marginBottom: 14 }}>
      {options.map((w) => (
        <button key={w} onClick={() => onChange(w)}
          style={{
            flex: 1, padding: "10px 4px", border: "none", cursor: "pointer",
            borderLeft: w === options[0] ? "none" : `1px solid ${C.line}`,
            background: value === w ? C.ink : "#fff",
            color: value === w ? "#fff" : C.inkSoft,
            fontSize: 13.5, fontWeight: 700,
          }}>{w}週</button>
      ))}
    </div>
  );
}

/* ---------- 9. 手帳グリッド（週表示） ---------- */
const symText = (v) => (v === 1 ? "ない" : v === 2 ? "ある" : "");
const symColor = (v) => (v === 2 ? C.alert : v === 1 ? C.inkSoft : C.line);

function WeekGrid({ dates, records, plan }) {
  const th = { border: `1px solid ${C.line}`, padding: "6px 4px", fontSize: 11.5, fontWeight: 700, color: C.ink, background: C.tint, whiteSpace: "nowrap" };
  const td = { border: `1px solid ${C.line}`, padding: "6px 3px", fontSize: 12.5, textAlign: "center", color: C.ink, ...NUM };
  const avgTd = { ...td, background: C.tint, fontWeight: 800, borderLeft: `2px solid ${C.inkSoft}` };
  const avgTh = { ...th, background: C.tintDeep, borderLeft: `2px solid ${C.inkSoft}`, color: C.good };

  const bp = (r, p) => (r && r[p + "S"] ? `${r[p + "S"]}/${r[p + "D"] || "-"}` : "");
  const vals = (key) => dates
    .map((d) => (records[d] && records[d][key] ? Number(records[d][key]) : null))
    .filter((v) => v != null && !isNaN(v));
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const avgBP = (p) => {
    const sy = mean(vals(p + "S")), di = mean(vals(p + "D"));
    return sy == null ? "" : `${Math.round(sy)}/${di == null ? "-" : Math.round(di)}`;
  };
  const avgNum = (key, dp) => { const m = mean(vals(key)); return m == null ? "" : m.toFixed(dp); };
  const symCount = (k) => {
    const n = dates.filter((d) => records[d] && records[d][k] === 2).length;
    return n ? `${n}日` : "0日";
  };
  const medRate = () => {
    const all = medVals(dates, records, plan);
    if (!all.length) return "";
    return `${Math.round((all.filter((v) => v === 1).length / all.length) * 100)}%`;
  };

  const rows = [
    ["血圧 朝", (r) => bp(r, "am"), C.morning, avgBP("am")],
    ["血圧 夕", (r) => bp(r, "pm"), C.evening, avgBP("pm")],
    ["脈拍 朝", (r) => (r && r.amH) || "", C.morning, avgNum("amH", 0)],
    ["脈拍 夕", (r) => (r && r.pmH) || "", C.evening, avgNum("pmH", 0)],
    ["体重 (kg)", (r) => (r && r.w) || "", C.ink, avgNum("w", 1)],
  ];

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 580 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left", minWidth: 92 }}>日付</th>
            {dates.map((d) => (
              <th key={d} style={th}>{fmtMD(d)}<br /><span style={{ fontWeight: 400, color: C.inkSoft }}>({fmtWD(d)})</span></th>
            ))}
            <th style={{ ...avgTh, minWidth: 62 }}>週平均</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, get, tone, av]) => (
            <tr key={name}>
              <th style={{ ...th, textAlign: "left", color: tone }}>{name}</th>
              {dates.map((d) => <td key={d} style={td}>{get(records[d]) || <span style={{ color: C.line }}>—</span>}</td>)}
              <td style={avgTd}>{av || <span style={{ color: C.line }}>—</span>}</td>
            </tr>
          ))}
          {[["足のむくみ", "edema"], ["息ぐるしさ", "dysp"], ["脈の乱れ", "palp"]].map(([name, k]) => (
            <tr key={k}>
              <th style={{ ...th, textAlign: "left" }}>{name}</th>
              {dates.map((d) => {
                const v = records[d] ? records[d][k] : 0;
                return <td key={d} style={{ ...td, color: symColor(v), fontWeight: v === 2 ? 800 : 400 }}>{symText(v) || "—"}</td>;
              })}
              <td style={{ ...avgTd, color: symCount(k) === "0日" ? C.inkSoft : C.alert }}>{symCount(k)}</td>
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
            <td style={avgTd}>{medRate() || <span style={{ color: C.line }}>—</span>}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


/* ---------- サマリー（きろく内・押すと開く） ---------- */
function SummaryCard({ dates, records, targets, plan, profile }) {
  const [open, setOpen] = useState(false);
  const s = summarize(dates, records, plan);
  const aw = alertWeight(targets);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="no-print"
        style={{
          width: "100%", textAlign: "left", padding: "11px 12px", cursor: "pointer",
          background: C.tint, border: `1px solid ${C.line}`, borderRadius: 3,
          fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 14,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        }}>
        サマリーを表示する
        <span style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft }}>▼</span>
      </button>
    );
  }

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 3, padding: "12px 12px 14px", marginBottom: 16, background: C.tint }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 3 }}>サマリー</div>
      <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 10, ...NUM }}>
        {dates[0]} 〜 {dates[dates.length - 1]}（{dates.length}日間・記録 {s.recorded}日）
      </div>
      <div className="flex flex-wrap gap-2">
        <Stat label="体重 平均" value={s.wAvg ? s.wAvg.toFixed(1) : null} unit="kg" />
        <Stat label="BMI（平均体重）" value={bmiOf(s.wAvg, profile && profile.height) != null ? bmiOf(s.wAvg, profile.height).toFixed(1) : null}
          unit={bmiLabel(bmiOf(s.wAvg, profile && profile.height))} />
        <Stat label="体重 最小〜最大" value={s.wMin != null ? `${s.wMin.toFixed(1)}–${s.wMax.toFixed(1)}` : null} unit="kg" />
        <Stat label="3日以内 最大増加" value={s.maxGain ? s.maxGain.toFixed(1) : "0.0"} unit="kg" tone={s.maxGain >= 2 ? C.alert : C.ink} />
        <Stat label="朝収縮期 平均" value={s.sysAvg ? Math.round(s.sysAvg) : null} unit="mmHg" />
        <Stat label="服薬 達成" value={s.adherence != null ? Math.round(s.adherence) : null} unit="%" tone={s.adherence != null && s.adherence < 80 ? C.alert : C.good} />
        <Stat label="むくみ" value={s.edemaDays} unit="日" tone={s.edemaDays ? C.alert : C.ink} />
        <Stat label="息切れ" value={s.dyspDays} unit="日" tone={s.dyspDays ? C.alert : C.ink} />
        <Stat label="脈の乱れ" value={s.palpDays} unit="日" tone={s.palpDays ? C.alert : C.ink} />
      </div>
      {(targets.weight || targets.sys) && (
        <p style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 12, ...NUM }}>
          目標：体重 {targets.weight || "—"} kg（受診の目安 {aw != null ? aw.toFixed(1) : "—"} kg以上）／血圧 {targets.sys || "—"} mmHg以下
        </p>
      )}
      <div className="no-print" style={{ marginTop: 12 }}>
        <Btn small filled={false} onClick={() => setOpen(false)}>閉じる</Btn>
      </div>
    </div>
  );
}

/* ---------- その他（記録した時刻） ---------- */
function TimeCard({ weeksList, records, plan }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("time");
  const all = weeksList.flat();
  const nums = (k) => all.map((d) => records[d] && records[d][k]).filter((v) => v).map(Number);
  const stat = (k) => {
    const a = nums(k);
    if (!a.length) return null;
    const avg = a.reduce((x, y) => x + y, 0) / a.length;
    return { avg: slotText(Math.round(avg)), min: slotText(Math.min(...a)), max: slotText(Math.max(...a)), n: a.length };
  };
  const am = stat("amT"), pm = stat("pmT");
  const th = { border: `1px solid ${C.line}`, padding: "5px 4px", fontSize: 11, fontWeight: 700, color: C.ink, background: C.tint, whiteSpace: "nowrap" };
  const td = { border: `1px solid ${C.line}`, padding: "5px 3px", fontSize: 11.5, textAlign: "center", color: C.ink, ...NUM };

  const Box = ({ label, v, color }) => (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 3, padding: "10px 12px", minWidth: 132 }}>
      <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, ...NUM }}>{v ? v.avg : "—"}</div>
      {v && <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 2, ...NUM }}>{v.min} 〜 {v.max}（{v.n}回）</div>}
    </div>
  );

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="no-print"
        style={{
          width: "100%", textAlign: "left", padding: "14px 16px", cursor: "pointer",
          background: C.card, border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.inkSoft}`,
          borderRadius: 3, fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: "0.06em",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        }}>
        その他
        <span style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft }}>はかった時刻・服薬状況 ▼</span>
      </button>
    );
  }

  const seg = (k, l) => (
    <button key={k} onClick={() => setView(k)}
      style={{
        flex: 1, padding: "10px 4px", border: "none", cursor: "pointer",
        borderLeft: k === "time" ? "none" : `1px solid ${C.line}`,
        background: view === k ? C.ink : "#fff", color: view === k ? "#fff" : C.inkSoft,
        fontSize: 13.5, fontWeight: 700,
      }}>{l}</button>
  );

  return (
    <Card title="その他">
      <div className="no-print" style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 3, overflow: "hidden", marginBottom: 16 }}>
        {seg("time", "はかった時刻")}
        {seg("med", "服薬状況")}
      </div>

      {view === "time" && (
      <>
      <div className="flex flex-wrap gap-2" style={{ marginBottom: 16 }}>
        <Box label="朝 いつもの時刻" v={am} color={C.morning} />
        <Box label="夕 いつもの時刻" v={pm} color={C.evening} />
      </div>

      <div className="flex flex-col gap-4">
        {weeksList.map((w, i) => (
          <div key={i}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, marginBottom: 4, ...NUM }}>
              {fmtMD(w[0])} 〜 {fmtMD(w[6])}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 420 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "left", minWidth: 44 }}></th>
                    {w.map((d) => <th key={d} style={th}>{fmtMD(d)}<br /><span style={{ fontWeight: 400, color: C.inkSoft }}>({fmtWD(d)})</span></th>)}
                  </tr>
                </thead>
                <tbody>
                  {[["朝", "amT", C.morning], ["夕", "pmT", C.evening]].map(([jp, k, color]) => (
                    <tr key={k}>
                      <th style={{ ...th, textAlign: "left", color }}>{jp}</th>
                      {w.map((d) => {
                        const v = records[d] && records[d][k] ? slotText(records[d][k]) : "";
                        return <td key={d} style={{ ...td, color: v ? color : C.line, fontWeight: v ? 700 : 400 }}>{v || "—"}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 14 }}>
        その日のうちに入力したときだけ時刻が残ります。あとからまとめて入力した日は空欄になります。
      </p>
      </>
      )}

      {view === "med" && (
      <>
        {planList(plan).length === 0
          ? <p style={{ fontSize: 13.5, color: C.inkSoft }}>「設定」でお薬を飲む回数を選ぶと、ここに記録が出ます。</p>
          : <>
            {(() => {
              const rate = (keys) => {
                const vals = all.flatMap((d) => (records[d] ? keys.map((k) => records[d][k]) : [])).filter((v) => v > 0);
                return vals.length ? Math.round((vals.filter((v) => v === 1).length / vals.length) * 100) : null;
              };
              const box = (l, v, tone) => (
                <div key={l} style={{ border: `1px solid ${C.line}`, borderRadius: 3, padding: "10px 12px", minWidth: 100 }}>
                  <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 2 }}>{l}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: tone, ...NUM }}>
                    {v == null ? "—" : v}<span style={{ fontSize: 11, fontWeight: 600, marginLeft: 3, color: C.inkSoft }}>%</span>
                  </div>
                </div>
              );
              const total = rate(planList(plan).map(([k]) => k));
              return (
                <div className="flex flex-wrap gap-2" style={{ marginBottom: 14 }}>
                  {box("ぜんぶ", total, total != null && total < 80 ? C.alert : C.good)}
                  {planList(plan).length > 1 && planList(plan).map(([k, jp]) => {
                    const r = rate([k]);
                    return box(jp, r, r != null && r < 80 ? C.alert : C.ink);
                  })}
                </div>
              );
            })()}

            <div className="flex flex-col gap-4">
              {weeksList.map((w, i) => (
                <div key={`m${i}`}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, marginBottom: 4, ...NUM }}>
                    {fmtMD(w[0])} 〜 {fmtMD(w[6])}
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 420 }}>
                      <thead>
                        <tr>
                          <th style={{ ...th, textAlign: "left", minWidth: 56 }}></th>
                          {w.map((d) => <th key={d} style={th}>{fmtMD(d)}<br /><span style={{ fontWeight: 400, color: C.inkSoft }}>({fmtWD(d)})</span></th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {planList(plan).map(([k, jp]) => (
                          <tr key={k}>
                            <th style={{ ...th, textAlign: "left" }}>{jp}</th>
                            {w.map((d) => {
                              const v = records[d] ? records[d][k] : 0;
                              return (
                                <td key={d} style={{ ...td, fontSize: 15, fontWeight: 800, color: v === 2 ? C.alert : v === 1 ? C.good : C.line }}>
                                  {v === 1 ? "✓" : v === 2 ? "×" : "—"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 12 }}>
              ✓ は飲めた、× は飲めなかった、— は記録のない回です。
            </p>
          </>}
      </>
      )}

      <div className="no-print" style={{ marginTop: 12 }}>
        <Btn small filled={false} onClick={() => setOpen(false)}>閉じる</Btn>
      </div>
    </Card>
  );
}

/* ---------- 10. グラフ ---------- */
// 朝は●、夕は■。形と色の両方で見分けられるようにする
const dotCircle = (color) => (p) =>
  p.cx == null || p.cy == null ? null
    : <circle key={`c${p.index}`} cx={p.cx} cy={p.cy} r={3.2} fill={color} stroke="#fff" strokeWidth={1.8} />;

function Charts({ dates, records, targets }) {
  const data = dates.map((d) => {
    const r = records[d] || {};
    return {
      d: fmtMD(d),
      体重: r.w ? Number(r.w) : null,
      朝上: r.amS ? Number(r.amS) : null, 朝下: r.amD ? Number(r.amD) : null,
      夕上: r.pmS ? Number(r.pmS) : null, 夕下: r.pmD ? Number(r.pmD) : null,
      朝脈: r.amH ? Number(r.amH) : null, 夕脈: r.pmH ? Number(r.pmH) : null,
    };
  });
  const tw = targets.weight ? Number(targets.weight) : null;
  const taw = alertWeight(targets);
  const tsys = targets.sys ? Number(targets.sys) : null;
  const axis = { stroke: C.inkSoft, fontSize: 11 };
  const dash = "6 4";
  const domainFor = (keys, extras, minPad) => {
    const vals = [];
    for (const k of keys) for (const row of data) if (row[k] != null) vals.push(row[k]);
    for (const e of extras) if (e != null) vals.push(e);
    if (!vals.length) return ["auto", "auto"];
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max(minPad, (hi - lo) * 0.15);
    return [Math.floor((lo - pad) * 10) / 10, Math.ceil((hi + pad) * 10) / 10];
  };
  const wDomain = domainFor(["体重"], [tw, taw], 0.6);
  const mark = (value, color) => ({ value, fontSize: 10.5, fontWeight: 700, fill: color, position: "right", offset: 5 });
  const head = (t) => (
    <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 6, borderLeft: `4px solid ${C.evening}`, paddingLeft: 8 }}>{t}</div>
  );

  // 朝と夕で別のグラフ。縦軸の範囲はそろえて見比べられるようにする
  const bpDomain = domainFor(["朝上", "朝下", "夕上", "夕下"], [tsys, null], 8);
  // 上は青、下はオレンジ。朝は●、夕は■で形が変わる
  const SYS_COLOR = C.evening;
  const DIA_COLOR = C.morning;
  const Half = ({ title, sKey, dKey }) => (
    <div>
      {head(title)}
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 56, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={C.line} strokeDasharray="2 4" />
            <XAxis dataKey="d" tick={axis} interval="preserveStartEnd" />
            <YAxis domain={bpDomain} tick={axis} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 3, borderColor: C.line }} />
            <Legend align="center" verticalAlign="bottom" iconType="plainline" iconSize={18}
              wrapperStyle={{ fontSize: 12, paddingTop: 2, width: "100%", left: 0, textAlign: "center" }} />
            {tsys != null && (
              <ReferenceLine y={tsys} stroke={C.good} strokeDasharray="6 4" strokeWidth={1.8}
                label={mark(`目標 ${tsys}`, C.good)} />
            )}
            <Line name="上" dataKey={sKey} stroke={SYS_COLOR} strokeWidth={2.4}
              dot={dotCircle(SYS_COLOR)} activeDot={{ r: 5 }} connectNulls={false} />
            <Line name="下" dataKey={dKey} stroke={DIA_COLOR} strokeWidth={2.4}
              dot={dotCircle(DIA_COLOR)} activeDot={{ r: 5 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const Pair = ({ title, amKey, pmKey, target, height = 185, minPad = 8 }) => (
    <div>
      {head(title)}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 56, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={C.line} strokeDasharray="2 4" />
            <XAxis dataKey="d" tick={axis} interval="preserveStartEnd" />
            <YAxis domain={domainFor([amKey, pmKey], [target], minPad)} tick={axis} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 3, borderColor: C.line }} />
            <Legend align="center" verticalAlign="bottom" iconType="plainline" iconSize={18}
              wrapperStyle={{ fontSize: 12, paddingTop: 2, width: "100%", left: 0, textAlign: "center" }} />
            {target != null && (
              <ReferenceLine y={target} stroke={C.good} strokeDasharray={dash} strokeWidth={1.8}
                label={mark(`目標 ${target}`, C.good)} />
            )}
            <Line name="朝" dataKey={amKey} stroke={C.morning} strokeWidth={2.2}
              dot={dotCircle(C.morning)} activeDot={{ r: 5 }} connectNulls={false} />
            <Line name="夕" dataKey={pmKey} stroke={C.evening} strokeWidth={2.2}
              dot={dotCircle(C.evening)} activeDot={{ r: 5 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        {head("体重 (kg)")}
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 56, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={C.line} strokeDasharray="2 4" />
              <XAxis dataKey="d" tick={axis} interval="preserveStartEnd" />
              <YAxis domain={wDomain} tick={axis} allowDecimals />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 3, borderColor: C.line }} />
              {taw != null && <ReferenceArea y1={taw} y2={wDomain[1]} fill={C.alert} fillOpacity={0.07} />}
              {taw != null && (
                <ReferenceLine y={taw} stroke={C.alert} strokeDasharray={dash} strokeWidth={1.6}
                  label={mark(`目安 ${taw.toFixed(1)}`, C.alert)} />
              )}
              {tw != null && (
                <ReferenceLine y={tw} stroke={C.good} strokeDasharray={dash} strokeWidth={1.8}
                  label={mark(`目標 ${tw.toFixed(1)}`, C.good)} />
              )}
              <Line name="体重" dataKey="体重" stroke={C.ink} strokeWidth={2.4}
                dot={dotCircle(C.ink)} activeDot={{ r: 5 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {tw == null && (
          <p style={{ fontSize: 12, color: C.inkSoft, marginTop: 4 }}>
            「目標」で目標体重を入れると、点線で目標と受診の目安が出ます。
          </p>
        )}
      </div>

      <Half title="朝の血圧（上と下）" sKey="朝上" dKey="朝下" />
      <Half title="夕の血圧（上と下）" sKey="夕上" dKey="夕下" />
      <Pair title="脈拍" amKey="朝脈" pmKey="夕脈" target={null} height={165} minPad={6} />
    </div>
  );
}

/* ---------- CSV書き出し ---------- */
const CSV_HEAD = ["日付","曜日","体重(kg)","朝収縮期","朝拡張期","朝脈拍","朝記録時刻","夕収縮期","夕拡張期","夕脈拍","夕記録時刻","足のむくみ","息ぐるしさ","脈の乱れ",...MED_SLOTS.map(([, jp]) => `服薬${jp}`)];
const symCsv = (v) => (v === 1 ? "ない" : v === 2 ? "ある" : "");
const medCsv = (v) => (v === 1 ? "飲めた" : v === 2 ? "飲み忘れた" : "");

function buildCSV(dates, records) {
  const lines = [CSV_HEAD.join(",")];
  for (const d of dates) {
    const r = records[d] || {};
    lines.push([
      d, fmtWD(d), r.w || "", r.amS || "", r.amD || "", r.amH || "", slotText(r.amT),
      r.pmS || "", r.pmD || "", r.pmH || "", slotText(r.pmT),
      symCsv(r.edema), symCsv(r.dysp), symCsv(r.palp),
      ...MED_SLOTS.map(([k]) => medCsv(r[k])),
    ].join(","));
  }
  return lines.join("\r\n");
}

function buildLearnCSV(learned) {
  const lines = ["章,項目,状況"];
  for (const t of TOPICS) lines.push([`第${t.ch + 1}章 ${CHAPTERS[t.ch]}`, t.title, learned[t.id] ? "済" : "未"].join(","));
  return lines.join("\r\n");
}

function downloadCSV(filename, text) {
  try {
    const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    return true;
  } catch { return false; }
}

/* ---------- 11. 集計 ---------- */
function summarize(dates, records, plan) {
  const rs = dates.map((d) => records[d]).filter(hasData);
  const ws = rs.map((r) => Number(r.w)).filter((n) => !isNaN(n) && n > 0);
  const sys = rs.map((r) => Number(r.amS)).filter((n) => !isNaN(n) && n > 0);
  const med = medVals(dates, records, plan);
  const taken = med.filter((v) => v === 1).length;
  let maxGain = 0;
  const wd = dates.filter((d) => records[d] && records[d].w);
  for (let i = 0; i < wd.length; i++) for (let j = i + 1; j < wd.length; j++) {
    if (diffDays(wd[i], wd[j]) > 3) break;
    maxGain = Math.max(maxGain, Number(records[wd[j]].w) - Number(records[wd[i]].w));
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    recorded: rs.length, total: dates.length,
    wMin: ws.length ? Math.min(...ws) : null, wMax: ws.length ? Math.max(...ws) : null,
    wAvg: avg(ws), maxGain,
    sysAvg: avg(sys),
    adherence: med.length ? (taken / med.length) * 100 : null,
    edemaDays: rs.filter((r) => r.edema === 2).length,
    dyspDays: rs.filter((r) => r.dysp === 2).length,
    palpDays: rs.filter((r) => r.palp === 2).length,
  };
}

function Stat({ label, value, unit, tone = C.ink }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 3, padding: "10px 12px", minWidth: 108 }}>
      <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: tone, ...NUM }}>
        {value == null ? "—" : value}<span style={{ fontSize: 11, fontWeight: 600, marginLeft: 2, color: C.inkSoft }}>{unit}</span>
      </div>
    </div>
  );
}

/* ---------- ふりかえりのことば ---------- */
function feedback(dates, records, targets, plan) {
  const s = summarize(dates, records, plan);
  if (!s.recorded) return null;
  const aw = alertWeight(targets);
  const tw = targets.weight ? Number(targets.weight) : null;
  const rate = dates.length ? Math.round((s.recorded / dates.length) * 100) : 0;

  const okWeight = aw == null || s.wMax == null || s.wMax < aw;
  const okGain = s.maxGain < 2;
  const okAdh = s.adherence == null || s.adherence >= 90;
  const okSym = s.edemaDays === 0 && s.dyspDays === 0;

  const lines = [];
  let tone = "good";

  if (tw != null && s.wAvg != null) {
    if (okWeight && okGain) {
      lines.push(`この期間の体重は平均 ${s.wAvg.toFixed(1)} kg。受診の目安の ${aw != null ? aw.toFixed(1) : "—"} kg を超えずに保てています。`);
    } else {
      tone = "warn";
      if (!okWeight) lines.push(`体重が受診の目安の ${aw.toFixed(1)} kg に届いた日がありました。`);
      if (!okGain) lines.push(`3日で ${s.maxGain.toFixed(1)} kg 増えた時期がありました。水分がたまっているサインかもしれません。`);
    }
  }

  if (s.adherence != null) {
    if (okAdh) lines.push(`お薬は ${Math.round(s.adherence)}% 飲めています。続けられているのがいちばんの治療です。`);
    else { tone = "warn"; lines.push(`お薬を飲めた割合は ${Math.round(s.adherence)}% でした。飲みにくい時間帯があれば教えてください。`); }
  }

  if (!okSym) {
    tone = "warn";
    const parts = [];
    if (s.edemaDays) parts.push(`むくみ ${s.edemaDays}日`);
    if (s.dyspDays) parts.push(`息ぐるしさ ${s.dyspDays}日`);
    lines.push(`${parts.join("・")}ありました。次の受診で必ず伝えてください。`);
  } else if (tone === "good") {
    lines.push("むくみや息ぐるしさのない日が続いています。");
  }

  if (rate >= 80) lines.push(`${dates.length}日のうち${s.recorded}日記録できています。`);
  else if (rate < 50) lines.push(`記録できたのは${dates.length}日のうち${s.recorded}日でした。まずは体重だけでも続けてみましょう。`);

  return lines.length ? { tone, lines } : null;
}

function FeedbackCard({ dates, records, targets, plan }) {
  const fb = feedback(dates, records, targets, plan);
  if (!fb) return null;
  const good = fb.tone === "good";
  const color = good ? C.good : C.morning;
  return (
    <Card style={{ borderColor: color, borderLeft: `5px solid ${color}` }}>
      <div style={{ fontSize: 15.5, fontWeight: 800, color, marginBottom: 8 }}>
        {good ? "よくできています" : "気をつけたいところ"}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.95, color: C.ink }}>
        {fb.lines.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
      {!good && (
        <p style={{ fontSize: 12, color: C.inkSoft, marginTop: 10, lineHeight: 1.7 }}>
          うまくいかない時期は誰にでもあります。ご自身を責めず、この記録を持って相談してください。
        </p>
      )}
    </Card>
  );
}

/* ---------- 12. 患者：受診・QR出力 ---------- */
const RANGES = [
  { k: "prev", label: "前回受診日から" },
  { k: "2w", label: "前2週間" },
  { k: "1m", label: "前1ヶ月" },
  { k: "2m", label: "前2ヶ月" },
  { k: "3m", label: "前3ヶ月" },
];
const WHEEL_H = 54;

/* スクロールで選ぶ期間ピッカー */
function RangeWheel({ options, value, onChange, disabled }) {
  const ref = useRef(null);
  const idx = Math.max(0, options.findIndex((o) => o.k === value));

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = idx * WHEEL_H;
    // 初回のみ位置合わせ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settle = () => {
    if (!ref.current || disabled) return;
    const i = Math.min(options.length - 1, Math.max(0, Math.round(ref.current.scrollTop / WHEEL_H)));
    if (options[i].k !== value) onChange(options[i].k);
  };
  const jump = (i) => {
    if (disabled) return;
    onChange(options[i].k);
    if (ref.current) ref.current.scrollTo({ top: i * WHEEL_H, behavior: "smooth" });
  };

  return (
    <div style={{ position: "relative", height: WHEEL_H * 3, opacity: disabled ? 0.35 : 1 }}>
      <div style={{
        position: "absolute", top: WHEEL_H, left: 0, right: 0, height: WHEEL_H,
        border: `2px solid ${C.evening}`, borderRadius: 3, background: C.tint, pointerEvents: "none",
      }} />
      <div ref={ref} className="wheel" onScroll={settle}
        style={{
          height: WHEEL_H * 3, overflowY: disabled ? "hidden" : "auto",
          scrollSnapType: "y mandatory", position: "relative", WebkitOverflowScrolling: "touch",
        }}>
        <div style={{ height: WHEEL_H }} />
        {options.map((o, i) => {
          const on = o.k === value;
          return (
            <div key={o.k} onClick={() => jump(i)}
              style={{
                height: WHEEL_H, display: "flex", alignItems: "center", justifyContent: "center",
                scrollSnapAlign: "center", cursor: disabled ? "default" : "pointer",
                fontSize: on ? 18 : 16, fontWeight: on ? 800 : 600,
                color: on ? C.ink : C.inkSoft, opacity: on ? 1 : 0.5, transition: "all .15s",
              }}>{o.label}</div>
          );
        })}
        <div style={{ height: WHEEL_H }} />
      </div>
    </div>
  );
}

function VisitView({ visits, setVisits, records, targets, learned, plan, profile }) {
  const [newVisit, setNewVisit] = useState(todayISO());
  const [range, setRange] = useState("prev");
  const [custom, setCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(addDays(todayISO(), -30));
  const [customTo, setCustomTo] = useState(todayISO());
  const [showCode, setShowCode] = useState(false);

  const sorted = [...visits].sort();
  const visitDate = sorted.length ? sorted[sorted.length - 1] : todayISO();
  const prevVisit = sorted.length > 1 ? sorted[sorted.length - 2] : null;

  const { from, to } = useMemo(() => {
    if (custom) return { from: customFrom, to: customTo };
    if (range === "prev") return { from: prevVisit ? addDays(prevVisit, 1) : addDays(visitDate, -30), to: visitDate };
    const m = { "2w": 14, "1m": 30, "2m": 61, "3m": 91 }[range];
    return { from: addDays(visitDate, -m + 1), to: visitDate };
  }, [range, custom, customFrom, customTo, visitDate, prevVisit]);

  const days = Math.max(1, diffDays(from, to) + 1);
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const codes = useMemo(() => encodeChunks(records, targets, from, days, learned, plan, profile), [records, targets, from, days, learned, plan, profile]);
  const recorded = dates.filter((d) => hasData(records[d])).length;

  return (
    <div className="flex flex-col gap-4">
      <Card title="受診日" sub="受診日を登録しておくと、そこから遡って書き出せます">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <input type="date" value={newVisit} onChange={(e) => setNewVisit(e.target.value)}
            style={{ padding: "9px 10px", border: `1px solid ${C.line}`, borderRadius: 3, fontSize: 14, color: C.ink }} />
          <Btn small onClick={() => newVisit && setVisits([...new Set([...visits, newVisit])])}>受診日を追加</Btn>
        </div>
        {sorted.length === 0
          ? <p style={{ fontSize: 13, color: C.inkSoft }}>まだ登録がありません。次回の予約日を入れておくと当日そのまま使えます。</p>
          : <div className="flex flex-wrap gap-2">
            {sorted.slice().reverse().map((v) => (
              <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${C.line}`, borderRadius: 3, padding: "6px 8px 6px 12px", fontSize: 13, color: C.ink, ...NUM }}>
                {v}
                <button onClick={() => setVisits(visits.filter((x) => x !== v))}
                  style={{ border: "none", background: "none", color: C.inkSoft, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>}
      </Card>

      <Card title="書き出す期間" sub="上下にスクロールして選びます">
        <RangeWheel options={RANGES} value={range} onChange={setRange} disabled={custom} />

        {!custom && range === "prev" && !prevVisit && (
          <p style={{ fontSize: 12.5, color: C.morning, fontWeight: 700, marginTop: 8 }}>
            前回の受診日がまだ登録されていないので、30日前からにしています。
          </p>
        )}

        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 14, paddingTop: 14 }}>
          <Btn small filled={custom} tone={custom ? C.evening : C.inkSoft}
            onClick={() => setCustom(!custom)}>
            {custom ? "スクロールで選ぶ" : "期間を指定する"}
          </Btn>
          {custom && (
            <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 12 }}>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                style={{ padding: "9px 10px", border: `1px solid ${C.line}`, borderRadius: 3, fontSize: 14, color: C.ink }} />
              <span style={{ color: C.inkSoft }}>〜</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                style={{ padding: "9px 10px", border: `1px solid ${C.line}`, borderRadius: 3, fontSize: 14, color: C.ink }} />
            </div>
          )}
        </div>

        <div style={{ fontSize: 13.5, color: C.ink, marginTop: 14, ...NUM }}>
          {from} 〜 {to}（{days}日間・記録 {recorded}日 / 未記録 {days - recorded}日）
        </div>
      </Card>

      <Card title="受診用QRコード" sub={codes.length > 1 ? `${codes.length}枚あります。順番に読み取ってもらってください` : "外来で読み取ってもらいます"}>
        <div className="flex flex-wrap gap-5 justify-center">
          {codes.map((code, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <QRSvg text={code} px={230} />
              <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 6, ...NUM }}>
                {codes.length > 1 ? `${i + 1} / ${codes.length} 枚目` : "1枚"}・{code.length}桁
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: C.inkSoft, marginTop: 14, lineHeight: 1.7 }}>
          氏名や生年月日は含みません。手帳の番号（乱数）、年齢・性別と、数値の記録が入っています。
        </p>
        <div className="mt-3">
          <Btn small filled={false} onClick={() => setShowCode(!showCode)}>{showCode ? "コードを隠す" : "コードを文字で見る"}</Btn>
          {showCode && (
            <textarea readOnly value={codes.join("\n")} rows={4}
              style={{ width: "100%", marginTop: 10, padding: 10, fontSize: 11, border: `1px solid ${C.line}`, borderRadius: 3, color: C.inkSoft, wordBreak: "break-all" }} />
          )}
        </div>
      </Card>
    </div>
  );
}



/* ---------- 導入施設マップ（滋賀県・模式図） ---------- */
// ここに施設を追加してください。lat/lng はおおよその位置で構いません。
const FACILITIES = [
  {
    name: "滋賀医科大学医学部附属病院",
    dept: "循環器内科",
    city: "大津市",
    address: "〒520-2192 大津市瀬田月輪町",
    director: "野﨑 和彦",
    url: "https://www.shiga-med.ac.jp/hospital/",
    lat: 34.972, lng: 135.938,
  },
  {
    name: "伊賀市立上野総合市民病院",
    dept: "循環器内科",
    city: "伊賀市",
    pref: "三重県",
    address: "〒518-0823 三重県伊賀市四十九町831番地",
    director: "田中 光司",
    url: "https://www.cgh-iga.jp/",
    lat: 34.783, lng: 136.147,
  },
  {
    name: "南草津ひだまりハートクリニック",
    dept: "循環器内科・内科・心臓リハビリテーション",
    city: "草津市",
    address: "草津市南草津3丁目4-7",
    director: "八木 典章",
    url: "https://kusatsu-hidamariclinic.com/",
    lat: 34.9915, lng: 135.9605,
  },
];

// 琵琶湖：Natural Earth の湖沼データ。[経度, 緯度]
const GEO_BIWAKO = [[136.221,35.385],[136.2489,35.3768],[136.2787,35.3647],[136.2766,35.3368],[136.2528,35.2841],[136.2398,35.2708],[136.1633,35.2258],[136.105,35.2055],[136.0779,35.1905],[136.0603,35.1646],[136.0785,35.1587],[136.0738,35.1493],[136.0564,35.1404],[135.9999,35.1319],[135.9831,35.1254],[135.9708,35.116],[135.9646,35.1233],[135.9572,35.1036],[135.9531,35.0783],[135.9452,35.0568],[135.9266,35.0477],[135.9193,35.0389],[135.9193,34.9953],[135.9095,34.9788],[135.8984,34.98],[135.8848,34.9903],[135.8733,35.0059],[135.8683,35.0236],[135.8736,35.0389],[135.9216,35.1051],[135.9281,35.1192],[135.9322,35.1713],[135.9369,35.1863],[135.9572,35.219],[136.0164,35.2667],[136.0261,35.2773],[136.0341,35.2923],[136.0679,35.3076],[136.0744,35.3215],[136.0429,35.3865],[136.0432,35.3977],[136.0514,35.4109],[136.0585,35.4365],[136.0709,35.4542],[136.095,35.4442],[136.1135,35.4766],[136.1224,35.4866],[136.1283,35.4557],[136.1347,35.4433],[136.1527,35.438],[136.1574,35.4454],[136.1603,35.4625],[136.1633,35.4995],[136.1777,35.4951],[136.1898,35.4869],[136.1968,35.4748],[136.1989,35.4351],[136.2054,35.4062],[136.221,35.385]];

// 市町の境界：国土数値情報「行政区域」由来。隣どうしが同じ線を共有するよう弧に分けています。
const ARCS = [[[135.8598,35.2824],[135.8608,35.283]],[[135.8608,35.283],[135.8659,35.2802],[135.8828,35.2847],[135.8875,35.2836],[135.9055,35.2757],[135.9046,35.2707],[135.9101,35.2642],[135.9171,35.266],[135.919,35.2606],[135.9279,35.2583],[135.9322,35.261],[135.9372,35.2606],[135.9405,35.2671],[135.9453,35.2673],[135.9458,35.2712],[135.9487,35.2742],[135.9556,35.2755],[135.9565,35.2776],[135.9768,35.2723],[135.9837,35.2723],[135.9879,35.267],[135.9909,35.2672],[135.9937,35.2644],[136.0149,35.2333]],[[136.0149,35.2333],[136.0163,35.2313]],[[136.0135,35.228],[136.0163,35.2313]],[[135.9965,35.1917],[136.0135,35.228]],[[135.9958,35.1902],[135.9965,35.1917]],[[135.9917,35.1891],[135.9958,35.1902]],[[135.9604,35.15],[135.9726,35.181],[135.9824,35.1866],[135.9917,35.1891]],[[135.9593,35.1472],[135.9604,35.15]],[[135.9583,35.1467],[135.9593,35.1472]],[[135.9246,35.0917],[135.9314,35.1095],[135.9356,35.1155],[135.9352,35.1212],[135.9384,35.1262],[135.9403,35.1375],[135.9583,35.1467]],[[135.9232,35.0881],[135.9246,35.0917]],[[135.9185,35.0833],[135.9232,35.0881]],[[135.9185,35.0833],[135.9147,35.0794],[135.9115,35.0697],[135.8922,35.0446],[135.888,35.0353],[135.8912,35.0235],[135.8937,35.0224],[135.8982,35.0125],[135.9029,34.9924],[135.9159,34.9964],[135.9299,34.9942],[135.9296,34.9963],[135.933,34.9955],[135.9415,34.9908],[135.9397,34.9885],[135.9431,34.9864],[135.9515,34.9719],[135.955,34.9738],[135.96,34.9723],[135.9627,34.9764],[135.969,34.9766],[135.9686,34.978],[135.9658,34.9775],[135.967,34.9831],[135.9734,34.986],[135.9795,34.9833],[135.976,34.9818],[135.9779,34.9801],[135.9811,34.981],[135.9873,34.9781],[135.9891,34.98]],[[135.9891,34.98],[135.9894,34.98]],[[135.9894,34.98],[135.9904,34.9801]],[[135.9904,34.9801],[135.9939,34.981],[135.9931,34.9784],[135.9988,34.9769],[136.0055,34.9798],[136.0103,34.9755],[136.014,34.9626],[136.0093,34.9631],[136.001,34.9598],[136.0036,34.9568],[136.0102,34.9545],[136.0162,34.9431],[136.0199,34.9439],[136.0301,34.9397],[136.0352,34.9435],[136.039,34.9436],[136.0412,34.9533],[136.0397,34.958],[136.0427,34.9613],[136.0411,34.9565],[136.0425,34.9562],[136.0407,34.9554],[136.0422,34.9547],[136.0401,34.9496],[136.041,34.9456]],[[136.041,34.9456],[136.0411,34.9453]],[[136.0411,34.9453],[136.0411,34.945]],[[135.9432,34.8782],[135.9534,34.8787],[135.9559,34.8808],[135.964,34.8798],[135.9664,34.8831],[135.9675,34.8912],[135.9715,34.8939],[135.9747,34.8917],[135.9748,34.8885],[135.9872,34.8896],[135.989,34.8922],[135.9869,34.8976],[135.9917,34.9009],[135.9931,34.9095],[135.9992,34.9091],[136.0098,34.92],[136.0198,34.9167],[136.0235,34.9216],[136.0331,34.9222],[136.0353,34.9239],[136.0378,34.9216],[136.0404,34.9222],[136.0427,34.9264],[136.0423,34.9309],[136.033,34.9379],[136.0411,34.945]],[[135.9432,34.8782],[135.9433,34.8782]],[[135.8598,35.2824],[135.8584,35.2782],[135.8546,35.2756],[135.8549,35.2714],[135.8475,35.2667],[135.8447,35.262],[135.8461,35.2571],[135.8425,35.2539],[135.844,35.2515],[135.8402,35.2479],[135.8399,35.2439],[135.8345,35.2411],[135.8377,35.2372],[135.8381,35.2261],[135.8293,35.2205],[135.83,35.2158],[135.8326,35.2141],[135.831,35.2105],[135.8356,35.2065],[135.8373,35.1963],[135.8419,35.1898],[135.8402,35.1819],[135.8433,35.1787],[135.8424,35.1739],[135.8453,35.1655],[135.8484,35.1613],[135.8561,35.1596],[135.8568,35.1536],[135.8539,35.1519],[135.8526,35.146],[135.8488,35.1422],[135.8501,35.1353],[135.8523,35.1343],[135.8494,35.1258],[135.8499,35.1206],[135.8473,35.1142],[135.8444,35.1136],[135.8429,35.1025],[135.8393,35.0998],[135.835,35.0913],[135.8399,35.0859],[135.8383,35.0791],[135.8366,35.0789],[135.8319,35.0715],[135.8358,35.0623],[135.8349,35.0556],[135.8328,35.0528],[135.8258,35.0534],[135.8148,35.0452],[135.8156,35.0414],[135.8215,35.0362],[135.8246,35.0356],[135.8277,35.0304],[135.8274,35.0221],[135.8345,35.0221],[135.8356,35.0127],[135.8249,35.0124],[135.8207,35.0157],[135.8202,35.013],[135.8243,35.0087],[135.8327,35.0094],[135.8366,35.0012],[135.8355,34.9993],[135.8324,35.0008],[135.8269,34.9912],[135.8436,34.9896],[135.8493,34.9917],[135.8491,34.9848],[135.855,34.9847],[135.8567,34.9825],[135.8524,34.9708],[135.8556,34.9699],[135.8562,34.9667],[135.863,34.9608],[135.8639,34.9576],[135.8742,34.955],[135.8787,34.947],[135.876,34.9432],[135.8799,34.9345],[135.8707,34.926],[135.8719,34.9239],[135.8687,34.9195],[135.8713,34.9148],[135.8712,34.9099],[135.8629,34.9034],[135.8673,34.8969],[135.8666,34.8921],[135.8812,34.8838],[135.8869,34.8832],[135.8886,34.8799],[135.8857,34.8786],[135.885,34.8755],[135.8934,34.8741],[135.8973,34.8713],[135.9074,34.874],[135.9068,34.8755],[135.9097,34.8772],[135.9127,34.8835],[135.9186,34.8848],[135.9232,34.8836],[135.9287,34.8881],[135.9336,34.888],[135.936,34.8916],[135.9409,34.8937],[135.9396,34.8886],[135.9412,34.8845],[135.9397,34.8814],[135.9433,34.8782]],[[136.0852,35.2518],[136.0866,35.25]],[[136.0838,35.2583],[136.0852,35.2518]],[[136.0837,35.2589],[136.0838,35.2583]],[[136.0837,35.2589],[136.0891,35.2583]],[[136.0891,35.2583],[136.1222,35.2559],[136.1528,35.2687],[136.1458,35.35]],[[136.1458,35.35],[136.1485,35.356]],[[136.1485,35.356],[136.15,35.3556]],[[136.15,35.3556],[136.2083,35.3391]],[[136.2083,35.3391],[136.2098,35.3387]],[[136.2098,35.3387],[136.2127,35.3333]],[[136.2127,35.3333],[136.216,35.3037],[136.2441,35.2956],[136.2574,35.3005],[136.2623,35.294],[136.2686,35.2942],[136.2699,35.2968],[136.2861,35.297],[136.2882,35.3016],[136.2975,35.2989],[136.3011,35.3021],[136.3026,35.2958],[136.3137,35.293],[136.3175,35.2887],[136.3189,35.2809],[136.3229,35.2799],[136.3256,35.2839],[136.325,35.2881],[136.3285,35.2916],[136.326,35.2984],[136.3284,35.298],[136.3317,35.2915],[136.3461,35.2864],[136.3513,35.2743]],[[136.3513,35.2743],[136.3515,35.2741]],[[136.3514,35.2738],[136.3515,35.2741]],[[136.2583,35.2291],[136.2615,35.2305],[136.2679,35.2259],[136.2722,35.226],[136.275,35.2295],[136.2699,35.2325],[136.2733,35.239],[136.2747,35.2403],[136.2761,35.239],[136.2794,35.2424],[136.2852,35.2403],[136.2914,35.2459],[136.2943,35.2454],[136.2969,35.2491],[136.2967,35.253],[136.3006,35.2572],[136.305,35.2558],[136.3046,35.2571],[136.3077,35.2577],[136.321,35.2677],[136.3386,35.264],[136.3454,35.2686],[136.3508,35.2682],[136.3514,35.2738]],[[136.2577,35.2284],[136.2583,35.2291]],[[136.2561,35.2299],[136.2577,35.2284]],[[136.238,35.2134],[136.2413,35.2177],[136.2446,35.2155],[136.2467,35.2178],[136.2507,35.2171],[136.253,35.2203],[136.2503,35.226],[136.2521,35.2273],[136.2547,35.225],[136.2561,35.2299]],[[136.2376,35.2128],[136.238,35.2134]],[[136.2374,35.2126],[136.2376,35.2128]],[[136.2161,35.1939],[136.2135,35.1971],[136.2198,35.2064],[136.2231,35.2059],[136.2212,35.207],[136.2233,35.2078],[136.222,35.2084],[136.2239,35.2122],[136.2217,35.2133],[136.2258,35.2186],[136.2374,35.2126]],[[136.2161,35.1936],[136.2161,35.1939]],[[136.2159,35.1937],[136.2161,35.1936]],[[136.1917,35.1902],[136.1937,35.1986],[136.2004,35.1949],[136.2053,35.1991],[136.2159,35.1937]],[[136.1916,35.1902],[136.1917,35.1902]],[[136.1913,35.1903],[136.1916,35.1902]],[[136.0866,35.25],[136.1121,35.2164],[136.1213,35.2128],[136.1336,35.2126],[136.1413,35.2066],[136.1657,35.205],[136.1779,35.1951],[136.1913,35.1903]],[[136.1056,35.5288],[136.1057,35.5289]],[[136.1057,35.5289],[136.1072,35.5305],[136.1059,35.5383],[136.1094,35.545],[136.1079,35.5472],[136.1091,35.5497],[136.1054,35.5555],[136.1104,35.5597],[136.1107,35.5633],[136.1079,35.5683],[136.1129,35.574],[136.1136,35.5828],[136.1167,35.5819],[136.117,35.5785],[136.1212,35.5762],[136.1327,35.5745],[136.1389,35.5757],[136.1449,35.5706],[136.1505,35.5729],[136.1623,35.5715],[136.1669,35.5654],[136.1699,35.5661],[136.1707,35.5756],[136.1664,35.5825],[136.1774,35.5949],[136.1768,35.5984],[136.1669,35.6186],[136.1599,35.6252],[136.1586,35.6298],[136.1599,35.6348],[136.1512,35.649],[136.1525,35.6507],[136.1501,35.6545],[136.1513,35.6556],[136.1502,35.6594],[136.1481,35.6624],[136.1364,35.6657],[136.1345,35.6696],[136.1396,35.678],[136.1425,35.6792],[136.1462,35.6868],[136.1489,35.6884],[136.1506,35.6979],[136.1568,35.7004],[136.1617,35.6965],[136.1648,35.6963],[136.1678,35.7033],[136.1704,35.7014],[136.1746,35.7037],[136.1808,35.7015],[136.1834,35.7036],[136.1913,35.7024],[136.1983,35.6897],[136.201,35.6899],[136.2042,35.6868],[136.2083,35.6876],[136.2126,35.6817],[136.2172,35.6846],[136.2259,35.6805],[136.2342,35.6825],[136.2447,35.6738],[136.2507,35.6762],[136.2576,35.6712],[136.2623,35.6716],[136.2694,35.6687],[136.2716,35.6656],[136.2805,35.6613],[136.2807,35.6586],[136.2762,35.6531],[136.2831,35.6437],[136.2792,35.6367],[136.2873,35.6281],[136.2886,35.6206],[136.2984,35.6175],[136.3053,35.62],[136.3069,35.6224],[136.3158,35.6234],[136.3237,35.6164],[136.3205,35.6106],[136.315,35.6059],[136.3203,35.6016],[136.3228,35.593],[136.3222,35.5879],[136.3244,35.5842],[136.3221,35.5812],[136.3227,35.5695],[136.3188,35.5653],[136.3162,35.5569],[136.3175,35.5474],[136.3224,35.5444],[136.3255,35.5457],[136.3262,35.5495],[136.3296,35.5509],[136.3373,35.5503],[136.3414,35.5427],[136.3396,35.5408],[136.3409,35.5373],[136.3457,35.5362]],[[136.3457,35.5362],[136.3459,35.5361]],[[136.2142,35.3412],[136.2257,35.3479],[136.243,35.3497],[136.2504,35.3527],[136.2781,35.3508],[136.2964,35.3546],[136.2981,35.3503],[136.3058,35.3522],[136.3121,35.3425],[136.3182,35.3463],[136.3218,35.3454],[136.325,35.3471],[136.3265,35.3593],[136.3293,35.365],[136.3341,35.3677],[136.3339,35.3719],[136.3375,35.3795],[136.3352,35.3858],[136.3357,35.3911],[136.3323,35.3974],[136.3331,35.4038],[136.337,35.4054],[136.3411,35.4025],[136.3565,35.4007],[136.3597,35.4047],[136.3629,35.4154],[136.3571,35.4245],[136.3561,35.429],[136.3587,35.4343],[136.3497,35.4469],[136.3504,35.4512],[136.3432,35.4594],[136.3441,35.464],[136.3327,35.4694],[136.3384,35.4766],[136.3347,35.4829],[136.3371,35.4877],[136.3367,35.4944],[136.3427,35.5026],[136.3428,35.5149],[136.3462,35.5178],[136.3477,35.5227],[136.3459,35.5361]],[[136.2098,35.3387],[136.2142,35.3412]],[[136.1451,35.3576],[136.1485,35.356]],[[136.1056,35.5288],[136.1036,35.5208],[136.105,35.5145],[136.1019,35.512],[136.0986,35.5],[136.1012,35.4903],[136.1001,35.4808],[136.0962,35.4784],[136.0972,35.4749],[136.0947,35.4732],[136.0955,35.4695],[136.0916,35.4652],[136.0943,35.4614],[136.1016,35.4606],[136.1158,35.4546],[136.1179,35.4381],[136.1164,35.4327],[136.0947,35.4101],[136.0983,35.3928],[136.1451,35.3576]],[[135.9958,35.1902],[136,35.187]],[[136.0163,35.2313],[136.0167,35.2316]],[[136.0167,35.2316],[136.0269,35.2393],[136.0712,35.2595],[136.0789,35.2609],[136.0833,35.259]],[[136.0833,35.259],[136.0837,35.2589]],[[136.0852,35.2518],[136.0856,35.25]],[[136.0856,35.25],[136.0905,35.2217],[136.0995,35.2097],[136.1019,35.1989],[136.0982,35.1964],[136.1041,35.1961],[136.1059,35.189],[136.1113,35.1899],[136.1124,35.1852],[136.1234,35.187],[136.1246,35.1824],[136.1297,35.1833],[136.1318,35.1752],[136.1351,35.1757],[136.1357,35.1737],[136.1305,35.1719],[136.14,35.1608],[136.1394,35.156],[136.1519,35.1529],[136.162,35.1457],[136.1683,35.1442],[136.1733,35.1378],[136.1721,35.1342],[136.1828,35.1271],[136.1822,35.1247],[136.1765,35.1233],[136.1699,35.1182],[136.1698,35.1109],[136.1643,35.1096],[136.1637,35.1051],[136.1556,35.1087],[136.1545,35.1074],[136.1517,35.1084],[136.1468,35.112],[136.1448,35.1094],[136.1396,35.1097],[136.14,35.1047],[136.1331,35.1058],[136.1256,35.1026],[136.1274,35.0978],[136.1255,35.0957],[136.1355,35.0879],[136.1394,35.0869],[136.1407,35.081],[136.1459,35.0765]],[[136.1458,35.0764],[136.1459,35.0765]],[[136.1447,35.0764],[136.1458,35.0764]],[[136.078,35.0924],[136.0832,35.093],[136.0872,35.0972],[136.0983,35.0972],[136.1034,35.0888],[136.1085,35.0923],[136.115,35.0874],[136.1221,35.0918],[136.1295,35.0849],[136.1346,35.084],[136.1334,35.0784],[136.136,35.0748],[136.1387,35.0739],[136.1447,35.0764]],[[136.078,35.092],[136.078,35.0924]],[[136.0778,35.0921],[136.078,35.092]],[[136,35.187],[136.0036,35.1546],[136.008,35.1409],[136.0159,35.1372],[136.025,35.1359],[136.0257,35.1313],[136.0306,35.13],[136.0284,35.1272],[136.0322,35.1254],[136.0306,35.1208],[136.0337,35.114],[136.0419,35.1097],[136.0487,35.1104],[136.0573,35.1056],[136.0665,35.1063],[136.0702,35.0979],[136.0778,35.0921]],[[135.9232,35.0881],[135.925,35.0874]],[[135.925,35.0874],[135.9409,35.0808],[135.9448,35.0775],[135.9444,35.0741],[135.9483,35.0632],[135.9608,35.0589],[135.9606,35.056],[135.9644,35.0547],[135.963,35.0509]],[[135.9628,35.0507],[135.963,35.0509]],[[135.9623,35.05],[135.9628,35.0507]],[[135.9623,35.05],[135.9585,35.0473],[135.965,35.0426],[135.961,35.0375],[135.9725,35.0314],[135.9688,35.0251],[135.9704,35.0242],[135.9684,35.0218],[135.9726,35.0184],[135.9705,35.0156],[135.9825,35.0089],[135.9862,35.0097],[135.9901,35.008],[135.992,35.0033],[135.9993,34.9972],[135.9959,34.989],[135.9906,34.9915],[135.9894,34.9872],[135.9914,34.9831],[135.9892,34.9811]],[[135.9892,34.9811],[135.9894,34.98]],[[135.9593,35.1472],[135.9621,35.1417]],[[135.9621,35.1417],[135.9676,35.1309],[135.9819,35.1221],[135.985,35.1221],[135.985,35.1202],[135.9936,35.1177],[135.9933,35.1121],[135.9914,35.1107],[135.9935,35.1091],[135.999,35.11],[136.0034,35.1032],[136.0037,35.0927],[136.0016,35.0904],[136.0097,35.0863],[136.0102,35.0774],[136.0072,35.0702],[136.0019,35.069],[135.9968,35.0631],[136.0043,35.0587],[136.0077,35.0593],[136.0158,35.0509]],[[136.0158,35.0509],[136.016,35.0507]],[[136.0153,35.0502],[136.016,35.0507]],[[135.9639,35.0501],[135.9748,35.0445],[135.9769,35.0455],[135.986,35.038],[135.9881,35.0397],[135.9932,35.0369],[135.9974,35.038],[136.0035,35.0477],[136.0072,35.0499],[136.0115,35.0476],[136.0153,35.0502]],[[135.9628,35.0507],[135.9639,35.0501]],[[136.016,35.0507],[136.0164,35.05]],[[136.0164,35.05],[136.0279,35.0333],[136.0383,35.0264]],[[136.0383,35.0264],[136.0389,35.0262]],[[136.0387,35.026],[136.0389,35.0262]],[[136.0387,35.026],[136.0366,35.0213],[136.0396,35.0184],[136.0362,35.0118],[136.0396,35.0074],[136.0373,35.0048],[136.0393,35.0014],[136.0385,34.9979],[136.0464,34.9949],[136.0424,34.9856],[136.0531,34.9761],[136.053,34.9741],[136.061,34.9665],[136.0612,34.9643]],[[136.0612,34.9642],[136.0612,34.9643]],[[136.0612,34.9641],[136.0612,34.9642]],[[136.0417,34.9453],[136.0462,34.9464],[136.0451,34.9502],[136.0495,34.959],[136.0612,34.9641]],[[136.0411,34.9453],[136.0417,34.9453]],[[136.0612,34.9642],[136.0616,34.9642]],[[136.0616,34.9642],[136.0651,34.9626],[136.0701,34.9657],[136.0716,34.9626],[136.0764,34.9625],[136.0864,34.9537],[136.0916,34.9543],[136.0933,34.9573],[136.0947,34.9546],[136.1028,34.9519],[136.1048,34.9486],[136.1097,34.9466],[136.1136,34.9477],[136.1196,34.9546],[136.1233,34.9549],[136.1256,34.961],[136.132,34.9635],[136.1294,34.9658],[136.1317,34.968],[136.1279,34.9786],[136.1241,34.9838],[136.1244,34.9884],[136.1275,34.9891],[136.1272,34.9914],[136.1224,34.9958],[136.1391,35.003],[136.1395,35.008],[136.137,35.0137],[136.1417,35.0205],[136.1421,35.025]],[[136.1421,35.025],[136.1422,35.025]],[[136.1422,35.025],[136.1422,35.025]],[[136.1422,35.025],[136.1534,35.0193],[136.1592,35.0222],[136.1635,35.0305]],[[136.1635,35.0305],[136.1635,35.0306]],[[136.1635,35.0306],[136.1637,35.0307]],[[136.1637,35.0307],[136.1675,35.0241],[136.1714,35.0214],[136.1732,35.0166],[136.1766,35.0214],[136.1803,35.0166]],[[136.1803,35.0166],[136.1807,35.0164]],[[136.1807,35.0162],[136.1807,35.0164]],[[136.1807,35.0162],[136.1837,35.009],[136.1817,35.0025],[136.1855,35.0022],[136.1886,35.0001],[136.1889,34.9975],[136.2012,34.9923],[136.2001,34.9889],[136.2061,34.9889],[136.2077,34.9853],[136.2112,34.9844],[136.2154,34.9856],[136.2205,34.9776],[136.2181,34.9725],[136.22,34.9687],[136.2282,34.9704],[136.2318,34.9632],[136.2378,34.9593],[136.2484,34.9564],[136.2638,34.9613],[136.2652,34.9637],[136.2696,34.9614],[136.275,34.965],[136.2777,34.9649],[136.2817,34.9701],[136.2844,34.9707],[136.2841,34.9734],[136.2869,34.975],[136.2907,34.9737],[136.3012,34.9836],[136.3158,34.9826],[136.3233,34.9776],[136.3291,34.9825],[136.3363,34.9836],[136.3409,34.9893],[136.3434,34.9971],[136.343,35.0018],[136.3454,35.0086],[136.342,35.0122],[136.3423,35.0164]],[[136.3423,35.0164],[136.3425,35.0166]],[[136.3425,35.0166],[136.3426,35.0166]],[[136.3426,35.0166],[136.3549,35.0234],[136.3634,35.0218],[136.3645,35.0164],[136.3745,35.0151],[136.3833,35.0184],[136.3846,35.0215],[136.3879,35.0225],[136.3945,35.0171],[136.4001,35.0165],[136.4038,35.0138],[136.4182,35.0181]],[[136.4182,35.0181],[136.4184,35.0179]],[[135.9431,34.8781],[135.9436,34.8728],[135.9409,34.8639],[135.9452,34.8585],[135.9464,34.8516],[135.9614,34.8547],[135.9627,34.8504],[135.9666,34.8492],[135.9678,34.8467],[135.9721,34.846],[135.9699,34.8378],[135.9818,34.8392],[135.9919,34.8429],[135.9945,34.8421],[135.9992,34.845],[136.004,34.8443],[136.0053,34.8429],[136.0023,34.8328],[136.0058,34.8262],[136.0122,34.8252],[136.0163,34.8289],[136.0279,34.8217],[136.0285,34.8159],[136.0187,34.8127],[136.0151,34.8091],[136.0102,34.7997],[136.0112,34.7959],[136.0159,34.7978],[136.0163,34.7947],[136.0196,34.7922],[136.0281,34.7906],[136.0329,34.7941],[136.0388,34.794],[136.0412,34.7985],[136.0467,34.8014],[136.0516,34.7991],[136.0574,34.8037],[136.0625,34.7998],[136.0684,34.804],[136.073,34.8042],[136.0755,34.8079],[136.0813,34.8075],[136.0903,34.812],[136.0908,34.8158],[136.0952,34.8188],[136.0879,34.8293],[136.0901,34.8333],[136.0861,34.8376],[136.0907,34.8364],[136.0949,34.8402],[136.1001,34.8391],[136.1045,34.8406],[136.1075,34.8454],[136.1071,34.8526],[136.1109,34.8554],[136.1171,34.8556],[136.121,34.8598],[136.1264,34.8619],[136.1227,34.8665],[136.1259,34.87],[136.124,34.8725],[136.1189,34.8706],[136.1155,34.8719],[136.1133,34.8693],[136.1032,34.8697],[136.0856,34.8772],[136.0852,34.879],[136.0896,34.8825],[136.0853,34.8869],[136.0875,34.8906],[136.0931,34.8877],[136.098,34.8893],[136.1017,34.8961],[136.1108,34.9019],[136.1153,34.8986],[136.115,34.8931],[136.1204,34.8914],[136.1217,34.8879],[136.1254,34.8883],[136.1312,34.8831],[136.135,34.8849],[136.1368,34.8884],[136.1479,34.8819],[136.1658,34.8879],[136.1785,34.8871],[136.1808,34.8859],[136.1783,34.8826],[136.1787,34.8798],[136.1885,34.8778],[136.1901,34.8733],[136.1946,34.8728],[136.1981,34.8699],[136.2186,34.8656],[136.2201,34.8634],[136.2275,34.861],[136.2356,34.8615],[136.2377,34.8595],[136.2507,34.8577],[136.268,34.8645],[136.2692,34.8683],[136.2737,34.8698],[136.2771,34.8742],[136.2837,34.8703],[136.2929,34.8703],[136.2989,34.8755],[136.3049,34.8751],[136.3129,34.8806],[136.3132,34.887],[136.3201,34.8898],[136.3265,34.8887],[136.3305,34.8923],[136.3394,34.8955],[136.3462,34.8947],[136.3506,34.8991],[136.3574,34.9005],[136.3602,34.9041],[136.366,34.9049],[136.3647,34.9115],[136.3685,34.9149],[136.3678,34.9219],[136.3752,34.9245],[136.3717,34.9276],[136.373,34.9285],[136.3718,34.9344],[136.3754,34.939],[136.3727,34.9423],[136.3857,34.9526],[136.3951,34.9516],[136.3992,34.9632],[136.4034,34.9664],[136.4031,34.9692],[136.4158,34.9805],[136.4146,34.9818],[136.4164,34.9923],[136.4135,34.9954],[136.4214,35.0001],[136.417,35.0112],[136.4184,35.0179]],[[135.9431,34.8781],[135.9432,34.8782]],[[136.078,35.092],[136.078,35.0917]],[[136.0732,35.0527],[136.0733,35.0561],[136.0797,35.0608],[136.0785,35.0637],[136.0803,35.0668],[136.0786,35.068],[136.0798,35.072],[136.0783,35.0737],[136.0796,35.0789],[136.0758,35.0834],[136.0781,35.0872],[136.0765,35.0894],[136.078,35.0917]],[[136.0732,35.0523],[136.0732,35.0527]],[[136.073,35.0525],[136.0732,35.0523]],[[136.0401,35.0257],[136.0512,35.0317],[136.0513,35.0358],[136.0533,35.037],[136.0525,35.0397],[136.056,35.0453],[136.0552,35.056],[136.073,35.0525]],[[136.0389,35.0262],[136.0401,35.0257]],[[136.0732,35.0523],[136.0734,35.0521]],[[136.0734,35.0521],[136.0789,35.0498],[136.0789,35.0455],[136.084,35.0393],[136.0858,35.0305],[136.0909,35.029],[136.0937,35.0244],[136.0975,35.0249],[136.1025,35.0214],[136.1046,35.0246],[136.1129,35.0276],[136.1169,35.0271],[136.119,35.0219],[136.122,35.0216],[136.1236,35.0252],[136.1184,35.0363],[136.124,35.0372],[136.1314,35.0343],[136.1369,35.0305],[136.1371,35.027],[136.1421,35.0251]],[[136.1421,35.0251],[136.1422,35.025]],[[135.8604,35.2831],[135.8608,35.283]],[[135.8604,35.2831],[135.8584,35.2892],[135.8571,35.289],[135.8517,35.286],[135.8492,35.2797],[135.841,35.2778],[135.8401,35.2756],[135.8346,35.2741],[135.8296,35.2767],[135.8201,35.2908],[135.8214,35.2971],[135.8151,35.301],[135.8145,35.307],[135.8102,35.3092],[135.8112,35.3135],[135.8093,35.3164],[135.8034,35.3173],[135.7911,35.3235],[135.79,35.3282],[135.7859,35.3305],[135.7808,35.3406],[135.7637,35.3452],[135.7697,35.3543],[135.7699,35.3598],[135.7745,35.3652],[135.7777,35.3659],[135.779,35.3734],[135.7844,35.3774],[135.7909,35.379],[135.7909,35.3866],[135.8075,35.3854],[135.8101,35.3917],[135.808,35.3944],[135.8107,35.4092],[135.8132,35.413],[135.8267,35.4147],[135.8363,35.412],[135.8388,35.4144],[135.8497,35.4106],[135.8532,35.4115],[135.8556,35.409],[135.8543,35.4008],[135.8604,35.3953],[135.8647,35.3944],[135.8906,35.4032],[135.8935,35.4107],[135.893,35.4198],[135.901,35.4258],[135.9027,35.4294],[135.9142,35.4321],[135.9132,35.4451],[135.9098,35.447],[135.9146,35.4519],[135.9174,35.4671],[135.9159,35.4709],[135.9217,35.476],[135.9237,35.4815],[135.9223,35.4859],[135.9244,35.4896],[135.93,35.4923],[135.938,35.5112],[135.9396,35.5205],[135.947,35.5205],[135.9517,35.5116],[135.9524,35.5062],[135.9576,35.506],[135.9627,35.5013],[135.9672,35.503],[135.9726,35.5002],[135.9815,35.4865],[135.9895,35.4927],[136.0042,35.491],[136.0089,35.4939],[136.0117,35.4976],[136.0117,35.5048],[136.0151,35.5087],[136.0151,35.5116],[136.0203,35.512],[136.0234,35.5199],[136.0288,35.5234],[136.0261,35.527],[136.0265,35.5295],[136.0409,35.5322],[136.0464,35.5302],[136.0486,35.5345],[136.0607,35.5319],[136.0624,35.5281],[136.0694,35.5263],[136.077,35.5305],[136.0768,35.5346],[136.0829,35.5406],[136.0932,35.5375],[136.1056,35.5288]],[[136.1056,35.5288],[136.1056,35.5288]],[[136.1916,35.1902],[136.1917,35.1901]],[[136.1917,35.1901],[136.196,35.1846],[136.1968,35.1697],[136.2023,35.1607],[136.2045,35.1615],[136.2043,35.148],[136.21,35.1493],[136.2143,35.1448],[136.2165,35.1481],[136.227,35.1435],[136.2315,35.1477],[136.2322,35.1517],[136.2282,35.1548],[136.2288,35.1583],[136.2314,35.1571],[136.2332,35.1597],[136.2397,35.1572],[136.239,35.1547],[136.2422,35.1521],[136.2468,35.151],[136.248,35.1561],[136.2535,35.1532],[136.2588,35.1592],[136.2817,35.1525],[136.3036,35.1577],[136.3127,35.1501],[136.3152,35.1512],[136.3215,35.1462],[136.3189,35.1386],[136.3252,35.1369],[136.3309,35.1429],[136.3354,35.1429]],[[136.3354,35.1429],[136.3357,35.143]],[[136.3357,35.143],[136.3357,35.1428]],[[136.3357,35.1428],[136.3372,35.1397],[136.3405,35.1389],[136.3407,35.1361],[136.3547,35.1311],[136.3592,35.1365],[136.3638,35.1349],[136.3685,35.1361],[136.372,35.1391],[136.3793,35.1403],[136.3866,35.1446],[136.3912,35.1509],[136.3912,35.1537],[136.3804,35.1622],[136.3759,35.1695],[136.3762,35.1753],[136.3745,35.1775],[136.3765,35.186],[136.3795,35.1894],[136.3876,35.1908],[136.3891,35.1968],[136.4033,35.1876],[136.4087,35.1872]],[[136.4087,35.1872],[136.4089,35.187]],[[136.4089,35.187],[136.4196,35.1826],[136.4247,35.1844],[136.4357,35.1765],[136.4387,35.172],[136.4446,35.1711],[136.4462,35.1692],[136.4453,35.1662],[136.4525,35.1659],[136.4547,35.1614],[136.4529,35.1589],[136.455,35.1524],[136.4513,35.1497],[136.4443,35.1492],[136.4429,35.1391],[136.438,35.1366],[136.4356,35.1308],[136.4481,35.1237],[136.4445,35.119],[136.44,35.1166],[136.4426,35.1107],[136.4408,35.1077],[136.4419,35.1014],[136.4392,35.0981],[136.4396,35.0933],[136.4381,35.0917],[136.4421,35.086],[136.4353,35.0827],[136.4403,35.0746],[136.4416,35.0663],[136.4409,35.0645],[136.4386,35.0655],[136.4336,35.0617],[136.4335,35.0596],[136.4288,35.0564],[136.4246,35.0569],[136.4222,35.0514],[136.4178,35.0495],[136.4178,35.0425],[136.4159,35.0414],[136.4179,35.0307],[136.4245,35.0295],[136.4221,35.0269],[136.4214,35.0214],[136.4171,35.0196],[136.4178,35.0183]],[[136.4178,35.0183],[136.4182,35.0181]],[[136.3423,35.0167],[136.3425,35.0166]],[[136.1807,35.0165],[136.1835,35.0195],[136.1843,35.0251],[136.1967,35.0225],[136.2003,35.0241],[136.1991,35.027],[136.2053,35.0316],[136.2205,35.0375],[136.2195,35.0401],[136.2153,35.0385],[136.2142,35.0411],[136.2147,35.0443],[136.2165,35.0442],[136.2154,35.0512],[136.2169,35.0565],[136.2146,35.0598],[136.2228,35.0649],[136.2339,35.0656],[136.2341,35.0688],[136.2383,35.0694],[136.2505,35.0681],[136.2577,35.0648],[136.2646,35.0581],[136.2705,35.0592],[136.2729,35.0631],[136.2756,35.0579],[136.2915,35.0586],[136.2959,35.0573],[136.3063,35.0457],[136.3104,35.0471],[136.3118,35.0444],[136.3175,35.0421],[136.3177,35.0384],[136.3266,35.037],[136.3291,35.0333],[136.3321,35.0325],[136.3347,35.0299],[136.3349,35.0255],[136.3374,35.0251],[136.3423,35.0167]],[[136.1807,35.0164],[136.1807,35.0165]],[[136.1633,35.0308],[136.1635,35.0306]],[[136.1458,35.0763],[136.1495,35.0732],[136.1476,35.0701],[136.1514,35.0661],[136.1473,35.0648],[136.144,35.0604],[136.1481,35.0592],[136.1531,35.0539],[136.1527,35.0512],[136.1491,35.0497],[136.1547,35.0308],[136.1577,35.0281],[136.1633,35.0308]],[[136.1458,35.0764],[136.1458,35.0763]],[[136.3459,35.5361],[136.346,35.5361]],[[136.346,35.5361],[136.3567,35.5399],[136.3626,35.5587],[136.3724,35.5598],[136.3758,35.5512],[136.3803,35.5461],[136.381,35.5377],[136.3843,35.5331],[136.3976,35.532],[136.4004,35.5301],[136.3998,35.5273],[136.4018,35.5256],[136.3991,35.5213],[136.4057,35.5135],[136.4037,35.5114],[136.4001,35.5136],[136.4006,35.5117],[136.3941,35.5063],[136.3878,35.4968],[136.3867,35.4888],[136.398,35.4809],[136.402,35.4735],[136.4016,35.47],[136.4205,35.466],[136.4215,35.4556],[136.4246,35.4533],[136.4262,35.4484],[136.4222,35.4426],[136.4231,35.4397],[136.4157,35.4334],[136.4189,35.4278],[136.4118,35.4224],[136.4118,35.4186],[136.4203,35.4129],[136.428,35.4008],[136.4366,35.3972],[136.4444,35.3894],[136.4365,35.3788],[136.4263,35.3734],[136.4156,35.3736],[136.412,35.3701],[136.4135,35.36],[136.4097,35.357],[136.4106,35.3525],[136.4133,35.3523],[136.4162,35.3548],[136.4214,35.3539],[136.4223,35.3484],[136.4114,35.329],[136.4136,35.3243],[136.412,35.3151],[136.4068,35.31],[136.4068,35.3053],[136.4032,35.3034],[136.4031,35.3006],[136.3994,35.2994],[136.3912,35.2902],[136.3917,35.2872]],[[136.3917,35.2872],[136.3917,35.2871]],[[136.3518,35.2743],[136.3555,35.2748],[136.364,35.2811],[136.3699,35.282],[136.3771,35.2877],[136.3808,35.2841],[136.3852,35.2868],[136.3917,35.2871]],[[136.3515,35.2741],[136.3518,35.2743]],[[136.216,35.1931],[136.2161,35.1936]],[[136.216,35.1931],[136.2163,35.1905],[136.2245,35.1869],[136.2261,35.1824],[136.2251,35.179],[136.2295,35.1769],[136.2308,35.1785],[136.2348,35.1763],[136.2375,35.1798],[136.2327,35.1844],[136.2341,35.1864],[136.2299,35.1923],[136.2311,35.1953],[136.2297,35.1968],[136.2363,35.1928],[136.2561,35.1885]],[[136.2561,35.1885],[136.2562,35.1884]],[[136.2562,35.1884],[136.2566,35.1883]],[[136.2566,35.1883],[136.2746,35.1832],[136.2748,35.1798],[136.2849,35.1798],[136.2904,35.1826]],[[136.2904,35.1826],[136.2905,35.1826]],[[136.2905,35.1826],[136.2907,35.1825]],[[136.2907,35.1825],[136.2958,35.1721],[136.2952,35.1674],[136.3068,35.1628],[136.3095,35.1576],[136.3136,35.1548],[136.3276,35.1544],[136.3345,35.1481],[136.3357,35.143]],[[136.3357,35.143],[136.3357,35.143]],[[136.2376,35.2128],[136.2382,35.2125]],[[136.2382,35.2125],[136.245,35.2092],[136.242,35.2025],[136.2443,35.2015],[136.2431,35.1975],[136.2493,35.1939],[136.2508,35.1963],[136.2559,35.1951],[136.2563,35.1885]],[[136.2562,35.1884],[136.2563,35.1885]],[[136.2577,35.2284],[136.2582,35.2279]],[[136.2582,35.2279],[136.273,35.2153],[136.2815,35.2031],[136.2891,35.1998],[136.2856,35.1976],[136.2906,35.1924],[136.288,35.1879],[136.2905,35.1828]],[[136.2905,35.1828],[136.2905,35.1826]],[[136.3917,35.2871],[136.392,35.2869]],[[136.392,35.2869],[136.396,35.2802],[136.3935,35.2619],[136.397,35.2577],[136.3892,35.2498],[136.3792,35.2475],[136.3773,35.2433],[136.3836,35.2397],[136.3857,35.2351],[136.3921,35.2342],[136.3938,35.2308],[136.3925,35.2298],[136.3986,35.228],[136.3993,35.2259],[136.4084,35.2236],[136.412,35.2184],[136.4157,35.2172],[136.4159,35.2064],[136.418,35.2038],[136.4145,35.2007],[136.4127,35.1921],[136.4087,35.1872]],[[136.4087,35.1872],[136.4087,35.1872]]];
const ARC_OUTER = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0];
const MUNI = [{"n":"大津市","c":[135.9199,35.0447],"a":[1,2,3,-4,-5,-6,-7,-8,-9,-10,-11,-12,-13,14,15,16,17,18,19,-20,21,-22]},{"n":"彦根市","c":[136.2454,35.2506],"a":[-23,-24,-25,26,27,28,29,30,31,32,33,34,-35,-36,-37,-38,-39,-40,-41,-42,-43,-44,-45,-46,-47,-48]},{"n":"長浜市","c":[136.2281,35.54],"a":[49,50,51,-52,-53,-31,-30,-29,-54,-55]},{"n":"近江八幡市","c":[136.1025,35.1422],"a":[-56,6,5,4,57,58,59,25,24,60,61,-62,-63,-64,-65,-66,-67]},{"n":"草津市","c":[135.9557,35.0157],"a":[13,68,69,-70,-71,72,73,-15,-14]},{"n":"守山市","c":[135.9771,35.0826],"a":[-68,12,11,10,74,75,76,-77,-78,-79,70,-69]},{"n":"栗東市","c":[136.013,34.995],"a":[-16,-73,-72,71,79,78,77,80,81,82,-83,84,-85,-86,-87,-88,-18,-17]},{"n":"甲賀市","c":[136.1618,34.9193],"a":[-19,88,87,86,89,90,91,92,93,94,95,96,97,-98,99,100,101,102,103,-104,105,20]},{"n":"野洲市","c":[136.0292,35.0943],"a":[-74,9,8,7,56,67,66,106,-107,-108,-109,-110,-111,-82,-81,-80,-76,-75]},{"n":"湖南市","c":[136.0909,35.0025],"a":[83,111,110,109,112,113,114,-91,-90,-89,85,-84]},{"n":"高島市","c":[135.9508,35.3929],"a":[-115,116,117,55,54,-28,-27,-26,-59,-58,-57,-3,-2]},{"n":"東近江市","c":[136.2729,35.1076],"a":[-60,23,48,47,118,119,120,121,122,123,124,125,-102,-101,-126,-127,-128,-97,-96,-95,-129,-130,-131,62,-61]},{"n":"米原市","c":[136.3569,35.3903],"a":[-32,53,52,132,133,134,-135,-136,-34,-33]},{"n":"日野町","c":[136.2589,35.0137],"a":[98,128,127,126,-100,-99]},{"n":"竜王町","c":[136.1155,35.0557],"a":[-112,108,107,-106,65,64,63,131,130,129,-94,-93,-92,-114,-113]},{"n":"愛荘町","c":[136.2528,35.1686],"a":[-118,46,45,44,-137,138,139,140,141,142,143,144,-145,-120,-119]},{"n":"豊郷町","c":[136.2326,35.1963],"a":[137,43,42,41,146,147,-148,-139,-138]},{"n":"甲良町","c":[136.2609,35.2039],"a":[-146,40,39,38,149,150,151,-142,-141,-140,148,-147]},{"n":"多賀町","c":[136.3441,35.2125],"a":[-143,-151,-150,-149,37,36,35,136,135,152,153,-154,-122,-121,145,-144]}];
// 弧をつないで市町の輪郭にする（負の番号は逆向き）
const arcPts = (refs) => {
  const out = [];
  for (const rf of refs) {
    const seg = ARCS[Math.abs(rf) - 1];
    const s = rf > 0 ? seg : seg.slice().reverse();
    for (let i = 0; i < s.length - 1; i++) out.push(s[i]);
  }
  return out;
};
const MUNI_POLY = MUNI.map((m) => arcPts(m.a));
// 地域ごとの表示範囲（操作しやすいように用意）
const REGIONS = [
  ["全体", null],
  ["大津・湖南", ["大津市", "草津市", "守山市", "栗東市", "野洲市"]],
  ["甲賀", ["甲賀市", "湖南市"]],
  ["東近江", ["近江八幡市", "東近江市", "日野町", "竜王町"]],
  ["湖東", ["彦根市", "愛荘町", "豊郷町", "甲良町", "多賀町"]],
  ["湖北", ["長浜市", "米原市"]],
  ["湖西", ["高島市"]],
];

const ALL_PTS = ARCS.flat();
const PAD = 0.02;
const LNG0 = Math.min(...ALL_PTS.map((p) => p[0])) - PAD;
const LNG1 = Math.max(...ALL_PTS.map((p) => p[0])) + PAD;
const LAT0 = Math.min(...ALL_PTS.map((p) => p[1])) - PAD;
const LAT1 = Math.max(...ALL_PTS.map((p) => p[1])) + PAD;
const COS_LAT = Math.cos((((LAT0 + LAT1) / 2) * Math.PI) / 180);
const MAP_W = 280;
const MAP_H = Math.round((MAP_W * (LAT1 - LAT0)) / ((LNG1 - LNG0) * COS_LAT));
const px = (lng) => ((lng - LNG0) / (LNG1 - LNG0)) * MAP_W;
const py = (lat) => ((LAT1 - lat) / (LAT1 - LAT0)) * MAP_H;
const poly = (pts) => pts.map(([ln, la]) => `${px(ln).toFixed(1)},${py(la).toFixed(1)}`).join(" ");

const FULL_VIEW = { x: 0, y: 0, w: MAP_W, h: MAP_H };
const mapsUrl = (f) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${f.name} ${f.address}`)}`;

function FacilityMap() {
  const [sel, setSel] = useState(null);
  const [view, setView] = useState(FULL_VIEW);
  const [region, setRegion] = useState("全体");

  const f = sel == null ? null : FACILITIES[sel];
  const k = view.w / MAP_W;

  const fit = (names) => {
    if (!names) return FULL_VIEW;
    const pts = MUNI.filter((m) => names.includes(m.n)).flatMap((m, i) => MUNI_POLY[MUNI.findIndex((x) => x.n === m.n)]);
    const xs = pts.map((p) => px(p[0])), ys = pts.map((p) => py(p[1]));
    const pad = 10;
    let x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
    let w = Math.max(...xs) - Math.min(...xs) + pad * 2;
    let h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    // 縦横比を地図に合わせる
    if (w / h > MAP_W / MAP_H) { const nh = (w * MAP_H) / MAP_W; y -= (nh - h) / 2; h = nh; }
    else { const nw = (h * MAP_W) / MAP_H; x -= (nw - w) / 2; w = nw; }
    return { x: Math.max(0, Math.min(MAP_W - w, x)), y: Math.max(0, Math.min(MAP_H - h, y)), w, h };
  };
  const focus = (i) => {
    const g = FACILITIES[i];
    if (g.pref) return;               // 県外は地図の対象外
    const w = MAP_W / 4, h = (w * MAP_H) / MAP_W;
    setRegion("");
    setView({
      w, h,
      x: Math.max(0, Math.min(MAP_W - w, px(g.lng) - w / 2)),
      y: Math.max(0, Math.min(MAP_H - h, py(g.lat) - h / 2)),
    });
  };

  const btn = (label, on) => (
    <button key={label} onClick={on}
      style={{
        padding: "7px 12px", borderRadius: 3, cursor: "pointer", fontSize: 13, fontWeight: 700,
        border: `1px solid ${C.line}`, background: "#fff", color: C.ink,
      }}>{label}</button>
  );
  const linkBtn = (href, label, filled) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{
        display: "inline-block", padding: "9px 14px", borderRadius: 3, textDecoration: "none",
        fontSize: 13.5, fontWeight: 700, border: `1.5px solid ${C.evening}`,
        background: filled ? C.evening : "#fff", color: filled ? "#fff" : C.evening,
      }}>{label}</a>
  );

  return (
    <Card title="このアプリを導入している病院・クリニック" sub="地図の印を押すと、住所などが出ます">
      {FACILITIES.length === 0 ? (
        <p style={{ fontSize: 13.5, color: C.inkSoft }}>まだ登録がありません。</p>
      ) : (
        <>
          <div className="no-print flex gap-2 flex-wrap" style={{ marginBottom: 8 }}>
            {REGIONS.map(([label, names]) => (
              <button key={label} onClick={() => { setRegion(label); setView(fit(names)); }}
                style={{
                  padding: "9px 14px", borderRadius: 3, cursor: "pointer", fontSize: 13, fontWeight: 700,
                  border: `1.5px solid ${region === label ? C.ink : C.line}`,
                  background: region === label ? C.ink : "#fff",
                  color: region === label ? "#fff" : C.inkSoft,
                }}>{label}</button>
            ))}
          </div>

          <div style={{ fontSize: 11.5, color: C.inkSoft, marginBottom: 8 }}>
            下の一覧で施設を選ぶと、その場所を拡大します。県外の施設は一覧のみです。
          </div>

          <div style={{ display: "flex", justifyContent: "center" }}>
            <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} width="100%"
              style={{ maxWidth: 320, border: `1px solid ${C.line}`, borderRadius: 3, background: "#fff" }}>
              {MUNI_POLY.map((pts, i) => (
                <polygon key={`f${i}`} points={poly(pts)} fill={C.tint} stroke="none" />
              ))}
              {ARCS.map((a, i) => (
                <polyline key={`a${i}`} points={poly(a)} fill="none"
                  stroke={C.inkSoft} strokeWidth={(ARC_OUTER[i] ? 1.1 : 0.55) * k}
                  opacity={ARC_OUTER[i] ? 0.95 : 0.45}
                  strokeLinejoin="round" strokeLinecap="round" />
              ))}
              <polygon points={poly(GEO_BIWAKO)} fill="#9FD3EA" stroke="#5FAFD0" strokeWidth={0.8 * k} strokeLinejoin="round" />
              <text x={px(136.06)} y={py(35.33)} fontSize={10.5 * k} fill="#245E7A" fontWeight="700" textAnchor="middle">琵琶湖</text>
              {MUNI.filter((m) => k < 0.55 || ["大津市", "草津市", "彦根市", "長浜市", "高島市", "甲賀市", "東近江市"].includes(m.n)).map((m) => (
                <text key={`t${m.n}`} x={px(m.c[0])} y={py(m.c[1])} fontSize={(k < 0.55 ? 7.5 : 8.5) * k}
                  fill={C.inkSoft} textAnchor="middle">{m.n}</text>
              ))}
              {FACILITIES.map((x, i) => {
                if (x.pref) return null;          // 県外の施設は地図に出さない
                const on = sel === i;
                return (
                  <g key={i} style={{ cursor: "pointer" }}
                    onClick={() => { if (on) { setSel(null); } else { setSel(i); focus(i); } }}>
                    <circle cx={px(x.lng)} cy={py(x.lat)} r={(on ? 7 : 5) * k}
                      fill={on ? C.alert : C.evening} stroke="#fff" strokeWidth={1.6 * k} />
                    <circle cx={px(x.lng)} cy={py(x.lat)} r={14 * k} fill="transparent" />
                  </g>
                );
              })}
            </svg>
          </div>

          {f && (
            <div style={{ border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.alert}`, borderRadius: 3, padding: "12px 14px", marginTop: 12 }}>
              <div style={{ fontSize: 15.5, fontWeight: 800, color: C.ink }}>{f.name}</div>
              {f.dept && <div style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 2 }}>{f.dept}</div>}
              <div style={{ fontSize: 13.5, color: C.ink, marginTop: 8, lineHeight: 1.9 }}>
                <div>住所　{f.address || "—"}</div>
                <div>{f.name.includes("病院") ? "病院長" : "院長"}　{f.director || "—"}</div>
              </div>
              <div className="no-print flex gap-2 flex-wrap" style={{ marginTop: 12 }}>
                {linkBtn(mapsUrl(f), "地図で見る", true)}
                {f.url && linkBtn(f.url, "ホームページ", false)}
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginBottom: 6 }}>市町ごとの一覧</div>
            <div className="flex flex-col gap-3">
              {[...MUNI.map((m) => m.n),
                ...[...new Set(FACILITIES.filter((x) => x.pref).map((x) => `${x.pref}${x.city}`))]]
                .map((label) => ({
                  label,
                  list: FACILITIES.map((x, i) => ({ x, i }))
                    .filter(({ x }) => (x.pref ? `${x.pref}${x.city}` : x.city) === label),
                }))
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <div key={g.label}>
                    <div style={{
                      fontSize: 12.5, fontWeight: 800, color: C.ink, marginBottom: 5,
                      borderLeft: `4px solid ${C.evening}`, paddingLeft: 8,
                    }}>
                      {g.label}
                      <span style={{ fontSize: 11.5, fontWeight: 400, color: C.inkSoft, marginLeft: 6, ...NUM }}>
                        {g.list.length}件
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {g.list.map(({ x, i }) => (
                        <button key={i} onClick={() => { setSel(sel === i ? null : i); if (sel !== i) focus(i); }}
                          style={{
                            textAlign: "left", padding: "10px 12px", cursor: "pointer", borderRadius: 3,
                            border: `1px solid ${sel === i ? C.evening : C.line}`,
                            background: sel === i ? C.tint : "#fff", fontSize: 13.5, fontWeight: 700, color: C.ink,
                          }}>
                          {x.name}
                          <span style={{ display: "block", fontSize: 11.5, fontWeight: 400, color: C.inkSoft, marginTop: 2 }}>
                            {x.address}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <p style={{ fontSize: 11.5, color: C.inkSoft, lineHeight: 1.8, marginTop: 14 }}>
            地図は滋賀県の市町の境界（国土数値情報「行政区域」）と琵琶湖（Natural Earth）のGeoJSONをもとに描いています。県外の施設は下の一覧のみに掲載しています。
            「地図で見る」「ホームページ」は外部のサイトを開きます。
          </p>
        </>
      )}
    </Card>
  );
}

/* ---------- 使う人のこと（初回設定） ---------- */
// 端末ごとの匿名ID（数字10桁）。氏名や生年月日とは無関係な乱数です
function newAnonId() {
  const a = new Uint32Array(2);
  (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : (a[0] = Math.random() * 4294967296, a[1] = Math.random() * 4294967296);
  return String(a[0] % 100000).padStart(5, "0") + String(a[1] % 100000).padStart(5, "0");
}
const idText = (v) => (v && v.length === 10 ? `${v.slice(0, 4)}-${v.slice(4, 7)}-${v.slice(7)}` : "—");

const emptyProfile = () => ({ id: "", birth: "", sex: "", height: "", done: false });
const SEX_OPTS = [["female", "女性"], ["male", "男性"], ["na", "回答しない"]];

function ageFrom(birth) {
  if (!birth) return null;
  const b = parseISO(birth), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

// 年だけの短い和暦（選択肢に添える）
function eraShort(y) {
  if (y >= 2020) return `令${y - 2018}`;
  if (y >= 1990) return `平${y - 1988}`;
  if (y >= 1927) return `昭${y - 1925}`;
  if (y >= 1913) return `大${y - 1911}`;
  return `明${y - 1867}`;
}

// 和暦（明治以降）
function wareki(birth) {
  if (!birth) return "";
  const [y, m, d] = birth.split("-").map(Number);
  const n = y * 10000 + m * 100 + d;
  const eras = [
    ["令和", 20190501, 2018], ["平成", 19890108, 1988], ["昭和", 19261225, 1925],
    ["大正", 19120730, 1911], ["明治", 18680908, 1867],
  ];
  for (const [name, from, base] of eras) {
    if (n >= from) { const yy = y - base; return `${name}${yy === 1 ? "元" : yy}年${m}月${d}日`; }
  }
  return `${y}年${m}月${d}日`;
}

function ProfileFields({ profile, setProfile }) {
  const pill = (on) => ({
    padding: "12px 18px", borderRadius: 3, fontSize: 15, fontWeight: 700, cursor: "pointer",
    border: `2px solid ${on ? C.evening : C.line}`, background: on ? C.evening : "#fff", color: on ? "#fff" : C.inkSoft,
  });
  const age = ageFrom(profile.birth);
  const [y, m, d] = profile.birth ? profile.birth.split("-").map(Number) : ["", "", ""];
  const thisYear = new Date().getFullYear();
  const daysIn = (yy, mm) => (yy && mm ? new Date(yy, mm, 0).getDate() : 31);

  const setYMD = (ny, nm, nd) => {
    if (!ny || !nm || !nd) { setProfile({ ...profile, birth: "" }); return; }
    const day = Math.min(nd, daysIn(ny, nm));
    setProfile({ ...profile, birth: `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
  };
  const sel = {
    padding: "11px 10px", border: `1px solid ${C.line}`, borderRadius: 3,
    fontSize: 16, color: C.ink, background: "#fff", ...NUM,
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>生年月日</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "nowrap" }}>
          <label style={{ flex: "1 1 0", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11.5, color: C.inkSoft, marginBottom: 3 }}>年</span>
            <select value={y || ""} onChange={(e) => setYMD(Number(e.target.value), m || 1, d || 1)}
              style={{ ...sel, width: "100%" }}>
              {/* 上へたどると古い年。未選択のときは1980年あたりが見える位置に空欄を置く */}
              {Array.from({ length: 1980 - 1906 }, (_, i) => 1906 + i).map((x) => (
                <option key={x} value={x}>{x}（{eraShort(x)}）</option>
              ))}
              <option value="">----</option>
              {Array.from({ length: thisYear - 15 - 1979 }, (_, i) => 1980 + i).map((x) => (
                <option key={x} value={x}>{x}（{eraShort(x)}）</option>
              ))}
            </select>
          </label>
          <label style={{ flex: "0 0 74px", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11.5, color: C.inkSoft, marginBottom: 3 }}>月</span>
            <select value={m || ""} onChange={(e) => setYMD(y || 1950, Number(e.target.value), d || 1)}
              style={{ ...sel, width: "100%" }}>
              <option value="">--</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label style={{ flex: "0 0 74px", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11.5, color: C.inkSoft, marginBottom: 3 }}>日</span>
            <select value={d || ""} onChange={(e) => setYMD(y || 1950, m || 1, Number(e.target.value))}
              style={{ ...sel, width: "100%" }}>
              <option value="">--</option>
              {Array.from({ length: daysIn(y, m) }, (_, i) => i + 1).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        </div>
        {profile.birth && (
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.inkSoft, marginTop: 8, ...NUM }}>
            {wareki(profile.birth)}{age != null ? `　${age} 歳` : ""}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>性別</div>
        <div className="flex flex-wrap gap-2">
          {SEX_OPTS.map(([k, l]) => (
            <button key={k} onClick={() => setProfile({ ...profile, sex: profile.sex === k ? "" : k })}
              style={pill(profile.sex === k)}>{l}</button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>身長</div>
        <NumInput value={profile.height} onChange={(v) => setProfile({ ...profile, height: v })}
          placeholder="--" unit="cm" width={110} step="0.1" />
      </div>

      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>この手帳の番号</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: "0.06em", ...NUM }}>
          {idText(profile.id)}
        </div>
        <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 6 }}>
          はじめて開いたときに自動で決まる番号です。氏名や生年月日とは関係のない数字で、
          受診のたびに同じ人の記録だとわかるようにするために使います。
        </p>
      </div>
    </div>
  );
}

function SetupScreen({ profile, setProfile, onDone }) {
  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "36px 16px 60px" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, letterSpacing: "0.1em" }}>心不全手帳</div>
        <div style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 6, lineHeight: 1.8 }}>
          はじめに、あなたのことを教えてください
        </div>
      </div>

      <Card>
        <ProfileFields profile={profile} setProfile={setProfile} />
        <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 16 }}>
          入力した内容はこの端末の中だけに保存されます。外部に送られることはありません。
          あとから「設定」で変えられます。
        </p>
        <div className="flex gap-2 flex-wrap" style={{ marginTop: 16 }}>
          <Btn onClick={() => onDone()}>はじめる</Btn>
          <Btn filled={false} onClick={() => onDone()}>あとで入力する</Btn>
        </div>
      </Card>
    </div>
  );
}

/* ---------- 書き出し（設定の中） ---------- */
const EXPORT_COLS = [
  { k: "w", label: "体重", head: () => ["体重(kg)"], get: (r) => [r.w || ""] },
  { k: "amBP", label: "朝の血圧", head: () => ["朝収縮期", "朝拡張期"], get: (r) => [r.amS || "", r.amD || ""] },
  { k: "amHR", label: "朝の脈拍", head: () => ["朝脈拍"], get: (r) => [r.amH || ""] },
  { k: "amT", label: "朝の記録時刻", head: () => ["朝記録時刻"], get: (r) => [slotText(r.amT)] },
  { k: "pmBP", label: "夕の血圧", head: () => ["夕収縮期", "夕拡張期"], get: (r) => [r.pmS || "", r.pmD || ""] },
  { k: "pmHR", label: "夕の脈拍", head: () => ["夕脈拍"], get: (r) => [r.pmH || ""] },
  { k: "pmT", label: "夕の記録時刻", head: () => ["夕記録時刻"], get: (r) => [slotText(r.pmT)] },
  { k: "sym", label: "症状", head: () => ["足のむくみ", "息ぐるしさ", "脈の乱れ"], get: (r) => [symCsv(r.edema), symCsv(r.dysp), symCsv(r.palp)] },
  { k: "med", label: "服薬", head: (plan) => planList(plan).map(([, jp]) => `服薬${jp}`), get: (r, plan) => planList(plan).map(([k]) => medCsv(r[k])) },
];
const DEFAULT_COLS = { w: true, amBP: true, amHR: true, amT: false, pmBP: true, pmHR: true, pmT: false, sym: true, med: true };

const emptyExportPrefs = () => ({ range: "4w", from: "", to: "", cols: DEFAULT_COLS, withEmpty: false });

function exportTable(dates, records, plan, cols, withEmpty) {
  const active = EXPORT_COLS.filter((c) => cols[c.k]);
  const head = ["日付", "曜日", ...active.flatMap((c) => c.head(plan))];
  const rows = [];
  for (const d of dates) {
    const r = records[d];
    if (!withEmpty && !hasData(r)) continue;
    rows.push([d, fmtWD(d), ...active.flatMap((c) => c.get(r || emptyRec(), plan))]);
  }
  return { head, rows };
}

function ExportCard({ records, plan, preview, setPreview, prefs, onSavePrefs }) {
  const [range, setRange] = useState(prefs.range || "4w");
  const [from, setFrom] = useState(prefs.from || addDays(todayISO(), -27));
  const [to, setTo] = useState(prefs.to || todayISO());
  const [cols, setCols] = useState({ ...DEFAULT_COLS, ...(prefs.cols || {}) });
  const [withEmpty, setWithEmpty] = useState(!!prefs.withEmpty);
  useEffect(() => { onSavePrefs({ range, from, to, cols, withEmpty }); }, [range, from, to, cols, withEmpty]);

  const dates = useMemo(() => {
    if (range === "all") {
      const ks = Object.keys(records).filter((d) => hasData(records[d])).sort();
      if (!ks.length) return [];
      const n = diffDays(ks[0], ks[ks.length - 1]) + 1;
      return Array.from({ length: n }, (_, i) => addDays(ks[0], i));
    }
    if (range === "custom") {
      const n = Math.max(1, diffDays(from, to) + 1);
      return Array.from({ length: n }, (_, i) => addDays(from, i));
    }
    const w = { "2w": 2, "4w": 4, "8w": 8, "12w": 12 }[range];
    const start = addDays(startOfWeekMon(todayISO()), -7 * (w - 1));
    return Array.from({ length: w * 7 }, (_, i) => addDays(start, i));
  }, [range, from, to, records]);

  const tbl = exportTable(dates, records, plan, cols, withEmpty);
  const pill = (on) => ({
    padding: "9px 14px", borderRadius: 3, fontSize: 13, fontWeight: 700, cursor: "pointer",
    border: `1.5px solid ${on ? C.ink : C.line}`, background: on ? C.ink : "#fff", color: on ? "#fff" : C.inkSoft,
  });

  return (
    <Card title="書き出し" sub="期間と項目を選んで、CSVや印刷に出せます">
      <div style={{ fontSize: 13, fontWeight: 700, color: C.inkSoft, marginBottom: 8 }}>期間</div>
      <div className="flex flex-wrap gap-2" style={{ marginBottom: 10 }}>
        {[["2w", "2週"], ["4w", "4週"], ["8w", "8週"], ["12w", "12週"], ["all", "全期間"], ["custom", "指定"]].map(([k, l]) => (
          <button key={k} onClick={() => setRange(k)} style={pill(range === k)}>{l}</button>
        ))}
      </div>
      {range === "custom" && (
        <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 10 }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            style={{ padding: "8px 10px", border: `1px solid ${C.line}`, borderRadius: 3, fontSize: 14, color: C.ink }} />
          <span style={{ color: C.inkSoft }}>〜</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            style={{ padding: "8px 10px", border: `1px solid ${C.line}`, borderRadius: 3, fontSize: 14, color: C.ink }} />
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: C.inkSoft, margin: "14px 0 8px" }}>項目</div>
      <div className="flex flex-wrap gap-2">
        {EXPORT_COLS.map((c) => (
          <button key={c.k} onClick={() => setCols({ ...cols, [c.k]: !cols[c.k] })} style={pill(cols[c.k])}>
            {cols[c.k] ? "✓ " : ""}{c.label}
          </button>
        ))}
        <button onClick={() => setWithEmpty(!withEmpty)} style={pill(withEmpty)}>
          {withEmpty ? "✓ " : ""}記録のない日も出す
        </button>
      </div>

      <div style={{ fontSize: 13, color: C.ink, margin: "14px 0", ...NUM }}>
        {dates.length ? `${dates[0]} 〜 ${dates[dates.length - 1]}` : "対象の記録がありません"}
        {dates.length ? `（${tbl.rows.length}行）` : ""}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Btn small disabled={!tbl.rows.length}
          onClick={() => downloadCSV(`心不全手帳_${dates[0]}_${dates[dates.length - 1]}.csv`,
            [tbl.head.join(","), ...tbl.rows.map((r) => r.join(","))].join("\r\n"))}>
          CSVで保存
        </Btn>
        <Btn small filled={false} disabled={!tbl.rows.length} onClick={() => setPreview(preview ? null : { tbl, dates })}>
          {preview ? "印刷プレビューを閉じる" : "印刷プレビュー"}
        </Btn>
      </div>
    </Card>
  );
}

function ExportPreview({ data, onClose }) {
  const { tbl, dates } = data;
  const th = { border: `1px solid ${C.line}`, padding: "6px 6px", fontSize: 11.5, fontWeight: 700, background: C.tint, color: C.ink, whiteSpace: "nowrap" };
  const td = { border: `1px solid ${C.line}`, padding: "5px 6px", fontSize: 12, textAlign: "center", color: C.ink, ...NUM };
  return (
    <Card title="印刷プレビュー" sub={`${dates[0]} 〜 ${dates[dates.length - 1]}（${tbl.rows.length}行）`}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{tbl.head.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {tbl.rows.map((r, i) => (
              <tr key={i}>{r.map((v, j) => <td key={j} style={{ ...td, textAlign: j < 2 ? "left" : "center" }}>{v || "—"}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="no-print flex gap-2" style={{ marginTop: 14 }}>
        <Btn small onClick={() => window.print()}>印刷 / PDFで保存</Btn>
        <Btn small filled={false} onClick={onClose}>閉じる</Btn>
      </div>
    </Card>
  );
}

/* ---------- 12.5 ロック（暗証番号＋生体認証） ---------- */

const randBytes = (n) => { const a = new Uint8Array(n); window.crypto.getRandomValues(a); return a; };
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

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

const bioSupported = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
async function bioAvailable() {
  if (!bioSupported()) return false;
  try { return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}
async function bioRegister() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randBytes(32),
      rp: { name: "心不全手帳" },
      user: { id: randBytes(16), name: "patient", displayName: "この端末の利用者" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60000, attestation: "none",
    },
  });
  return toB64(cred.rawId);
}
async function bioVerify(credId) {
  await navigator.credentials.get({
    publicKey: {
      challenge: randBytes(32),
      allowCredentials: credId ? [{ type: "public-key", id: fromB64(credId) }] : [],
      userVerification: "required", timeout: 60000,
    },
  });
  return true;
}

/* 4桁の入力パッド */
function PinPad({ title, sub, onComplete, error, onCancel }) {
  const [pin, setPin] = useState("");
  const push = (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => { onComplete(next); setPin(""); }, 120);
  };
  useEffect(() => { if (error) setPin(""); }, [error]);

  const key = {
    fontSize: 26, fontWeight: 700, padding: "16px 0", borderRadius: 3,
    border: `1.5px solid ${C.line}`, background: "#fff", color: C.ink, cursor: "pointer", ...NUM,
  };
  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 4 }}>{sub}</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 14, margin: "16px 0 20px" }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{
            width: 16, height: 16, borderRadius: 99,
            background: i < pin.length ? C.evening : "transparent",
            border: `2px solid ${i < pin.length ? C.evening : C.line}`,
          }} />
        ))}
      </div>
      {error && <p style={{ textAlign: "center", color: C.alert, fontSize: 13.5, fontWeight: 700, margin: "0 0 12px" }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, maxWidth: 300, margin: "0 auto" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} style={key} onClick={() => push(String(d))}>{d}</button>
        ))}
        <button style={{ ...key, border: "none", background: "transparent", fontSize: 13, color: C.inkSoft }}
          onClick={onCancel}>{onCancel ? "やめる" : ""}</button>
        <button style={key} onClick={() => push("0")}>0</button>
        <button style={{ ...key, fontSize: 14, color: C.inkSoft }} onClick={() => setPin(pin.slice(0, -1))}>けす</button>
      </div>
    </div>
  );
}

/* ロック画面 */
function LockScreen({ security, onUnlock, onWipe }) {
  const [error, setError] = useState("");
  const [bioMsg, setBioMsg] = useState("");
  const [forgot, setForgot] = useState(0);
  const tried = useRef(false);

  const runBio = useCallback(async () => {
    if (!security.bio) return;
    setBioMsg("");
    try { await bioVerify(security.credId); onUnlock(); }
    catch { setBioMsg("認証できませんでした。暗証番号で開いてください"); }
  }, [security, onUnlock]);

  useEffect(() => {
    if (security.bio && !tried.current) { tried.current = true; runBio(); }
  }, [security.bio, runBio]);

  const check = async (pin) => {
    const h = await hashPin(pin, security.salt);
    if (h === security.hash) onUnlock();
    else setError("暗証番号が違います");
  };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "40px 18px 60px" }}>
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, letterSpacing: "0.1em" }}>心不全手帳</div>
        <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 4 }}>ロックを解除してください</div>
      </div>

      <Card>
        {security.bio && (
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <Btn onClick={runBio}>Face ID・指紋で開く</Btn>
            {bioMsg && <p style={{ fontSize: 12.5, color: C.morning, fontWeight: 700, marginTop: 10 }}>{bioMsg}</p>}
          </div>
        )}
        <PinPad title="暗証番号" sub="4桁を入力してください" onComplete={check} error={error} />
      </Card>

      <div style={{ textAlign: "center", marginTop: 18 }}>
        {forgot === 0 && (
          <button onClick={() => setForgot(1)}
            style={{ border: "none", background: "none", color: C.inkSoft, fontSize: 12.5, cursor: "pointer", textDecoration: "underline" }}>
            暗証番号を忘れたとき
          </button>
        )}
        {forgot === 1 && (
          <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.9 }}>
            <p style={{ margin: "0 0 10px" }}>
              記録はこの端末の中だけに保存されているため、暗証番号を元に戻す方法はありません。
              続けるには、これまでの記録をすべて消して最初から始めることになります。
            </p>
            <div className="flex gap-2 justify-center">
              <Btn small filled={false} onClick={() => setForgot(0)}>やめる</Btn>
              <Btn small tone={C.alert} onClick={() => setForgot(2)}>消して初期化する</Btn>
            </div>
          </div>
        )}
        {forgot === 2 && (
          <div className="flex gap-2 justify-center items-center flex-wrap">
            <span style={{ fontSize: 13, fontWeight: 700, color: C.alert }}>本当に消しますか？</span>
            <Btn small filled={false} onClick={() => setForgot(0)}>やめる</Btn>
            <Btn small tone={C.alert} onClick={onWipe}>消す</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

/* 設定カード（目標タブ内） */
function SecurityCard({ security, setSecurity }) {
  const [mode, setMode] = useState(null);   // set1 / set2 / off / chg
  const [first, setFirst] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [canBio, setCanBio] = useState(false);

  useEffect(() => { bioAvailable().then(setCanBio); }, []);

  const savePin = async (pin) => {
    const salt = toB64(randBytes(8));
    setSecurity({ ...security, enabled: true, salt, hash: await hashPin(pin, salt) });
    setMode(null); setFirst(""); setError(""); setMsg("ロックを設定しました");
  };
  const verify = async (pin) => {
    const h = await hashPin(pin, security.salt);
    if (h !== security.hash) { setError("暗証番号が違います"); return false; }
    setError(""); return true;
  };

  const registerBio = async () => {
    setMsg(""); setError("");
    try {
      const credId = await bioRegister();
      setSecurity({ ...security, bio: true, credId });
      setMsg("この端末の生体認証を登録しました");
    } catch {
      setError("この端末では登録できませんでした");
    }
  };

  return (
    <Card title="ロック" sub="開くときに暗証番号を求めるかどうかを選べます">
      {mode === null && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <span style={{ fontSize: 15, fontWeight: 700, flex: 1, minWidth: 180 }}>
              開くときにロックする
              <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: C.inkSoft, marginTop: 2 }}>
                {security.enabled ? "設定されています" : "いまはロックなしで開きます"}
              </span>
            </span>
            {security.enabled
              ? <Btn small filled={false} onClick={() => { setMode("off"); setError(""); setMsg(""); }}>ロックをやめる</Btn>
              : <Btn small tone={C.evening} onClick={() => { setMode("set1"); setError(""); setMsg(""); }}>暗証番号を決める</Btn>}
          </div>

          {security.enabled && (
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 14, paddingTop: 14 }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span style={{ fontSize: 15, fontWeight: 700, flex: 1, minWidth: 180 }}>
                  Face ID・指紋で開く
                  <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: C.inkSoft, marginTop: 2 }}>
                    {security.bio ? "登録済み。失敗したときは暗証番号で開けます"
                      : canBio ? "登録すると、暗証番号を入れずに開けます"
                        : "この端末では使えません"}
                  </span>
                </span>
                {security.bio
                  ? <Btn small filled={false} onClick={() => setSecurity({ ...security, bio: false, credId: "" })}>登録を消す</Btn>
                  : <Btn small filled={false} tone={C.evening} disabled={!canBio} onClick={registerBio}>登録する</Btn>}
              </div>
              <div style={{ marginTop: 14 }}>
                <Btn small filled={false} onClick={() => { setMode("chg"); setError(""); setMsg(""); }}>暗証番号を変える</Btn>
              </div>
            </div>
          )}

          {msg && <p style={{ fontSize: 12.5, color: C.good, fontWeight: 700, marginTop: 12 }}>{msg}</p>}
          {error && <p style={{ fontSize: 12.5, color: C.alert, fontWeight: 700, marginTop: 12 }}>{error}</p>}

          <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 14 }}>
            暗証番号を忘れると記録を元に戻す方法がありません。ご家族と共有できる番号にしておくか、控えを残しておいてください。
          </p>
        </>
      )}

      {mode === "set1" && (
        <PinPad title="暗証番号を決める" sub="4桁の数字を入力してください" error={error}
          onComplete={(p) => { setFirst(p); setError(""); setMode("set2"); }}
          onCancel={() => { setMode(null); setError(""); }} />
      )}
      {mode === "set2" && (
        <PinPad title="もう一度入力" sub="確認のため同じ番号を入力してください" error={error}
          onComplete={(p) => { if (p === first) savePin(p); else { setError("番号が一致しません"); setMode("set1"); } }}
          onCancel={() => { setMode(null); setFirst(""); setError(""); }} />
      )}
      {mode === "off" && (
        <PinPad title="ロックをやめる" sub="いまの暗証番号を入力してください" error={error}
          onComplete={async (p) => {
            if (await verify(p)) { setSecurity(emptySecurity()); setMode(null); setMsg("ロックを解除しました"); }
          }}
          onCancel={() => { setMode(null); setError(""); }} />
      )}
      {mode === "chg" && (
        <PinPad title="いまの暗証番号" sub="確認のため入力してください" error={error}
          onComplete={async (p) => { if (await verify(p)) { setMode("set1"); setFirst(""); } }}
          onCancel={() => { setMode(null); setError(""); }} />
      )}
    </Card>
  );
}

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
              style={{ width: "100%", borderRadius: 3, border: `1px solid ${C.line}`, background: "#000", display: "block" }} />
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

/* ---------- 13. 医療者モード ---------- */
function ClinicianView() {
  const [chunks, setChunks] = useState({});
  const [meta, setMeta] = useState(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [cam, setCam] = useState(false);

  const accept = useCallback((raw) => {
    const res = decodeChunk(raw);
    if (res.error) { setError(res.error); return; }
    setError("");
    setMeta({
      startDate: res.startDate, days: res.days, targets: res.targets, total: res.total,
      learned: res.learned || {}, medPlan: res.medPlan, demo: res.demo, aid: res.aid, fmt: res.fmt, build: res.build, hasLearn: res.hasLearn,
    });
    setChunks((prev) => ({ ...prev, [res.idx]: res.records }));
    setInput("");
  }, []);

  const merged = useMemo(() => Object.assign({}, ...Object.values(chunks)), [chunks]);
  const dates = useMemo(
    () => (meta ? Array.from({ length: meta.days }, (_, i) => addDays(meta.startDate, i)) : []),
    [meta]
  );
  const sum = useMemo(() => (meta ? summarize(dates, merged, meta.medPlan) : null), [dates, merged, meta]);
  const signs = useMemo(() => (meta ? checkSigns(merged, meta.targets, dates[dates.length - 1], meta.medPlan) : []), [merged, meta, dates]);
  const got = Object.keys(chunks).length;

  const weeks = [];
  if (dates.length) {
    let cur = startOfWeekMon(dates[0]);
    const last = dates[dates.length - 1];
    while (cur <= last) { weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i))); cur = addDays(cur, 7); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="読み取り" sub="カメラ、バーコードリーダー、コードの貼り付けのいずれかで読めます">
        <div className="flex gap-2 flex-wrap">
          <input autoFocus value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") accept(input); }}
            placeholder="ここにフォーカスしてスキャン"
            style={{ flex: 1, minWidth: 240, padding: "12px 14px", fontSize: 14, border: `1.5px solid ${C.ink}`, borderRadius: 3, color: C.ink }} />
          <Btn onClick={() => accept(input)}>読み込む</Btn>
          <Btn filled={cam} tone={C.evening} onClick={() => setCam(!cam)}>
            {cam ? "カメラを閉じる" : "カメラで読み取る"}
          </Btn>
          <Btn filled={false} onClick={() => { setChunks({}); setMeta(null); setError(""); }}>クリア</Btn>
        </div>
        {cam && <CameraScanner onCode={(v) => accept(v)} onClose={() => setCam(false)} />}
        {error && <p style={{ color: C.alert, fontSize: 13, marginTop: 10, fontWeight: 700 }}>{error}</p>}
        {meta && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 13, color: got >= meta.total ? C.good : C.morning, fontWeight: 700, ...NUM, margin: 0 }}>
              {got} / {meta.total} 枚 読み取り済み{got < meta.total ? "（残りのQRも読み取ってください）" : ""}
            </p>
            <p style={{ fontSize: 12, color: C.inkSoft, margin: "6px 0 0", ...NUM }}>
              QR形式 v{meta.fmt}
              {meta.build != null && `・患者アプリ ${(meta.build / 100).toFixed(2)}`}
              {"・医療者アプリ " + APP_VERSION}
            </p>
            {(meta.build == null || meta.build < APP_BUILD) && (
              <p style={{ fontSize: 12.5, color: C.morning, fontWeight: 700, margin: "6px 0 0" }}>
                患者さんの端末は旧版です。{!meta.hasLearn && "学習状況は含まれていません。"}アプリを開き直すよう案内してください。
              </p>
            )}
          </div>
        )}
      </Card>

      {!meta && (
        <Card>
          <p style={{ fontSize: 14, color: C.inkSoft, lineHeight: 1.9 }}>
            患者さんの端末に表示されたQRを読み取ると、期間の集計・グラフ・手帳形式の一覧がここに出ます。
            そのまま印刷してカルテに残せます。
          </p>
        </Card>
      )}

      {meta && sum && (
        <div id="hf-print-area" className="flex flex-col gap-4">
          <Card title="サマリー" sub={`${meta.startDate} 〜 ${dates[dates.length - 1]}（${meta.days}日間・記録 ${sum.recorded}日）`}>
            {meta.demo && (meta.demo.age != null || meta.demo.sex) && (
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 12, ...NUM }}>
                {meta.demo.age != null ? `${meta.demo.age} 歳` : "年齢 —"}
                {meta.demo.sex ? `・${SEX_TEXT[meta.demo.sex]}` : ""}
                {meta.aid ? `　手帳番号 ${idText(meta.aid)}` : ""}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Stat label="体重 平均" value={sum.wAvg ? sum.wAvg.toFixed(1) : null} unit="kg" />
              <Stat label="体重 最小〜最大" value={sum.wMin != null ? `${sum.wMin.toFixed(1)}–${sum.wMax.toFixed(1)}` : null} unit="kg" />
              <Stat label="3日以内 最大増加" value={sum.maxGain ? sum.maxGain.toFixed(1) : "0.0"} unit="kg" tone={sum.maxGain >= 2 ? C.alert : C.ink} />
              <Stat label="朝収縮期 平均" value={sum.sysAvg ? Math.round(sum.sysAvg) : null} unit="mmHg" />
              <Stat label="服薬達成" value={sum.adherence != null ? Math.round(sum.adherence) : null} unit="%" tone={sum.adherence != null && sum.adherence < 80 ? C.alert : C.good} />
              <Stat label="むくみ" value={sum.edemaDays} unit="日" tone={sum.edemaDays ? C.alert : C.ink} />
              <Stat label="息切れ" value={sum.dyspDays} unit="日" tone={sum.dyspDays ? C.alert : C.ink} />
              <Stat label="脈の乱れ" value={sum.palpDays} unit="日" tone={sum.palpDays ? C.alert : C.ink} />
            </div>
            {(meta.targets.weight || meta.targets.sys) && (
              <p style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 12, ...NUM }}>
                目標：体重 {meta.targets.weight || "—"} kg（受診の目安 {alertWeight(meta.targets) != null ? alertWeight(meta.targets).toFixed(1) : "—"} kg以上）／脈拍 {meta.targets.hr || "—"} 回/分以下／血圧 {meta.targets.sys || "—"} mmHg以下／水分 {meta.targets.fluid || "—"} mL以下
              </p>
            )}
          </Card>

          <SignPanel signs={signs} />

          <div className="no-print">
          {meta.hasLearn && <Card title="指導・学習の状況" sub={`しおり ${TOPICS.filter((t) => meta.learned[t.id]).length} / ${TOPICS.length} 項目`}>
            <div className="flex flex-col gap-3">
              {CHAPTERS.map((ch, ci) => {
                const list = TOPICS.filter((t) => t.ch === ci);
                const n = list.filter((t) => meta.learned[t.id]).length;
                return (
                  <div key={ci}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 5, ...NUM }}>
                      第{ci + 1}章 {ch}（{n}/{list.length}）
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((t) => (
                        <span key={t.id} style={{
                          fontSize: 12, padding: "4px 9px", borderRadius: 3,
                          border: `1px solid ${meta.learned[t.id] ? C.good : C.line}`,
                          background: meta.learned[t.id] ? C.tint : "#fff",
                          color: meta.learned[t.id] ? C.good : C.inkSoft,
                          fontWeight: meta.learned[t.id] ? 700 : 400,
                        }}>{t.title}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 12, color: C.inkSoft, marginTop: 12 }}>色の付いていない項目が、まだ説明できていないところです。</p>
          </Card>}
          </div>

          <Card title="推移"><Charts dates={dates} records={merged} targets={meta.targets} /></Card>

          <Card title="過去の記録">
            <div className="flex flex-col gap-5">
              {weeks.map((w, i) => (
                <div key={i}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginBottom: 5, ...NUM }}>
                    {fmtMD(w[0])} 〜 {fmtMD(w[6])}
                  </div>
                  <WeekGrid dates={w} records={merged} plan={meta.medPlan} />
                </div>
              ))}
            </div>
          </Card>

          <div className="no-print flex gap-2 justify-end flex-wrap">
            <Btn filled={false} onClick={() => {
              const ok = downloadCSV(`心不全手帳_${meta.startDate}_${dates[dates.length - 1]}.csv`, buildCSV(dates, merged));
              if (!ok) setError("CSVを保存できませんでした");
            }}>記録をCSVで保存</Btn>
            <Btn filled={false} onClick={() => {
              const ok = downloadCSV(`心不全手帳_学習状況_${dates[dates.length - 1]}.csv`, buildLearnCSV(meta.learned));
              if (!ok) setError("CSVを保存できませんでした");
            }}>学習状況をCSVで保存</Btn>
            <Btn onClick={() => window.print()}>印刷 / PDFで保存</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- 教材の表示 ---------- */
function Blocks({ blocks }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === "p")
          return <p key={i} style={{ fontSize: 15, lineHeight: 1.95, color: C.ink, margin: "0 0 14px" }}>{b.v}</p>;
        if (b.t === "list")
          return (
            <div key={i} style={{ margin: "0 0 14px" }}>
              {b.title && <div style={{ fontSize: 13.5, fontWeight: 700, color: C.inkSoft, marginBottom: 6 }}>{b.title}</div>}
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 15, lineHeight: 1.95, color: C.ink }}>
                {b.v.map((x, j) => <li key={j}>{x}</li>)}
              </ul>
            </div>
          );
        if (b.t === "kv")
          return (
            <div key={i} style={{ margin: "0 0 14px" }}>
              {b.title && <div style={{ fontSize: 13.5, fontWeight: 700, color: C.inkSoft, marginBottom: 6 }}>{b.title}</div>}
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <tbody>
                  {b.v.map(([k, v], j) => (
                    <tr key={j}>
                      <th style={{ border: `1px solid ${C.line}`, padding: "8px 10px", fontSize: 13.5, fontWeight: 700, textAlign: "left", background: C.tint, color: C.ink, width: "42%" }}>{k}</th>
                      <td style={{ border: `1px solid ${C.line}`, padding: "8px 10px", fontSize: 13.5, lineHeight: 1.8, color: C.ink }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        const warn = b.t === "warn";
        return (
          <div key={i} style={{
            background: warn ? C.alertBg : C.tint, borderLeft: `4px solid ${warn ? C.alert : C.good}`,
            borderRadius: 3, padding: "12px 14px", fontSize: 14.5, lineHeight: 1.9, margin: "0 0 14px",
            color: warn ? C.alert : C.ink, fontWeight: warn ? 700 : 400,
          }}>{b.v}</div>
        );
      })}
    </>
  );
}

function LearnView({ learned, setLearned, chapter, goRecord }) {
  const list = TOPICS.filter((t) => t.ch === chapter);
  const done = list.filter((t) => learned[t.id]).length;
  const allDone = TOPICS.filter((t) => learned[t.id]).length;
  const pct = Math.round((allDone / TOPICS.length) * 100);
  const toggle = (id) => {
    const next = { ...learned };
    if (next[id]) delete next[id]; else next[id] = todayISO();
    setLearned(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div style={{ fontSize: 12.5, color: C.inkSoft, letterSpacing: "0.1em", marginBottom: 4 }}>
          第{chapter + 1}章
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: "0 0 14px" }}>{CHAPTERS[chapter]}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, height: 8, background: C.line, borderRadius: 99, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: C.good, transition: "width .3s" }} />
          </div>
          <div style={{ fontSize: 13, color: C.inkSoft, ...NUM }}>
            この章 {done}/{list.length}・全体 {allDone}/{TOPICS.length}
          </div>
        </div>
      </Card>

      {list.map((t, i) => {
        const mark = learned[t.id];
        return (
          <Card key={t.id} style={{ borderColor: mark ? C.good : C.line }}>
            <header style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
              <span style={{
                fontSize: 12, fontWeight: 800, color: "#fff", background: C.evening,
                padding: "3px 7px", borderRadius: 2, ...NUM,
              }}>{chapter + 1}-{i + 1}</span>
              <h3 style={{ fontSize: 19, fontWeight: 800, color: C.ink, margin: 0, lineHeight: 1.5, flex: 1 }}>{t.title}</h3>
            </header>

            <Blocks blocks={t.body} />

            <div className="flex gap-2 flex-wrap items-center" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14, marginTop: 4 }}>
              <Btn small filled={!mark} tone={mark ? C.inkSoft : C.good} onClick={() => toggle(t.id)}>
                {mark ? "チェックを外す" : "読んだ・説明を受けた"}
              </Btn>
              {mark && <span style={{ fontSize: 12.5, color: C.good, fontWeight: 700, ...NUM }}>{mark}</span>}
              {(t.id === "t05" || t.id === "t10" || t.id === "t11") && (
                <Btn small filled={false} onClick={goRecord}>きょうの記録へ</Btn>
              )}
            </div>
          </Card>
        );
      })}

      <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, padding: "0 4px" }}>
        内容は日本循環器学会「急性・慢性心不全診療ガイドライン」および日本心不全学会の患者向け資材にもとづいて構成しています。
        実際の指示は主治医の説明が優先されます。
      </p>
    </div>
  );
}

/* ---------- 14. デモデータ ---------- */
function demoRecords() {
  const out = {};
  let w = 62.0;
  for (let i = 44; i >= 0; i--) {
    const d = addDays(todayISO(), -i);
    if (i % 9 === 5) continue; // 記録忘れの日
    const late = i < 8;
    w += late ? 0.35 : (Math.random() - 0.48) * 0.3;
    out[d] = {
      w: w.toFixed(1),
      amS: String(112 + Math.round(Math.random() * 16)), amD: String(64 + Math.round(Math.random() * 10)),
      amH: String(64 + Math.round(Math.random() * 12)),
      pmS: String(108 + Math.round(Math.random() * 16)), pmD: String(62 + Math.round(Math.random() * 10)),
      pmH: String(66 + Math.round(Math.random() * 12)),
      edema: late && i < 4 ? 2 : 1, dysp: late && i < 3 ? 2 : 1, palp: 1,
      mA: 1, mN: i % 11 === 0 ? 2 : 1, mP: 1, mB: 0,
      amT: String(26 + (i % 4)).padStart(2, "0"), pmT: String(82 + (i % 3)).padStart(2, "0"),
    };
  }
  return out;
}


/* ---------- 受付端末モード ---------- */
function KioskView({ onExit }) {
  const [chunks, setChunks] = useState({});
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState("");
  const [phase, setPhase] = useState("wait");
  const inputRef = useRef(null);
  const idleRef = useRef(null);

  const reset = useCallback(() => {
    setChunks({}); setMeta(null); setErr(""); setPhase("wait");
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
    setMeta({ startDate: res.startDate, days: res.days, targets: res.targets, total: res.total,
      medPlan: res.medPlan, learned: res.learned || {}, demo: res.demo, aid: res.aid });
    setChunks((prev) => ({ ...prev, [res.idx]: res.records }));
    touch();
  }, [touch]);

  const merged = useMemo(() => Object.assign({}, ...Object.values(chunks)), [chunks]);
  const dates = useMemo(() => (meta ? Array.from({ length: meta.days }, (_, i) => addDays(meta.startDate, i)) : []), [meta]);
  const sum = useMemo(() => (meta ? summarize(dates, merged, meta.medPlan) : null), [dates, merged, meta]);
  const signs = useMemo(() => (meta ? checkSigns(merged, meta.targets, dates[dates.length - 1], meta.medPlan) : []), [merged, meta, dates]);
  const got = Object.keys(chunks).length;

  useEffect(() => {
    if (!meta || got < meta.total || phase !== "wait") return;
    setPhase("ready");
    const t1 = setTimeout(() => {
      try { window.print(); } catch { /* 手動印刷 */ }
      setPhase("printed");
    }, 700);
    return () => clearTimeout(t1);
  }, [meta, got, phase]);

  useEffect(() => {
    if (phase !== "printed") return;
    const t = setTimeout(reset, 10000);
    return () => clearTimeout(t);
  }, [phase, reset]);

  useEffect(() => { touch(); return () => { if (idleRef.current) clearTimeout(idleRef.current); }; }, [touch]);

  const weeks = [];
  if (dates.length) {
    let cur = startOfWeekMon(dates[0]);
    const last = dates[dates.length - 1];
    while (cur <= last) { weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i))); cur = addDays(cur, 7); }
  }
  const big = { fontSize: 30, fontWeight: 800, color: C.ink, lineHeight: 1.5 };

  return (
    <div style={{ minHeight: "100vh", background: C.paper }}>
      <div className="no-print" style={{ maxWidth: 720, margin: "0 auto", padding: "28px 18px 40px" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.inkSoft, letterSpacing: "0.14em" }}>受付端末</div>
        </div>

        {phase === "printed" ? (
          <Card style={{ borderColor: C.good, borderLeft: `6px solid ${C.good}` }}>
            <div style={{ ...big, color: C.good, textAlign: "center" }}>用紙をお取りください</div>
            <p style={{ fontSize: 16, color: C.inkSoft, textAlign: "center", marginTop: 12 }}>まもなく最初の画面に戻ります</p>
            <div className="flex justify-center" style={{ marginTop: 16 }}><Btn onClick={reset}>次の方へ</Btn></div>
          </Card>
        ) : phase === "ready" ? (
          <Card style={{ borderColor: C.evening, borderLeft: `6px solid ${C.evening}` }}>
            <div style={{ ...big, textAlign: "center" }}>印刷しています…</div>
          </Card>
        ) : (
          <>
            <Card style={{ borderLeft: `6px solid ${C.evening}` }}>
              <div style={{ ...big, textAlign: "center" }}>受診用QRコードを<br />かざしてください</div>
              <p style={{ fontSize: 15, color: C.inkSoft, textAlign: "center", marginTop: 14, lineHeight: 1.8 }}>
                スマートフォンの画面を、下のカメラに向けてください
              </p>
              {meta && (
                <div style={{ textAlign: "center", marginTop: 16 }}>
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

            <div style={{ marginTop: 16 }}>
              <CameraScanner onCode={accept} onClose={() => {}} />
            </div>

            <input ref={inputRef} autoFocus
              onBlur={(e) => setTimeout(() => e.target && e.target.focus(), 100)}
              onKeyDown={(e) => { if (e.key === "Enter") { accept(e.currentTarget.value); e.currentTarget.value = ""; } }}
              style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />

            {onExit && (
              <div className="flex justify-center" style={{ marginTop: 28 }}>
                <Btn small filled={false} tone={C.inkSoft} onClick={onExit}>受付端末モードを終了</Btn>
              </div>
            )}
          </>
        )}
      </div>

      {meta && sum && (
        <div style={{ display: "none" }} className="kiosk-print">
          <div style={{ padding: "0 0 8px", borderBottom: `2px solid ${C.ink}`, marginBottom: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.ink }}>心不全手帳　受診用記録</div>
            <div style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 4, ...NUM }}>
              {meta.startDate} 〜 {dates[dates.length - 1]}（{meta.days}日間・記録 {sum.recorded}日）
              {meta.demo && meta.demo.age != null ? `　${meta.demo.age}歳` : ""}
              {meta.demo && meta.demo.sex ? `・${SEX_TEXT[meta.demo.sex]}` : ""}
              {meta.aid ? `　手帳番号 ${idText(meta.aid)}` : ""}
            </div>
          </div>

          <div className="flex flex-wrap gap-2" style={{ marginBottom: 12 }}>
            {[["体重 平均", sum.wAvg ? sum.wAvg.toFixed(1) : "—", "kg"],
              ["体重 最小〜最大", sum.wMin != null ? `${sum.wMin.toFixed(1)}–${sum.wMax.toFixed(1)}` : "—", "kg"],
              ["3日以内 最大増加", sum.maxGain ? sum.maxGain.toFixed(1) : "0.0", "kg"],
              ["朝収縮期 平均", sum.sysAvg ? Math.round(sum.sysAvg) : "—", "mmHg"],
              ["服薬 達成", sum.adherence != null ? Math.round(sum.adherence) : "—", "%"],
              ["むくみ／息切れ", `${sum.edemaDays}／${sum.dyspDays}`, "日"]].map(([l, v, u]) => (
              <div key={l} style={{ border: `1px solid ${C.line}`, padding: "6px 10px", minWidth: 96 }}>
                <div style={{ fontSize: 10, color: C.inkSoft }}>{l}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, ...NUM }}>
                  {v}<span style={{ fontSize: 9, fontWeight: 600, marginLeft: 3, color: C.inkSoft }}>{u}</span>
                </div>
              </div>
            ))}
          </div>

          {signs.length > 0 && (
            <div style={{ border: `1px solid ${C.alert}`, padding: "8px 10px", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.alert, marginBottom: 4 }}>気になるサイン</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.8, color: C.ink }}>
                {signs.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          )}

          <Charts dates={dates} records={merged} targets={meta.targets} />

          <div style={{ marginTop: 12 }}>
            {weeks.map((w, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.inkSoft, marginBottom: 3, ...NUM }}>
                  {fmtMD(w[0])} 〜 {fmtMD(w[6])}
                </div>
                <WeekGrid dates={w} records={merged} plan={meta.medPlan} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- 共通の外枠 ---------- */
const ROOT_STYLE = {
  fontFamily: FONT,
  background: C.paper,
  minHeight: "100vh",
  color: C.ink,
};
function GlobalStyle() {
  return <style>{`
        .hf-root, .hf-root * { font-family: ${FONT}; }
        @media print {
          .no-print { display: none !important; }
          .kiosk-print { display: block !important; }
          body { background: #fff; }
        }
        .wheel::-webkit-scrollbar { display: none; }
        .wheel { scrollbar-width: none; -ms-overflow-style: none; }
        input:focus, button:focus, textarea:focus { outline: 2.5px solid ${C.morning}; outline-offset: 1px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>;
}

/* ---------- 15. ルート ---------- */
export default function App() {
  const [kiosk] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("kiosk") === "1"; } catch { return false; }
  });
  const [kioskByHand, setKioskByHand] = useState(false);
  const [mode, setMode] = useState("patient");
  const [section, setSection] = useState("self");
  const [tab, setTab] = useState("today");
  const [chapter, setChapter] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [records, setRecords] = useState({});
  const [targets, setTargets] = useState(emptyTargets());
  const [visits, setVisits] = useState([]);
  const [learned, setLearned] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const periodOptions = usePeriodOptions(records);
  const [period, setPeriod] = useState(null);
  const shownWeeks = useMemo(() => weeksOf(period || { type: "week", key: periodOptions.weeks[0] }), [period, periodOptions]);
  const [security, setSecurity] = useState(emptySecurity());
  const [medPlan, setMedPlan] = useState(emptyPlan());
  const [exportPreview, setExportPreview] = useState(null);
  const [settingsTab, setSettingsTab] = useState("main");
  const snap = useRef(null);
  const [exportPrefs, setExportPrefs] = useState(emptyExportPrefs());
  const [profile, setProfile] = useState(emptyProfile());
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let alive = true;
    store.load().then((d) => {
      if (!alive) return;
      if (d) { setRecords(d.records); setTargets(d.targets); setVisits(d.visits); setLearned(d.learned); setSecurity(d.security); setMedPlan(d.medPlan); setExportPrefs(d.exportPrefs); setProfile(d.profile); setLocked(!!d.security.enabled); }
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (loaded) store.save({ records, targets, visits, learned, security, medPlan, exportPrefs, profile }); }, [records, targets, visits, learned, security, medPlan, exportPrefs, profile, loaded]);

  const openSettings = () => {
    snap.current = { targets, medPlan, profile, exportPrefs, security };
    setSettingsTab("main"); setSection("settings");
  };
  const closeSettings = (keep) => {
    if (!keep && snap.current) {
      const s0 = snap.current;
      setTargets(s0.targets); setMedPlan(s0.medPlan); setProfile(s0.profile);
      setExportPrefs(s0.exportPrefs); setSecurity(s0.security);
    }
    snap.current = null; setSection("self"); setExportPreview(null);
  };

  const rec = records[date] || emptyRec();
  const update = (r) => setRecords({ ...records, [date]: r });

  const recentDates = useMemo(() => { const m = addDays(startOfWeekMon(todayISO()), -7 * (weeks - 1)); return Array.from({ length: weeks * 7 }, (_, i) => addDays(m, i)); }, [weeks]);
  const signs = useMemo(() => checkSigns(records, targets, todayISO(), medPlan), [records, targets, medPlan]);

  const TABS = [{ k: "today", label: "きょう" }, { k: "record", label: "きろく" }, { k: "target", label: "目標" }, { k: "visit", label: "受診" }];
  const CH_TABS = ["知る", "予防", "検査・治療", "くらし"];

  if (loaded && locked) {
    return (
      <div className="hf-root" style={ROOT_STYLE}>
        <GlobalStyle />
        <LockScreen security={security} onUnlock={() => setLocked(false)}
          onWipe={() => {
            setRecords({}); setVisits([]); setLearned({}); setTargets(emptyTargets());
            setSecurity(emptySecurity()); setLocked(false);
          }} />
      </div>
    );
  }

  if (kiosk || kioskByHand) {
    return (
      <div className="hf-root" style={ROOT_STYLE}>
        <GlobalStyle />
        <KioskView onExit={kioskByHand ? () => setKioskByHand(false) : null} />
      </div>
    );
  }

  if (loaded && !profile.done) {
    return (
      <div className="hf-root" style={ROOT_STYLE}>
        <GlobalStyle />
        <SetupScreen profile={profile} setProfile={setProfile}
          onDone={() => setProfile({ ...profile, done: true })} />
      </div>
    );
  }

  return (
    <div className="hf-root" style={ROOT_STYLE}>
      <GlobalStyle />

      <header className="no-print" style={{ background: "#FFFFFF", color: C.ink, borderBottom: `3px solid #54A9F0`, padding: "16px 18px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "0.1em", color: C.ink }}>心不全手帳</div>
            <div style={{ fontSize: 11.5, letterSpacing: "0.12em", color: C.inkSoft }}>教材と日々の記録</div>
          </div>
          <div className="flex items-center gap-2">
          <div className="flex gap-1" style={{ background: C.tint, borderRadius: 3, padding: 3 }}>
            {[["patient", "患者"], ["clinician", "医療者"]].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)}
                style={{
                  padding: "7px 16px", borderRadius: 3, border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 700,
                  background: mode === k ? C.evening : "transparent",
                  color: mode === k ? "#fff" : C.ink,
                }}>{l}</button>
            ))}
          </div>
          {mode === "patient" && (
            <button onClick={() => (section === "settings" ? closeSettings(true) : openSettings())}
              title="設定"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 3, cursor: "pointer",
                border: `1.5px solid ${section === "settings" ? C.evening : C.line}`,
                background: section === "settings" ? C.evening : C.tint,
                color: section === "settings" ? "#fff" : C.ink,
                fontSize: 13, fontWeight: 700,
              }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>{section === "settings" ? "✕" : "⚙"}</span>
              {section === "settings" ? "閉じる" : "設定等"}
            </button>
          )}
          </div>
        </div>
      </header>

      {mode === "patient" && (
        <nav className="no-print" style={{ position: "sticky", top: 0, zIndex: 5, background: "#fff", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 8, padding: "10px 12px 0" }}>
              {[["learn", "教材"], ["self", "自己管理"]].map(([k, l]) => {
                const on = section === k;
                return (
                  <button key={k} onClick={() => setSection(k)}
                    style={{
                      flex: 1, padding: "13px 8px", cursor: "pointer",
                      borderRadius: "3px 3px 0 0", border: `1px solid ${on ? C.line : "transparent"}`,
                      borderBottom: "none", background: on ? C.card : "transparent",
                      fontSize: 17, fontWeight: 800, letterSpacing: "0.08em",
                      color: on ? C.ink : C.inkSoft,
                      boxShadow: on ? `inset 0 4px 0 ${C.morning}` : "none",
                    }}>{l}</button>
                );
              })}
            </div>
            {section !== "settings" && (
            <div style={{ display: "flex", borderTop: `1px solid ${C.line}`, overflowX: "auto" }}>
              {section === "self"
                ? TABS.map((t) => (
                  <button key={t.k} onClick={() => setTab(t.k)}
                    style={{
                      flex: 1, minWidth: 76, padding: "12px 6px", border: "none", cursor: "pointer",
                      fontSize: 14, fontWeight: 700, whiteSpace: "nowrap",
                      background: tab === t.k ? C.ink : "transparent",
                      color: tab === t.k ? "#fff" : C.inkSoft,
                    }}>{t.label}</button>
                ))
                : CH_TABS.map((l, i) => (
                  <button key={i} onClick={() => setChapter(i)}
                    style={{
                      flex: 1, minWidth: 76, padding: "12px 6px", border: "none", cursor: "pointer",
                      fontSize: 14, fontWeight: 700, whiteSpace: "nowrap",
                      background: chapter === i ? C.ink : "transparent",
                      color: chapter === i ? "#fff" : C.inkSoft,
                    }}>
                    <span style={{ fontSize: 10.5, opacity: 0.75, display: "block", ...NUM }}>第{i + 1}章</span>
                    {l}
                  </button>
                ))}
            </div>
            )}
          </div>
        </nav>
      )}

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "18px 14px 60px" }}>
        {mode === "clinician" ? <ClinicianView /> : section === "learn" ? (
          <LearnView learned={learned} setLearned={setLearned} chapter={chapter}
            goRecord={() => { setSection("self"); setTab("today"); }} />
        ) : section === "settings" && exportPreview ? (
              <div className="flex flex-col gap-4">
                <ExportPreview data={exportPreview} onClose={() => setExportPreview(null)} />
              </div>
        ) : section === "settings" ? (
              <div className="flex flex-col gap-4">
                <div className="no-print" style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 3, overflow: "hidden" }}>
                  {[["main", "設定"], ["other", "その他"]].map(([k, l]) => (
                    <button key={k} onClick={() => setSettingsTab(k)}
                      style={{
                        flex: 1, padding: "11px 4px", border: "none", cursor: "pointer",
                        borderLeft: k === "main" ? "none" : `1px solid ${C.line}`,
                        background: settingsTab === k ? C.ink : "#fff", color: settingsTab === k ? "#fff" : C.inkSoft,
                        fontSize: 14, fontWeight: 700,
                      }}>{l}</button>
                  ))}
                </div>

                {settingsTab === "other" && (
                  <div className="flex flex-col gap-4">
                    <FacilityMap />
                    <Card title="アプリについて">
                      <div style={{ fontSize: 13.5, lineHeight: 2, color: C.ink, ...NUM }}>
                        <div>版　　　　v{APP_VERSION}</div>
                        <div>QRの形式　v{FMT}</div>
                      </div>
                      <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 12 }}>
                        記録はこの端末の中だけに保存され、外部に送られることはありません。
                        新しい版が出たときは、アプリを一度閉じて開き直すと更新されます。
                      </p>
                      <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.9, marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
                        作成　滋賀医科大学医学部附属病院　循環器内科
                      </p>
                      <div className="no-print flex flex-wrap gap-2" style={{ marginTop: 10 }}>
                        {[["附属病院", "https://www.shiga-med.ac.jp/hospital/"],
                          ["循環器内科", "https://www.shiga-med.ac.jp/~hqmed1/"]].map(([l, href]) => (
                          <a key={l} href={href} target="_blank" rel="noopener noreferrer"
                            style={{
                              display: "inline-block", padding: "7px 12px", borderRadius: 3, textDecoration: "none",
                              fontSize: 12.5, fontWeight: 700, border: `1px solid ${C.evening}`,
                              background: "#fff", color: C.evening,
                            }}>{l}</a>
                        ))}
                      </div>
                      <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 12, paddingTop: 12 }}>
                        <Btn small filled={false} tone={C.evening} onClick={() => setKioskByHand(true)}>受付端末モードを試す</Btn>
                        <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 8 }}>
                          外来の受付に置く端末では、URLのうしろに <b>?kiosk=1</b> を付けて開いてください。
                        </p>
                      </div>
                    </Card>
                  </div>
                )}

                {settingsTab === "main" && <>

                <Card title="あなたのこと" sub="あとから変えられます">
                  <ProfileFields profile={profile} setProfile={setProfile} />
                </Card>

                <Card title="お薬を飲む回数" sub="選んだ回数だけ、きょうの画面にチェック欄が出ます">
                  <div className="flex flex-wrap gap-2" style={{ marginBottom: 14 }}>
                    {[["朝のみ", ["mA"]], ["朝夕", ["mA", "mP"]], ["朝昼夕", ["mA", "mN", "mP"]],
                      ["朝夕＋寝る前", ["mA", "mP", "mB"]], ["朝昼夕＋寝る前", ["mA", "mN", "mP", "mB"]]].map(([l, keys]) => (
                      <Btn key={l} small filled={false}
                        onClick={() => setMedPlan({ mA: false, mN: false, mP: false, mB: false, ...Object.fromEntries(keys.map((k) => [k, true])) })}>
                        {l}
                      </Btn>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {MED_SLOTS.map(([k, jp]) => {
                      const on = medPlan[k];
                      return (
                        <button key={k} onClick={() => setMedPlan({ ...medPlan, [k]: !on })}
                          style={{
                            padding: "12px 18px", borderRadius: 3, fontSize: 15, fontWeight: 700, cursor: "pointer",
                            border: `2px solid ${on ? C.evening : C.line}`,
                            background: on ? C.evening : "#fff", color: on ? "#fff" : C.inkSoft,
                          }}>{on ? "✓ " : ""}{jp}</button>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.8, marginTop: 12 }}>
                    個別に押して選ぶこともできます。すべて外すと、お薬の記録欄は表示されません。
                  </p>
                </Card>

                <Card title="データ" sub="記録はこの端末の中だけに保存されます">
                  <div className="flex gap-2 flex-wrap">
                    <Btn small filled={false} onClick={() => { setRecords(demoRecords()); setTargets({ weight: "61.5", hr: "80", sys: "130", fluid: "1200", alertW: "63.5" }); setVisits([addDays(todayISO(), -42), todayISO()]); setLearned(Object.fromEntries(TOPICS.slice(0, 11).map((t) => [t.id, addDays(todayISO(), -40)]))); }}>
                      デモデータを入れる
                    </Btn>
                    {wipe
                      ? <Btn small tone={C.alert} onClick={() => { setRecords({}); setVisits([]); setLearned({}); setWipe(false); }}>本当に消す</Btn>
                      : <Btn small filled={false} tone={C.alert} onClick={() => setWipe(true)}>記録をすべて消す</Btn>}
                    {wipe && <Btn small filled={false} onClick={() => setWipe(false)}>やめる</Btn>}
                  </div>
                </Card>

                <SecurityCard security={security} setSecurity={setSecurity} />

                <ExportCard records={records} plan={medPlan} preview={exportPreview} setPreview={setExportPreview}
                  prefs={exportPrefs} onSavePrefs={setExportPrefs} />

                </>}


                <div className="no-print flex gap-2 flex-wrap">
                  <Btn onClick={() => closeSettings(true)}>設定を保存して記録にもどる</Btn>
                  <Btn filled={false} tone={C.inkSoft} onClick={() => closeSettings(false)}>保存せずにもどる</Btn>
                </div>
              </div>
        ) : (
          <>
            {tab === "today" && (
              <div className="flex flex-col gap-4">
                <SignPanel signs={signs} />
                <TodayView date={date} setDate={setDate} rec={rec} update={update} targets={targets} plan={medPlan} profile={profile} />
              </div>
            )}

            {tab === "record" && (
              <div className="flex flex-col gap-4">
                <FeedbackCard dates={recentDates} records={records} targets={targets} plan={medPlan} />
                <Card title={`この${weeks}週間`}>
                  <WeekTabs value={weeks} onChange={setWeeks} options={[2, 4, 8, 12]} />
                  <SummaryCard dates={recentDates} records={records} targets={targets} plan={medPlan} profile={profile} />
                  <Charts dates={recentDates} records={records} targets={targets} />
                </Card>
                <Card title="過去の記録">
                  <PeriodTabs options={periodOptions} value={period || { type: "week", key: periodOptions.weeks[0] }} onChange={setPeriod} />
                  <div className="flex flex-col gap-5">
                    {shownWeeks.map((w, i) => (
                      <div key={i}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginBottom: 5, ...NUM }}>
                          {fmtMD(w[0])} 〜 {fmtMD(w[6])}
                        </div>
                        <WeekGrid dates={w} records={records} plan={medPlan} />
                      </div>
                    ))}
                  </div>
                </Card>

                <TimeCard weeksList={shownWeeks} records={records} plan={medPlan} />
              </div>
            )}

            {tab === "target" && (
              <div className="flex flex-col gap-4">
                <Card title="今後の目標値" sub="主治医から言われた数字を入れておきます">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-3 flex-wrap">
                      <span style={{ fontSize: 15, fontWeight: 700, width: 130, paddingTop: 12 }}>目標体重</span>
                      <div>
                        <NumInput value={targets.weight} placeholder="--" unit="kg" width={110} step="0.1"
                          onChange={(v) => setTargets({
                            ...targets, weight: v,
                            alertW: targets.alertW || (v ? (Number(v) + 2).toFixed(1) : ""),
                          })} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.alert, marginBottom: 4 }}>受診の目安</div>
                        <NumInput value={targets.alertW} onChange={(v) => setTargets({ ...targets, alertW: v })}
                          placeholder="--" unit="kg 以上" width={110} step="0.1" />
                      </div>
                    </div>
                    <p style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.8, margin: "-6px 0 0" }}>
                      受診の目安は、目標体重を入れると自動で「＋2kg」が入ります。主治医から別の数字を言われている場合は書き換えてください。
                    </p>
                    {[["目標脈拍", "hr", "回/分 以下", "1"], ["目標血圧（上）", "sys", "mmHg 以下", "1"], ["水分制限", "fluid", "mL 以下", "10"]].map(([l, k, u, st]) => (
                      <div key={k} className="flex items-center gap-3">
                        <span style={{ fontSize: 15, fontWeight: 700, width: 130 }}>{l}</span>
                        <NumInput value={targets[k]} onChange={(v) => setTargets({ ...targets, [k]: v })} placeholder="--" unit={u} width={110} step={st} />
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {tab === "visit" && <VisitView visits={visits} setVisits={setVisits} records={records} targets={targets} learned={learned} plan={medPlan} profile={profile} />}
          </>
        )}
        <footer className="no-print" style={{ textAlign: "center", padding: "28px 0 4px", fontSize: 11.5, color: C.inkSoft, ...NUM }}>
          心不全手帳 v{APP_VERSION}
        </footer>
      </main>
    </div>
  );
}
