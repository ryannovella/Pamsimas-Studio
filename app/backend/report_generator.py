import os
import io
import re
import json
import requests
import subprocess
import tempfile
import shutil
from typing import List, Dict, Any, Optional
from datetime import datetime
from PIL import Image, ImageOps

try:
    import pypdf  # type: ignore
except ImportError:
    pypdf = None

import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from app.backend.config import (
    BASE_DIR, OUTPUT_DIR, STAMP_FONT_PATH, FALLBACK_FONT_PATH
)
from app.backend.stamper import apply_stamp
from app.backend.logger import log_error

DEFAULT_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-3.1-flash-lite"

SYSTEM_INSTRUCTION_ANTI_SLOP = """Anda adalah penyusun laporan teknis resmi Kegiatan Pamsimas (Penyediaan Air Minum dan Sanitasi Berbasis Masyarakat) Balai Prasarana Permukiman Wilayah (BPPW / BPBPK) Jawa Tengah, Kementerian Pekerjaan Umum (Kementerian PU).

TUGAS UTAMA:
Ubah catatan mentah / temuan lapangan menjadi butir narasi teknis kedinasan resmi dengan elaborasi kalimat yang komprehensif, terstruktur, lugas, dan kontekstual dengan kegiatan Pamsimas.

ATURAN KRITIS ANTI-PEMALSUAN DATA & EKSKLUSIVITAS SUMBER (STRICT FACTUAL GROUNDING):
1. DILARANG KERAS MENGADA-ADAKAN DATA ATAU ASPEK YANG TIDAK TERCANTUM DI CATATAN LAPANGAN:
   - Apabila di catatan lapangan TIDAK MENYEBUTKAN data progres fisik (persentase fisik atau realisasi fisik), MAKA DILARANG KERAS menulis atau memunculkan butir/kalimat tentang 'Progres fisik'.
   - Apabila di catatan lapangan TIDAK MENYEBUTKAN data keuangan (persentase penyerapan dana, pencairan anggaran, SPJ), MAKA DILARANG KERAS menulis atau memunculkan butir/kalimat tentang 'Progres keuangan'.
   - Begitu pula aspek lain (opsi sistem, pengadaan pipa, sambungan rumah/SR, kendala, rekomendasi): JANGAN PERNAH memaksakan menulis butir tersebut jika topiknya tidak disinggung di catatan lapangan.
   - Peringatan tegas kedinasan: Mengarang, memperkirakan, atau memunculkan aspek yang tidak ada di catatan lapangan merupakan INDIKASI PEMALSUAN DOKUMEN LAPORAN RESMI.
2. BATASAN RUANG LINGKUP ELABORASI:
   - HANYA elaborasi, perluas kalimat maupun paragraf, dan jabarkan secara teknis-kedinasan aspek-aspek yang BENAR-BENAR TERDAPAT pada catatan lapangan.
   - Contoh: Jika catatan lapangan hanya berisi "Pengeboran sumur sedalam 90 meter dengan debit 2 liter/detik, ditemui lapisan batuan andesit keras pada kedalaman 60-75 meter", maka narasi HANYA boleh mengelaborasi teknis pengeboran sumur, perolehan debit air, serta kendala formasi batuan andesit dan penanganannya. JANGAN menulis progres fisik sekian persen atau progres keuangan sekian persen!
3. DILARANG KERAS MENGGUNAKAN KATA: 'proyek', 'program', 'program pamsimas', 'pupr', 'kementerian pupr', 'kementrian pupr', 'pekerjaan umum dan perumahan rakyat', 'kemenpupr'! Selalu gunakan istilah resmi kedinasan: 'Kementerian PU', 'kegiatan', 'kegiatan Pamsimas', 'pekerjaan', atau 'pembangunan sarana air minum'.
4. DILARANG menggunakan tanda em dash ('—'). Gunakan tanda koma (,), titik (.), titik dua (:), atau tanda kurung ().
5. DILARANG pembuka klise AI atau bunga kata (seperti 'Dalam lanskap...', 'Menandakan era baru...', 'Patut dicatat...', 'Tentunya...', 'Menunjukkan komitmen tak tergoyahkan').
6. DILARANG kesimpulan filosofis kosong di akhir poin.
7. DILARANG KERAS MENGULANG KATA ATAU FRASA BERTURUT-TURUT (ANTI-DUPLIKASI): Jangan pernah menghasilkan duplikasi kalimat atau frasa seperti 'dialirkan menuju dialirkan menuju'.
8. Gaya bahasa kedinasan teknis Kementerian PU: lugas, faktual, presisi, padat, berorientasi data riil dan solusi kendala lapangan.

FORMAT STRUKTUR OUTPUT (SESUAI KAIDAH KBBI):
- Awali dengan kalimat pengantar:
  Hasil monitoring dan evaluasi pelaksanaan Kegiatan Pamsimas TA [Tahun] di Desa [Desa], Kecamatan [Kecamatan], Kabupaten [Kabupaten], kondisi per [Tanggal] adalah sebagai berikut:
- Diikuti butir-butir terstruktur (HANYA UNTUK TOPIK YANG RELEVAN DAN ADA DI CATATAN):
  * **[Nama Topik]:** [Penjabaran komprehensif, perluasan kalimat dan paragraf dari catatan]
  (Label butir disesuaikan secara dinamis dengan isi catatan, contohnya:
   - Jika ada data progres fisik: * **Progres fisik:** Realisasi capaian pekerjaan fisik sebesar...
   - Jika ada data progres keuangan: * **Progres keuangan:** Realisasi penyerapan dana sebesar...
   - Jika ada teknis sarana / sumber air: * **Pekerjaan sarana air minum:** ... atau * **Pengeboran sumur:** ...
   - Jika ada perpipaan: * **Pemasangan jaringan perpipaan:** ...
   - Jika ada sambungan rumah: * **Sambungan rumah (SR):** ...
   - Jika ada kendala: * **Kendala dan permasalahan:** ...
   - Jika ada tindak lanjut: * **Tindak lanjut & rekomendasi:** ...
   - Jika berupa catatan temuan lain: Gunakan label topik yang relevan secara kontekstual).

ATURAN KBBI & TATA BAHASA KEDINASAN:
- Wajib gunakan format bold pada label butir dan SELALU beri 1 spasi setelah titik dua (contoh: '* **Topik:** Penjelasan...'). DILARANG MENEMPELKAN KATA TANPA SPASI SETELAH TITIK DUA.
- DILARANG menggunakan spasi ganda (double space) di antara kata maupun setelah tanda baca.
- Angka persentase desimal ditulis menggunakan tanda koma dan menempel tanpa spasi sebelum tanda persen sesuai KBBI (contoh: 23,12% bukan 23.12% atau 23,12 %).
- Penulisan nominal mata uang Rupiah ditulis tanpa titik dan tanpa spasi setelah lambang Rp (contoh: Rp15.000.000).
- Apabila catatan lapangan menggunakan bahasa kiasan, istilah sehari-hari, atau ungkapan tidak baku, terjemahkan dan sarikan maknanya menjadi bahasa teknis kedinasan yang netral, sopan, dan objektif. DILARANG mengeluarkan kalimat meta-percakapan AI seperti 'Mohon maaf, saya tidak dapat...' atau 'Jika Anda memiliki catatan...'.
- Hasilkan narasi siap pakai dalam format teks paragraf dan butir poin yang rapi tanpa markdown berlebih."""


def is_ai_refusal_text(text: str) -> bool:
    """Mendeteksi apakah output model AI merupakan kalimat penolakan (safety/policy refusal) dan bukan narasi laporan."""
    if not text:
        return False
    t_low = text.strip().lower()
    refusal_patterns = [
        r"\bmohon\s+maaf\s*,\s*saya\s+tidak\s+dapat\b",
        r"\bsaya\s+tidak\s+dapat\s+menyusun\s+laporan\b",
        r"\bsaya\s+tidak\s+diizinkan\s+untuk\s+memproses\b",
        r"\bberdasarkan\s+pedoman\s+keselamatan\b",
        r"\bkebijakan\s+konten\b",
        r"\bjika\s+anda\s+memiliki\s+catatan\s+lapangan\s+teknis\b",
        r"\bi\s+cannot\s+fulfill\s+this\s+request\b",
        r"\bsebagai\s+(?:model\s+bahasa|asisten)\s+ai\b",
    ]
    return any(re.search(pat, t_low) for pat in refusal_patterns)


