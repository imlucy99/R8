/* =========================================================
   TEMA SPEEDO (warna) - ikut tersinkron lewat room Firebase yang sama dengan music.js
   Yang diatur dari remote.html:  preset warna / warna bebas, dimmer, ukuran HUD.
   Hanya mengubah variabel CSS, bentuk dial tetap Audi R8 Optitron.
   URL opsional (menimpa room):  ?theme=biru   ?theme=custom&main=ff8800&ink=ffffff   ?notheme
   Preset: merah, biru, cyan, hijau, amber, pink, ungu, putih
   Perlu music.js dimuat lebih dulu (konfigurasi database dibaca dari sana).
   ========================================================= */
(function () {
    const PRESETS = {
        biru: '#2f7bff', cyan: '#19d3ff', hijau: '#22d65a', amber: '#ffb000',
        pink: '#ff4fa3', ungu: '#a65cff', putih: '#f2f4f8',
    };
    const VARS = ['--zone', '--ndl-off', '--ndl-mid', '--ndl-on', '--glow', '--edge', '--accent', '--tkred', '--ink'];
    const root = document.documentElement;
    const q = new URLSearchParams(location.search);
    if (q.has('notheme')) return;

    const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
    const norm = (s) => { s = String(s || '').trim(); if (/^[0-9a-f]{6}$/i.test(s)) s = '#' + s; return isHex(s) ? s.toLowerCase() : ''; };
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
    const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    const mix = (h, t, k) => { const a = rgb(h), b = rgb(t); return hex(a.map((v, i) => v + (b[i] - v) * k)); };

    function apply(t) {
        VARS.forEach((v) => root.style.removeProperty(v));
        root.style.removeProperty('--scale');
        t = t || {};
        let main = '', ink = norm(t.ink);
        if (t.preset === 'custom') main = norm(t.main);
        else if (PRESETS[t.preset]) main = PRESETS[t.preset];
        if (main) {
            const set = (k, v) => root.style.setProperty(k, v);
            set('--zone', mix(main, '#000000', 0.12));
            set('--ndl-on', main);
            set('--glow', mix(main, '#ffffff', 0.1));
            set('--ndl-mid', mix(main, '#000000', 0.45));
            set('--ndl-off', mix(main, '#000000', 0.75));
            set('--edge', mix(main, '#000000', 0.1));
            set('--accent', main);
            set('--tkred', mix(main, '#ffffff', 0.45));
        }
        if (ink) root.style.setProperty('--ink', ink);
        const sc = parseFloat(t.scale);
        if (!isNaN(sc)) root.style.setProperty('--scale', String(Math.max(0.3, Math.min(1.2, sc))));
        const dm = parseFloat(t.dim);
        if (!isNaN(dm) && dm !== apply.lastDim && typeof window.setDimmer === 'function') { apply.lastDim = dm; window.setDimmer(dm); }
    }
    window.setSpeedoTheme = apply;

    // Tema dari URL (prioritas tertinggi, tidak ikut room)
    if (q.has('theme')) {
        apply({ preset: q.get('theme'), main: q.get('main'), ink: q.get('ink') });
        return;
    }

    // Tema terakhir dari cache supaya tidak berkedip saat dibuka
    const cache = (v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('speedoTheme') || 'null'); localStorage.setItem('speedoTheme', JSON.stringify(v)); } catch (e) { return null; } };
    const cached = cache();
    if (cached) apply(cached);

    const cfg = window.SPEEDO_CFG || {};
    if (!cfg.db) return;
    const url = `${cfg.db}/rooms/${cfg.room}/theme.json`;

    function onTheme(t) { apply(t); cache(t || {}); }
    async function fetchTheme() { try { onTheme(await (await fetch(url)).json()); } catch (e) {} }

    let poll = 0;
    try {
        const es = new EventSource(url);
        es.addEventListener('put', (ev) => {
            let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m.path === '/') onTheme(m.data); else fetchTheme();
        });
        es.addEventListener('patch', fetchTheme);
        es.onerror = () => { if (!poll) poll = setInterval(fetchTheme, 5000); };
        es.onopen = () => { if (poll) { clearInterval(poll); poll = 0; } };
    } catch (e) { poll = setInterval(fetchTheme, 5000); fetchTheme(); }
})();
