// edge.js — เลือกจุดสุ่มบริเวณขอบภาพ + สถิติแบบทนค่าผิดปกติ (ไม่แตะ DOM)
export const MIN_POINTS = 100;

/**
 * สร้างจุดอย่างน้อย 100 จุดกระจายทั่วแถบขอบของภาพ (3 วงซ้อนกันในแถบ)
 * @param w,h     ขนาดภาพ (px)
 * @param n       จำนวนจุดที่ต้องการ (บังคับขั้นต่ำ 100)
 * @param bandFrac ความกว้างแถบขอบ เป็นสัดส่วนของด้านสั้น (เช่น 0.06 = 6%)
 * @param patch   ขนาดแพตช์ที่จะอ่านรอบแต่ละจุด (px)
 */
export function edgePoints(w, h, n = 120, bandFrac = 0.06, patch = 5) {
  n = Math.max(Math.round(n), MIN_POINTS);
  const band = Math.max(bandFrac * Math.min(w, h), patch + 2);
  const rings = 3;
  const perRing = Math.ceil(n / rings);
  const pts = [];
  for (let k = 0; k < rings; k++) {
    const inset = (band * (2 * k + 1)) / (2 * rings);
    const rw = w - 2 * inset, rh = h - 2 * inset;
    if (rw <= 0 || rh <= 0) continue;
    const per = 2 * (rw + rh);
    for (let i = 0; i < perRing; i++) {
      const s = ((i + k / rings) * per) / perRing;   // เลื่อนเฟสแต่ละวงไม่ให้จุดเรียงตรงกัน
      let x, y;
      if (s < rw) { x = inset + s; y = inset; }
      else if (s < rw + rh) { x = inset + rw; y = inset + (s - rw); }
      else if (s < 2 * rw + rh) { x = inset + rw - (s - rw - rh); y = inset + rh; }
      else { x = inset; y = inset + rh - (s - 2 * rw - rh); }
      pts.push({ x: Math.round(x), y: Math.round(y) });
    }
  }
  return pts;
}

export function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(a.length - 1, 1)); };

/**
 * samples: [{r,g,b}] ค่า sRGB 0..255 ของแต่ละจุด
 * ตัดจุดที่ความสว่างผิดปกติ (แสงสะท้อน เงา สิ่งแปลกปลอม) ด้วย MAD แล้วหาค่า median ของจุดที่เหลือ
 */
export function robustRGB(samples, k = 3, floor = 4) {
  const Y = samples.map((p) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b);
  const my = median(Y);
  const mad = median(Y.map((v) => Math.abs(v - my))) * 1.4826;
  const thr = Math.max(k * mad, floor);
  const mask = Y.map((v) => Math.abs(v - my) <= thr);
  const keep = samples.filter((_, i) => mask[i]);
  const use = keep.length ? keep : samples;
  const rgb = { r: median(use.map((p) => p.r)), g: median(use.map((p) => p.g)), b: median(use.map((p) => p.b)) };
  const gs = use.map((p) => p.g);
  return {
    rgb,
    mask,
    nRead: samples.length,
    nUsed: use.length,
    sd: { r: sd(use.map((p) => p.r)), g: sd(gs), b: sd(use.map((p) => p.b)) },
    cvG: (sd(gs) / (mean(gs) || 1)) * 100,
  };
}