def sanitize_pamsimas_text(text: str) -> str:
    """
    Menyelaraskan teks narasi laporan agar mematuhi standar resmi Pamsimas & KBBI:
    1. Menghilangkan kata 'proyek', 'program', 'program pamsimas' secara ketat.
    2. Menghilangkan kata 'pupr', 'kementerian pupr', 'pekerjaan umum dan perumahan rakyat' -> resmi 'Kementerian PU'.
    3. Menjaga kapitalisasi kata (misal 'Program Pamsimas' -> 'Kegiatan Pamsimas', 'program' -> 'kegiatan').
    4. Normalisasi tanda baca & ejaan baku KBBI:
       - 1 spasi setelah titik dua (kecuali waktu jam, e.g. 09:14)
       - Desimal persentase menggunakan tanda koma tanpa spasi sebelum % (e.g. 23,12%)
       - Mata uang Rupiah tanpa titik dan tanpa spasi (e.g. Rp10.000)
       - 1 spasi setelah tanda koma, titik koma, dan titik kalimat jika menempel huruf
       - Menghapus tanda em dash '—' menjadi tanda koma
       - Menghilangkan seluruh spasi ganda (double space)
    """
    if not text:
        return ""

    # Normalisasi tanda baca & diksi KBBI
    # Ganti em dash
    text = text.replace("—", ", ")

    # Ejaan baku kata umum sesuai KBBI V
    text = re.sub(r"(?i)\bkementrian\b", "Kementerian", text)
    text = re.sub(r"(?i)\bdikarenakan\b", "karena", text)
    text = re.sub(r"(?i)\bdi\s+karenakan\b", "karena", text)
    text = re.sub(r"(?i)\bmerubah\b", "mengubah", text)
    text = re.sub(r"(?i)\bmempengaruhi\b", "memengaruhi", text)
    text = re.sub(r"(?i)\bmensosialisasikan\b", "menyosialisasikan", text)
    text = re.sub(r"(?i)\bmengkordinasikan\b", "mengoordinasikan", text)
    text = re.sub(r"(?i)\bstandard\b", "standar", text)
    text = re.sub(r"(?i)\bkwalitas\b", "kualitas", text)
    text = re.sub(r"(?i)\bdebet\b", "debit", text)
    text = re.sub(r"(?i)\bpraktek\b", "praktik", text)
    text = re.sub(r"(?i)\bresiko\b", "risiko", text)
    text = re.sub(r"(?i)\bjadual\b", "jadwal", text)
    text = re.sub(r"(?i)\banalisa\b", "analisis", text)
    text = re.sub(r"(?i)\befektip\b", "efektif", text)
    text = re.sub(r"(?i)\befisiend\b", "efisien", text)
    text = re.sub(r"(?i)\baksesoris\b", "aksesori", text)
    text = re.sub(r"(?i)\breservoar\b", "reservoir", text)
    text = re.sub(r"(?i)\baktifitas\b", "aktivitas", text)
    text = re.sub(r"(?i)\bproduktifitas\b", "produktivitas", text)
    text = re.sub(r"(?i)\befektifitas\b", "efektivitas", text)
    text = re.sub(r"(?i)\bkreatifitas\b", "kreativitas", text)
    text = re.sub(r"(?i)\b(?:prosentase|presentase)\b", "persentase", text)
    text = re.sub(r"(?i)\bpondasi\b", "fondasi", text)
    text = re.sub(r"(?i)\blobang\b", "lubang", text)
    text = re.sub(r"(?i)\bkran\b", "keran", text)
    text = re.sub(r"(?i)\bsurvey\b", "survei", text)
    text = re.sub(r"(?i)\bkomplit\b", "lengkap", text)
    text = re.sub(r"(?i)\bkerjasama\b", "kerja sama", text)
    text = re.sub(r"(?i)\btindaklanjut\b", "tindak lanjut", text)
    text = re.sub(r"(?i)\bujicoba\b", "uji coba", text)
    text = re.sub(r"(?i)\bserahterima\b", "serah terima", text)
    text = re.sub(r"(?i)\bpertanggung\s+jawaban\b", "pertanggungjawaban", text)
    text = re.sub(r"(?i)\bnon\s+fisik\b", "nonfisik", text)
    text = re.sub(r"(?i)\bnon\s+teknis\b", "nonteknis", text)
    text = re.sub(r"(?i)\bantar\s+desa\b", "antardesa", text)
    text = re.sub(r"(?i)\bantar\s+pihak\b", "antarpihak", text)
    text = re.sub(r"(?i)\bantar\s+titik\b", "antartitik", text)
    text = re.sub(r"(?i)\bsub\s+sistem\b", "subsistem", text)
    text = re.sub(r"(?i)\b(?:pasca|paska)\s+konstruksi\b", "pascakonstruksi", text)
    text = re.sub(r"(?i)\b(?:pasca|paska)\s+pelaksanaan\b", "pascapelaksanaan", text)
    text = re.sub(r"(?i)\bPJ(?:\.|\b)(?=\s+(?:Kepala\s+Desa|Kades|Bupati|Gubernur|Walikota|Wali\s+Kota))", "Pj.", text)
    text = re.sub(r"(?i)\bPLT(?:\.|\b)", "Plt.", text)

    # 1. Hindari kata 'program pamsimas' / 'proyek pamsimas'
    text = re.sub(r"(?i)\bprogram\s+pamsimas\b", "Kegiatan Pamsimas", text)
    text = re.sub(r"(?i)\bproyek\s+pamsimas\b", "Kegiatan Pamsimas", text)

    # 2. Hindari nomenklatur lama PUPR -> kini resmi Kementerian PU (Kementerian Pekerjaan Umum)
    # 2a. Frasa lengkap Kementerian Pekerjaan Umum dan Perumahan Rakyat (opsional diikuti (PUPR))
    text = re.sub(
        r"(?i)\bkementerian\s+pekerjaan\s+umum\s+dan\s+perumahan\s+rakyat(?:\s*[\(\[]\s*pupr\s*[\)\]])?\b",
        "Kementerian PU",
        text
    )

    # 2b. Dinas PUPR / Dinas Pekerjaan Umum dan Perumahan Rakyat -> Dinas PU
    text = re.sub(
        r"(?i)\bdinas\s+pekerjaan\s+umum(?:\s+dan\s+(?:perumahan\s+rakyat|penataan\s+ruang))?(?:\s*[\(\[]\s*pupr\s*[\)\]])?\b",
        "Dinas PU",
        text
    )
    text = re.sub(r"(?i)\bdinas\s+pupr\b", "Dinas PU", text)

    # 2c. Kementerian PUPR / Kemen PUPR / Kemenpupr -> Kementerian PU
    text = re.sub(r"(?i)\b(?:kementerian|kemen)\s*pupr\b", "Kementerian PU", text)
    text = re.sub(r"(?i)\bkemenpupr\b", "Kementerian PU", text)

    # 2d. Singkatan (PUPR) yang menempel setelah Kementerian PU
    text = re.sub(r"(?i)\bKementerian\s+PU\s*[\(\[]\s*pupr\s*[\)\]]", "Kementerian PU", text)

    # 2e. Frasa pekerjaan umum dan perumahan rakyat mandiri
    text = re.sub(r"(?i)\bpekerjaan\s+umum\s+dan\s+perumahan\s+rakyat\b", "Pekerjaan Umum", text)

    # 2f. Singkatan PUPR mandiri -> Kementerian PU
    text = re.sub(r"(?i)\bpupr\b", "Kementerian PU", text)

    # 2g. Reduksi dobel jika ada 'Kementerian Kementerian PU'
    text = re.sub(r"(?i)\bKementerian\s+Kementerian\s+PU\b", "Kementerian PU", text)

    # 3. Hindari kata 'proyek' / 'proyek-proyek'
    def replace_proyek(match):
        w = match.group(0)
        if w.isupper():
            return "KEGIATAN"
        elif w[0].isupper():
            return "Kegiatan"
        else:
            return "kegiatan"

    text = re.sub(r"\bproyek(?:-proyek)?\b", replace_proyek, text, flags=re.I)

    # 4. Hindari kata 'program' / 'program-program'
    def replace_program(match):
        w = match.group(0)
        if w.isupper():
            return "KEGIATAN"
        elif w[0].isupper():
            return "Kegiatan"
        else:
            return "kegiatan"

    text = re.sub(r"\bprogram(?:-program)?\b", replace_program, text, flags=re.I)

    # 5. Normalisasi tanda baca sesuai KBBI & EYD V:
    # 5a. Hapus spasi sebelum titik dua, titik koma, koma, titik, tanda seru, tanda tanya, persen, dan kurung tutup
    text = re.sub(r'[ \t]+([:;,.!?%)\]])', r'\1', text)
    # Hapus spasi tepat setelah kurung buka
    text = re.sub(r'([(\[])[ \t]+', r'\1', text)

    # 5b. Spasi setelah titik dua (selalu beri spasi kecuali format jam HH:MM(:SS), URL, atau penutup markdown bold :**)
    text = re.sub(r':\*\*(?!\s)', ':** ', text)
    text = re.sub(r'(?<!\d):(?![\s\d/*])|:(?![\s/*])(?!\d{2}(?::|\s|$))', ': ', text)

    # 5c. Format desimal persen koma sesuai KBBI (misal 23.12% -> 23,12%, 23,12 % -> 23,12%)
    text = re.sub(r'(\d+)\.(\d+)\s*%', r'\1,\2%', text)
    text = re.sub(r'(\d+(?:,\d+)?)\s+%', r'\1%', text)

    # 5d. Format mata uang Rupiah sesuai KBBI (tanpa titik dan tanpa spasi setelah Rp, misal Rp 10.000 -> Rp10.000)
    text = re.sub(r'\bRp\.?\s+(\d)', r'Rp\1', text)

    # 5e. Spasi setelah koma dan titik koma jika menempel pada huruf
    text = re.sub(r',([a-zA-Z])', r', \1', text)
    text = re.sub(r';([a-zA-Z])', r'; \1', text)

    # 5f. Spasi setelah titik kalimat jika menempel pada huruf kapital awal kalimat berikutnya (melindungi gelar/singkatan)
    text = re.sub(
        r'(?<![A-Z])(?<!\bPj)(?<!\bPlt)(?<!\bA\.Md)(?<!\bS\.Ars)(?<!\bS\.Kom)(?<!\bS\.Pt)(?<!\bM\.Si)\.([A-Z][a-z]{2,})',
        r'. \1',
        text
    )

    # 5g. Bersihkan sisa heading B. HASIL YANG DICAPAI jika model tak sengaja menyertakannya
    text = re.sub(r"^(?:\*{0,2}B\.?\s*HASIL\s*YANG\s*DICAPAI\*{0,2}\s*)+", "", text, flags=re.I).strip()

    # 6. Pembersihan duplikasi kata dan frasa berulang (deduplikasi auto teks elaborasi)
    # 6a. Frasa berulang berturut-turut 2 s/d 5 kata (e.g. "dialirkan menuju dialirkan menuju" -> "dialirkan menuju")
    for _ in range(3):
        text = re.sub(
            r'\b([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){1,4})(?:[,\s]+|\s+)\1\b',
            r'\1',
            text,
            flags=re.IGNORECASE
        )
    # 6b. Kata umum yang sering terduplikasi berturut-turut tanpa tanda hubung
    common_repeat_words = (
        r'dialirkan|menuju|direncanakan|selanjutnya|dilakukan|dilaksanakan|merupakan|'
        r'dengan|untuk|pada|dalam|dari|yang|ke|di|adalah|akan|telah|sudah|serta|atau'
    )
    text = re.sub(rf'\b({common_repeat_words})\s+\1\b', r'\1', text, flags=re.IGNORECASE)

    # 6c. Normalisasi spasi ganda per baris dan secara global
    text = re.sub(r'[ \t]{2,}', ' ', text)
    text = "\n".join(line.strip() for line in text.splitlines())

    return text


def format_to_indonesian_date(val: str) -> str:
    """Mengonversi format ISO YYYY-MM-DD ke format resmi Bahasa Indonesia, misal: '22 September 2026'."""
    if not val:
        return ""
    val_clean = str(val).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", val_clean)
    if m:
        year = int(m.group(1))
        month = int(m.group(2))
        day = int(m.group(3))
        indo_months = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
        if 1 <= month <= 12:
            return f"{day} {indo_months[month]} {year}"
    return val_clean


