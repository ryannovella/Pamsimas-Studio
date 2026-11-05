---
title: Studio
emoji: 💧
colorFrom: blue
colorTo: indigo
sdk: gradio
app_file: run_server.py
app_port: 7860
pinned: false
---

# Pamsimas Studio - Generator Laporan Word Monev

Aplikasi otomasi pembuatan dokumen laporan monitoring dan evaluasi (Monev) program Pamsimas lengkap dengan stempel foto geotag/timestamping, narasi otomatis AI (Gemini), dan formatting standar resmi dokumen Word (.docx).

## Fitur Utama
- **Stempel Geotagging & Timestamping Otomatis:** Deteksi EXIF tanggal, koordinat GPS, dan format visual resmi.
- **AI Village Narrative:** Draft narasi kegiatan desa otomatis menggunakan Google Gemini API atau deterministic local fallback.
- **Smart Timeline:** Rekonstruksi jadwal dan rute monev dari foto lapangan secara otomatis.
- **Word Document (.docx) Generator:** Menghasilkan dokumen laporan siap pakai dengan layout, pagination, dan tabel yang presisi.

## Menjalankan Secara Mandiri
1. Pastikan Docker terpasang.
2. Build image: `docker build -t pamsimas-studio .`
3. Jalankan container: `docker run -p 7860:7860 -e GEMINI_API_KEY="your-key" pamsimas-studio`
4. Akses melalui browser di `http://localhost:7860`.
