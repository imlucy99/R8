/* =========================================================
   JGVRP Speedometer HUD  -  Audi R8 Gen 2 Virtual Cockpit (Optitron)
   Semua satuan IMPERIAL: MPH / Miles / MPG / PSI
   API (dipanggil dari game / CEF) - tidak berubah dari base:
     setSpeed(m/s)            setRPM(0.0 - 1.0)   (1.0 = RPM_FULL x1000, lihat konstanta)
     setFuel(0-1 | 0-100)     setHealth(0-1 | 0-1000)  -> jarum OIL PRESS (PSI) + RANGE ikut fuel
     setGear(n)               setHeadlights(0 off | 1 low | 2 high)
     setSeatbelts(bool)       updateLockStatus(state)
     setOdometer(miles)       setEngine(bool)
     setDimmer(0.15-1 | 15-100)   (alias: setBrightness)  -> kecerahan lampu dial
   Optitron:
     setEngine(true)    -> ignition wake-up: dial menyala bertahap + jarum menyapu
     (normal)           -> angka putih menyala, jarum merah menyala + glow
     setHeadlights(1|2) -> SEMUA JARUM menyala (merah terang + glow); lampu mati = jarum redup
     setEngine(false)   -> shutdown: jarum turun, cahaya dial memudar pelan
   ========================================================= */

// ===================== KONFIGURASI (ubah di sini) =====================
const MPS_TO_MPH = 2.236936;
const MAX_MPH = 220;                  // skala jarum speedo analog (MPH)
const MAX_RPM = 10;                   // skala tachometer (x1000)
const RPM_FULL = 9;                   // putaran (x1000) yang ditunjuk jarum saat setRPM(1.0)
const REDLINE = 8;                    // mulai zona merah (x1000 RPM)
const LIMITER = 0.96;                 // RPM (0-1) mulai dianggap kena limiter -> jarum geter
const OIL_MAX = 100;                  // skala oil press (PSI)
const OIL_FULL = 100;                 // PSI yang ditunjuk saat health = 1.0 (setHealth(1.0) = 100 PSI)
const OIL_LOW = 20;                   // di bawah ini zona merah oil (PSI)
const TANK_CAPACITY_GALLONS = 21.9;   // kapasitas tangki (US Gallons)  <-- UBAH DI SINI
const FUEL_ECONOMY_MPG = 11;          // konsumsi tetap (MPG)
const FUEL_LOW = 0.20;                // di bawah ini indikator low fuel amber
const FUEL_CRIT = 0.10;               // di bawah ini indikator low fuel merah
// Range (Miles) = sisa bahan bakar (Gallons) x FUEL_ECONOMY_MPG
const calcRange = (frac) => Math.max(0, Math.round(frac * TANK_CAPACITY_GALLONS * FUEL_ECONOMY_MPG));
// =======================================================================

// Catatan: gauge oil/fuel, range, odo & indikator tidak digambar lagi; API-nya tetap menerima data (elemen kosong diabaikan).
const NOOP_EL = document.createElement('div');   // pengaman kalau ada elemen yang dihapus dari HTML
const $ = (id) => document.getElementById(id) || NOOP_EL;
const elHud = $('hud');
const svg = $('dial');