def build_structured_monev_narrative_local(
    notes: str,
    desa: str,
    kecamatan: str,
    kabupaten: str,
    tanggal: str,
    tahun: str = "2026"
) -> str:
    """
    Menyusun narasi Monev Pamsimas resmi dan komprehensif secara cerdas (deterministic engine)
    apabila koneksi API AI sedang offline atau mengalami kendala jaringan.
    HANYA menguraikan aspek yang secara eksplisit ada di catatan lapangan (anti-pemalsuan).
    """
    notes_clean = (notes or "").strip()
    if not notes_clean:
        return ""

    desa_str = desa.strip() or "Baleagung"
    kec_str = kecamatan.strip() or "Grabag"
    kab_str = kabupaten.strip() or "Kabupaten Magelang"
    kab_clean = re.sub(r"^(?:Kabupaten|Kota)\s*", "", kab_str, flags=re.I).strip()
    kab_full = f"Kabupaten {kab_clean}" if not kab_str.lower().startswith(("kabupaten", "kota")) else kab_str
    tgl_str = format_to_indonesian_date(tanggal.strip()) or "21 September 2026"

    intro = f"Hasil monitoring dan evaluasi pelaksanaan Kegiatan Pamsimas TA {tahun} di Desa {desa_str}, Kecamatan {kec_str}, {kab_full}, kondisi per {tgl_str} adalah sebagai berikut:"

    bullets = []

    # 1. Progres Fisik - HANYA jika ada persentase / realisasi capaian di catatan
    m_fisik = re.search(r"(?:fisik|realisasi\s+fisik)[^\d%]*(\d+(?:[.,]\d+)?\s*%)", notes_clean, flags=re.I)
    if m_fisik:
        pct = m_fisik.group(1).replace(".", ",")
        bullets.append(f"* **Progres fisik:** Realisasi pekerjaan fisik mencapai {pct}. Pelaksanaan pekerjaan di lapangan berjalan dan dipantau secara berkesinambungan agar target capaian fisik tercapai sesuai jadwal kegiatan.")

    # 2. Progres Keuangan - HANYA jika ada data penyerapan / pencairan di catatan
    m_keu = re.search(r"(?:keuangan|penyerapan|anggaran|dana|cair)[^\d%]*(\d+(?:[.,]\d+)?\s*%)", notes_clean, flags=re.I)
    if m_keu:
        pct = m_keu.group(1).replace(".", ",")
        bullets.append(f"* **Progres keuangan:** Realisasi penyerapan dana mencapai {pct}. Penyerapan anggaran dialokasikan sesuai tahapan pengadaan material dan pertanggungjawaban administrasi kegiatan.")

    # 3. Opsi Sistem & Sarana / Sumber Air - HANYA jika ada data teknis di catatan
    m_sbd = re.search(r"\b(SBD|sumur\s+bor\s+dalam|MAP|mata\s+air|gravitasi)\b", notes_clean, flags=re.I)
    if m_sbd:
        opsi_val = m_sbd.group(0).upper() if len(m_sbd.group(0)) <= 4 else m_sbd.group(0).title()
        bullets.append(f"* **Opsi sistem & sarana:** Menggunakan sistem {opsi_val}. Pembangunan sarana air minum difokuskan untuk memastikan kontinuitas debit dan keandalan suplai air bagi masyarakat.")
    elif any(k in notes_clean.lower() for k in ["sumur", "pengeboran", "pemboran", "sumber air", "debit"]):
        bullets.append("* **Pekerjaan sarana air minum:** Pelaksanaan pembangunan sarana sumber air bersih difokuskan pada pemenuhan kapasitas debit air bagi kebutuhan masyarakat penerima manfaat.")

    # 4. Pengadaan Pipa dan Aksesoris - HANYA jika perpipaan disebut
    if "pipa" in notes_clean.lower():
        bullets.append("* **Pemasangan jaringan perpipaan:** Pengadaan pipa transmisi, pipa distribusi, serta perlengkapan aksesoris jaringan dipasang dan diamankan mutunya sesuai spesifikasi teknis.")

    # 5. Sambungan Rumah (SR) - HANYA jika SR disebut
    m_sr = re.search(r"(\d+)\s*(?:unit\s*)?SR\b", notes_clean, flags=re.I)
    if m_sr:
        sr_cnt = m_sr.group(1)
        bullets.append(f"* **Sambungan rumah (SR):** Alokasi penerima manfaat ditargetkan sebanyak {sr_cnt} unit SR guna memastikan akses air minum aman menjangkau warga secara merata.")
    elif "sambungan rumah" in notes_clean.lower() or " sr " in f" {notes_clean.lower()} ":
        bullets.append("* **Sambungan rumah (SR):** Rencana sambungan rumah dipersiapkan bagi warga penerima manfaat setelah jaringan perpipaan utama tersambung.")

    # 6. Kendala dan Permasalahan - HANYA jika ada kendala di catatan
    m_kendala = re.search(r"(?:kendala|masalah|hambatan|terkendala)[^.:;\n]*[:\-]?\s*([^.:;\n]+(?:[.,][^.:;\n]+)*)", notes_clean, flags=re.I)
    if m_kendala:
        det_kendala = m_kendala.group(1).strip()
        bullets.append(f"* **Kendala dan permasalahan:** {det_kendala}. Permasalahan ini memerlukan penanganan teknis dan mitigasi intensif di lapangan.")
    elif any(k in notes_clean.lower() for k in ["water loss", "batuan", "keras", "rongga", "swadaya", "lambat"]):
        bullets.append("* **Kendala teknis lapangan:** Terdapat tantangan teknis pelaksanaan di lapangan yang memerlukan mitigasi dan penyesuaian operasional.")

    # 7. Tindak Lanjut & Rekomendasi - HANYA jika ada rekomendasi/tindak lanjut di catatan
    m_tindak = re.search(r"(?:tindak\s*lanjut|rekomendasi|langkah|solusi)[^.:;\n]*[:\-]?\s*([^.:;\n]+(?:[.,][^.:;\n]+)*)", notes_clean, flags=re.I)
    if m_tindak:
        det_tindak = m_tindak.group(1).strip()
        bullets.append(f"* **Tindak lanjut & rekomendasi:** {det_tindak}. Tim pelaksana bersama fasilitator dan pemerintah desa mengawal implementasi langkah penyelesaian tersebut.")

    # 8. Sisa / Temuan Lapangan Lainnya yang belum tercakup di butir terstruktur di atas
    # Bagi catatan menjadi kalimat-kalimat untuk memeriksa temuan yang belum masuk
    raw_sentences = [s.strip() for s in re.split(r"[.\n]+", notes_clean) if len(s.strip()) > 3]
    uncovered = []
    for s in raw_sentences:
        s_low = s.lower()
        # Cek apakah kalimat ini sudah tercakup di salah satu butir
        already_in_bullets = any(s_low in b.lower() or any(w in b.lower() for w in s_low.split() if len(w) > 5) for b in bullets)
        if not already_in_bullets:
            uncovered.append(s)

    if uncovered:
        temuan_text = ". ".join(uncovered).strip()
        if not temuan_text.endswith("."):
            temuan_text += "."
        bullets.append(f"* **Catatan temuan lapangan:** {temuan_text}")

    # Jika catatan berupa temuan narasi umum tanpa butir kategori di atas, elaborasi temuan tersebut langsung
    if not bullets:
        bullets.append(f"* **Temuan teknis lapangan:** {notes_clean}")

    output_narrative = intro + "\n" + "\n".join(bullets)
    return sanitize_pamsimas_text(output_narrative)


