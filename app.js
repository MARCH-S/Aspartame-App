import { DEFAULTS, TIER_BOUNDS, compute, fmt } from './model.js';
import { edgePoints, robustRGB, MIN_POINTS } from './edge.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const trim = (v, d = 2) => String(+v.toFixed(d));

// ---------- storage ----------
const store = {
  load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
let settings = { ...DEFAULTS, ...store.load('asp-settings', {}) };
let history = store.load('asp-history', []);
let current = null;           // ผลวิเคราะห์ภาพล่าสุด
let activeView = 'home';

let toastTimer;
function toast(t) {
  $('toast').textContent = t;
  clearTimeout(toastTimer);
  if (t) toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 5000);
}

// ---------- image → edge points → RGB ----------
const view = $('view'), vctx = view.getContext('2d');
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });
const MAX_SIDE = 3000;

function loadFile(f) {
  if (!f) return;
  const url = URL.createObjectURL(f);
  const im = new Image();
  im.onload = () => {
    const s = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
    work.width = Math.round(im.naturalWidth * s);
    work.height = Math.round(im.naturalHeight * s);
    wctx.drawImage(im, 0, 0, work.width, work.height);
    URL.revokeObjectURL(url);
    document.body.classList.add('has-image');
    analyze(f.name, true);
  };
  im.onerror = () => toast('เปิดไฟล์ภาพนี้ไม่ได้ (ลองแปลงเป็น JPG/PNG)');
  im.src = url;
}

function readPatch(cx, cy, p) {
  const half = p >> 1;
  const sx = Math.min(Math.max(cx - half, 0), work.width - p);
  const sy = Math.min(Math.max(cy - half, 0), work.height - p);
  const d = wctx.getImageData(sx, sy, p, p).data;
  let r = 0, g = 0, b = 0;
  const n = p * p;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  return { r: r / n, g: g / n, b: b / n };
}

function analyze(name, isNew) {
  if (!work.width) return;
  const n = Math.max(MIN_POINTS, Math.round(settings.nPts) || MIN_POINTS);
  const patch = Math.min(Math.max(1, Math.round(settings.patch) || 5), work.width, work.height);
  const pts = edgePoints(work.width, work.height, n, (settings.bandPct || 6) / 100, patch);
  const rb = robustRGB(pts.map((p) => readPatch(p.x, p.y, patch)));
  current = { name: name ?? current?.name ?? '', t: isNew ? Date.now() : current?.t ?? Date.now(), pts, mask: rb.mask,
              rgb: rb.rgb, nRead: rb.nRead, nUsed: rb.nUsed, cvG: rb.cvG, semG: rb.sd.g / Math.sqrt(rb.nUsed) };
  drawView();
  if (isNew) {
    const r = compute(current.rgb.g, settings, current.semG);
    history.push({ t: current.t, name: current.name, r: current.rgb.r, g: current.rgb.g, b: current.rgb.b, y: r.y, x: r.x, ux: r.ux,
                   xo: r.xo, tier: r.tier, nUsed: current.nUsed, nRead: current.nRead, cvG: current.cvG });
    if (history.length > 500) history = history.slice(-500);
    store.save('asp-history', history);
    toast('บันทึกผลลงประวัติแล้ว');
  }
  render();
}

function drawView() {
  view.width = work.width; view.height = work.height;
  vctx.drawImage(work, 0, 0);
  const r = Math.max(3, work.width / 300);
  current.pts.forEach((p, i) => {
    vctx.beginPath(); vctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    vctx.fillStyle = current.mask[i] ? '#22c55e' : '#ef4444'; vctx.fill();
  });
}

// ---------- ICONS ----------
const ICON = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l3 3 5-6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l10.5 18.2a1 1 0 0 1-.9 1.5H2.4a1 1 0 0 1-.9-1.5z"/><path d="M12 9v5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.300" r="1.300" fill="#fff"/></svg>',
  idle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.500v.01"/></svg>',
};
const TITLES = ['SAFE', 'CAUTION', 'RISK', 'OVER LIMIT'];