function isLockedState(val) {
    return val === true || val === 1 || val === '1' || val === 'true' || val === 2 || val === '2';
}
function isTrueValue(val) {
    return val === true || val === 1 || val === '1' || val === 'true';
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---------- Geometri (koordinat mengikuti gambar referensi 1774x887) ----------
// TACHO & SPEEDO berbagi pusat yang sama (speedo = cincin dalam). Sudut SVG: 0 = timur, searah jarum jam.
const TAC  = { cx: 887, cy: 455, bezel: 322, ring: 312, face: 303, a0: 135, sweep: 270, inner: 190 };
const SPD  = { cx: 887, cy: 455, a0: 135, sweep: 270 };
// OIL (kiri): 0 PSI di bawah -> 100 PSI di atas, busur melengkung ke kiri
const OIL  = { cx: 372,  cy: 515, r: 290, a0: 156, sweep: 48 };
// FUEL (kanan): E di bawah -> F di atas, busur melengkung ke kanan
const FUEL = { cx: 1402, cy: 515, r: 290, a0: 24,  sweep: -48 };

const pol = (cx, cy, r, a) => {
    const t = (a * Math.PI) / 180;
    return [(cx + r * Math.cos(t)).toFixed(2), (cy + r * Math.sin(t)).toFixed(2)];
};
function sector(cx, cy, r1, r2, a1, a2) {
    const [x1, y1] = pol(cx, cy, r2, a1), [x2, y2] = pol(cx, cy, r2, a2);
    const [x3, y3] = pol(cx, cy, r1, a2), [x4, y4] = pol(cx, cy, r1, a1);
    const large = a2 - a1 > 180 ? 1 : 0;
    return `M${x1} ${y1}A${r2} ${r2} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 ${large} 0 ${x4} ${y4}Z`;
}
function arcPath(cx, cy, r, a1, a2) {
    const [x1, y1] = pol(cx, cy, r, a1), [x2, y2] = pol(cx, cy, r, a2);
    return `M${x1} ${y1}A${r} ${r} 0 ${Math.abs(a2 - a1) > 180 ? 1 : 0} ${a2 > a1 ? 1 : 0} ${x2} ${y2}`;
}
const tick = (cx, cy, a, r1, r2, w, cls) => {
    const [x1, y1] = pol(cx, cy, r1, a), [x2, y2] = pol(cx, cy, r2, a);
    return `<line class="tk${cls ? ' ' + cls : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w}"/>`;
};
const txt = (cls, x, y, size, s, id) => `<text${id ? ` id="${id}"` : ''} class="${cls}" x="${x}" y="${y}" font-size="${size}">${s}</text>`;

// ---------- Ikon (viewBox 24x24) ditaruh di (x,y) dengan skala s ----------
const icon = (id, cls, x, y, s, inner) =>
    `<g id="${id}" class="ind ${cls}" transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;

const ICON_HEADLIGHT = `
    <path d="M12 4h2a8 8 0 0 1 0 16h-2z" fill="currentColor" fill-opacity=".15"/>
    <g class="beam-low"><path d="M9 5L2 7.5M9 9L2 11.5M9 13L2 15.5M9 17L2 19.5"/></g>
    <g class="beam-high"><path d="M9 6H2M9 10H2M9 14H2M9 18H2"/></g>`;
const ICON_SEATBELT = `
    <circle cx="12" cy="4" r="2.2" fill="currentColor" stroke="none"/>
    <path d="M8 22v-5.5L7 11.5C7 9.6 8.4 8 10.2 8h3.6C15.6 8 17 9.6 17 11.5l-1 5V22"/>
    <path d="M9 8.5l7.5 10"/>`;
const ICON_LOCK = `
    <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="15.2" r="1.4" fill="#0b0b0d" stroke="none"/>
    <path class="shackle-closed" d="M8 11V8a4 4 0 0 1 8 0v3"/>
    <path class="shackle-open" d="M8 11V8a4 4 0 0 1 7.4-2.1"/>`;
const ICON_FUEL = `<path fill="currentColor" stroke="none" d="M19.77 7.23l.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77zM12 10H6V5h6v5zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>`;
const ICON_OIL = `<path fill="currentColor" stroke="none" d="M2.5 10h4.2l1.3-2h2V6.5H8V5h6v1.5h-2V8h2.5l2 1.8 5-2.8 1 1.2-6.6 7.3H8.4L7 13H2.5zM20.2 14.6c0-.9 1.1-2.3 1.1-2.3s1.1 1.4 1.1 2.3c0 .6-.5 1.1-1.1 1.1s-1.1-.5-1.1-1.1z"/>`;

// ---------- Jendela ODO (LCD, bawah kiri): 6 drum, digit terakhir = desimal (1/10 mil) ----------
const ODO_N = 6, ODO_W = 26, ODO_ROW = 42, ODO_BOX = { x: 0, y: 0, w: 277, h: 56 };
const ODO_Y = 7, ODO_X0 = 54;
// ---------- Jendela RANGE (bawah kanan, di bawah gauge bensin) ----------

// ---------- Jarum: lapisan glow lebar, glow sempit, badan jarum, garis inti ----------
// Jarum dibangun sepanjang sumbu +x lokal lalu diputar di sekitar pusat (g.cx, g.cy).
function needle(id, g, r1, r2, w) {
    const d = `M${r1} ${-w}L${r2} -1.3L${r2} 1.3L${r1} ${w}Z`;
    return `
    <g id="${id}" transform="translate(${g.cx} ${g.cy}) rotate(0)">
      <path class="ndl-glow g2" d="${d}"/>
      <path class="ndl-glow g1" d="${d}"/>
      <path class="ndl" d="${d}"/>
      <line class="ndl-core" x1="${r1 + 6}" y1="0" x2="${r2 - 4}" y2="0"/>
    </g>`;
}

// ---------- Mobil Audi R8 tampak depan (stilasi, sisi kanan) ----------
function carFront(x, y) {
    const side = (m) => `
      <path d="M${m * 124} -6L${m * 64} -17L${m * 60} -4L${m * 112} 9Z" fill="url(#hlG)"/>
      <path d="M${m * 118} 1L${m * 70} -9" stroke="#fff" stroke-width="2" opacity=".85"/>
      <path d="M${m * 100} 33L${m * 128} 24L${m * 126} 40Q${m * 120} 50 ${m * 104} 50Z" fill="#0a0a0c"/>
      <rect x="${m > 0 ? 106 : -134}" y="40" width="28" height="22" rx="4" fill="#050506"/>`;
    return `
    <g class="lit g-aux" transform="translate(${x} ${y})">
      <ellipse cx="0" cy="66" rx="125" ry="9" fill="#000" opacity=".55"/>
      <path d="M-82 -52Q-62 -84 0 -84Q62 -84 82 -52L96 -30L-96 -30Z" fill="url(#glassCar)"/>
      <path d="M-134 -2Q-130 -34 -96 -37L96 -37Q130 -34 134 -2L138 34Q136 54 114 56L-114 56Q-136 54 -138 34Z" fill="url(#bodyG)"/>
      <path d="M-70 -37L-24 -29L24 -29L70 -37" stroke="rgba(255,255,255,.35)" stroke-width="1.5" fill="none"/>
      ${side(1)}${side(-1)}
      <path d="M-88 16L88 16L72 50L-72 50Z" fill="#08080a"/>
      <path d="M-70 22H70M-62 30H62M-54 38H54M-46 45H46" stroke="#25272c" stroke-width="2"/>
      <path d="M-60 16L-48 50M-30 16L-24 50M0 16V50M30 16L24 50M60 16L48 50" stroke="#25272c" stroke-width="2"/>
      <path d="M-72 52H72" stroke="#c8cbd1" stroke-width="2.4" opacity=".7"/>
      <g fill="none" stroke="#d0d3d9" stroke-width="2" opacity=".85">
        <circle cx="-15" cy="-14" r="6"/><circle cx="-5" cy="-14" r="6"/><circle cx="5" cy="-14" r="6"/><circle cx="15" cy="-14" r="6"/>
      </g>
    </g>`;
}

function buildDial() {
    const sA = (v) => SPD.a0 + (v / MAX_MPH) * SPD.sweep;        // sudut jarum speedo (MPH)
    const rA = (v) => TAC.a0 + (v / MAX_RPM) * TAC.sweep;        // sudut tacho (x1000 RPM)
    const fA = (f) => FUEL.a0 + f * FUEL.sweep;                  // sudut fuel (0 = E, 1 = F)
    const oA = (p) => OIL.a0 + (p / OIL_MAX) * OIL.sweep;        // sudut oil (PSI)
    const tx = TAC.cx, ty = TAC.cy;
    let s = `
    <defs>
      <pattern id="carbon" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="#0c0c0e"/>
        <path d="M0 0h4v4H0zM4 4h4v4H4z" fill="#151518"/>
        <path d="M0 4h4v4H0zM4 0h4v4H4z" fill="#070708"/>
      </pattern>
      <linearGradient id="chrome" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset="0.25" stop-color="#9a9da5"/>
        <stop offset="0.5" stop-color="#2b2c31"/><stop offset="0.72" stop-color="#8b8e96"/><stop offset="1" stop-color="#ffffff"/>
      </linearGradient>
      <radialGradient id="faceG" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.35" style="stop-color:var(--face-a)"/><stop offset="1" style="stop-color:var(--face-b)"/>
      </radialGradient>
      <linearGradient id="glassG" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.11"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="gtG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#8a8e97"/>
      </linearGradient>
      <linearGradient id="drumShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0.6"/><stop offset="0.3" stop-color="#000" stop-opacity="0"/>
        <stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/>
      </linearGradient>
      <radialGradient id="haloG" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.9" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="bodyG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#a3a6ad"/><stop offset="0.55" stop-color="#5c5f66"/><stop offset="1" stop-color="#25272b"/>
      </linearGradient>
      <linearGradient id="glassCar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4a4d54"/><stop offset="1" stop-color="#15161a"/>
      </linearGradient>
      <linearGradient id="hlG" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#9fb4ff" stop-opacity="0.5"/><stop offset="1" stop-color="#eef2ff"/>
      </linearGradient>
      <linearGradient id="redWash" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#d4161a" stop-opacity="0"/><stop offset="1" stop-color="#d4161a" stop-opacity="0.35"/>
      </linearGradient>
      <filter id="bloom" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>`;

    // ===================== TACHO: bezel + muka =====================
    s += `
    <circle cx="${tx}" cy="${ty}" r="${TAC.bezel + 14}" fill="url(#haloG)"/>
    <circle cx="${tx}" cy="${ty}" r="${TAC.bezel}" fill="#050506"/>
    <g class="chrome-g">
    <circle cx="${tx}" cy="${ty}" r="${TAC.bezel - 4}" fill="none" stroke="url(#chrome)" stroke-width="3" opacity="0.5"/>
    <circle cx="${tx}" cy="${ty}" r="${TAC.ring}" fill="none" stroke="url(#chrome)" stroke-width="9"/>
    <circle cx="${tx}" cy="${ty}" r="${TAC.ring - 7}" fill="#0a0a0c"/>
    <circle cx="${tx}" cy="${ty}" r="${TAC.face}" fill="url(#faceG)"/>
    <circle cx="${tx}" cy="${ty}" r="${TAC.face}" fill="url(#glassG)"/>
    </g>`;

    // ----- skala RPM (x1000) -----
    s += `<g class="lit g-rpm">`;
    s += `<path class="wash" d="${sector(tx, ty, TAC.inner + 6, 298, rA(REDLINE), rA(MAX_RPM))}"/>`;
    s += `<path class="zone-glow" filter="url(#bloom)" d="${sector(tx, ty, 272, 298, rA(REDLINE), rA(MAX_RPM))}"/>`;
    s += `<path class="zone" d="${sector(tx, ty, 272, 298, rA(REDLINE), rA(MAX_RPM))}"/>`;
    for (let i = 0; i <= MAX_RPM * 5; i++) {
        const major = i % 5 === 0, v = i / 5;
        s += tick(tx, ty, rA(v), major ? 258 : 272, 292, major ? 5 : 2.2, v >= REDLINE ? 'red' : '');
    }
    for (let v = 0; v <= MAX_RPM; v++) {
        const [x, y] = pol(tx, ty, 228, rA(v));
        s += txt(v >= REDLINE ? 'num red' : 'num', x, y, 52, v);
    }
    s += `</g>`;

    // ===================== SPEEDO: cincin dalam + angka digital =====================
    s += `
    <circle cx="${tx}" cy="${ty}" r="${TAC.inner + 6}" fill="#050506"/>
    <circle class="chrome-g" cx="${tx}" cy="${ty}" r="${TAC.inner + 2}" fill="none" stroke="url(#chrome)" stroke-width="5"/>
    <circle cx="${tx}" cy="${ty}" r="${TAC.inner - 4}" fill="#050506"/>`;
    s += `<g class="lit g-spd">`;
    s += `<circle class="edge" cx="${tx}" cy="${ty}" r="${TAC.inner - 6}" fill="none" stroke="#c8181c" stroke-width="2"/>`;
    // logo R8 (blok merah + wordmark)
    s += `<polygon class="r8-slab" points="${tx - 76},${ty - 166} ${tx - 40},${ty - 166} ${tx - 51},${ty - 128} ${tx - 87},${ty - 128}"/>`;
    s += txt('9r', tx + 10, ty - 146, 48, '9R');
    s += txt('lbl up', tx, ty - 104, 15, 'MPH');
    s += txt('big', tx, ty - 52, 80, '0', 'spd-val');

    // OIL (PSI) kiri & FUEL (%) kanan
    s += icon('oil-ico', 'gauge-ico', tx - 144, ty + 41, 1.2, ICON_OIL);
    s += `<text class="big" x="${tx - 72}" y="${ty + 56}" font-size="30"><tspan id="oil-val">100</tspan><tspan class="unit" font-size="14"> PSI</tspan></text>`;
    s += icon('fuel-ico', 'gauge-ico', tx + 114, ty + 41, 1.2, ICON_FUEL);
    s += txt('big', tx + 70, ty + 56, 30, '100%', 'fuel-val');
    // RANGE (miles) = galon tersisa x MPG
    s += `<text class="lbl up" x="${tx}" y="${ty + 96}" font-size="15">RANGE <tspan id="rng-val" class="rng">${calcRange(1)}</tspan> MI</text>`;

    // indikator
    s += icon('seatbelts', 'eng warn', tx - 50, ty + 113, 1.1, ICON_SEATBELT);
    s += icon('door-lock', '', tx - 13, ty + 113, 1.1, ICON_LOCK);
    s += icon('headlight', 'eng', tx + 24, ty + 113, 1.1, ICON_HEADLIGHT);

    // ODO (miles): drum angka kecil di dasar lingkaran dalam, tanpa kotak
    s += `<g class="odo lit g-spd" transform="translate(${tx - 48} ${ty + 147}) scale(0.5)">`;
    for (let i = 0; i < ODO_N; i++) {
        const x = i * ODO_W, last = i === ODO_N - 1;
        let rows = '';
        for (let r = 0; r <= 10; r++) rows += `<text class="odo-digit${last ? ' odo-last' : ''}" x="${ODO_W / 2}" y="${ODO_ROW / 2 + r * ODO_ROW + 2}">${r % 10}</text>`;
        s += `<svg x="${x}" y="0" width="${ODO_W}" height="${ODO_ROW}" viewBox="0 0 ${ODO_W} ${ODO_ROW}" overflow="hidden">
          <rect width="${ODO_W}" height="${ODO_ROW}" fill="${last ? '#f2f2f2' : '#050506'}"/>
          <g class="odo-strip snap" id="odo${i}">${rows}</g>
          <rect width="${ODO_W}" height="${ODO_ROW}" fill="url(#drumShade)"/>
        </svg>`;
    }
    s += txt('lbl odo-tag', ODO_N * ODO_W + 8, ODO_ROW / 2 + 1, 26, 'MI') + `</g>`;
    s += `</g>`;
    s += txt('gear', tx, ty + 8, 30, 'N', 'gear');

    // ----- jarum RPM (paling atas); speed = angka digital saja -----
    s += `<g class="chrome-g">` + needle('nd-rpm', TAC, TAC.inner + 8, 298, 7) + `</g>`;   // satu-satunya jarum: RPM

    svg.innerHTML = s;
}
buildDial();

const ndSpd = $('nd-spd'), ndRpm = $('nd-rpm'), ndFuel = $('nd-fuel'), ndOil = $('nd-oil');
const ang = {};
function setNeedle(el, key, g, a) {
    if (ang[key] !== undefined && Math.abs(ang[key] - a) < 0.04) return;   // tulis hanya kalau jarum benar-benar bergerak
    ang[key] = a;
    el.setAttribute('transform', `translate(${g.cx} ${g.cy}) rotate(${a.toFixed(2)})`);
}
const bars = {};
function setBar(el, key, f) {
    const v = Math.round(clamp01(f) * 1000);
    if (bars[key] === v) return;
    bars[key] = v;
    el.setAttribute('stroke-dasharray', `${v} 1000`);
}
// Helper kelas untuk elemen SVG (className SVG bukan string biasa)
function setCls(el, cls) { if (el.getAttribute('class') !== cls) el.setAttribute('class', cls); }
function setText(el, t) { t = String(t); if (el.textContent !== t) el.textContent = t; }

// ---------- State ----------
const state = {
    mph: 0, mps: 0,
    rpm: 0, health: 1, fuel: 1,
    spdShown: 0, rpmShown: 0, fuelShown: 0, oilShown: 0,
    belted: false, engine: false, lights: 0, dimmer: 1,
};
const BOOT_MS = 1700;
let bootUntil = 0;

// ---------- Loop animasi (berhenti sendiri kalau semua jarum diam) ----------
const FRAME_MS = 1000 / 60;
let lastFrame = 0, rafId = 0;
function kick() {
    if (rafId) return;
    lastFrame = performance.now() - FRAME_MS;
    rafId = requestAnimationFrame(frame);
}
function frame(now) {
    rafId = 0;
    if (now - lastFrame < FRAME_MS - 2) { rafId = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    // Sapuan jarum saat kontak ON: 0 -> max -> 0
    const booting = now < bootUntil;
    let sw = 0, rise = false;
    if (booting) {
        const t = 1 - (bootUntil - now) / BOOT_MS;
        rise = t < 0.45;
        sw = t < 0.45 ? t / 0.45 : t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45);
    }

    const tSpd = booting ? Math.max(sw, state.mph / MAX_MPH) : state.mph / MAX_MPH;
    const limiter = !booting && state.engine && state.rpm >= LIMITER;
    const rpmFrac = state.rpm * (RPM_FULL / MAX_RPM);      // setRPM(0-1) -> posisi pada skala tacho
    let tRpm = booting ? sw : state.engine ? rpmFrac : 0;
    if (limiter) {   // rev limiter: jarum mental-mental di dekat batas (fuel cut), seperti mobil asli
        const cut = Math.sin((now / 1000) * 2 * Math.PI * 11) > 0;
        tRpm = rpmFrac - (cut ? 0.035 + Math.random() * 0.02 : Math.random() * 0.01);
    }
    const tFuel = booting ? (rise ? sw : state.fuel + (1 - state.fuel) * sw) : state.engine ? state.fuel : 0;   // E -> F -> level bensin
    const tOil = booting ? sw : state.engine ? clamp01(state.health * (OIL_FULL / OIL_MAX)) : 0;

    const kf = booting ? 1 : Math.min(1, dt * (limiter ? 45 : 12)), ks = booting ? 1 : Math.min(1, dt * 4);
    const ease = (cur, tgt, k) => (Math.abs(tgt - cur) < 0.0004 ? tgt : cur + (tgt - cur) * k);
    state.spdShown = ease(state.spdShown, tSpd, kf);
    state.rpmShown = ease(state.rpmShown, tRpm, kf);
    state.fuelShown = ease(state.fuelShown, tFuel, ks);
    state.oilShown = ease(state.oilShown, tOil, ks);

    setNeedle(ndSpd, 'spd', SPD, SPD.a0 + clamp01(state.spdShown) * SPD.sweep);
    setNeedle(ndRpm, 'rpm', TAC, TAC.a0 + clamp01(state.rpmShown) * TAC.sweep);
    setNeedle(ndFuel, 'fuel', FUEL, FUEL.a0 + clamp01(state.fuelShown) * FUEL.sweep);
    setNeedle(ndOil, 'oil', OIL, OIL.a0 + clamp01(state.oilShown) * OIL.sweep);
    setBar($('fuel-bar'), 'fuel', state.fuelShown);
    setBar($('oil-bar'), 'oil', state.oilShown);
    setText($('spd-val'), Math.round(clamp01(state.spdShown) * MAX_MPH));          // angka digital MPH ikut jarum
    setText($('oil-val'), Math.round(clamp01(state.oilShown) * OIL_MAX));
    setText($('fuel-val'), Math.round(clamp01(state.fuelShown) * 100) + '%');          // PSI

    if (booting || limiter || state.spdShown !== tSpd || state.rpmShown !== tRpm || state.fuelShown !== tFuel || state.oilShown !== tOil) {
        rafId = requestAnimationFrame(frame);
    }
}

// ---------- 1. Kecepatan (m/s) ----------
window.setSpeed = function (speed) {
    state.mps = Number(speed || 0);
    state.mph = Math.round(state.mps * MPS_TO_MPH);
    kick();
};
// ---------- 2. RPM (0.0 - 1.0) ----------
window.setRPM = function (rpm) {
    const r = clamp01(Number(rpm || 0));
    if (r === state.rpm) return;
    state.rpm = r;
    kick();
};
// ---------- 3. Fuel ----------
window.setFuel = function (fuel) {
    const val = Number(fuel || 0);
    state.fuel = clamp01(val > 1 ? val / 100 : val);
    const lvl = state.fuel < FUEL_CRIT ? 'crit' : state.fuel < FUEL_LOW ? 'low' : '';
    setCls($('fuel-ico'), ('ind gauge-ico ' + lvl).trim());
    setCls($('fuel-val'), ('big ' + lvl).trim());
    setCls($('rng-val'), ('rng ' + lvl).trim());
    setText($('rng-val'), calcRange(state.fuel));            // RANGE (miles) = galon tersisa x MPG
    kick();
};
// ---------- 4. Engine health -> jarum OIL PSI ----------
window.setHealth = function (health) {
    const val = Number(health || 0);
    const p = clamp01(val > 1 ? val / 1000 : val);
    if (p === state.health) return;
    state.health = p;
    setCls($('oil-ico'), p <= 0.3 ? 'ind gauge-ico crit' : p <= 0.5 ? 'ind gauge-ico low' : 'ind gauge-ico');
    setCls($('oil-val'), p * OIL_FULL <= OIL_LOW ? 'big crit' : 'big');
    kick();
};
// ---------- 5. Gear ----------
window.setGear = function (gear) {
    let g = String(gear);
    if (gear == 0 || g === '0' || g.toUpperCase() === 'R') g = 'R';
    else if (gear === null || gear === undefined || g === '' || g.toUpperCase() === 'N') g = 'N';
    setText($('gear'), g);
    setCls($('gear'), g === 'R' ? 'gear rev' : 'gear');
};
// ---------- 6. Lock ----------
window.updateLockStatus = function (st) {
    setCls($('door-lock'), isLockedState(st) ? 'ind locked' : 'ind');
};
['setDoors', 'setDoorLock', 'setVehicleLocked', 'setLocked', 'setLock', 'toggleLock'].forEach((n) => { window[n] = window.updateLockStatus; });

// ---------- 7. LAMPU: 0 mati, 1 low, 2 high -> ikon + SEMUA JARUM MENYALA ----------
window.setHeadlights = function (st) {
    const val = Number(st || 0);
    state.lights = val;
    setCls($('headlight'), val === 2 ? 'ind eng high-beam' : val === 1 ? 'ind eng active' : 'ind eng');
    elHud.classList.toggle('lights-on', val > 0);
    applyLum();
};
// ---------- Dimmer Optitron: kecerahan dial (CSS --lum) ----------
function applyLum() {
    const lum = Math.max(0.12, Math.min(1, state.dimmer));
    elHud.style.setProperty('--lum', lum.toFixed(3));
}
window.setDimmer = function (v) {
    let n = Number(v);
    if (isNaN(n)) return;
    if (n > 1) n /= 100;                       // boleh 0-100
    state.dimmer = Math.max(0.15, Math.min(1, n));
    applyLum();
};
window.setBrightness = window.setDimmer;
window.setLights = window.setHeadlights;
window.setLeftIndicator = function () {};     // sein dihapus
window.setRightIndicator = function () {};

// ---------- 8. Seatbelt ----------
window.setSeatbelts = function (val) {
    const on = isTrueValue(val);
    state.belted = on;
    setCls($('seatbelts'), on ? 'ind eng active' : 'ind eng warn');
};

// ---------- 9. Odometer (mil) -> 5 digit + 1 digit desimal, drum berputar ----------
let lastOdo = '';
const odoCells = [];
for (let i = 0; i < ODO_N; i++) {
    const el = $('odo' + i), c = { el, row: 0 };
    el.addEventListener('transitionend', () => {          // 9 -> 0: setelah putar ke "0" cadangan, lompat balik ke baris 0 tanpa animasi
        if (c.row === 10) odoMove(c, 0, false);
    });
    odoCells.push(c);
}
function odoMove(c, row, animate) {
    c.row = row;
    if (!animate) c.el.classList.add('snap');
    c.el.style.transform = `translateY(${-row * ODO_ROW}px)`;
    if (!animate) { void c.el.getBoundingClientRect(); c.el.classList.remove('snap'); }
}
window.setOdometer = function (distance) {
    const n = Math.max(0, Math.min(999999, Math.floor(Number(distance || 0) * 10)));
    const s = String(n).padStart(ODO_N, '0');
    if (s === lastOdo) return;
    const animate = lastOdo !== '' && state.engine;      // pertama kali / mesin mati: langsung set tanpa animasi
    lastOdo = s;
    for (let i = 0; i < ODO_N; i++) {
        const c = odoCells[i], d = +s[i];
        if (c.row === 10) odoMove(c, 0, false);
        if (c.row === d) continue;
        if (!animate) odoMove(c, d, false);
        else if (d < c.row && c.row - d > 5) odoMove(c, 10, true);   // lewat 9 -> 0: putar maju terus
        else odoMove(c, d, true);
    }
};

// ---------- 10. MESIN: nyala = dial terang + jarum menyapu ----------
window.setEngine = function (on) {
    const v = isTrueValue(on);
    const was = state.engine;
    state.engine = v;
    elHud.classList.toggle('engine-on', v);
    if (v && !was && performance.now() > bootUntil) bootUntil = performance.now() + BOOT_MS;
    kick();
};

// ---------- Sapuan jarum (tanpa tulisan intro) ----------
window.playIntro = function () {
    if (state.engine) bootUntil = performance.now() + BOOT_MS;
    kick();
};

// ---------- Suara peringatan (Web Audio, tanpa file mp3) ----------
const SND = {
    enabled: true,
    volume: 0.3,
    seatbeltEvery: 2000,
    seatbeltMinSpeed: 1,    // m/s
    fuelBelow: 0.20,
    fuelEvery: 30000,
};
try {
    const q = new URLSearchParams(location.search);
    ['nosound', 'mute', 'silent', 'noalarm', 'noseatbelt', 'nobelt'].forEach((k) => {
        if (q.has(k) && !['0', 'false', 'no', 'off'].includes((q.get(k) || '').toLowerCase())) SND.enabled = false;
    });
    if (q.has('volume') && !isNaN(parseFloat(q.get('volume')))) SND.volume = Math.max(0, Math.min(1, parseFloat(q.get('volume'))));
} catch (e) {}
let audioCtx = null;
function getAudio() {
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
}
function tone(freq, start, dur, type, vol) {
    const a = getAudio();
    if (!a) return;
    const t0 = a.currentTime + start;
    const osc = a.createOscillator(), gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, SND.volume * vol), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
}
window.playHudSound = function (kind) {
    if (!SND.enabled) return;
    if (kind === 'seatbelt') {
        tone(1000, 0.00, 0.14, 'triangle', 1);
        tone(1000, 0.22, 0.14, 'triangle', 1);
    } else if (kind === 'fuel') {
        tone(988, 0.00, 0.45, 'sine', 1);
        tone(1976, 0.00, 0.30, 'sine', 0.25);
        tone(740, 0.30, 0.70, 'sine', 1);
        tone(1480, 0.30, 0.45, 'sine', 0.25);
    }
};
window.setHudSound = function (on, volume) {
    SND.enabled = !!on;
    if (volume !== undefined) SND.volume = clamp01(Number(volume));
};
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, getAudio, { once: true }));

