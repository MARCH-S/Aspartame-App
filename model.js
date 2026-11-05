// model.js — สมการจากการทดลอง (ไม่แตะ DOM / ทดสอบด้วย Node ได้)
//   y = log(I0 / G)        G = ค่า G จาก RGB (sRGB 0-255 ดิบ ไม่ linearize) ตรงกับที่ใช้ตอนทดลอง
//   y = m·x + b            x = ความเข้มข้น (ppm)  →  x = (y − b) / m

export const DEFAULTS = {
  I0: 189,                 // ค่า G ของ blank จากการทดลอง
  m: 0.4204, um: 0.0090,   // slope ± ความไม่แน่นอน
  b: 0.0227, ub: 0.0030,   // intercept ± ความไม่แน่นอน
  logBase: 10,             // 10 = log10 (ปกติของ absorbance), 'e' = ln
  df: 1,                   // dilution factor (ตัวอย่างเดิม = x · df)
  calMin: 0, calMax: 5,    // ช่วงความเข้มข้นที่สอบเทียบ (ppm) — ตั้งให้ตรงกับการทดลองจริง
  limit: 600,              // เกณฑ์อ้างอิงของตัวอย่าง (ppm) — แก้ตามประเภทอาหาร/กฎหมาย
  nPts: 120, bandPct: 6, patch: 5,
};

export const TIER_BOUNDS = [0, 0.5, 0.8, 1, 1.25];   // สัดส่วนของเกณฑ์อ้างอิง

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const lnBase = (p) => (p.logBase === 'e' ? 1 : Math.LN10);
const logB = (v, p) => (p.logBase === 'e' ? Math.log(v) : Math.log10(v));

/** คำนวณผลทั้งหมดจากค่า G (และ SEM ของ G ถ้ามี) */
export function compute(G, p, semG = 0) {
  const g = Math.max(G, 0.5);                 // กัน log(∞) เมื่อ G = 0
  const y = logB(p.I0 / g, p);
  const x = (y - p.b) / p.m;
  const uy = semG / (g * lnBase(p));          // ความไม่แน่นอนจากการอ่านภาพ (1σ)
  const ux = Math.sqrt(uy ** 2 + p.ub ** 2 + (x * p.um) ** 2) / Math.abs(p.m);
  const xo = x * p.df;                        // ความเข้มข้นในตัวอย่างเดิม
  const lod = (3.3 * p.ub) / Math.abs(p.m);   // ใช้ SE ของ intercept เป็น σ (แนว ICH Q2)
  const loq = (10 * p.ub) / Math.abs(p.m);
  const ratio = p.limit > 0 ? xo / p.limit : 0;
  const t = tier(ratio);
  return {
    y, x, ux, xo, uxo: ux * p.df, lod, loq, ratio,
    tier: t.idx, levelPos: t.pos,
    gaugePos: clamp((x - p.calMin) / ((p.calMax - p.calMin) || 1), 0, 1),
    belowLOD: x < lod, belowLOQ: x < loq,
    outOfRange: x < p.calMin - 1e-9 || x > p.calMax + 1e-9,
  };
}

/** แบ่ง 4 ระดับ: <50% | 50–80% | 80–100% | >100% ของเกณฑ์ (แถบกว้างเท่ากัน) */
export function tier(ratio) {
  const B = TIER_BOUNDS;
  const idx = ratio < B[1] ? 0 : ratio < B[2] ? 1 : ratio < B[3] ? 2 : 3;
  const frac = clamp((ratio - B[idx]) / (B[idx + 1] - B[idx]), 0, 1);
  return { idx, pos: (idx + frac) / 4 };
}

export const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');