// ---------- render: หน้าหลัก ----------
function renderHome() {
  const p = settings;
  // gauge ticks (คงที่ตามช่วงสอบเทียบ)
  const span = p.calMax - p.calMin;
  $('ticks').innerHTML = [0, 0.25, 0.5, 0.75, 1].map((f, i) =>
    `<span style="left:${f * 100}%">${trim(p.calMin + f * span)}${i === 4 ? '+' : ''}</span>`).join('');
  $('gauge').querySelectorAll('.tick').forEach((t) => t.remove());
  [25, 50, 75].forEach((x) => { const t = document.createElement('i'); t.className = 'tick'; t.style.left = x + '%'; $('gauge').appendChild(t); });

  // level ranges
  const L = p.limit;
  $('r0').textContent = `< ${trim(L * TIER_BOUNDS[1], 1)}`;
  $('r1').textContent = `${trim(L * TIER_BOUNDS[1], 1)}–${trim(L * TIER_BOUNDS[2], 1)}`;
  $('r2').textContent = `${trim(L * TIER_BOUNDS[2], 1)}–${trim(L, 1)}`;
  $('r3').textContent = `> ${trim(L, 1)}`;
  $('eqInfo').title = `y = log(I₀/G) = ${p.m}·x + ${p.b}, I₀ = ${p.I0}  →  x = (y − b)/m`;

  if (!current) {
    ['vR', 'vG', 'vB'].forEach((id) => { $(id).textContent = '–'; });
    ['fR', 'fG', 'fB'].forEach((id) => { $(id).style.width = '0'; });
    $('sw').style.background = '';
    $('ratioChip').textContent = 'R : G : B = – : – : –';
    $('ppmVal').textContent = '–'; $('ppmU').textContent = ''; $('flag').textContent = '';
    $('pin').style.opacity = 0; $('lmark').style.opacity = 0;
    $('banner').className = 'banner t-1';
    $('lvlIcon').innerHTML = ICON.idle; $('lvlTitle').textContent = 'รอข้อมูล'; $('lvlMsg').textContent = 'อัปโหลดภาพเพื่อเริ่มวัด';
    $('hdrName').textContent = 'ยังไม่ได้เลือกภาพ'; $('hdrDot').classList.remove('on'); $('updTime').textContent = '–';
    return;
  }

  const { r, g, b } = current.rgb;
  const R = Math.round(r), G = Math.round(g), B = Math.round(b);
  $('vR').textContent = R; $('vG').textContent = G; $('vB').textContent = B;
  $('fR').style.width = (r / 255) * 100 + '%'; $('fG').style.width = (g / 255) * 100 + '%'; $('fB').style.width = (b / 255) * 100 + '%';
  $('sw').style.background = `rgb(${R}, ${G}, ${B})`;
  $('ratioChip').textContent = `R : G : B  =  ${R} : ${G} : ${B}`;
  $('hdrName').textContent = current.name; $('hdrDot').classList.add('on');
  $('updTime').textContent = new Date(current.t).toLocaleString('th-TH');
  $('qc').textContent = `อ่าน ${current.nRead} จุด, ใช้ ${current.nUsed} จุด (ตัดค่าผิดปกติ ${current.nRead - current.nUsed}), CV(G) = ${current.cvG.toFixed(1)}%` +
    (current.nUsed < MIN_POINTS ? ' — จุดที่ใช้จริงน้อยกว่า 100 ให้เพิ่มจำนวนจุด' : '') + (current.cvG > 5 ? ' — ความแปรปรวนสูง ตรวจแสงสะท้อน/เงา' : '');

  const res = compute(g, p, current.semG);
  $('ppmVal').textContent = res.belowLOD ? `< ${fmt(res.lod, 2)}` : fmt(res.x, res.x < 10 ? 2 : 1);
  let u = `± ${fmt(res.ux, 2)} ppm (1σ)`;
  if (p.df !== 1) u += `  •  ตัวอย่างเดิม ${fmt(res.xo, 2)} ± ${fmt(res.uxo, 2)} ppm`;
  $('ppmU').textContent = res.belowLOD ? '' : u;
  const flags = [];
  if (res.belowLOD) flags.push(`ต่ำกว่า LOD (≈ ${fmt(res.lod, 3)} ppm) — แยกจาก blank ไม่ได้`);
  else if (res.belowLOQ) flags.push(`ต่ำกว่า LOQ (≈ ${fmt(res.loq, 3)} ppm) — ใช้เป็นค่ากึ่งปริมาณเท่านั้น`);
  if (res.outOfRange && !res.belowLOD) flags.push(`นอกช่วงสอบเทียบ (${trim(p.calMin)}–${trim(p.calMax)} ppm) — ผลอาจไม่แม่นยำ`);
  $('flag').textContent = flags.join('  •  ');
  $('pin').style.opacity = 1; $('pin').style.left = res.gaugePos * 100 + '%';

  const pct = Math.round(res.ratio * 100);
  const msgs = [`ต่ำกว่าเกณฑ์อ้างอิง (${pct}% ของ ${trim(L, 1)} ppm)`, `อยู่ที่ ${pct}% ของเกณฑ์อ้างอิง ${trim(L, 1)} ppm — เฝ้าระวัง`,
                `ใกล้เกณฑ์อ้างอิง (${pct}% ของ ${trim(L, 1)} ppm)`, `เกินเกณฑ์อ้างอิง ${trim(L, 1)} ppm (${pct}%)`];
  $('banner').className = `banner t${res.tier}`;
  $('lvlIcon').innerHTML = res.tier === 0 ? ICON.ok : ICON.warn;
  $('lvlTitle').textContent = TITLES[res.tier]; $('lvlMsg').textContent = msgs[res.tier];
  $('lmark').style.opacity = 1; $('lmark').style.left = res.levelPos * 100 + '%';
}