let lastSeatBeep = -Infinity, lastFuelChime = -Infinity;
setInterval(() => {
    if (!SND.enabled) return;
    const now = performance.now();
    const seatWarn = state.engine && !state.belted && state.mps > SND.seatbeltMinSpeed;
    if (!seatWarn) lastSeatBeep = -Infinity;
    else if (now - lastSeatBeep >= SND.seatbeltEvery) { lastSeatBeep = now; window.playHudSound('seatbelt'); }

    const fuelWarn = state.engine && state.fuel < SND.fuelBelow;
    if (!fuelWarn) lastFuelChime = -Infinity;
    else if (now - lastFuelChime >= SND.fuelEvery) { lastFuelChime = now; window.playHudSound('fuel'); }
}, 250);

window.setSeatbeltSoundEnabled = (on) => window.setHudSound(!!on);
window.setSeatbeltVolume = (v) => { const n = parseFloat(v); if (!isNaN(n)) window.setHudSound(SND.enabled, n); };

// ---------- Pesan NUI: window.postMessage({ action: 'setEngine', state: true }) ----------
window.addEventListener('message', function (event) {
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'setDoors' || d.action === 'setDoors' || d.type === 'lock') {
        window.updateLockStatus(d.status !== undefined ? d.status : d.state);
    }
    if (d.type === 'playIntro' || d.action === 'playIntro') window.playIntro();
    if (!d.action) return;
    try {
        switch (d.action) {
            case 'setEngine': window.setEngine(d.state); break;
            case 'setSpeed': window.setSpeed(Number(d.speed) || 0); break;
            case 'setRPM': window.setRPM(Number(d.rpm) || 0); break;
            case 'setFuel': window.setFuel(Number(d.fuel) || 0); break;
            case 'setHealth': window.setHealth(Number(d.health) || 0); break;
            case 'setGear': window.setGear(d.gear !== undefined ? d.gear : 'N'); break;
            case 'setHeadlights':
            case 'setLights': window.setHeadlights(Number(d.state !== undefined ? d.state : d.lights) || 0); break;
            case 'setSeatbelts': window.setSeatbelts(!!d.state); break;
            case 'setOdometer': window.setOdometer(Number(d.distance) || 0); break;
            case 'setDimmer':
            case 'setBrightness': window.setDimmer(d.value !== undefined ? d.value : d.level !== undefined ? d.level : d.dimmer); break;
            case 'toggleVbox': window.toggleVbox(); break;
            case 'setVbox': window.setVbox(d.state !== undefined ? !!d.state : true); break;
            case 'resetVbox': window.resetVbox(); break;
            case 'muteSeatbelt': window.setSeatbeltSoundEnabled(false); break;
            case 'unmuteSeatbelt': window.setSeatbeltSoundEnabled(true); break;
            case 'setSeatbeltSound': window.setSeatbeltSoundEnabled(d.enabled !== undefined ? !!d.enabled : !d.disabled); break;
            case 'setVolume': window.setSeatbeltVolume(d.volume !== undefined ? d.volume : d.value); break;
        }
    } catch (e) { /* abaikan pesan rusak */ }
});