def draft_village_narrative(
    notes: str,
    desa: str,
    kecamatan: str,
    kabupaten: str,
    tanggal: str,
    tahun: str = "2026",
    extra_data: Optional[Dict[str, Any]] = None,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Drafts professional Monev narrative for a village using Gemini 3.1 Flash Lite
    under strict Anti-Slop guidelines and token-efficient configuration.
    Falls back to deterministic structured engine if network or API quota errors occur.
    """
    notes_clean = (notes or "").strip()
    if not notes_clean:
        return {
            "success": True,
            "narrative": "",
            "model_used": "none",
            "fallback": False
        }

    key = api_key or os.environ.get("GEMINI_API_KEY") or DEFAULT_API_KEY

    extra_str = ""
    if extra_data:
        items = [f"{k}: {v}" for k, v in extra_data.items() if v]
        if items:
            extra_str = "\nData Tambahan: " + ", ".join(items)

    prompt = (
        f"Data Wilayah:\n"
        f"- Desa: {desa}\n"
        f"- Kecamatan: {kecamatan}\n"
        f"- Kabupaten: {kabupaten}\n"
        f"- Tanggal Pemantauan: {format_to_indonesian_date(tanggal)}\n"
        f"- Tahun Anggaran: {tahun}{extra_str}\n\n"
        f"Catatan Mentah Lapangan:\n{notes_clean}\n\n"
        f"INSTRUKSI KHUSUS ANTI-PEMALSUAN (SANGAT KETAT):\n"
        f"HANYA elaborasi aspek/topik yang ada pada Catatan Mentah Lapangan di atas. "
        f"Apabila catatan lapangan TIDAK MENYEBUTKAN data progres fisik, JANGAN menuliskan atau mencantumkan butir progres fisik. "
        f"Apabila catatan lapangan TIDAK MENYEBUTKAN data keuangan, JANGAN menuliskan atau mencantumkan butir progres keuangan. "
        f"Dilarang keras mengarang butir atau persentase apa pun yang tidak ada di catatan."
    )

    payload = {
        "contents": [
            {"parts": [{"text": prompt}]}
        ],
        "systemInstruction": {
            "parts": [{"text": SYSTEM_INSTRUCTION_ANTI_SLOP}]
        },
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 8192
        }
    }

    # Urutan model fallback sesuai preferensi
    models_to_try = [
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite-preview",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.6-flash",
        "gemini-flash-lite-latest",
        "gemma-4-26b-a4b-it",
        "gemini-3.1-flash-lite"
    ]
    last_err = ""
    last_refusal_text = ""

    for m in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}"
        # Jika model sebelumnya menolak karena kata kiasan/aneh, gunakan instruksi abstraksi teknis objektif
        current_payload = payload
        if last_refusal_text:
            abstracted_prompt = (
                prompt
                + "\n\nINSTRUKSI KHUSUS ABSTRAKSI KEDINASAN:\n"
                "Apabila catatan lapangan di atas mengandung ungkapan eksperimental, kiasan, hiperbola, atau istilah non-standar, "
                "JANGAN MENOLAK pembuatan laporan. Saring, netralkan, dan abstraksikan substansinya menjadi narasi teknis "
                "pelaksanaan Kegiatan Pamsimas yang 100% formal, sopan, objektif, dan sesuai etika dokumen kedinasan Kementerian PU "
                "(fokuskan pada aspek karakteristik sumber air, kondisi teknis sarana di lapangan, penguatan kelembagaan KPSPAMS, "
                "serta koordinasi pemerintah desa dan masyarakat)."
            )
            current_payload = {
                **payload,
                "contents": [{"parts": [{"text": abstracted_prompt}]}]
            }

        try:
            resp = requests.post(url, json=current_payload, headers={"Content-Type": "application/json"}, timeout=20)
            if resp.status_code == 200:
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates:
                    cand = candidates[0]
                    finish_reason = cand.get("finishReason", "")
                    parts = cand.get("content", {}).get("parts", [])
                    # Gabungkan seluruh bagian teks non-thought agar tidak pernah terpotong
                    text_chunks = [
                        p.get("text", "")
                        for p in parts
                        if isinstance(p, dict) and not p.get("thought") and p.get("text")
                    ]
                    text = "\n".join(text_chunks).strip()
                    if not text and parts and isinstance(parts[0], dict):
                        text = (parts[0].get("text") or "").strip()

                    if text:
                        # Post-processing Anti-Slop & KBBI enforcement
                        text = sanitize_pamsimas_text(text)

                        # Jika terpotong oleh MAX_TOKENS di tengah kalimat, coba model berikutnya
                        if finish_reason == "MAX_TOKENS" and not text.endswith((".", "!", "?", ":", ")")):
                            last_err = f"Model {m} truncated by MAX_TOKENS"
                            continue

                        # Cek apakah output berupa kalimat penolakan AI (Refusal)
                        if is_ai_refusal_text(text):
                            # Simpan teks penolakan yang utuh (tidak terpotong) dan coba model berikutnya dengan abstraksi
                            if len(text) > len(last_refusal_text):
                                last_refusal_text = text
                            continue

                        usage = data.get("usageMetadata", {})
                        return {
                            "success": True,
                            "narrative": text,
                            "model_used": m,
                            "token_usage": usage
                        }
                    elif finish_reason in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"):
                        last_refusal_text = (
                            last_refusal_text
                            or "Catatan lapangan mengandung istilah yang memerlukan abstraksi teknis."
                        )
                        continue
            else:
                last_err = f"Model {m} status {resp.status_code}: {resp.text[:120]}"
                continue
        except Exception as e:
            last_err = f"Model {m} error: {str(e)}"
            continue

    # Jika seluruh model menolak karena kebijakan konten namun ada respons utuh dari model,
    # pastikan respons tersebut utuh (tidak terpotong)
    if last_refusal_text:
        return {
            "success": True,
            "narrative": sanitize_pamsimas_text(last_refusal_text),
            "model_used": "refusal_complete",
            "fallback": False
        }

    # RESILIENT FALLBACK: Jika seluruh model AI terkendala (koneksi internet offline / kuota habis),
    # hentikan pembuatan laporan dan kembalikan status kegagalan koneksi agar tidak menghasilkan laporan kosong/kurang lengkap.
    return {
        "success": False,
        "narrative": "",
        "model_used": "none",
        "fallback": True,
        "error": "Koneksi internet tidak terhubung atau layanan AI sedang tidak dapat dijangkau. Pembuatan laporan dihentikan agar catatan lapangan dapat diolah secara lengkap."
    }


def set_cell_borders(cell, **kwargs):
    """Sets cell border elements in docx table."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = tcPr.first_child_found_in("w:tcBorders")
    if tcBorders is None:
        tcBorders = OxmlElement('w:tcBorders')
        tcPr.append(tcBorders)

    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        edge_data = kwargs.get(edge)
        if edge_data:
            tag = f'w:{edge}'
            element = tcBorders.find(qn(tag))
            if element is None:
                element = OxmlElement(tag)
                tcBorders.append(element)
            for key, attr in [('val', 'w:val'), ('color', 'w:color'), ('sz', 'w:sz'), ('space', 'w:space')]:
                if key in edge_data:
                    element.set(qn(attr), str(edge_data[key]))


TEMPLATE_DOCX = os.path.join(BASE_DIR, "app", "templates", "template_laporan_monev.docx")
if not os.path.exists(TEMPLATE_DOCX):
    _fallback_template = r"D:\Downloads\21-September-2026_Baleagung_Magelang (Geotagged).docx"
    if os.path.exists(_fallback_template):
        TEMPLATE_DOCX = _fallback_template


def make_xml_paragraph(
    text: str = "",
    style_name: str = "Normal",
    bold: bool = False,
    italic: bool = False,
    font_name: str = "Arial",
    font_size_pt: float = 11.0,
    alignment: str = "both",
    line_spacing: float = 1.5,
    space_before_pt: float = 0,
    space_after_pt: float = 0,
    bold_prefix: str = "",
    indent_left_dxa: Optional[int] = None,
    indent_right_dxa: Optional[int] = None
):
    """Creates a native Word oxml paragraph with high precision official formatting and pure black text."""
    p = OxmlElement('w:p')
    pPr = OxmlElement('w:pPr')

    if style_name:
        pStyle = OxmlElement('w:pStyle')
        clean_style = style_name.replace(" ", "")
        pStyle.set(qn('w:val'), clean_style)
        pPr.append(pStyle)

    if indent_left_dxa is not None or indent_right_dxa is not None:
        ind = OxmlElement('w:ind')
        if indent_left_dxa is not None:
            ind.set(qn('w:left'), str(indent_left_dxa))
        if indent_right_dxa is not None:
            ind.set(qn('w:right'), str(indent_right_dxa))
        pPr.append(ind)

    spacing = OxmlElement('w:spacing')
    spacing.set(qn('w:line'), str(int(line_spacing * 240)))
    spacing.set(qn('w:lineRule'), 'auto')
    if space_before_pt:
        spacing.set(qn('w:before'), str(int(space_before_pt * 20)))
    if space_after_pt:
        spacing.set(qn('w:after'), str(int(space_after_pt * 20)))
    pPr.append(spacing)

    if alignment:
        jc = OxmlElement('w:jc')
        jc.set(qn('w:val'), alignment)
        pPr.append(jc)

    p.append(pPr)

    clean_pre = re.sub(r'[ \t]{2,}', ' ', (bold_prefix or "").strip())
    clean_body = re.sub(r'[ \t]{2,}', ' ', (text or "").strip())

    if clean_pre:
        r_pre = OxmlElement('w:r')
        rPr_pre = OxmlElement('w:rPr')
        rFonts_pre = OxmlElement('w:rFonts')
        rFonts_pre.set(qn('w:ascii'), font_name)
        rFonts_pre.set(qn('w:hAnsi'), font_name)
        rPr_pre.append(rFonts_pre)
        rPr_pre.append(OxmlElement('w:b'))
        sz_pre = OxmlElement('w:sz')
        sz_pre.set(qn('w:val'), str(int(font_size_pt * 2)))
        rPr_pre.append(sz_pre)
        col_pre = OxmlElement('w:color')
        col_pre.set(qn('w:val'), '000000')
        rPr_pre.append(col_pre)
        r_pre.append(rPr_pre)
        t_pre = OxmlElement('w:t')
        t_pre.set(qn('xml:space'), 'preserve')
        t_pre.text = clean_pre + (" " if clean_body else "")
        r_pre.append(t_pre)
        p.append(r_pre)

    if clean_body:
        r = OxmlElement('w:r')
        rPr = OxmlElement('w:rPr')
        rFonts = OxmlElement('w:rFonts')
        rFonts.set(qn('w:ascii'), font_name)
        rFonts.set(qn('w:hAnsi'), font_name)
        rPr.append(rFonts)
        if bold:
            rPr.append(OxmlElement('w:b'))
        if italic:
            rPr.append(OxmlElement('w:i'))
        sz = OxmlElement('w:sz')
        sz.set(qn('w:val'), str(int(font_size_pt * 2)))
        rPr.append(sz)
        col_r = OxmlElement('w:color')
        col_r.set(qn('w:val'), '000000')
        rPr.append(col_r)
        r.append(rPr)
        t = OxmlElement('w:t')
        t.text = clean_body
        r.append(t)
        p.append(r)

    return p


def make_xml_bullet(
    text: str = "",
    label: str = "",
    num_id: int = 15,
    ilvl: int = 0,
    font_name: str = "Arial",
    font_size_pt: float = 11.0,
    line_spacing: float = 1.5,
    left_indent_dxa: int = 500,
    hanging_indent_dxa: int = 250
):
    """Creates a native Word oxml bullet item with numPr, proportional indent, and bold label followed by a space."""
    p = OxmlElement('w:p')
    pPr = OxmlElement('w:pPr')

    pStyle = OxmlElement('w:pStyle')
    pStyle.set(qn('w:val'), 'ListParagraph')
    pPr.append(pStyle)

    numPr = OxmlElement('w:numPr')
    ilvl_elem = OxmlElement('w:ilvl')
    ilvl_elem.set(qn('w:val'), str(ilvl))
    numPr.append(ilvl_elem)
    numId_elem = OxmlElement('w:numId')
    numId_elem.set(qn('w:val'), str(num_id))
    numPr.append(numId_elem)
    pPr.append(numPr)

    # Indent yang rapi dan proporsional (tidak terlalu menjorok)
    ind = OxmlElement('w:ind')
    ind.set(qn('w:left'), str(left_indent_dxa))
    ind.set(qn('w:hanging'), str(hanging_indent_dxa))
    pPr.append(ind)

    spacing = OxmlElement('w:spacing')
    spacing.set(qn('w:line'), str(int(line_spacing * 240)))
    spacing.set(qn('w:lineRule'), 'auto')
    spacing.set(qn('w:after'), '0')
    pPr.append(spacing)

    jc = OxmlElement('w:jc')
    jc.set(qn('w:val'), 'both')
    pPr.append(jc)

    p.append(pPr)

    # Normalisasi label: pastikan diakhiri titik dua dan satu spasi, tanpa spasi ganda
    clean_lbl = re.sub(r'[ \t]{2,}', ' ', label.replace("**", "").replace("*", "").strip()) if label else ""
    if clean_lbl:
        clean_lbl = clean_lbl.rstrip(":").rstrip(".").strip() + ": "

    clean_txt = re.sub(r'[ \t]{2,}', ' ', text.replace("**", "").replace("*", "").strip()) if text else ""

    if clean_lbl:
        r_lbl = OxmlElement('w:r')
        rPr_lbl = OxmlElement('w:rPr')
        rFonts_lbl = OxmlElement('w:rFonts')
        rFonts_lbl.set(qn('w:ascii'), font_name)
        rFonts_lbl.set(qn('w:hAnsi'), font_name)
        rPr_lbl.append(rFonts_lbl)
        rPr_lbl.append(OxmlElement('w:b'))
        sz_lbl = OxmlElement('w:sz')
        sz_lbl.set(qn('w:val'), str(int(font_size_pt * 2)))
        rPr_lbl.append(sz_lbl)
        col_lbl = OxmlElement('w:color')
        col_lbl.set(qn('w:val'), '000000')
        rPr_lbl.append(col_lbl)
        r_lbl.append(rPr_lbl)
        t_lbl = OxmlElement('w:t')
        t_lbl.set(qn('xml:space'), 'preserve')
        t_lbl.text = clean_lbl
        r_lbl.append(t_lbl)
        p.append(r_lbl)

    if clean_txt:
        r_txt = OxmlElement('w:r')
        rPr_txt = OxmlElement('w:rPr')
        rFonts_txt = OxmlElement('w:rFonts')
        rFonts_txt.set(qn('w:ascii'), font_name)
        rFonts_txt.set(qn('w:hAnsi'), font_name)
        rPr_txt.append(rFonts_txt)
        sz_txt = OxmlElement('w:sz')
        sz_txt.set(qn('w:val'), str(int(font_size_pt * 2)))
        rPr_txt.append(sz_txt)
        col_txt = OxmlElement('w:color')
        col_txt.set(qn('w:val'), '000000')
        rPr_txt.append(col_txt)
        r_txt.append(rPr_txt)
        t_txt = OxmlElement('w:t')
        t_txt.text = clean_txt
        r_txt.append(t_txt)
        p.append(r_txt)

    return p


def normalize_image_aspect_ratio(img: Image.Image, target_ratio: float = 4 / 3) -> Image.Image:
    """
    Normalizes portrait or mismatched images to a balanced landscape aspect ratio (default 4:3)
    using high-quality centered cropping so that table grid rows remain perfectly aligned and symmetrical.
    Also handles EXIF orientation transposition if present.
    """
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    w, h = img.size
    current_ratio = w / h

    # If image is portrait (h > w) or substantially narrower than 4:3 (margin toleransi ketat agar landscape panjang tidak terpangkas)
    if current_ratio < 0.98:
        # Portrait to Landscape 4:3 center crop
        target_h = int(w / target_ratio)
        if target_h <= h:
            top = max(0, (h - target_h) // 2)
            bottom = top + target_h
            return img.crop((0, top, w, bottom))
        else:
            target_w = int(h * target_ratio)
            left = max(0, (w - target_w) // 2)
            right = left + target_w
            return img.crop((left, 0, right, h))
    return img


def parse_date_parts(date_val: str):
    """Mengekstrak (tahun, bulan_int, hari_int) dari string ISO YYYY-MM-DD atau teks Indonesia."""
    if not date_val:
        return None
    val = str(date_val).strip()
    m_iso = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", val)
    if m_iso:
        return int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3))
    
    indo_map = {
        'januari': 1, 'jan': 1, 'februari': 2, 'feb': 2, 'maret': 3, 'mar': 3,
        'april': 4, 'apr': 4, 'mei': 5, 'juni': 6, 'jun': 6, 'juli': 7, 'jul': 7,
        'agustus': 8, 'agt': 8, 'agust': 8, 'september': 9, 'sep': 9, 'sept': 9,
        'oktober': 10, 'okt': 10, 'november': 11, 'nov': 11, 'desember': 12, 'des': 12
    }
    m_txt = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", val)
    if m_txt:
        d = int(m_txt.group(1))
        m_str = m_txt.group(2).lower()
        y = int(m_txt.group(3))
        if m_str in indo_map:
            return y, indo_map[m_str], d
    return None


def parse_date_range_str(val: str):
    """
    Mengekstrak ((y1, m1, d1), (y2, m2, d2)) atau ((y1, m1, d1), None) dari teks rentang tanggal atau tanggal tunggal.
    Mendukung format:
    - Lintas bulan: '28 September 2026 - 2 Oktober 2026' atau '28 September - 2 Oktober 2026'
    - Bulan sama: '8 - 9 Oktober 2026' atau '05 – 06 Agustus 2026'
    - Tanggal tunggal: '28 September 2026'
    """
    if not val:
        return None, None
    val_clean = str(val).strip()
    indo_map = {
        'januari': 1, 'jan': 1, 'februari': 2, 'feb': 2, 'maret': 3, 'mar': 3,
        'april': 4, 'apr': 4, 'mei': 5, 'juni': 6, 'jun': 6, 'juli': 7, 'jul': 7,
        'agustus': 8, 'agt': 8, 'agust': 8, 'september': 9, 'sep': 9, 'sept': 9,
        'oktober': 10, 'okt': 10, 'november': 11, 'nov': 11, 'desember': 12, 'des': 12
    }

    # Format lintas bulan: 28 September 2026 - 2 Oktober 2026 atau 28 September - 2 Oktober 2026
    m_cross = re.search(r"(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\s*[-–—s/d]+\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", val_clean, re.I)
    if m_cross:
        y2 = int(m_cross.group(6))
        m2_str = m_cross.group(5).lower()
        d2 = int(m_cross.group(4))

        y1 = int(m_cross.group(3)) if m_cross.group(3) else y2
        m1_str = m_cross.group(2).lower()
        d1 = int(m_cross.group(1))

        if m1_str in indo_map and m2_str in indo_map:
            return (y1, indo_map[m1_str], d1), (y2, indo_map[m2_str], d2)

    # Format bulan sama: 8 - 9 Oktober 2026 atau 05 – 06 Agustus 2026
    m_same = re.search(r"(\d{1,2})\s*[-–—s/d]+\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", val_clean, re.I)
    if m_same:
        d1 = int(m_same.group(1))
        d2 = int(m_same.group(2))
        m_str = m_same.group(3).lower()
        y = int(m_same.group(4))
        if m_str in indo_map:
            return (y, indo_map[m_str], d1), (y, indo_map[m_str], d2)

    p_single = parse_date_parts(val_clean)
    return p_single, None


def normalize_personel_title(name: str) -> str:
    """
    Merapikan penulisan nama dan gelar akademik/profesi personel sesuai kaidah KBBI/EYD:
    - Setiap unsur singkatan gelar akademik diakhiri tanda titik (e.g. S.T., M.T., S.E., S.Ars., S.A.P., A.Md., dll.)
    - Singkatan nama depan diakhiri titik (e.g. FX -> F.X.)
    - Penulisan tanda koma dan spasi sebelum dan antargelar dirapikan (e.g. 'Nama, S.T., M.T.')
    """
    if not name:
        return ""
    raw = str(name).strip()
    raw = re.sub(r'^\d+\.\s*', '', raw).strip()

    # Singkatan nama depan: FX -> F.X.
    raw = re.sub(r'\bFX\b\.?', 'F.X.', raw)

    title_rules = [
        (r'\bS\.?I\.?Kom\b\.?', 'S.I.Kom.'),
        (r'\bM\.?I\.?Kom\b\.?', 'M.I.Kom.'),
        (r'\bS\.?K\.?M\b\.?', 'S.K.M.'),
        (r'\bM\.?K\.?M\b\.?', 'M.K.M.'),
        (r'\bS\.?A\.?P\b\.?', 'S.A.P.'),
        (r'\bM\.?A\.?P\b\.?', 'M.A.P.'),
        (r'\bS\.?I\.?P\b\.?', 'S.I.P.'),
        (r'\bM\.?I\.?P\b\.?', 'M.I.P.'),
        (r'\bA\.?Md\.?Kom\b\.?', 'A.Md.Kom.'),
        (r'\bA\.?Md\.?T\b\.?', 'A.Md.T.'),
        (r'\bA\.?Md\b\.?', 'A.Md.'),
        (r'\bS\.?Ars\b\.?', 'S.Ars.'),
        (r'\bM\.?Ars\b\.?', 'M.Ars.'),
        (r'\bS\.?Kom\b\.?', 'S.Kom.'),
        (r'\bM\.?Kom\b\.?', 'M.Kom.'),
        (r'\bS\.?Pt\b\.?', 'S.Pt.'),
        (r'\bM\.?Pt\b\.?', 'M.Pt.'),
        (r'\bS\.?Pd\b\.?', 'S.Pd.'),
        (r'\bM\.?Pd\b\.?', 'M.Pd.'),
        (r'\bS\.?Si\b\.?', 'S.Si.'),
        (r'\bM\.?Si\b\.?', 'M.Si.'),
        (r'\bS\.?Sos\b\.?', 'S.Sos.'),
        (r'\bM\.?Sos\b\.?', 'M.Sos.'),
        (r'\bS\.?Ked\b\.?', 'S.Ked.'),
        (r'\bS\.?T\b\.?', 'S.T.'),
        (r'\bM\.?T\b\.?', 'M.T.'),
        (r'\bS\.?E\b\.?', 'S.E.'),
        (r'\bM\.?E\b\.?', 'M.E.'),
        (r'\bS\.?H\b\.?', 'S.H.'),
        (r'\bM\.?H\b\.?', 'M.H.'),
        (r'\bIr\b\.?', 'Ir.'),
        (r'\bDrs\b\.?', 'Drs.'),
        (r'\bDra\b\.?', 'Dra.'),
    ]

    for pat, rep in title_rules:
        raw = re.sub(pat, rep, raw)

    raw = re.sub(r'\s*,\s*', ', ', raw)
    raw = re.sub(r'([^,])\s+(S\.[A-Za-z\.]+|M\.[A-Za-z\.]+|A\.Md\.[A-Za-z\.]*|A\.Md\.)', r'\1, \2', raw)
    raw = re.sub(r'(\b[A-Z][A-Za-z\.]*\.)\s+(S\.[A-Za-z\.]+|M\.[A-Za-z\.]+|A\.Md\.[A-Za-z\.]*|A\.Md\.)', r'\1, \2', raw)
    raw = re.sub(r'(?:,\s*)+', ', ', raw)
    raw = re.sub(r'[ \t]{2,}', ' ', raw).strip()
    return raw


def format_spt_full_date(report_data: Dict[str, Any]) -> str:
    """
    Menyusun teks tanggal atau rentang tanggal dinas untuk klausul Dasar Pelaksanaan SPT.
    Mengikuti durasi hari dinas:
    - 1 Hari: '28 September 2026'
    - Multi-Hari (Bulan Sama): '8 - 9 Oktober 2026'
    - Multi-Hari (Beda Bulan): '28 September 2026 - 2 Oktober 2026'
    - Multi-Hari (Beda Tahun): '30 Desember 2025 - 2 Januari 2026'
    """
    indo_months = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]

    s_raw = (report_data.get("trip_start_date") or "").strip()
    e_raw = (report_data.get("trip_end_date") or "").strip()
    tgl_spt_raw = (report_data.get("tanggal_spt") or "").strip()

    # Ekstraksi rentang
    p_start = parse_date_parts(s_raw) if s_raw else None
    p_end = parse_date_parts(e_raw) if e_raw else None

    # Fallback jika trip_start_date kosong atau jika tanggal_spt membawa rentang langsung
    if not p_start and tgl_spt_raw:
        p_s_range, p_e_range = parse_date_range_str(tgl_spt_raw)
        p_start = p_s_range
        if not p_end and p_e_range:
            p_end = p_e_range

    if p_start and p_end and p_start != p_end:
        y1, m1, d1 = p_start
        y2, m2, d2 = p_end
        m1_name = indo_months[m1] if 1 <= m1 <= 12 else str(m1)
        m2_name = indo_months[m2] if 1 <= m2 <= 12 else str(m2)
        if y1 == y2 and m1 == m2:
            return f"{d1} - {d2} {m1_name} {y1}"
        else:
            return f"{d1} {m1_name} {y1} - {d2} {m2_name} {y2}"
    elif p_start:
        y1, m1, d1 = p_start
        m1_name = indo_months[m1] if 1 <= m1 <= 12 else str(m1)
        return f"{d1} {m1_name} {y1}"

    if tgl_spt_raw:
        return format_to_indonesian_date(tgl_spt_raw)
    if s_raw:
        return format_to_indonesian_date(s_raw)
    return ""