// ---------- render: ประวัติ / รายงาน ----------
const TIER_TH = ['ปลอดภัย', 'เฝ้าระวัง', 'เสี่ยง', 'เกินเกณฑ์'];

function renderHistory() {
  $('histTbl').innerHTML = '<tr><th>เวลา</th><th>ไฟล์</th><th>G</th><th>x (ppm)</th><th>ตัวอย่างเดิม (ppm)</th><th>ระดับ</th></tr>' +
    (history.length
      ? history.slice().reverse().slice(0, 100).map((h) =>
        `<tr><td>${new Date(h.t).toLocaleString('th-TH')}</td><td>${esc(h.name)}</td><td class="mono">${h.g.toFixed(1)}</td>` +
        `<td class="mono">${fmt(h.x, 3)} ± ${fmt(h.ux, 3)}</td><td class="mono">${fmt(h.xo, 2)}</td><td><span class="pill p${h.tier}">${TIER_TH[h.tier]}</span></td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">ยังไม่มีประวัติ — อัปโหลดภาพที่หน้าหลักเพื่อเริ่มวัด</td></tr>');
}

const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function prep(cv, ratio = 0.62) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 520, H = Math.round(W * ratio);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.font = '12px system-ui, sans-serif';
  return { c, W, H };
}
function axes(c, W, H, m) {
  c.strokeStyle = cssv('--border'); c.lineWidth = 1; c.strokeRect(m.l, m.t, W - m.l - m.r, H - m.t - m.b);
}

function renderReport() {
  const xs = history.map((h) => h.xo);
  const n = xs.length, mean = n ? xs.reduce((s, v) => s + v, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : NaN;
  $('stats').innerHTML = [['จำนวนครั้งที่วัด', n], ['ค่าเฉลี่ย (ppm)', fmt(mean, 2)], ['SD (ppm)', fmt(sd, 2)],
    ['สูงสุด (ppm)', n ? fmt(Math.max(...xs), 2) : '–'], ['ต่ำสุด (ppm)', n ? fmt(Math.min(...xs), 2) : '–']]
    .map(([k, v]) => `<div class="stat"><b class="mono">${v}</b><span>${k}</span></div>`).join('');
  $('eqText').textContent = `y = (${settings.m} ± ${settings.um})·x + (${settings.b} ± ${settings.ub}),  I₀ = ${settings.I0}`;

  const ink = cssv('--text'), muted = cssv('--muted'), accent = cssv('--accent');
  // แนวโน้ม
  let { c, W, H } = prep($('trend'));
  const M = { l: 44, r: 14, t: 14, b: 28 };
  axes(c, W, H, M); c.fillStyle = muted;
  if (n < 2) { c.fillText('ต้องมีอย่างน้อย 2 ครั้งเพื่อแสดงแนวโน้ม', M.l + 14, H / 2); }
  else {
    const ymax = Math.max(...xs) * 1.15 || 1;
    const X = (i) => M.l + (i / (n - 1)) * (W - M.l - M.r), Y = (v) => H - M.b - (v / ymax) * (H - M.t - M.b);
    c.fillText('0', 8, H - M.b); c.fillText(trim(ymax, 1), 8, M.t + 10); c.fillText('ครั้งที่ 1', M.l, H - 8); c.fillText(`ครั้งที่ ${n}`, W - M.r - 52, H - 8);
    c.strokeStyle = accent; c.lineWidth = 2; c.beginPath();
    xs.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)))); c.stroke();
    c.fillStyle = accent; xs.forEach((v, i) => { c.beginPath(); c.arc(X(i), Y(v), 3.5, 0, 7); c.fill(); });
  }
  // กราฟสอบเทียบ
  ({ c, W, H } = prep($('calplot')));
  axes(c, W, H, M); c.fillStyle = muted;
  const pts = history.map((h) => ({ x: h.x, y: h.y }));
  const xmin = Math.min(settings.calMin, 0), xmax = Math.max(settings.calMax, ...pts.map((p) => p.x), 1e-6);
  const yline = (x) => settings.m * x + settings.b;
  const ymax2 = Math.max(yline(xmax), ...pts.map((p) => p.y), 1e-6) * 1.08, ymin2 = Math.min(0, yline(xmin), ...pts.map((p) => p.y));
  const X2 = (x) => M.l + ((x - xmin) / (xmax - xmin)) * (W - M.l - M.r), Y2 = (y) => H - M.b - ((y - ymin2) / (ymax2 - ymin2)) * (H - M.t - M.b);
  c.fillText(trim(ymin2, 2), 6, H - M.b); c.fillText(trim(ymax2, 2), 6, M.t + 10);
  c.fillText(trim(xmin, 2) + ' ppm', M.l, H - 8); c.fillText(trim(xmax, 2) + ' ppm', W - M.r - 60, H - 8);
  c.fillStyle = ink; c.fillText('y = log(I₀/G)', M.l + 8, M.t + 14);
  c.strokeStyle = accent; c.lineWidth = 2; c.beginPath(); c.moveTo(X2(xmin), Y2(yline(xmin))); c.lineTo(X2(xmax), Y2(yline(xmax))); c.stroke();
  // ช่วงสอบเทียบ
  c.strokeStyle = cssv('--muted'); c.setLineDash([4, 4]);
  [settings.calMin, settings.calMax].forEach((x) => { c.beginPath(); c.moveTo(X2(x), M.t); c.lineTo(X2(x), H - M.b); c.stroke(); });
  c.setLineDash([]);
  c.fillStyle = '#f97316'; pts.forEach((p) => { c.beginPath(); c.arc(X2(p.x), Y2(p.y), 4, 0, 7); c.fill(); });
}

// ---------- settings UI ----------
const SCHEMA = {
  fCal: [['I0', 'I₀ (G ของ blank)'], ['m', 'slope (m)'], ['um', '± slope'], ['b', 'intercept (b)'], ['ub', '± intercept']],
  fSample: [['calMin', 'ช่วงสอบเทียบ ต่ำสุด (ppm)'], ['calMax', 'ช่วงสอบเทียบ สูงสุด (ppm)'], ['df', 'Dilution factor'], ['limit', 'เกณฑ์อ้างอิง (ppm)']],
  fImg: [['nPts', 'จำนวนจุด (≥100)'], ['bandPct', 'แถบขอบ (% ของด้านสั้น)'], ['patch', 'แพตช์ (px)']],
};
const IMG_KEYS = ['nPts', 'bandPct', 'patch'];

function buildSettings() {
  Object.entries(SCHEMA).forEach(([id, fields]) => {
    $(id).innerHTML = fields.map(([k, label]) =>
      `<label class="field">${label}<input type="number" step="any" data-k="${k}" inputmode="decimal"></label>`).join('');
  });
  syncSettings();
  document.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('change', onSetting));
}
function syncSettings() {
  document.querySelectorAll('[data-k]').forEach((el) => { el.value = settings[el.dataset.k]; });
}
function onSetting(e) {
  const k = e.target.dataset.k;
  let v = k === 'logBase' ? (e.target.value === 'e' ? 'e' : 10) : parseFloat(e.target.value);
  const bad = (k !== 'logBase' && !Number.isFinite(v)) ||
    (k === 'm' && v === 0) || (['df', 'limit', 'I0'].includes(k) && v <= 0) ||
    (k === 'calMax' && v <= settings.calMin) || (k === 'calMin' && v >= settings.calMax);
  if (bad) { toast('ค่าที่ใส่ไม่ถูกต้อง'); syncSettings(); return; }
  if (k === 'nPts') v = Math.max(MIN_POINTS, Math.round(v));
  if (k === 'patch') v = Math.max(1, Math.round(v));
  settings[k] = v; store.save('asp-settings', settings); syncSettings();
  if (IMG_KEYS.includes(k) && work.width) analyze(undefined, false); else render();
}

// ---------- events ----------
$('file').onchange = (e) => loadFile(e.target.files?.[0]);
const dz = $('dropzone');
['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', (e) => loadFile(e.dataTransfer?.files?.[0]));

function show(v) {
  activeView = v;
  document.querySelectorAll('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== v; });
  document.querySelectorAll('#tabs button').forEach((b) => { b.toggleAttribute('aria-current', b.dataset.tab === v); if (b.dataset.tab === v) b.setAttribute('aria-current', 'page'); });
  window.scrollTo({ top: 0 });
  render();
}
document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => show(b.dataset.tab); });
$('btnGear').onclick = () => show('more');

function toggleTheme() {
  const d = document.documentElement;
  const cur = d.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  d.dataset.theme = next;
  try { localStorage.setItem('asp-theme', next); } catch { /* ignore */ }
  render();
}
$('btnTheme').onclick = toggleTheme; $('btnTheme2').onclick = toggleTheme;

$('btnCsv').onclick = () => {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = ['time,file,R,G,B,y_log,x_ppm,u_x_ppm,sample_ppm,level,points_read,points_used,cv_G_percent',
    ...history.map((h) => [new Date(h.t).toISOString(), q(h.name), h.r.toFixed(2), h.g.toFixed(2), h.b.toFixed(2), h.y.toFixed(5),
      h.x.toFixed(4), h.ux.toFixed(4), h.xo.toFixed(4), TIER_TH[h.tier], h.nRead, h.nUsed, h.cvG.toFixed(2)].join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'aspartame-results.csv'; a.click(); URL.revokeObjectURL(a.href);
};
$('btnClear').onclick = () => { if (confirm('ล้างประวัติการวัดทั้งหมด?')) { history = []; store.save('asp-history', history); render(); } };
$('btnPrint').onclick = () => window.print();
$('btnDefaults').onclick = () => {
  if (!confirm('คืนค่าเริ่มต้นของสมการและการตั้งค่าทั้งหมด?')) return;
  settings = { ...DEFAULTS }; store.save('asp-settings', settings); $('logBase').value = '10'; syncSettings();
  if (work.width) analyze(undefined, false); else render();
};

function render() {
  $('logBase').value = String(settings.logBase);
  renderHome();
  if (activeView === 'history') renderHistory();
  if (activeView === 'report') renderReport();
}

buildSettings();
render();
window.addEventListener('resize', () => { if (activeView === 'report') renderReport(); });
