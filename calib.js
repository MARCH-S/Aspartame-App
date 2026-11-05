// calib.js — คณิตศาสตร์ล้วน ไม่แตะ DOM (ทดสอบด้วย Node ได้)
const EPS = 1e-6;

export const FEATURES = {
  'A_G': (s, b) => -Math.log10((s.g + EPS) / (b.g + EPS)),   // absorbance-like (เขียว)
  'R/G': (s) => s.r / (s.g + EPS),
  'B/G': (s) => s.b / (s.g + EPS),
  'G/(R+G+B)': (s) => s.g / (s.r + s.g + s.b + EPS),
};

/** sRGB 0..255 -> linear 0..1 (ต้องทำก่อนคำนวณ ratio / log) */
export function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** แปลงเป็น linear และหารด้วยแถบขาว (ถ้ามี) เพื่อชดเชยแสงที่เปลี่ยน */
export function normalize(rgb, white = null) {
  const l = { r: srgbToLinear(rgb.r), g: srgbToLinear(rgb.g), b: srgbToLinear(rgb.b) };
  if (!white) return l;
  const w = { r: srgbToLinear(white.r), g: srgbToLinear(white.g), b: srgbToLinear(white.b) };
  return { r: l.r / (w.r + EPS), g: l.g / (w.g + EPS), b: l.b / (w.b + EPS) };
}

export function feature(kind, sampleN, blankN) {
  return FEATURES[kind](sampleN, blankN);
}

/** Least squares polynomial: y = c0 + c1 x + c2 x^2 ... */
export function polyfit(x, y, degree) {
  const n = degree + 1;
  if (x.length !== y.length || x.length < n) return null;
  const a = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a[i][j] = x.reduce((s, v) => s + Math.pow(v, i + j), 0);
    a[i][n] = x.reduce((s, v, k) => s + y[k] * Math.pow(v, i), 0);
  }
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[p][col])) p = r;
    if (Math.abs(a[p][col]) < 1e-12) return null;
    [a[col], a[p]] = [a[p], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

export const poly = (c, x) => c.reduce((s, ci, i) => s + ci * Math.pow(x, i), 0);

/** points: [{conc, value}] -> {coef, r2, rmse, range} หรือ null */
export function fitCalibration(points, degree) {
  const x = points.map((p) => p.value), y = points.map((p) => p.conc);
  const coef = polyfit(x, y, degree);
  if (!coef) return null;
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  const ssRes = x.reduce((s, v, i) => s + (poly(coef, v) - y[i]) ** 2, 0);
  return {
    coef,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    rmse: Math.sqrt(ssRes / Math.max(y.length - degree - 1, 1)),
    range: [Math.min(...y), Math.max(...y)],
  };
}

export function predict(cal, value) {
  const conc = poly(cal.coef, value);
  return { conc, inRange: conc >= cal.range[0] && conc <= cal.range[1] };
}

/** Leave-one-out RMSE (หน่วยเดียวกับความเข้มข้น) */
export function looRMSE(points, degree) {
  if (points.length <= degree + 2) return null;
  let sq = 0;
  for (let i = 0; i < points.length; i++) {
    const rest = points.filter((_, k) => k !== i);
    const c = polyfit(rest.map((p) => p.value), rest.map((p) => p.conc), degree);
    if (!c) return null;
    sq += (poly(c, points[i].value) - points[i].conc) ** 2;
  }
  return Math.sqrt(sq / points.length);
}

/** LOD = 3.3*sd/slope, LOQ = 10*sd/slope (sd จาก blank ซ้ำ >= 7 ครั้ง) */
export function lodLoq(points, blankSD) {
  const c = polyfit(points.map((p) => p.conc), points.map((p) => p.value), 1);
  if (!c || Math.abs(c[1]) < 1e-12) return null;
  return { lod: (3.3 * blankSD) / Math.abs(c[1]), loq: (10 * blankSD) / Math.abs(c[1]) };
}