def build_compact_report_filename(report_data: Dict[str, Any], villages: List[Dict[str, Any]]) -> str:
    """
    Menghasilkan nama berkas dokumen Monev yang ringkas dan padat sesuai standar kedinasan:
    Diawali tanggal mulai dinas sampai akhir dinas (jika lebih dari 1 hari),
    diikuti nama kabupaten, dan nama desa.
    Contoh:
    - 1 Hari: '15-Agustus-2026_Magelang_Baleagung.docx'
    - Multi-Hari (Bulan Sama): '13-15-Agustus-2026_Magelang_Jambewangi-dkk.docx'
    - Multi-Hari (Beda Bulan): '30-Agustus-02-September-2026_Wonogiri_Sugihan-Gebangharjo.docx'
    """
    indo_months = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]

    s_raw = report_data.get("trip_start_date") or ""
    e_raw = report_data.get("trip_end_date") or ""
    tgl_spt_raw = report_data.get("tanggal_spt") or ""
    tgl_lap_raw = report_data.get("tanggal_laporan") or ""

    p_start = parse_date_parts(s_raw)
    p_end = parse_date_parts(e_raw) if e_raw else None

    # Jika trip_start_date tidak ada atau tanggal_spt membawa rentang langsung
    if not p_start and tgl_spt_raw:
        p_s_range, p_e_range = parse_date_range_str(tgl_spt_raw)
        p_start = p_s_range
        if not p_end and p_e_range:
            p_end = p_e_range

    # Jika trip_start_date tidak ada, fallback ke tanggal laporan
    if not p_start:
        p_start = parse_date_parts(tgl_lap_raw)

    if p_start:
        y1, m1, d1 = p_start
        m1_name = indo_months[m1] if 1 <= m1 <= 12 else str(m1)
        if p_end and p_end != p_start:
            y2, m2, d2 = p_end
            m2_name = indo_months[m2] if 1 <= m2 <= 12 else str(m2)
            if y1 == y2 and m1 == m2:
                # Format: 13-15-Agustus-2026
                date_tag = f"{d1:02d}-{d2:02d}-{m1_name}-{y1}"
            elif y1 == y2:
                # Format: 30-Agustus-02-September-2026
                date_tag = f"{d1:02d}-{m1_name}-{d2:02d}-{m2_name}-{y1}"
            else:
                # Format: 30-Desember-2025-02-Januari-2026
                date_tag = f"{d1:02d}-{m1_name}-{y1}-{d2:02d}-{m2_name}-{y2}"
        else:
            # 1 hari perjalanan dinas
            date_tag = f"{d1:02d}-{m1_name}-{y1}"
    else:
        clean_tgl = re.sub(r"[^\w\-]", "-", str(tgl_lap_raw).strip()) or "Monev"
        date_tag = clean_tgl

    # Kabupaten (ringkas tanpa prefiks 'Kabupaten' / 'Kota')
    kab_raw = report_data.get("kabupaten") or ""
    clean_kab = re.sub(r"^(?:Kabupaten|Kota)\s*", "", kab_raw, flags=re.I).strip().replace(" ", "-") or "Jawa-Tengah"

    # Desa (ringkas dan padat)
    desa_list = []
    for v in (villages or []):
        d = (v.get("desa") or "").strip()
        d_clean = re.sub(r"^(?:Desa|Kelurahan)\s*", "", d, flags=re.I).strip().replace(" ", "-")
        if d_clean and d_clean not in desa_list:
            desa_list.append(d_clean)

    if not desa_list:
        desa_tag = "Umum"
    elif len(desa_list) == 1:
        desa_tag = desa_list[0]
    elif len(desa_list) == 2:
        desa_tag = f"{desa_list[0]}-{desa_list[1]}"
    else:
        desa_tag = f"{desa_list[0]}-dkk"

    fn = f"{date_tag}_{clean_kab}_{desa_tag}.docx"
    fn = re.sub(r'[\\/*?:"<>|]', "", fn)
    return fn