// ---------- Nilai awal ----------
window.setSpeed(0);
window.setRPM(0);
window.setFuel(100);
window.setHealth(1000);
window.setGear('N');
window.setHeadlights(0);
window.setDimmer(1);
window.setSeatbelts(false);
window.setEngine(false);
window.updateLockStatus(false);
window.setOdometer(0);
window.playIntro();

// ---------- VBOX Performance Box Touch ----------
// Otomatis mengukur (imperial): 0-60 mph, 0-100 mph, 0-150 mph, 60-130 mph, 1/8 mil, 1/4 mil (+ kecepatan trap).
// Mulai saat mobil berhenti total lalu jalan; ikut berjalan walau panel ditutup.
// API: toggleVbox() | setVbox(bool) | resetVbox()  (juga lewat postMessage & tombol V)
const VB_STILL = 0.28, VB_MID_A = 60 / MPS_TO_MPH, VB_MID_B = 130 / MPS_TO_MPH;
const VB_TESTS = [
    { id: 'z60',   n: '0-60',    u: 'MPH',  type: 'v', v: 60 / MPS_TO_MPH },
    { id: 'z100m', n: '0-100',   u: 'MPH',  type: 'v', v: 100 / MPS_TO_MPH },
    { id: 'z150m', n: '0-150',   u: 'MPH',  type: 'v', v: 150 / MPS_TO_MPH },
    { id: 'mid',   n: '60-130',  u: 'MPH',  type: 'mid' },
    { id: 'e',     n: '1/8',     u: 'MIL',  type: 'd', d: 201.168 },
    { id: 'q',     n: '1/4',     u: 'MIL',  type: 'd', d: 402.336 },
];
const VB = { open: false, unit: 'mph', phase: 'wait', t0: 0, dist: 0, lastT: 0, lastV: 0, stillSince: 0, g: 0, res: {}, midT: null, lastMark: 0, frozen: 0 };
(function () {
    $('vbox').innerHTML = `
    <div class="vb-top"><span class="vb-logo">VBOX</span><span class="vb-sub">PERFORMANCE BOX TOUCH</span><span class="vb-gps"><i></i>GPS 100Hz</span></div>
    <div class="vb-screen">
      <div class="vb-status" id="vb-status">STOP TO ARM</div>
      <div class="vb-main">
        <div class="vb-speed" id="vb-speed" ><b id="vb-spd">0</b><em id="vb-unit">MPH</em></div>
        <div class="vb-time"><b id="vb-t">0.00</b><em>S</em></div>
      </div>
      <div class="vb-g">G <b id="vb-g">+0.00</b></div>
      <div class="vb-rows">${VB_TESTS.map((t) => `<div class="vb-row" id="vbr-${t.id}"><span class="n">${t.n}<small>${t.u}</small></span><b class="t" id="vbt-${t.id}">--.--</b><span class="x" id="vbx-${t.id}"></span></div>`).join('')}</div>
    </div>
    <div class="vb-btns"><button type="button" id="vb-reset">RESET</button><button type="button" id="vb-close">CLOSE</button></div>`;
})();
const vbSpeedK = () => MPS_TO_MPH;   // VBOX hanya MPH
function vbRender(now) {
    const run = VB.phase === 'run', el = run ? (now - VB.t0) / 1000 : VB.frozen;
    setText($('vb-spd'), Math.round(state.mps * vbSpeedK()));
    setText($('vb-unit'), 'MPH');
    setText($('vb-t'), el.toFixed(2));
    setText($('vb-g'), (VB.g >= 0 ? '+' : '-') + Math.abs(VB.g).toFixed(2));
    const st = $('vb-status'), label = run ? 'RUNNING' : VB.phase === 'ready' ? 'READY - GO!' : 'STOP TO ARM';
    setText(st, label); if (st.className !== 'vb-status ' + VB.phase) st.className = 'vb-status ' + VB.phase;
    for (const t of VB_TESTS) {
        const r = VB.res[t.id], row = $('vbr-' + t.id);
        const live = run && !r && (t.type !== 'mid' || VB.midT !== null);
        setText($('vbt-' + t.id), r ? r.t.toFixed(2) : live ? (t.type === 'mid' ? el - VB.midT : el).toFixed(2) : '--.--');
        setText($('vbx-' + t.id), r && r.v ? Math.round(r.v * vbSpeedK()) + ' mph' : '');
        const cls = 'vb-row' + (r ? ' done' : live ? ' live' : '');
        if (row.className !== cls) row.className = cls;
    }
}
function vbTick() {
    const now = performance.now(), v = state.mps;
    if (!VB.lastT) { VB.lastT = now; VB.lastV = v; return; }
    const dt = (now - VB.lastT) / 1000, lv = VB.lastV;
    if (dt <= 0) return;
    VB.lastT = now; VB.lastV = v;
    if (dt > 0.3) return;                                   // tab sempat tertahan: lewati sampel ini
    VB.g += ((v - lv) / dt / 9.81 - VB.g) * 0.15;
    const still = v <= VB_STILL, frac = (target) => clamp01((v - target) / ((v - lv) || 1));
    if (VB.phase === 'run') {
        const prev = VB.dist, el = (now - VB.t0) / 1000;
        VB.dist += ((v + lv) / 2) * dt;
        const mark = (id, t, extra) => { VB.res[id] = Object.assign({ t }, extra); };
        for (const t of VB_TESTS) {
            if (VB.res[t.id] || t.type === 'mid') continue;
            if (t.type === 'v' && v >= t.v) { const tt = el - dt * frac(t.v); mark(t.id, tt); VB.lastMark = Math.max(VB.lastMark, tt); }
            if (t.type === 'd' && VB.dist >= t.d) { const tt = el - dt * clamp01((VB.dist - t.d) / ((VB.dist - prev) || 1)); mark(t.id, tt, { v }); VB.lastMark = Math.max(VB.lastMark, tt); }
        }
        if (!VB.res.mid) {                                  // 60 -> 130 mph (gagal kalau kecepatan turun di bawah 60 sebelum 130)
            if (lv < VB_MID_A && v >= VB_MID_A && VB.midT === null) VB.midT = el - dt * frac(VB_MID_A);
            if (VB.midT !== null && v < VB_MID_A) VB.midT = null;
            if (VB.midT !== null && v >= VB_MID_B) { const tt = el - dt * frac(VB_MID_B); mark('mid', tt - VB.midT); VB.lastMark = Math.max(VB.lastMark, tt); }
        }
        if (still) {
            if (!VB.stillSince) VB.stillSince = now;
            else if (now - VB.stillSince > 1000) { VB.frozen = VB.lastMark || (VB.stillSince - VB.t0) / 1000; VB.phase = 'ready'; }
        } else VB.stillSince = 0;
    } else if (still) {
        if (!VB.stillSince) VB.stillSince = now;
        else if (now - VB.stillSince > 400) VB.phase = 'ready';
    } else {
        VB.stillSince = 0;
        if (VB.phase === 'ready') {                         // LAUNCH: waktu 0 diinterpolasi tepat saat lepas dari diam
            VB.phase = 'run'; VB.res = {}; VB.midT = null; VB.lastMark = 0; VB.frozen = 0; VB.dist = 0;
            VB.t0 = now - dt * 1000 * frac(VB_STILL);
        }
    }
    if (VB.open) vbRender(now);
}
setInterval(vbTick, 40);
window.setVbox = function (on) {
    VB.open = !!on;
    $('vbox').classList.toggle('open', VB.open);
    $('vbox-btn').classList.toggle('on', VB.open);
    if (VB.open) vbRender(performance.now());
};
window.toggleVbox = () => window.setVbox(!VB.open);
window.resetVbox = function () {
    VB.res = {}; VB.midT = null; VB.lastMark = 0; VB.frozen = 0; VB.stillSince = 0;
    if (VB.phase === 'run') VB.phase = 'wait';
    if (VB.open) vbRender(performance.now());
};
$('vbox-btn').addEventListener('click', window.toggleVbox);
$('vb-close').addEventListener('click', () => window.setVbox(false));
$('vb-reset').addEventListener('click', window.resetVbox);
window.addEventListener('keydown', (e) => { if (e.key === 'v' || e.key === 'V') window.toggleVbox(); });
try { if (new URLSearchParams(location.search).has('nobutton')) document.body.classList.add('no-btn'); } catch (e) {}

