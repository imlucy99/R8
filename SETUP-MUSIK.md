# Setup Musik Sinkron (Firebase gratis)

Fitur ini membuat lagu yang kamu putar terdengar juga oleh penumpang yang memakai speedo yang sama. Tidak perlu akses server game, cukup satu database Firebase gratis sebagai "ruang" bersama.

## File yang berubah / bertambah

| File | Status | Keterangan |
|---|---|---|
| `index.html` | diubah | menambah strip "now playing" dan `<script src="music.js">` |
| `styles.css` | diubah | gaya strip now playing (bagian paling bawah) |
| `music.js` | baru | pemutar audio sinkron di dalam speedo |
| `remote.html` | baru | halaman kontrol untuk HP/PC |
| `script.js` | tidak diubah | |

Upload semuanya ke repo GitHub Pages yang sama (`imlucy99.github.io/RH7/`).

## 1. Buat database Firebase (sekali saja, gratis)

1. Buka https://console.firebase.google.com lalu login dengan akun Google.
2. Klik **Create a project** (Add project), isi nama bebas, matikan Google Analytics, lalu **Create**.
3. Di menu kiri pilih **Build > Realtime Database**, klik **Create Database**.
4. Pilih lokasi **Singapore** (`asia-southeast1`) supaya cepat dari Indonesia.
5. Pilih **Start in test mode**, lalu **Enable**.
6. Salin **alamat database** yang tampil di bagian atas halaman Data, bentuknya seperti:
   `https://nama-project-default-rtdb.asia-southeast1.firebasedatabase.app`

## 2. Atur aturan (Rules)

Test mode kedaluwarsa dalam 30 hari. Buka tab **Rules**, ganti isinya dengan ini lalu **Publish**:

```json
{
  "rules": {
    "rooms": {
      "$room": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Artinya hanya path `rooms/<nama-room>` yang bisa dibaca dan ditulis, dan tidak ada batas waktu.

## 3. Isi konfigurasi di `music.js`

Buka `music.js`, cari bagian paling atas:

```js
const MUSIC_DB_URL = '';              // tempel alamat database di sini
const MUSIC_ROOM = 'garasi-lucy';     // nama room
```

- Tempel alamat database dari langkah 1 ke `MUSIC_DB_URL`.
- Ganti `MUSIC_ROOM` dengan nama yang susah ditebak, misalnya `rh7-x93kq`. Siapa pun yang tahu alamat database dan nama room bisa mengontrol musikmu.

Commit dan push ke GitHub, tunggu beberapa menit sampai GitHub Pages memperbarui.

## 4. Pakai remote

1. Buka `https://imlucy99.github.io/RH7/remote.html` di HP atau PC.
2. Buka **Pengaturan room**, isi Database URL dan nama room yang sama dengan `music.js`, lalu **Simpan & sambung**. Pengaturan tersimpan di browser.
3. Tempel link lagu (harus link langsung ke file audio, misalnya `.mp3`), lalu **Tambah & putar**.
4. Di game, speedo kamu dan speedo penumpang akan menampilkan strip "now playing" di atas dial dan memutar lagu di detik yang sama.

Tips: simpan alamat remote sebagai bookmark atau pasang ke layar utama HP.

## Soal link lagu

- Harus link langsung ke file audio (`.mp3`, `.ogg`, `.m4a`, atau stream radio). Link halaman YouTube, Spotify, atau SoundCloud tidak bisa diputar.
- Server file harus mengizinkan diputar dari situs lain. GitHub (raw / Pages), Dropbox (`?dl=1`), dan kebanyakan hosting mp3 aman. Kalau tidak bunyi, coba link lain.
- Cara paling aman: taruh file mp3 di repo GitHub yang sama (folder `musik/`), lalu pakai alamat `https://imlucy99.github.io/RH7/musik/lagu.mp3`. Ukuran file maksimal 100 MB, dan sebaiknya jangan memakai lagu berhak cipta kalau repo kamu publik.

## Cara kerja singkat

- Remote menulis `url`, status play/pause, posisi, dan volume ke `rooms/<room>/state`.
- Setiap speedo mendengarkan perubahan itu lewat koneksi realtime (dengan cadangan polling tiap 3 detik).
- Posisi lagu dihitung dari jam server Firebase, jadi tiap pemain berada di detik yang sama. Penumpang yang baru naik langsung nyambung di tengah lagu, dan drift dikoreksi tiap 5 detik.
- Saat satu lagu selesai, salah satu speedo otomatis memajukan antrean ke lagu berikutnya.

## Kalau tidak jalan

- **Tidak ada strip now playing:** `MUSIC_DB_URL` masih kosong, atau antrean di remote kosong.
- **Strip muncul tapi tidak ada suara:** game/CEF memblokir autoplay atau link lagu tidak bisa diputar. Coba link `.mp3` dari GitHub.
- **Remote bilang "Tidak bisa terhubung":** alamat database salah (harus tanpa `/` di belakang) atau Rules belum di-publish.
- **Penumpang tidak dengar:** pastikan speedo penumpang benar-benar ikut berganti saat masuk mobil, dan server RP mengizinkan koneksi keluar dari CEF. Tes dengan membuka `index.html?demo` di browser biasa: kalau musik jalan di browser tapi tidak di game, penyebabnya ada di sisi game/server.
- **Aturan server:** cek peraturan servermu soal speedo custom dan koneksi eksternal.

Parameter URL opsional pada speedo: `?db=...&room=...` (menimpa konfigurasi) dan `?nomusic` (menonaktifkan musik).