def ensure_personel_table_pagination(docx_path: str, pelaksana_names: Optional[List[str]] = None) -> bool:
    """
    Memeriksa apakah tabel personel pada dokumen Word terpotong/terpisah di dua halaman berbeda
    (atau teks penutup laporan terpisah dari tabel tanda tangan).
    Jika terpotong, secara otomatis menyisipkan page break (w:pageBreakBefore) tepat sebelum butir
    catatan lapangan 'Tindak lanjut dan rekomendasi' (atau kendala/poin paling cocok sebelumnya)
    pada desa terakhir sebelum penutup, sehingga seluruh tabel personel dan penutup tampil utuh,
    rapi, dan berada pada halaman yang sama.
    Menggunakan WordCraft CLI (ArtCraft) untuk deteksi pagination presisi instan (sub-detik).
    """
    if not os.path.exists(docx_path):
        return False

    wc_cli = r"C:\Program Files\WordCraft\wordcraft-cli.exe"
    if not os.path.exists(wc_cli):
        wc_cli = shutil.which("wordcraft-cli") or ""
    if not wc_cli or not pypdf:
        return False

    try:
        doc = docx.Document(docx_path)
        if not pelaksana_names:
            pelaksana_names = []
            for t in doc.tables:
                if len(t.columns) == 4 and len(t.rows) >= 2:
                    for r in t.rows:
                        txt = r.cells[1].text.strip()
                        if txt and txt not in pelaksana_names:
                            pelaksana_names.append(txt)
                    break

        if not pelaksana_names or len(pelaksana_names) < 2:
            return False

        def check_split_state(doc_obj):
            with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f_d, \
                 tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f_p:
                temp_docx = f_d.name
                temp_pdf = f_p.name
            try:
                doc_obj.save(temp_docx)
                subprocess.run([wc_cli, "convert", temp_docx, temp_pdf], check=True, capture_output=True)
                reader = pypdf.PdfReader(temp_pdf)  # type: ignore
                personel_pages = {}
                pembuat_page = None
                for p_idx, page in enumerate(reader.pages, 1):
                    txt = page.extract_text() or ""
                    if "Pembuat Laporan" in txt and pembuat_page is None:
                        pembuat_page = p_idx
                    for name in pelaksana_names:
                        parts = name.split()
                        prefix = " ".join(parts[:2]) if len(parts) >= 2 else name
                        if prefix in txt and name not in personel_pages:
                            personel_pages[name] = p_idx
                pages_seen = set(personel_pages.values())
                if not pages_seen:
                    return False, set()
                is_split = (len(pages_seen) > 1) or (pembuat_page is not None and pembuat_page != min(pages_seen))
                return is_split, pages_seen
            finally:
                for f in [temp_docx, temp_pdf]:
                    if os.path.exists(f):
                        try:
                            os.remove(f)
                        except Exception:
                            pass

        is_split, pages_seen = check_split_state(doc)
        if not is_split:
            return False

        dibuat_idx = -1
        for idx, p in enumerate(doc.paragraphs):
            if "Dibuat di" in p.text:
                dibuat_idx = idx
                break

        if dibuat_idx == -1:
            for idx, p in enumerate(doc.paragraphs):
                if "Pembuat Laporan" in p.text:
                    dibuat_idx = idx
                    break

        candidates_tindak = []
        candidates_kendala = []
        candidates_other = []

        start_scan = dibuat_idx if dibuat_idx != -1 else len(doc.paragraphs)
        for idx in range(start_scan - 1, -1, -1):
            p = doc.paragraphs[idx]
            txt = p.text.strip()
            if not txt:
                continue
            if re.match(r"^(?:[A-Z]\.|\d+\.\s*Dasar|\d+\.\s*Umum)", txt):
                break
            if re.search(r"(?:tindak\s*lanjut|rekomendasi)", txt, re.I):
                candidates_tindak.append((idx, p, txt))
            elif re.search(r"(?:kendala|permasalahan)", txt, re.I):
                candidates_kendala.append((idx, p, txt))
            elif not re.match(r"^\d+\.\s*Desa\b", txt):
                candidates_other.append((idx, p, txt))
            else:
                candidates_other.append((idx, p, txt))
                break

        ordered_candidates = candidates_tindak + candidates_kendala + candidates_other
        for c_idx, p_cand, txt in ordered_candidates:
            pPr = p_cand._element.get_or_add_pPr()
            br_elem = OxmlElement("w:pageBreakBefore")
            pPr.append(br_elem)

            split_after, _ = check_split_state(doc)
            if not split_after:
                doc.save(docx_path)
                return True
            else:
                pPr.remove(br_elem)

        return False
    except Exception as ex:
        log_error("ensure_personel_table_pagination", ex)
        return False


