/* =========================================================
   MUSIK SINKRON (penumpang ikut dengar)  -  Firebase Realtime Database (REST + SSE)
   Cara kerja:
     - Semua yang menjalankan speedo ini masuk ke "room" yang sama.
     - Halaman remote.html menulis state lagu ke database (url, play/pause, posisi).
     - Setiap speedo membaca state itu dan memutar audio sendiri di posisi yang sama.
   Konfigurasi: isi MUSIC_DB_URL di bawah (lihat SETUP-MUSIK.md), atau lewat URL: ?db=...&room=...
   API (opsional, dari game): setMusicVolume(0-1), setMusicEnabled(bool)
   ========================================================= */
(function () {
    // ====== ISI INI ======
    const MUSIC_DB_URL = 'https://nothinc99-default-rtdb.asia-southeast1.firebasedatabase.app/';          // contoh: 'https://nama-project-default-rtdb.asia-southeast1.firebasedatabase.app'
    const MUSIC_ROOM = 'rh7-x93kq'; // nama room (buat susah ditebak, siapa pun yang tahu bisa mengontrol)
    // =====================

    const q = new URLSearchParams(location.search);
    const DB = (q.get('db') || MUSIC_DB_URL).replace(/\/+$/, '');
    const ROOM = (q.get('room') || MUSIC_ROOM).replace(/[.#$\[\]\/]/g, '_');
    window.SPEEDO_CFG = { db: DB, room: ROOM };   // dipakai juga oleh theme.js
    const box = document.getElementById('music');
    if (!box) return;
    if (!DB) { console.warn('[music] MUSIC_DB_URL belum diisi'); return; }
    if (q.has('nomusic')) return;

    const elTitle = document.getElementById('music-title');
    const elTime = document.getElementById('music-time');
    const stateUrl = `${DB}/rooms/${ROOM}/state.json`;

    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';

    let enabled = true, localVol = 1;
    let st = null;              // state terakhir dari room
    let offset = 0;             // selisih jam server - jam lokal (ms)
    let curKey = '';            // url+idx yang sedang dimuat
    let retryTimer = 0;

    const serverNow = () => Date.now() + offset;
    const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

    // ---------- Sinkron jam dengan server Firebase (ambil RTT terkecil dari 3 kali ukur) ----------
    async function syncClock() {
        const id = Math.random().toString(36).slice(2, 8);
        const url = `${DB}/rooms/${ROOM}/ping/${id}.json`;
        let best = null;
        for (let i = 0; i < 3; i++) {
            try {
                const t0 = Date.now();
                const r = await fetch(url, { method: 'PUT', body: JSON.stringify({ '.sv': 'timestamp' }) });
                const sv = await r.json();
                const t1 = Date.now();
                if (typeof sv === 'number' && (!best || t1 - t0 < best.rtt)) best = { rtt: t1 - t0, off: sv - (t0 + t1) / 2 };
            } catch (e) {}
        }
        fetch(url, { method: 'DELETE' }).catch(() => {});
        if (best) offset = best.off;
    }

    // ---------- Terapkan state ke audio ----------
    function target() {
        if (!st || !st.queue || !st.queue.length) return null;
        const tr = st.queue[st.idx || 0];
        if (!tr || !tr.url) return null;
        const pos = (st.pos || 0) + (st.playing ? (serverNow() - (st.at || serverNow())) / 1000 : 0);
        return { tr, pos: Math.max(0, pos) };
    }

    function apply() {
        clearTimeout(retryTimer);
        const t = target();
        if (!t || !enabled) {
            audio.pause();
            box.classList.remove('show', 'on');
            return;
        }
        const key = t.tr.url + '#' + (st.idx || 0) + '#' + (st.rev || 0);
        if (key !== curKey) {
            curKey = key;
            audio.src = t.tr.url;
            audio.load();
        }
        audio.volume = Math.max(0, Math.min(1, (st.vol == null ? 0.8 : st.vol) * localVol));
        setCls(t.tr.title || t.tr.url);
        if (!st.playing) {
            audio.pause();
            box.classList.remove('on');
            const p = t.pos;
            if (isFinite(p) && Math.abs(audio.currentTime - p) > 0.5) try { audio.currentTime = p; } catch (e) {}
            return;
        }
        const go = () => {
            const tt = target();
            if (!tt) return;
            if (isFinite(tt.pos) && Math.abs(audio.currentTime - tt.pos) > 0.35) { try { audio.currentTime = tt.pos; } catch (e) {} }
            audio.play().then(() => box.classList.add('on')).catch(() => { retryTimer = setTimeout(apply, 1500); });
        };
        if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once: true });
    }

    function setCls(title) {
        box.classList.add('show');
        if (elTitle.textContent !== title) elTitle.textContent = title;
    }

    // Koreksi drift tiap 5 detik
    setInterval(() => {
        const t = target();
        if (!t || !st.playing || audio.paused || !isFinite(t.pos)) return;
        if (Math.abs(audio.currentTime - t.pos) > 0.8) { try { audio.currentTime = t.pos; } catch (e) {} }
    }, 5000);

    // Waktu tampil
    setInterval(() => {
        if (!box.classList.contains('show')) return;
        const d = isFinite(audio.duration) ? ' / ' + fmt(audio.duration) : '';
        elTime.textContent = fmt(audio.currentTime) + d;
    }, 500);

    // ---------- Lagu habis -> lanjut ke berikutnya (conditional PUT dengan ETag, hanya satu klien yang menang) ----------
    audio.addEventListener('ended', async () => {
        if (!st) return;
        const endedIdx = st.idx || 0;
        try {
            const r = await fetch(stateUrl, { headers: { 'X-Firebase-ETag': 'true' } });
            const etag = r.headers.get('ETag');
            const cur = await r.json();
            if (!cur || (cur.idx || 0) !== endedIdx) return;           // sudah diganti klien lain
            const n = cur.queue ? cur.queue.length : 0;
            const nextIdx = endedIdx + 1;
            const next = Object.assign({}, cur, {
                idx: nextIdx < n ? nextIdx : (cur.loop ? 0 : endedIdx),
                playing: nextIdx < n || !!cur.loop,
                pos: 0,
                at: { '.sv': 'timestamp' },
                rev: (cur.rev || 0) + 1,
            });
            await fetch(stateUrl, { method: 'PUT', headers: etag ? { 'if-match': etag } : {}, body: JSON.stringify(next) });
        } catch (e) {}
    });

    audio.addEventListener('error', () => {
        if (st && st.playing) { elTime.textContent = 'ERROR'; retryTimer = setTimeout(() => { curKey = ''; apply(); }, 4000); }
    });

    // ---------- Ambil & dengarkan state ----------
    function onState(data) { st = data; apply(); }
    async function fetchState() {
        try { onState(await (await fetch(stateUrl)).json()); } catch (e) {}
    }

    let es = null, poll = 0;
    function listen() {
        try {
            es = new EventSource(stateUrl);
            es.addEventListener('put', (ev) => {
                let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
                if (m.path === '/') onState(m.data); else fetchState();
            });
            es.addEventListener('patch', fetchState);
            es.onerror = () => {                                    // stream putus: pakai polling sambil menunggu EventSource sambung lagi
                if (!poll) poll = setInterval(fetchState, 3000);
            };
            es.onopen = () => { if (poll) { clearInterval(poll); poll = 0; } };
        } catch (e) {
            poll = setInterval(fetchState, 3000);
        }
    }

    // Antisipasi autoplay terblokir: coba lagi saat ada interaksi
    ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { if (st && st.playing && audio.paused) apply(); }));

    window.setMusicVolume = (v) => { const n = parseFloat(v); if (!isNaN(n)) { localVol = Math.max(0, Math.min(1, n)); apply(); } };
    window.setMusicEnabled = (on) => { enabled = !!on; apply(); };
    window.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || typeof d !== 'object') return;
        if (d.action === 'setMusicVolume') window.setMusicVolume(d.volume !== undefined ? d.volume : d.value);
        if (d.action === 'setMusicEnabled') window.setMusicEnabled(d.state !== undefined ? d.state : d.enabled);
    });

    syncClock().then(() => { fetchState(); listen(); });
    setInterval(syncClock, 5 * 60 * 1000);                          // koreksi jam tiap 5 menit
})();