// ---------- Demo (otomatis di preview Netlify atau dengan ?demo) ----------
const params = new URLSearchParams(location.search);
const isPreview = params.has('demo') || (/netlify\.app$/.test(location.hostname) && !params.has('nodemo'));

if (isPreview) {
    document.body.classList.add('preview');
    const btnE = $('dev-engine'), btnL = $('dev-lights'), btnD = $('dev-dim');
    const LIGHT_NAMES = ['OFF', 'LOW', 'HIGH'];
    const toggleEngine = () => { setEngine(!state.engine); };
    const cycleLights = () => { setHeadlights((state.lights + 1) % 3); };
    btnE.addEventListener('click', toggleEngine);
    btnL.addEventListener('click', cycleLights);
    const DIMS = [1, 0.7, 0.4, 0.2];
    const cycleDim = () => { setDimmer(DIMS[(DIMS.findIndex((d) => Math.abs(d - state.dimmer) < 0.01) + 1) % DIMS.length]); };
    btnD.addEventListener('click', cycleDim);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'e' || e.key === 'E') toggleEngine();
        if (e.key === 'l' || e.key === 'L') cycleLights();
        if (e.key === 'd' || e.key === 'D') cycleDim();
    });

    const GEAR_TOP = [0, 40, 68, 100, 138, 178, 222];
    let mps = 0, gear = 1, throttle = true, odo = 18452.3, health = 1000, fuel = 86;
    setInterval(() => {
        btnE.textContent = 'Mesin: ' + (state.engine ? 'ON' : 'OFF');
        btnE.classList.toggle('on', state.engine);
        btnL.textContent = 'Lampu: ' + LIGHT_NAMES[state.lights];
        btnL.classList.toggle('on', state.lights > 0);
        btnD.textContent = 'Dimmer: ' + Math.round(state.dimmer * 100) + '%';

        if (!state.engine || performance.now() < bootUntil) {   // mesin mati / masih menyapu: mobil diam
            mps = 0; gear = 1; throttle = true;
            setSpeed(0); setRPM(0); setGear('N');
            return;
        }
        const mph = mps * MPS_TO_MPH;
        if (throttle) mps += 0.38 / gear; else mps -= 0.55;
        if (mph > 195) throttle = false;
        if (mps <= 0) { mps = 0; throttle = true; }
        while (gear < 6 && mph > GEAR_TOP[gear]) gear++;
        while (gear > 1 && mph < GEAR_TOP[gear - 1] - 6) gear--;
        const lo = GEAR_TOP[gear - 1], hi = GEAR_TOP[gear];
        const rpm = 0.11 + clamp01((mph - lo) / (hi - lo)) * (throttle ? 0.89 : 0.6);
        health = Math.max(180, health - 0.9); if (health <= 180) health = 1000;
        fuel = fuel <= 4 ? 86 : fuel - 0.02;
        odo += (mph * 0.05) / 3600;
        setSpeed(mps); setRPM(rpm); setGear(gear); setHealth(health); setFuel(fuel); setOdometer(odo);
    }, 50);
    setTimeout(() => { setSeatbelts(true); updateLockStatus(false); }, 1500);
}