def generate_monev_docx(
    report_data: Dict[str, Any],
    photos: List[Dict[str, Any]] = None,
    output_path: Optional[str] = None
) -> str:
    """
    Generates official standard Word document (.docx) for Pamsimas Monev Report
    by loading master template (which preserves KemenPU kop surat header logo,
    native Word numbering, fonts, margins, and bullet styles).
    """
    # 1. Load Master Template
    doc = docx.Document(TEMPLATE_DOCX)

    # Force all document styles to pure black (w:color 000000)
    for s in doc.styles:
        try:
            if s.font:
                s.font.color.rgb = RGBColor(0, 0, 0)
            rpr = s.element.xpath('./w:rPr')
            if rpr:
                for c_elem in rpr[0].xpath('./w:color'):
                    c_elem.set(qn('w:val'), '000000')
                    if qn('w:themeColor') in c_elem.attrib:
                        del c_elem.attrib[qn('w:themeColor')]
        except Exception:
            pass

    # Metadata extraction
    kabupaten = report_data.get("kabupaten", "Magelang").strip()
    kabupaten_clean = re.sub(r"^(?:Kabupaten|Kota)\s*", "", kabupaten, flags=re.I).strip()
    kabupaten_full = f"Kabupaten {kabupaten_clean}" if not kabupaten.lower().startswith(("kabupaten", "kota")) else kabupaten

    tahun = str(report_data.get("tahun", "2026")).strip()
    nomor_spt = report_data.get("nomor_spt", "CK07/T/Bpbpk11/2026/1766").strip()
    tanggal_spt = format_to_indonesian_date(report_data.get("tanggal_spt", "").strip())
    tanggal_laporan = format_to_indonesian_date(report_data.get("tanggal_laporan", "21 September 2026").strip())
    tempat_pembuatan = "Semarang"

    villages = report_data.get("villages", [])
    pelaksana_raw = report_data.get("pelaksana", [])
    pelaksana = []
    for p in pelaksana_raw:
        if isinstance(p, dict):
            p_name = (p.get("nama") or p.get("name") or "").strip()
            if p_name:
                pelaksana.append(normalize_personel_title(p_name))
        elif isinstance(p, str) and p.strip():
            pelaksana.append(normalize_personel_title(p.strip()))

    # 2. Update Title P01 (Centered, Arial 12pt Bold, Line Spacing 1.5, Pure Black)
    p_title = doc.paragraphs[1]
    p_title.text = f"Monitoring dan Evaluasi Kegiatan Pamsimas {kabupaten_full} TA {tahun}"
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_title.paragraph_format.line_spacing = 1.5
    for r in p_title.runs:
        r.font.name = "Arial"
        r.font.size = Pt(12)
        r.bold = True
        r.font.color.rgb = RGBColor(0, 0, 0)

    # 3. Update P07 (1. Umum point 3)
    p_umum3 = doc.paragraphs[7]
    if len(villages) == 1:
        v0 = villages[0]
        v_desa = v0.get("desa") or v0.get("nama_desa") or ""
        v_kec = v0.get("kecamatan") or ""
        loc_str = f" (Desa {v_desa}, Kecamatan {v_kec})" if v_desa else ""
        p_umum3.text = (
            f"Kegiatan Monitoring dan Evaluasi (Monev) Pamsimas Tahun Anggaran {tahun} di {kabupaten_full} "
            f"dilaksanakan untuk memperoleh gambaran kondisi dan kemajuan pelaksanaan kegiatan di tingkat desa{loc_str}, "
            f"mengidentifikasi permasalahan yang dihadapi, serta memastikan pelaksanaan kegiatan tetap sesuai dengan target dan ketentuan yang telah ditetapkan."
        )
    else:
        p_umum3.text = (
            f"Kegiatan Monitoring dan Evaluasi (Monev) Pamsimas Tahun Anggaran {tahun} di {kabupaten_full} "
            f"dilaksanakan untuk memperoleh gambaran kondisi dan kemajuan pelaksanaan kegiatan di tingkat desa, "
            f"mengidentifikasi permasalahan yang dihadapi, serta memastikan pelaksanaan kegiatan tetap sesuai dengan target dan ketentuan yang telah ditetapkan."
        )
    p_umum3.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p_umum3.paragraph_format.line_spacing = 1.5
    for r in p_umum3.runs:
        r.font.name = "Arial"
        r.font.size = Pt(11)
        r.font.color.rgb = RGBColor(0, 0, 0)

    # Update P09 (2. Maksud dan Tujuan)
    for p_chk in doc.paragraphs[:15]:
        if "dimaksudkan sebagai upaya pengendalian" in p_chk.text:
            p_chk.text = f"Kegiatan Monitoring dan Evaluasi dimaksudkan sebagai upaya pengendalian dan pengawasan terhadap pelaksanaan Kegiatan Pamsimas TA {tahun} di tingkat desa."
            p_chk.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p_chk.paragraph_format.line_spacing = 1.5
            for r in p_chk.runs:
                r.font.name = "Arial"
                r.font.size = Pt(11)
                r.font.color.rgb = RGBColor(0, 0, 0)
            break

    # 4. Update P18 (3. Ruang Lingkup point 1)
    p_lingkup1 = doc.paragraphs[18]
    p_lingkup1.text = f"Monitoring dan Evaluasi pelaksanaan Kegiatan Pamsimas Tahun Anggaran {tahun} di tingkat {kabupaten_full}."
    p_lingkup1.paragraph_format.line_spacing = 1.5
    for r in p_lingkup1.runs:
        r.font.name = "Arial"
        r.font.size = Pt(11)
        r.font.color.rgb = RGBColor(0, 0, 0)

    # 5. Update P23 (4. Dasar Pelaksanaan)
    p_spt = None
    for p_chk in doc.paragraphs[:35]:
        if "Surat Perintah Tugas" in p_chk.text or "dilaksanakan berdasarkan" in p_chk.text:
            p_spt = p_chk
            break
    if p_spt is None and len(doc.paragraphs) > 23:
        p_spt = doc.paragraphs[23]

    spt_date_text = format_spt_full_date(report_data)
    spt_line = f"Kegiatan Monitoring dan Evaluasi dilaksanakan berdasarkan Surat Perintah Tugas Nomor: {nomor_spt}"
    if spt_date_text:
        spt_line += f" tanggal {spt_date_text}"
    spt_line = re.sub(r'[ \t]{2,}', ' ', spt_line.strip())
    if not spt_line.endswith("."):
        spt_line += "."
    if p_spt is not None:
        p_spt.text = spt_line
        p_spt.paragraph_format.line_spacing = 1.5
        for r in p_spt.runs:
            r.font.name = "Arial"
            r.font.size = Pt(11)
            r.font.color.rgb = RGBColor(0, 0, 0)

    # 6. Update P28 (A. Kegiatan yang Dilaksanakan point 2)
    p_keg2 = doc.paragraphs[28]
    p_keg2.text = f"Monitoring dan Evaluasi progres pelaksanaan Kegiatan Pamsimas TA {tahun} di {kabupaten_full}."
    p_keg2.paragraph_format.line_spacing = 1.5
    for r in p_keg2.runs:
        r.font.name = "Arial"
        r.font.size = Pt(11)
        r.font.color.rgb = RGBColor(0, 0, 0)

    # Pastikan seluruh run di paragraf template awal berwarna hitam
    for p in doc.paragraphs:
        for r in p.runs:
            if r.font:
                r.font.color.rgb = RGBColor(0, 0, 0)

    # 6b. Pastikan judul bagian & subbagian berformat bold, murni hitam, Arial:
    # - PENDAHULUAN
    # - 1. Umum
    # - 2. Maksud dan Tujuan
    # - 3. Ruang Lingkup
    # - 4. Dasar Pelaksanaan
    # - A. KEGIATAN YANG DILAKSANAKAN
    # - B. HASIL YANG DICAPAI
    def _is_monev_section_heading(text: str) -> bool:
        t = re.sub(r'\s+', ' ', text.strip()).upper()
        if t == "PENDAHULUAN":
            return True
        if t in ("1. UMUM", "2. MAKSUD DAN TUJUAN", "3. RUANG LINGKUP", "4. DASAR PELAKSANAAN"):
            return True
        if re.match(r"^(?:[A-Z]\.\s*)?KEGIATAN\s+YANG\s+DILAKSANAKAN$", t):
            return True
        if re.match(r"^(?:[A-Z]\.\s*)?HASIL\s+YANG\s+DICAPAI$", t):
            return True
        return False

    for s_name in ("Heading 1", "Heading 2"):
        if s_name in doc.styles:
            doc.styles[s_name].font.bold = True

    for p in doc.paragraphs:
        if _is_monev_section_heading(p.text):
            for r in p.runs:
                r.bold = True
                if r.font:
                    r.font.name = "Arial"
                    r.font.size = Pt(11)
                    r.font.color.rgb = RGBColor(0, 0, 0)

    # 7. Identifikasi P32 ("B. HASIL YANG DICAPAI") dan P54 (pembatas Section 1)
    p32_idx = 32
    for idx, p in enumerate(doc.paragraphs):
        if "B. HASIL YANG DICAPAI" in p.text:
            p32_idx = idx
            break

    p54_elem = None
    for idx, p in enumerate(doc.paragraphs):
        if idx > p32_idx and p._element.xpath('./w:pPr/w:sectPr'):
            p54_elem = p._element
            break

    body_parent = doc._body._element

    # Hapus paragraf lama template antara P32 dan P54
    p32_elem = doc.paragraphs[p32_idx]._element
    start_remove = False
    to_remove = []
    for child in list(body_parent):
        if child == p32_elem:
            start_remove = True
            continue
        if start_remove:
            if child == p54_elem:
                break
            to_remove.append(child)

    for elem in to_remove:
        body_parent.remove(elem)

    # Helper penyisipan sebelum target p54
    def insert_before_target(elem):
        if p54_elem is not None:
            body_parent.insert(body_parent.index(p54_elem), elem)
        else:
            body_parent.append(elem)

    # 8. Tambahkan Narasi Desa (B. HASIL YANG DICAPAI)
    for v_idx, v in enumerate(villages):
        desa_name = (v.get("desa") or v.get("nama_desa") or "").strip()
        kec_name = (v.get("kecamatan") or "").strip()
        notes_raw = (v.get("notes") or "").strip()
        narrative = (v.get("narrative") or v.get("hasil") or "").strip()

        # Otomatis ubah catatan lapangan menjadi narasi profesional komprehensif jika belum disusun atau masih berupa raw notes
        if notes_raw and (not narrative or narrative == notes_raw or len(narrative) < 60):
            try:
                res_draft = draft_village_narrative(
                    notes=notes_raw,
                    desa=desa_name,
                    kecamatan=kec_name,
                    kabupaten=kabupaten_full,
                    tanggal=tanggal_laporan,
                    tahun=tahun
                )
                if res_draft.get("success") and res_draft.get("narrative"):
                    narrative = res_draft["narrative"]
                else:
                    err_msg = res_draft.get("error") or "Koneksi internet tidak terhubung atau layanan AI sedang tidak dapat dijangkau. Pembuatan laporan dihentikan."
                    raise ConnectionError(err_msg)
            except ConnectionError:
                raise
            except Exception as ex:
                log_error("auto_draft_village_in_docx", ex)
                raise ConnectionError(str(ex))

        # Sanitasi ketat: eliminasi kata 'proyek'/'program'/'program pamsimas' & standarisasi KBBI
        narrative = sanitize_pamsimas_text(narrative)

        heading_text = f"{v_idx + 1}. Desa {desa_name}, Kecamatan {kec_name}" if len(villages) > 1 else f"1. Desa {desa_name}, Kecamatan {kec_name}"
        # Heading desa murni bold hitam Arial 11pt, spasi sebelum 6pt
        p_hdr = make_xml_paragraph(text=heading_text, bold=True, font_name="Arial", font_size_pt=11.0, alignment="both", line_spacing=1.5, space_before_pt=6, space_after_pt=2)
        insert_before_target(p_hdr)

        if narrative:
            lines = narrative.split("\n")
            for line in lines:
                line_clean = line.strip()
                if not line_clean:
                    continue
                if re.match(r"^(?:\*{0,2}B\.?\s*HASIL\s*YANG\s*DICAPAI\*{0,2})", line_clean, flags=re.I):
                    continue
                if re.match(r"^\d+\.\s*Desa\s+", line_clean, flags=re.I):
                    continue

                # Normalisasi tanda baca sesuai KBBI:
                # 1. Selalu berikan spasi setelah titik dua (kecuali waktu/jam HH:MM atau markdown :**)
                line_clean = re.sub(r':\*\*(?!\s)', ':** ', line_clean)
                line_clean = re.sub(r':([^\s\d/*])', r': \1', line_clean)
                # 2. Format desimal persen koma sesuai KBBI (misal 23.12% -> 23,12%)
                line_clean = re.sub(r'(\d+)\.(\d+)\s*%', r'\1,\2%', line_clean)
                # 3. Spasi setelah koma dan titik jika menempel ke huruf
                line_clean = re.sub(r',([a-zA-Z])', r', \1', line_clean)

                # Cek apakah sub-heading khusus tanpa isi di baris sama (Kendala / Tindak lanjut)
                if re.match(r"^(?:Kendala(?:\s+dan\s+permasalahan|\s+yang\s+dialami)?|Permasalahan|Rencana?\s+tindak\s+lanjut|Tindak\s+lanjut)\b", line_clean, flags=re.I) and (":" in line_clean or line_clean.endswith(".") or len(line_clean) < 45) and not re.search(r':\s*\S{20,}', line_clean):
                    clean_sub = re.sub(r'[ \t]{2,}', ' ', line_clean.replace("**", "").replace("*", "").strip())
                    p_sub = make_xml_paragraph(text=clean_sub, bold=True, font_name="Arial", font_size_pt=11.0, alignment="both", line_spacing=1.5, space_before_pt=6, space_after_pt=2)
                    insert_before_target(p_sub)
                    continue

                # Cek apakah pengantar umum (misal diakhiri "sebagai berikut:")
                if re.search(r"sebagai\s+berikut\s*[:\.]?$", line_clean, flags=re.I) and not line_clean.startswith(("*", "-", "•", "+")):
                    clean_intro = re.sub(r'[ \t]{2,}', ' ', line_clean.replace("**", "").replace("*", "").strip())
                    p_intro = make_xml_paragraph(text=clean_intro, font_name="Arial", font_size_pt=11.0, alignment="both", line_spacing=1.5, space_after_pt=2)
                    insert_before_target(p_intro)
                    continue

                # Ekstraksi butir teknis / bullets
                is_bullet_char = bool(re.match(r"^[\*\-\•\+\–]\s*", line_clean) or re.match(r"^\d+[\.\)]\s*", line_clean))
                clean_content = re.sub(r"^[\*\-\•\+\–]\s*", "", line_clean)
                clean_content = re.sub(r"^\d+[\.\)]\s*", "", clean_content).strip()

                label = ""
                val = ""

                # Pola 1: Markdown bold prefix (**Label:** Isi atau **Label**: Isi)
                m_markdown_bold = re.match(r"^\*\*(.+?)\*\*\s*[:\.]?\s*(.*)$", clean_content)
                if m_markdown_bold:
                    label = m_markdown_bold.group(1).strip().rstrip(":").rstrip(".")
                    val = m_markdown_bold.group(2).strip().replace("**", "").replace("*", "")
                elif ":" in clean_content:
                    parts = clean_content.split(":", 1)
                    cand_label = parts[0].strip().replace("**", "").replace("*", "")
                    if len(cand_label) <= 45 and not cand_label.lower().startswith("http") and not cand_label.isdigit():
                        label = cand_label
                        val = parts[1].strip().replace("**", "").replace("*", "")
                    elif is_bullet_char:
                        val = clean_content.replace("**", "").replace("*", "")
                    else:
                        clean_para = re.sub(r'[ \t]{2,}', ' ', line_clean.replace("**", "").replace("*", "").strip())
                        p_txt = make_xml_paragraph(text=clean_para, font_name="Arial", font_size_pt=11.0, alignment="both", line_spacing=1.5, space_after_pt=4)
                        insert_before_target(p_txt)
                        continue
                elif is_bullet_char:
                    val = clean_content.replace("**", "").replace("*", "")
                else:
                    clean_para = re.sub(r'[ \t]{2,}', ' ', line_clean.replace("**", "").replace("*", "").strip())
                    p_txt = make_xml_paragraph(text=clean_para, font_name="Arial", font_size_pt=11.0, alignment="both", line_spacing=1.5, space_after_pt=4)
                    insert_before_target(p_txt)
                    continue

                # Buat bullet item yang rapi, indent simetris tidak terlalu menjorok, subjudul tebal hitam
                p_blt = make_xml_bullet(
                    text=val,
                    label=label,
                    num_id=15,
                    line_spacing=1.5,
                    left_indent_dxa=500,
                    hanging_indent_dxa=250
                )
                insert_before_target(p_blt)
        else:
            p_default = make_xml_paragraph(
                text=f"Hasil monitoring dan evaluasi pelaksanaan Kegiatan Pamsimas TA {tahun} di Desa {desa_name}, Kecamatan {kec_name}, {kabupaten_full}, kondisi per {tanggal_laporan} menunjukkan pekerjaan fisik dan administrasi berjalan sesuai rencana.",
                font_name="Arial", font_size_pt=11.0, alignment="both", line_spacing=1.5, space_after_pt=4
            )
            insert_before_target(p_default)

    # 9. Penutup Laporan Resmi
    # Bagian 'Dibuat di Semarang\npada tanggal [tanggal_laporan]\nPembuat Laporan,'
    # Wajib DIBOLD, warna HITAM, rata tengah pada ketiga baris tersebut (center aligned relative to each other),
    # dan tetap berada di sebelah kanan-atas daripada tabel personel (sejajar di atas kolom tanda tangan).
    p_penutup1 = make_xml_paragraph(text="Dibuat di Semarang", bold=True, font_name="Arial", font_size_pt=11.0, alignment="center", line_spacing=1.5, space_before_pt=12, space_after_pt=2, indent_left_dxa=5472, indent_right_dxa=0)
    p_penutup2 = make_xml_paragraph(text=f"pada tanggal {tanggal_laporan}", bold=True, font_name="Arial", font_size_pt=11.0, alignment="center", line_spacing=1.5, space_before_pt=2, space_after_pt=2, indent_left_dxa=5472, indent_right_dxa=0)
    p_penutup3 = make_xml_paragraph(text="Pembuat Laporan,", bold=True, font_name="Arial", font_size_pt=11.0, alignment="center", line_spacing=1.5, space_before_pt=2, space_after_pt=8, indent_left_dxa=5472, indent_right_dxa=0)
    insert_before_target(p_penutup1)
    insert_before_target(p_penutup2)
    insert_before_target(p_penutup3)

    # 10. Tabel Pelaksana Monev (HANYA JIKA DIISI USER)
    # Kolom nomor kecil saja (0.32 in), kolom nama personel cukup leluasa (3.48 in),
    # dan kolom tanda tangan (1.25 in masing-masing)
    table_p = None
    if pelaksana:
        table_p = doc.add_table(rows=len(pelaksana), cols=4)
        table_p.alignment = WD_TABLE_ALIGNMENT.CENTER
        table_p.autofit = False
        col_widths = [Inches(0.32), Inches(3.48), Inches(1.25), Inches(1.25)]

        existing_grid = table_p._tbl.xpath('./w:tblGrid')
        if existing_grid:
            table_p._tbl.remove(existing_grid[0])
        tblGrid = OxmlElement('w:tblGrid')
        for w in col_widths:
            gc = OxmlElement('w:gridCol')
            gc.set(qn('w:w'), str(int(w.inches * 1440)))
            tblGrid.append(gc)
        table_p._tbl.insert(1, tblGrid)

        for p_idx, nama in enumerate(pelaksana):
            row = table_p.rows[p_idx]
            row.height = Pt(34) # Ruang tanda tangan vertikal nyaman dan simetris
            trPr = row._tr.get_or_add_trPr()
            trPr.append(OxmlElement('w:cantSplit'))

            row.cells[0].text = f"{p_idx + 1}."
            row.cells[1].text = nama

            if p_idx % 2 == 0:
                row.cells[2].text = f"{p_idx + 1}. …………"
                row.cells[3].text = ""
            else:
                row.cells[2].text = ""
                row.cells[3].text = f"{p_idx + 1}. …………"

            for c_i, c in enumerate(row.cells):
                c.width = col_widths[c_i]
                tcPr = c._tc.get_or_add_tcPr()
                tcW = OxmlElement('w:tcW')
                tcW.set(qn('w:w'), str(int(col_widths[c_i].inches * 1440)))
                tcW.set(qn('w:type'), 'dxa')
                tcPr.append(tcW)

                set_cell_borders(
                    c,
                    top={'val': 'single', 'sz': 4, 'color': 'auto'},
                    bottom={'val': 'single', 'sz': 4, 'color': 'auto'},
                    left={'val': 'single', 'sz': 4, 'color': 'auto'},
                    right={'val': 'single', 'sz': 4, 'color': 'auto'}
                )
                # Set vertical alignment center (align center secara vertikal)
                vAlign = OxmlElement('w:vAlign')
                vAlign.set(qn('w:val'), 'center')
                tcPr.append(vAlign)

                for para in c.paragraphs:
                    # Alignment teks horizontal sesuai arahan resmi:
                    # nomor: align center
                    # nama: align center left (vertikal center, teks kiri)
                    # space tanda tangan: align center
                    if c_i == 0:
                        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    elif c_i == 1:
                        para.alignment = WD_ALIGN_PARAGRAPH.LEFT
                    else:
                        para.alignment = WD_ALIGN_PARAGRAPH.CENTER

                    para.paragraph_format.line_spacing = 1.0
                    for r_c in para.runs:
                        r_c.font.name = 'Arial'
                        r_c.font.size = Pt(10)
                        r_c.font.color.rgb = RGBColor(0, 0, 0)
                        rPr_c = r_c._r.get_or_add_rPr()
                        w_col = OxmlElement('w:color')
                        w_col.set(qn('w:val'), '000000')
                        rPr_c.append(w_col)

        tbl_p_elem = table_p._tbl
        body_parent.remove(tbl_p_elem)
        insert_before_target(tbl_p_elem)

    # 11. Hapus tabel bawaan template lama
    for t in list(doc.tables):
        if table_p is None or t._tbl != table_p._tbl:
            t._element.getparent().remove(t._element)

    # 12. Penanganan Section 2 (Dokumentasi Foto)
    has_photos = bool(photos and len(photos) > 0)
    body_sectpr = body_parent.xpath('./w:sectPr')
    body_sectpr_elem = body_sectpr[0] if body_sectpr else None

    if has_photos:
        # Pertahankan Section 2 dengan margin simetris 1.00in
        # Bersihkan semua elemen setelah p54_elem kecuali body_sectpr_elem
        if p54_elem is not None:
            p54_idx_in_parent = body_parent.index(p54_elem)
            to_remove_after = [el for el in list(body_parent)[p54_idx_in_parent + 1:] if el != body_sectpr_elem]
            for elem in to_remove_after:
                body_parent.remove(elem)

        # Judul Dokumentasi Foto
        p_photo_title = doc.add_paragraph()
        p_photo_title.text = f"Monitoring Kegiatan Pamsimas TA {tahun}"
        p_photo_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_photo_title.paragraph_format.line_spacing = 1.2
        p_photo_title.paragraph_format.space_before = Pt(6)
        p_photo_title.paragraph_format.space_after = Pt(12)
        for r in p_photo_title.runs:
            r.font.name = "Arial"
            r.font.size = Pt(12)
            r.bold = True
            r.font.color.rgb = RGBColor(0, 0, 0)

        p_title_elem = p_photo_title._p
        body_parent.remove(p_title_elem)
        if body_sectpr_elem is not None:
            body_parent.insert(body_parent.index(body_sectpr_elem), p_title_elem)
        else:
            body_parent.append(p_title_elem)

        num_rows = (len(photos) + 1) // 2
        photo_table = doc.add_table(rows=num_rows, cols=2)
        photo_table.alignment = WD_TABLE_ALIGNMENT.CENTER

        for idx, photo_item in enumerate(photos):
            row_idx = idx // 2
            col_idx = idx % 2
            cell = photo_table.rows[row_idx].cells[col_idx]
            cell.width = Inches(3.25)
            # Table Outlines: Bingkai garis tunggal resmi standar kedinasan PU
            set_cell_borders(
                cell,
                top={'val': 'single', 'sz': 4, 'color': 'auto'},
                bottom={'val': 'single', 'sz': 4, 'color': 'auto'},
                left={'val': 'single', 'sz': 4, 'color': 'auto'},
                right={'val': 'single', 'sz': 4, 'color': 'auto'}
            )

            img_bytes = photo_item.get("bytes")
            if isinstance(img_bytes, list):
                img_bytes = bytes(img_bytes)
            if not img_bytes and photo_item.get("path") and os.path.exists(photo_item["path"]):
                with open(photo_item["path"], "rb") as f:
                    img_bytes = f.read()

            if img_bytes:
                is_original = bool(photo_item.get("already_stamped") or photo_item.get("keep_original") or photo_item.get("is_original"))
                try:
                    pil_img = Image.open(io.BytesIO(img_bytes))
                    # Normalisasi Aspect Ratio: sesuaikan foto portrait ke landscape 4:3 agar simetris
                    pil_img = normalize_image_aspect_ratio(pil_img)
                    if not is_original:
                        t_str = photo_item.get("time_str") or datetime.now().strftime("%A, %d %B %Y %H:%M:%S WIB")
                        lat_val = str(photo_item.get("lat") or "-7.500000")
                        lon_val = str(photo_item.get("lon") or "110.500000")
                        d_val = photo_item.get("dusun", "")
                        ds_val = photo_item.get("desa", "")
                        kc_val = photo_item.get("kecamatan", "")
                        kb_val = photo_item.get("kabupaten", kabupaten_full)
                        c_addr = photo_item.get("custom_address") or photo_item.get("address")

                        stamped_img = apply_stamp(
                            pil_img,
                            time_str=t_str,
                            lat=lat_val,
                            lon=lon_val,
                            dusun=d_val,
                            desa=ds_val,
                            kecamatan=kc_val,
                            kabupaten=kb_val,
                            custom_address=c_addr,
                            address_mode=photo_item.get("address_mode", "auto")
                        )
                        buf = io.BytesIO()
                        stamped_img.convert("RGB").save(buf, format="JPEG", quality=92)
                        img_bytes = buf.getvalue()
                    else:
                        buf = io.BytesIO()
                        pil_img.convert("RGB").save(buf, format="JPEG", quality=92)
                        img_bytes = buf.getvalue()
                except Exception as e:
                    log_error("photo_table_stamping", e)

                para = cell.paragraphs[0]
                para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                para.paragraph_format.space_before = Pt(4)
                para.paragraph_format.space_after = Pt(4)
                run = para.add_run()
                run.add_picture(io.BytesIO(img_bytes), width=Inches(3.10))

        tbl_photo_elem = photo_table._tbl
        body_parent.remove(tbl_photo_elem)
        if body_sectpr_elem is not None:
            body_parent.insert(body_parent.index(body_sectpr_elem), tbl_photo_elem)
        else:
            body_parent.append(tbl_photo_elem)
    else:
        # Jika TIDAK ADA foto:
        # Ambil sectPr dari p54, pindahkan ke akhir body sebagai sectPr dokumen,
        # dan hapus seluruh sisa elemen setelah teks penutup/tanda tangan
        if p54_elem is not None:
            sectpr_1_list = p54_elem.xpath('./w:pPr/w:sectPr')
            if sectpr_1_list:
                sectpr_1 = sectpr_1_list[0]
                if body_sectpr_elem is not None:
                    body_parent.remove(body_sectpr_elem)
                body_parent.append(sectpr_1)

            p54_idx_in_parent = body_parent.index(p54_elem)
            to_remove_after = [el for el in list(body_parent)[p54_idx_in_parent:] if el.tag != qn('w:sectPr')]
            for elem in to_remove_after:
                body_parent.remove(elem)

    # 13. SWEEP PURE BLACK 100% (Anti Non-Hitam) & NORMALISASI SPASI GANDA KBBI:
    # Pastikan setiap run teks (w:r) di seluruh dokumen (body, header, footer, tabel) berwarna hitam murni (000000)
    # serta bebas dari spasi ganda (double space) baik di dalam run maupun antar-run.
    targets_to_sweep = [doc._body._element]
    for s in doc.sections:
        targets_to_sweep.append(s.header._element)
        targets_to_sweep.append(s.footer._element)

    for target in targets_to_sweep:
        for p_elem in target.xpath('.//w:p'):
            prev_ended_with_space = False
            for t_elem in p_elem.xpath('.//w:t'):
                if t_elem.text:
                    cleaned_t = re.sub(r'[ \t]{2,}', ' ', t_elem.text)
                    if prev_ended_with_space and cleaned_t.startswith(' '):
                        cleaned_t = cleaned_t.lstrip(' ')
                    t_elem.text = cleaned_t
                    prev_ended_with_space = cleaned_t.endswith(' ')

        for r_elem in target.xpath('.//w:r'):
            # Abaikan run gambar/drawing murni tanpa teks jika tidak ada rPr
            rPr = r_elem.xpath('./w:rPr')
            if not rPr:
                rPr_elem = OxmlElement('w:rPr')
                r_elem.insert(0, rPr_elem)
            else:
                rPr_elem = rPr[0]

            c_nodes = rPr_elem.xpath('./w:color')
            if c_nodes:
                for c in c_nodes:
                    c.set(qn('w:val'), '000000')
                    if qn('w:themeColor') in c.attrib:
                        del c.attrib[qn('w:themeColor')]
            else:
                col = OxmlElement('w:color')
                col.set(qn('w:val'), '000000')
                rPr_elem.append(col)

    # 14. Simpan dokumen ke destination (penamaan ringkas dan padat diawali tanggal dinas)
    if not output_path:
        filename = build_compact_report_filename(report_data, villages)
        output_path = os.path.join(OUTPUT_DIR, filename)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    doc.save(output_path)

    # 15. Verifikasi dan perbaiki pemisahan tabel personel (Pagination Guard via WordCraft)
    try:
        ensure_personel_table_pagination(output_path, pelaksana)
    except Exception as ex_pg:
        log_error("ensure_personel_table_pagination_guard", ex_pg)

    return output_path

