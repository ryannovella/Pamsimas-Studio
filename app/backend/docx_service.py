import os
import io
import re
import zipfile
import xml.etree.ElementTree as ET
import shutil
import uuid
import hashlib
import time
import random
import difflib
from datetime import date, datetime, timedelta
import datetime as _dt_module

from typing import Dict, List, Tuple, Any, Optional
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from app.backend.config import DOCX_MEDIA_DIR, DOCX_UPLOADS_DIR, BACKUP_DIR, DEFAULT_DOCX, BASE_DIR
from app.backend.stamper import apply_stamp
from app.backend.stamp_detector import detect_timestamp, crop_image_bottom

import csv

# Master location database indexed by village key, subdistrict key, and composite keys
KNOWN_LOCATIONS = []
KNOWN_COORDS = {
    "jambewangi": ("-7.451824", "110.331825", "Pakis", "Kabupaten Magelang"),
    "tanjungsari": ("-7.422850", "110.133040", "Windusari", "Kabupaten Magelang"),
    "ketawang": ("-7.408820", "110.324540", "Grabag", "Kabupaten Magelang"),
    "genito": ("-7.397820", "110.156540", "Windusari", "Kabupaten Magelang"),
    "jati": ("-7.510160", "110.380950", "Sawangan", "Kabupaten Magelang"),
    "baleagung": ("-7.391520", "110.312050", "Grabag", "Kabupaten Magelang"),
    "karanggayam": ("-7.585210", "109.612450", "Karanggayam", "Kabupaten Kebumen"),
    "gempolan": ("-7.558320", "111.084530", "Kerjo", "Kabupaten Karanganyar"),
    "bukuran": ("-7.426210", "110.978120", "Kalijambe", "Kabupaten Sragen"),
    "gabus": ("-7.362140", "111.045230", "Ngrampal", "Kabupaten Sragen"),
    "aditirto": ("-7.683412", "109.641238", "Pejagoan", "Kabupaten Kebumen"),
    "tlogosari": ("-7.625124", "109.684125", "Ayah", "Kabupaten Kebumen"),
    "karanganyar": ("-7.596200", "110.952100", "Karanganyar", "Kabupaten Karanganyar"),
    "sragen": ("-7.426600", "111.022200", "Sragen", "Kabupaten Sragen"),
    "mojosari": ("-7.371420", "110.712350", "Karanggede", "Kabupaten Boyolali"),
}

# Load master locations from data_lokasi.csv
_csv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "data_lokasi.csv")
if os.path.exists(_csv_path):
    try:
        with open(_csv_path, "r", encoding="utf-8") as _f:
            _reader = csv.DictReader(_f)
            for _row in _reader:
                _desa = _row.get("Desa", "").strip()
                _kec = _row.get("Kecamatan", "").strip()
                _kab = _row.get("Kabupaten", "").strip()
                if _desa:
                    _dkey = _desa.lower()
                    _kckey = _kec.lower()
                    _kab_full = f"Kabupaten {_kab}" if not _kab.lower().startswith(("kabupaten", "kota")) else _kab
                    KNOWN_LOCATIONS.append({
                        "desa": _desa,
                        "desa_key": _dkey,
                        "kecamatan": _kec,
                        "kec_key": _kckey,
                        "kabupaten": _kab_full
                    })
                    # Populate default fallback coordinates
                    if _dkey not in KNOWN_COORDS:
                        KNOWN_COORDS[_dkey] = ("-7.500000", "110.500000", _kec, _kab_full)
                    else:
                        _lat, _lon, _, _ = KNOWN_COORDS[_dkey]
                        KNOWN_COORDS[_dkey] = (_lat, _lon, _kec, _kab_full)
    except Exception as _e:
        pass

# Helper for Levenshtein distance
def levenshtein_dist(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return levenshtein_dist(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            ins = prev[j + 1] + 1
            dels = curr[j] + 1
            subs = prev[j] + (c1 != c2)
            curr.append(min(ins, dels, subs))
        prev = curr
    return prev[-1]

# Comprehensive common Indonesian words guard - these words MUST NEVER be replaced by location names
INDONESIAN_COMMON_WORDS = {
    # Conjunctions, prepositions, pronouns
    'dan', 'atau', 'serta', 'tetapi', 'namun', 'melainkan', 'sedangkan', 'padahal',
    'karena', 'sebab', 'sehingga', 'sampai', 'hingga', 'jika', 'bila', 'apabila',
    'kalau', 'walaupun', 'meskipun', 'biarpun', 'kendati', 'supaya', 'agar', 'untuk',
    'bagi', 'guna', 'oleh', 'dengan', 'tanpa', 'tentang', 'mengenai', 'terhadap',
    'pada', 'dalam', 'atas', 'bawah', 'antara', 'luar', 'dari', 'ke', 'di',
    'ini', 'itu', 'tersebut', 'berikut', 'tadi', 'sana', 'sini', 'situ',
    'yang', 'apa', 'siapa', 'mana', 'kapan', 'bagaimana', 'mengapa', 'kenapa',
    'saya', 'kami', 'kita', 'anda', 'kamu', 'mereka', 'dia', 'beliau', 'ia',
    # Adverbs, auxiliaries, particles
    'sudah', 'telah', 'sedang', 'akan', 'belum', 'masih', 'pernah', 'sempat',
    'tidak', 'bukan', 'jangan', 'tanpa', 'tiada', 'bisa', 'dapat', 'mampu', 'sanggup',
    'harus', 'wajib', 'mesti', 'perlu', 'kudu', 'boleh', 'hendak', 'mau', 'ingin',
    'sangat', 'amat', 'sekali', 'paling', 'lebih', 'kurang', 'cukup', 'hampir',
    'selalu', 'sering', 'kadang', 'jarang', 'pula', 'juga', 'pun', 'saja', 'hanya',
    'kembali', 'segera', 'langsung', 'terus', 'menerus', 'sekalian', 'bersama',
    # Report & Monev terms
    'laporan', 'monev', 'monitoring', 'evaluasi', 'survei', 'peninjauan', 'kunjungan',
    'pemeriksaan', 'pengawasan', 'pengamatan', 'pengujian', 'verifikasi', 'validasi',
    'tanggal', 'waktu', 'hari', 'bulan', 'tahun', 'jam', 'menit', 'detik', 'minggu',
    'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu',
    'januari', 'februari', 'maret', 'april', 'mei', 'juni',
    'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
    'kegiatan', 'pekerjaan', 'pelaksanaan', 'pengerjaan', 'pengelolaan', 'penanganan',
    'penyusunan', 'perencanaan', 'pengembangan', 'peningkatan', 'pengadaan', 'pengaduan',
    'penggunaan', 'pengumpulan', 'pemanfaatan', 'pendampingan', 'pelaporan',
    'pembangunan', 'perbaikan', 'pemeliharaan', 'rehabilitasi', 'konstruksi',
    'masyarakat', 'warga', 'penduduk', 'keluarga', 'penerima', 'manfaat', 'sasaran',
    'dampingan', 'binaan', 'setempat', 'terkait', 'swakelola', 'swasembada',
    'anggaran', 'biaya', 'dana', 'bantuan', 'program', 'tahap', 'termin', 'progres',
    'target', 'capaian', 'realisasi', 'kinerja', 'hasil', 'output', 'outcome',
    'temuan', 'rekomendasi', 'kesimpulan', 'saran', 'tindak', 'lanjut', 'catatan',
    'kondisi', 'status', 'kriteria', 'standar', 'baku', 'mutu', 'kualitas', 'kuantitas',
    # Technical & Pamsimas infrastructure
    'air', 'minum', 'bersih', 'baku', 'sumber', 'mata', 'debit', 'liter', 'detik',
    'sarana', 'prasarana', 'infrastruktur', 'fasilitas', 'instalasi', 'jaringan',
    'perpipaan', 'pipa', 'transmisi', 'distribusi', 'sambungan', 'rumah',
    'reservoar', 'reservoir', 'tandon', 'tangki', 'bak', 'penampung', 'pelepas',
    'pompa', 'genset', 'panel', 'listrik', 'solar', 'tenaga', 'hidram',
    'meter', 'meteran', 'kran', 'valve', 'katup', 'gate', 'stop', 'udara', 'kuras',
    'galian', 'urugan', 'tanah', 'beton', 'semen', 'pasir', 'batu', 'pondasi',
    'bangunan', 'banguanan', 'gedung', 'rumah', 'posko', 'kantor', 'balai',
    'lapangan', 'lokasi', 'titik', 'koordinat', 'elevasi', 'ketinggian',
    # Media & Documentation
    'foto', 'gambar', 'citra', 'dokumentasi', 'geotagged', 'stempel', 'kamera',
    'lampiran', 'dokumen', 'berkas', 'arsip', 'data', 'informasi', 'keterangan',
    # Verbs / Actions
    'ada', 'adalah', 'yaitu', 'yakni', 'merupakan', 'menjadi', 'terdiri', 'meliputi',
    'buat', 'membuat', 'dibuat', 'pembuatan',
    'laku', 'melakukan', 'dilakukan', 'pelaku',
    'laksana', 'melaksanakan', 'dilaksanakan', 'pelaksana',
    'bangun', 'membangun', 'dibangun', 'pembangun',
    'pasang', 'memasang', 'dipasang', 'pemasangan',
    'tambah', 'menambah', 'ditambah', 'penambahan',
    'kurang', 'mengurangi', 'dikurangi', 'pengurangan',
    'ambil', 'mengambil', 'diambil', 'pengambilan',
    'beri', 'memberi', 'diberikan', 'pemberian',
    'terima', 'menerima', 'diterima', 'penerimaan',
    'uji', 'menguji', 'diuji', 'pengujian',
    'tinjau', 'meninjau', 'ditinjau', 'peninjauan',
    'temu', 'menemukan', 'ditemukan', 'pertemuan',
    'guna', 'menggunakan', 'digunakan', 'pengguna',
    'kerja', 'bekerja', 'mengerjakan', 'dikerjakan', 'pekerja',
    'awasi', 'mengawasi', 'diawasi', 'pengawas',
    'kelola', 'mengelola', 'dikelola', 'pengelola',
    'kumpul', 'mengumpulkan', 'dikumpulkan', 'pengumpul',
    'susun', 'menyusun', 'disusun', 'penyusun',
    'bantu', 'membantu', 'dibantu', 'pembantu',
    'hubung', 'menghubungi', 'dihubungkan', 'hubungan',
    'alih', 'mengalihkan', 'dialihkan', 'pengalihan',
    'alir', 'mengalir', 'dialirkan', 'aliran',
    'hidup', 'mati', 'rusak', 'baik', 'sedang', 'buruk',
    'fungsional', 'berfungsi', 'beroperasi', 'macet', 'bocor', 'kebocoran'
}

def is_indonesian_word(w: str) -> bool:
    """Checks whether a word is standard Indonesian prose/vocabulary and must be protected."""
    w_low = w.lower().strip()
    if not w_low or len(w_low) < 2:
        return True
    if w_low in INDONESIAN_COMMON_WORDS:
        return True
    # Clitics check: -nya, -lah, -kah, -pun, -ku, -mu
    for clitic in ('nya', 'lah', 'kah', 'pun', 'ku', 'mu'):
        if w_low.endswith(clitic) and len(w_low) > len(clitic) + 3:
            if w_low[:-len(clitic)] in INDONESIAN_COMMON_WORDS:
                return True
    # Standard verbal / nominal prefixes
    if (w_low.startswith(('peng', 'peny', 'pemb', 'pend', 'pen', 'per')) and
        w_low.endswith(('an', 'kan', 'i')) and len(w_low) >= 7):
        return True
    if w_low.startswith(('meng', 'meny', 'mem', 'men', 'ber', 'ter', 'di')) and len(w_low) >= 6:
        return True
    return False

def check_village_typo(word: str, target_kab: Optional[str] = None) -> Optional[str]:
    """
    Validates if a word is an actual misspelling of an official village name.
    Strictly guarded:
    - Never modifies standard Indonesian words (e.g., 'pengumpulan', 'pembangunan')
    - Enforces high similarity (ratio >= 0.85)
    - Enforces strict Levenshtein edit distance (<= 1 for <=8 chars, <= 2 for >=9 chars)
    """
    w_clean = word.lower().strip()
    if not w_clean or len(w_clean) < 4:
        return None

    all_official_villages = {}
    for loc in KNOWN_LOCATIONS:
        all_official_villages[loc["desa_key"]] = loc["desa"]
    for k in KNOWN_COORDS.keys():
        if k not in all_official_villages:
            all_official_villages[k] = k.capitalize()

    # Already official: no change needed
    if w_clean in all_official_villages:
        return None

    # Standard Indonesian words must NEVER be replaced by village names
    if is_indonesian_word(w_clean):
        return None

    # Filter by kabupaten pool if known
    pool_keys = list(all_official_villages.keys())
    if target_kab:
        kab_clean = re.sub(r'^(?:kabupaten|kab\.?)\s*', '', target_kab, flags=re.I).strip().lower()
        sub_keys = [loc['desa_key'] for loc in KNOWN_LOCATIONS if kab_clean in loc['kabupaten'].lower()]
        if sub_keys:
            pool_keys = sub_keys

    candidates = difflib.get_close_matches(w_clean, pool_keys, n=1, cutoff=0.85)
    if not candidates:
        return None

    matched_key = candidates[0]
    dist = levenshtein_dist(w_clean, matched_key)
    max_dist = 1 if len(matched_key) <= 8 else 2
    if dist > max_dist:
        return None

    ratio = difflib.SequenceMatcher(None, w_clean, matched_key).ratio()
    if ratio < 0.85:
        return None

    return all_official_villages[matched_key]

def fuzzy_match_village(desa_name: str, cutoff: float = 0.85) -> str:
    """Finds the closest official village name from KNOWN_LOCATIONS / KNOWN_COORDS to fix typos."""
    if not desa_name:
        return desa_name

    d_clean = re.sub(r'^(?:desa|dsa)\s+', '', desa_name.strip(), flags=re.I).lower().strip()
    if not d_clean or is_indonesian_word(d_clean):
        return desa_name.strip().title()

    all_village_keys = list(set([loc["desa_key"] for loc in KNOWN_LOCATIONS] + list(KNOWN_COORDS.keys())))
    if d_clean in all_village_keys:
        for loc in KNOWN_LOCATIONS:
            if loc["desa_key"] == d_clean:
                return loc["desa"]
        if d_clean in KNOWN_COORDS:
            return d_clean.capitalize()

    matches = difflib.get_close_matches(d_clean, all_village_keys, n=1, cutoff=cutoff)
    if matches:
        matched_key = matches[0]
        dist = levenshtein_dist(d_clean, matched_key)
        max_dist = 1 if len(matched_key) <= 8 else 2
        if dist <= max_dist:
            ratio = difflib.SequenceMatcher(None, d_clean, matched_key).ratio()
            if ratio >= cutoff:
                for loc in KNOWN_LOCATIONS:
                    if loc["desa_key"] == matched_key:
                        return loc["desa"]
                if matched_key in KNOWN_COORDS:
                    return matched_key.capitalize()
            
    return desa_name.strip().title()

def clean_xml_location_typos(xml_text: str, target_kab: Optional[str] = None) -> str:
    """
    Detects and fixes misspelled village names in Word XML.
    Strictly guarded so that:
    - Normal prose/vocabulary ('pengumpulan', 'pembangunan', 'masyarakat', etc.) is NEVER modified.
    - Only words explicitly preceded by location keywords (Desa, Dusun, Kecamatan, etc.) or standalone
      title-cased location cells are checked.
    - Misspellings must satisfy high similarity (>= 0.85) and strict edit distance (<= 1-2).
    """
    if not target_kab:
        m_k = re.search(r'\b(?:Kabupaten|Kab\.?)\s+([A-Za-z]+)\b', xml_text)
        if m_k:
            target_kab = m_k.group(1).strip()

    # 1. Location prefix within the same tag or run: e.g. "Desa Tanjunsari", "Dusun Tanjunsari"
    def replace_prefixed_same_tag(match):
        prefix = match.group(1)
        word = match.group(2)
        corr = check_village_typo(word, target_kab=target_kab)
        if corr:
            if word.isupper():
                return f"{prefix}{corr.upper()}"
            elif word[0].isupper():
                return f"{prefix}{corr}"
            else:
                return f"{prefix}{corr.lower()}"
        return match.group(0)

    xml_text = re.sub(
        r'(\b(?:Desa|Dsa\.?|Kelurahan|Kecamatan|Kec\.?|Kabupaten|Kab\.?|Dusun|Dsn\.?|Lokasi\s*[:=])\s+)([A-Za-z0-9\-]+)\b',
        replace_prefixed_same_tag,
        xml_text,
        flags=re.IGNORECASE
    )

    # 2. Location prefix across XML tags: e.g. <w:t>Desa</w:t> ... <w:t> Tanjunsari</w:t>
    def replace_prefixed_cross_tag(match):
        prefix_xml = match.group(1)
        word = match.group(2)
        suffix_xml = match.group(3)
        corr = check_village_typo(word, target_kab=target_kab)
        if corr:
            if word.isupper():
                word_corr = corr.upper()
            elif word[0].isupper():
                word_corr = corr
            else:
                word_corr = corr.lower()
            return f"{prefix_xml}{word_corr}{suffix_xml}"
        return match.group(0)

    xml_text = re.sub(
        r'(<w:t\b[^>]*>\s*(?:Desa|Dsa\.?|Kelurahan|Kecamatan|Kec\.?|Kabupaten|Kab\.?|Dusun|Dsn\.?)\s*</w:t>(?:(?!<w:t\b).)*?<w:t\b[^>]*>\s*)([A-Za-z0-9\-]+)(\s*</w:t>)',
        replace_prefixed_cross_tag,
        xml_text,
        flags=re.DOTALL | re.IGNORECASE
    )

    # 3. Standalone table cells or short headings (<= 25 chars, 1-2 words, title-cased/uppercase, not Indonesian words)
    def replace_standalone_cell(match):
        open_tag = match.group(1)
        content = match.group(2)
        close_tag = match.group(3)
        stripped = content.strip()
        words = stripped.split()
        if 1 <= len(words) <= 2 and len(stripped) <= 25 and stripped[0].isupper():
            if not is_indonesian_word(stripped):
                corr = check_village_typo(stripped, target_kab=target_kab)
                if corr:
                    lspace = content[:len(content) - len(content.lstrip())]
                    rspace = content[len(content.rstrip()):]
                    if stripped.isupper():
                        return f"{open_tag}{lspace}{corr.upper()}{rspace}{close_tag}"
                    return f"{open_tag}{lspace}{corr}{rspace}{close_tag}"
        return match.group(0)

    xml_text = re.sub(r'(<w:t\b[^>]*>)(.*?)(</w:t>)', replace_standalone_cell, xml_text, flags=re.DOTALL)

    return xml_text

def lookup_location(desa_name: str, kec_hint: str = "", doc_text_hint: str = "") -> Tuple[str, str, str, str]:
    """
    Look up (lat, lon, kecamatan, kabupaten) for a village.
    Disambiguates duplicate village names using subdistrict (kecamatan) or document context.
    Also handles typo correction via fuzzy matching.
    """
    corrected_desa = fuzzy_match_village(desa_name)
    d_key = corrected_desa.lower().strip()
    if not d_key:
        return ("-7.500000", "110.500000", kec_hint, "Kabupaten Magelang")

    matching = [loc for loc in KNOWN_LOCATIONS if loc["desa_key"] == d_key]
    
    if len(matching) == 1:
        loc = matching[0]
        lat, lon = KNOWN_COORDS.get(d_key, ("-7.500000", "110.500000"))[:2]
        return (lat, lon, loc["kecamatan"], loc["kabupaten"])
    
    elif len(matching) > 1:
        # Match by kecamatan hint if provided
        if kec_hint:
            k_hint_key = kec_hint.lower().strip()
            for loc in matching:
                if loc["kec_key"] == k_hint_key or k_hint_key in loc["kec_key"]:
                    lat, lon = KNOWN_COORDS.get(d_key, ("-7.500000", "110.500000"))[:2]
                    return (lat, lon, loc["kecamatan"], loc["kabupaten"])
        
        # Match by text hint in document
        if doc_text_hint:
            for loc in matching:
                kab_raw = loc["kabupaten"].replace("Kabupaten", "").strip()
                if re.search(rf'\b{re.escape(loc["kecamatan"])}\b|\b{re.escape(kab_raw)}\b', doc_text_hint, re.I):
                    lat, lon = KNOWN_COORDS.get(d_key, ("-7.500000", "110.500000"))[:2]
                    return (lat, lon, loc["kecamatan"], loc["kabupaten"])

        # Default to first match if disambiguation fails
        loc = matching[0]
        lat, lon = KNOWN_COORDS.get(d_key, ("-7.500000", "110.500000"))[:2]
        return (lat, lon, loc["kecamatan"], loc["kabupaten"])

    # Fallback if not found in master sheet
    if d_key in KNOWN_COORDS:
        lat, lon, def_kec, def_kab = KNOWN_COORDS[d_key]
        return (lat, lon, kec_hint or def_kec, def_kab)

    return ("-7.500000", "110.500000", kec_hint, "Kabupaten Magelang")




INDO_MONTH_MAP = {
    'januari': 1, 'jan': 1, 'january': 1,
    'februari': 2, 'feb': 2, 'february': 2,
    'maret': 3, 'mar': 3, 'march': 3,
    'april': 4, 'apr': 4,
    'mei': 5, 'may': 5,
    'juni': 6, 'jun': 6, 'june': 6,
    'juli': 7, 'jul': 7, 'july': 7,
    'agustus': 8, 'agu': 8, 'ags': 8, 'agt': 8, 'aug': 8, 'august': 8,
    'september': 9, 'sep': 9, 'sept': 9,
    'oktober': 10, 'okt': 10, 'oct': 10, 'october': 10,
    'november': 11, 'nov': 11,
    'desember': 12, 'des': 12, 'dec': 12, 'december': 12
}

INDO_MONTH_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

INDO_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

def extract_date_range(text: str, only_range: bool = False, default_year: int = 2026) -> Optional[Dict[str, Any]]:
    """
    Extracts date or date range from text/filename.
    Handles:
    - Two-month range: e.g. "31 Agustus - 4 September 2026", "31 Agt - 4 Sept", "31-Agustus-4-September-2026"
    - Single-month range: e.g. "17-20 Sept", "7 - 11 September 2026", "7-11-September-2026", "17 s.d. 20 Sept"
    - Single date: e.g. "11 September 2026", "11-September-2026", "15 Agustus 2026", "16 September"
    """
    if not text:
        return None
    clean_text = text.replace('%20', ' ').replace('_', ' ')
    
    # Delimiters:
    sep_word = r'[\s\-_–—\u2013\u2014]+'
    sep_day = r'(?:[\s\-_–—\u2013\u2014]+|(?:\s*[-–—\u2013\u2014]\s*)|(?:\s*(?:sampai|s\.?\s*d\.?|s\/d|sd)\s*))'

    # Extract explicit year from candidate if present, else fallback
    m_yr_search = re.search(r'\b(202[0-9]|203[0-9])\b', clean_text)
    year_found = int(m_yr_search.group(1)) if m_yr_search else default_year

    # 1. Two month range: e.g. 31 Agustus - 4 September 2026 or 31 Agt - 4 Sept
    m1 = re.search(
        r'(?:\b|[^\d])(\d{1,2})' + sep_word + r'([A-Za-z]+)' + sep_day + r'(\d{1,2})' + sep_word + r'([A-Za-z]+)(?:' + sep_word + r'(\d{4}))?',
        clean_text, re.I
    )
    if m1 and m1.group(2).lower() in INDO_MONTH_MAP and m1.group(4).lower() in INDO_MONTH_MAP:
        d1_day = int(m1.group(1))
        d1_m = INDO_MONTH_MAP[m1.group(2).lower()]
        d2_day = int(m1.group(3))
        d2_m = INDO_MONTH_MAP[m1.group(4).lower()]
        yr = int(m1.group(5)) if m1.group(5) else year_found
        if 1 <= d1_day <= 31 and 1 <= d2_day <= 31:
            try:
                dt1 = date(yr, d1_m, d1_day)
                dt2 = date(yr, d2_m, d2_day)
                if dt1 > dt2:
                    dt1, dt2 = dt2, dt1
                total_days = max(1, (dt2 - dt1).days + 1)
                return {
                    'is_range': True,
                    'start_date': (dt1.year, dt1.month, dt1.day),
                    'end_date': (dt2.year, dt2.month, dt2.day),
                    'start_iso': dt1.isoformat(),
                    'end_iso': dt2.isoformat(),
                    'total_days': total_days,
                    'range_str': f'{dt1.day} {INDO_MONTH_NAMES[dt1.month]} - {dt2.day} {INDO_MONTH_NAMES[dt2.month]} {yr}',
                    'start_day_name': INDO_DAYS[(dt1.weekday() + 1) % 7],
                    'end_day_name': INDO_DAYS[(dt2.weekday() + 1) % 7]
                }
            except ValueError:
                pass
        
    # 2. Single month range: e.g. 17-20 Sept, 7 - 11 September 2026, 7-11-September-2026, 17 s.d. 20 Sept
    m2 = re.search(
        r'(?:\b|[^\d])(\d{1,2})' + sep_day + r'(\d{1,2})' + sep_word + r'([A-Za-z]+)(?:' + sep_word + r'(\d{4}))?',
        clean_text, re.I
    )
    if m2 and m2.group(3).lower() in INDO_MONTH_MAP:
        d1_day = int(m2.group(1))
        d2_day = int(m2.group(2))
        m_idx = INDO_MONTH_MAP[m2.group(3).lower()]
        yr = int(m2.group(4)) if m2.group(4) else year_found
        if 1 <= d1_day <= 31 and 1 <= d2_day <= 31:
            try:
                d_start = min(d1_day, d2_day)
                d_end = max(d1_day, d2_day)
                dt1 = date(yr, m_idx, d_start)
                dt2 = date(yr, m_idx, d_end)
                total_days = max(1, (dt2 - dt1).days + 1)
                return {
                    'is_range': True,
                    'start_date': (yr, m_idx, d_start),
                    'end_date': (yr, m_idx, d_end),
                    'start_iso': dt1.isoformat(),
                    'end_iso': dt2.isoformat(),
                    'total_days': total_days,
                    'range_str': f'{d_start} - {d_end} {INDO_MONTH_NAMES[m_idx]} {yr}',
                    'start_day_name': INDO_DAYS[(dt1.weekday() + 1) % 7],
                    'end_day_name': INDO_DAYS[(dt2.weekday() + 1) % 7]
                }
            except ValueError:
                pass

    if only_range:
        return None
        
    # 3. Single date: e.g. 15 Agustus 2026, 11-September-2026, 16 Sept
    m3 = re.search(
        r'(?:tanggal' + sep_word + r')?(\d{1,2})' + sep_word + r'([A-Za-z]+)(?:' + sep_word + r'(\d{4}))?',
        clean_text, re.I
    )
    if m3 and m3.group(2).lower() in INDO_MONTH_MAP:
        d_day = int(m3.group(1))
        m_idx = INDO_MONTH_MAP[m3.group(2).lower()]
        yr = int(m3.group(3)) if m3.group(3) else year_found
        if 1 <= d_day <= 31:
            try:
                dt = date(yr, m_idx, d_day)
                return {
                    'is_range': False,
                    'start_date': (yr, m_idx, d_day),
                    'end_date': (yr, m_idx, d_day),
                    'start_iso': dt.isoformat(),
                    'end_iso': dt.isoformat(),
                    'total_days': 1,
                    'range_str': f'{d_day} {INDO_MONTH_NAMES[m_idx]} {yr}',
                    'start_day_name': INDO_DAYS[(dt.weekday() + 1) % 7],
                    'end_day_name': INDO_DAYS[(dt.weekday() + 1) % 7]
                }
            except ValueError:
                pass
            
    return None

def format_detected_date(day: int, month_name: str, year: int, default_time: str = "09:14:23") -> str:
    """Formats day, month, year into full Indonesian timestamp with day of week."""
    m_lower = month_name.lower()
    m_idx = INDO_MONTH_MAP.get(m_lower, 8)
    try:
        d = date(year, m_idx, day)
        indo_day = INDO_DAYS[(d.weekday() + 1) % 7]
        clean_month = month_name.capitalize()
        return f"{indo_day}, {day} {clean_month} {year} {default_time} WIB"
    except Exception:
        return f"{day} {month_name.capitalize()} {year} {default_time} WIB"

def clear_media_cache(keep_tokens: Optional[List[str]] = None):
    """Removes stale extracted media files and subdirectories."""
    keep = set(keep_tokens or [])
    if not os.path.exists(DOCX_MEDIA_DIR):
        return
    for f in os.listdir(DOCX_MEDIA_DIR):
        if f in keep:
            continue
        p = os.path.join(DOCX_MEDIA_DIR, f)
        try:
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
            else:
                os.remove(p)
        except Exception:
            pass

def cleanup_uploads(max_age_hours: int = 24, max_keep: int = 10):
    """Cleans up old uploaded docx files exceeding age or quota."""
    if not os.path.exists(DOCX_UPLOADS_DIR):
        return
    try:
        now = time.time()
        files = []
        for f in os.listdir(DOCX_UPLOADS_DIR):
            p = os.path.join(DOCX_UPLOADS_DIR, f)
            if os.path.isfile(p):
                files.append((p, os.path.getmtime(p)))
        
        # Sort newest first
        files.sort(key=lambda x: x[1], reverse=True)
        for idx, (p, mtime) in enumerate(files):
            age_hours = (now - mtime) / 3600.0
            if idx >= max_keep or age_hours > max_age_hours:
                try:
                    os.remove(p)
                except Exception:
                    pass
    except Exception as e:
        print(f"cleanup_uploads warning: {e}")

def cleanup_temp_media(max_age_hours: int = 24):
    """Removes media extraction cache older than max_age_hours."""
    if not os.path.exists(DOCX_MEDIA_DIR):
        return
    try:
        now = time.time()
        for f in os.listdir(DOCX_MEDIA_DIR):
            p = os.path.join(DOCX_MEDIA_DIR, f)
            try:
                mtime = os.path.getmtime(p)
                if (now - mtime) / 3600.0 > max_age_hours:
                    if os.path.isdir(p):
                        shutil.rmtree(p, ignore_errors=True)
                    else:
                        os.remove(p)
            except Exception:
                pass
    except Exception as e:
        print(f"cleanup_temp_media warning: {e}")

def cleanup_backups(max_age_days: int = 7, max_keep: int = 20):
    """Rotates and cleans up old backup files."""
    if not os.path.exists(BACKUP_DIR):
        return
    try:
        now = time.time()
        files = []
        for f in os.listdir(BACKUP_DIR):
            p = os.path.join(BACKUP_DIR, f)
            if os.path.isfile(p) and f.endswith(".docx"):
                files.append((p, os.path.getmtime(p)))
        
        # Sort newest first
        files.sort(key=lambda x: x[1], reverse=True)
        for idx, (p, mtime) in enumerate(files):
            age_days = (now - mtime) / 86400.0
            if idx >= max_keep or age_days > max_age_days:
                try:
                    os.remove(p)
                except Exception:
                    pass
    except Exception as e:
        print(f"cleanup_backups warning: {e}")

def is_survey_photo(data: bytes, filename: str) -> bool:
    """
    Validates if an image is a genuine field survey photo:
    - Skips small icons and logo graphics (< 8KB or < 180px)
    - Skips horizontal header banners or logos (high aspect ratio > 2.8 or extremely low unique color count)
    - Ensures valid photo format
    """
    if len(data) < 8000:
        return False
    try:
        with Image.open(io.BytesIO(data)) as img:
            w, h = img.size
            if min(w, h) < 180:
                return False
            aspect = max(w / h, h / w)
            if aspect > 2.8:
                return False
            
            # Count unique colors for logo detection: banners/logos often have very low unique colors compared to photos
            # Only sample if large enough, else just skip
            if w * h > 10000:
                img_rgb = img.convert("RGB")
                # Sample pixels to be fast
                sample = img_rgb.resize((50, 50))
                unique_colors = len(set(sample.getdata()))
                if unique_colors < 100: # Logo-like images have very low color variety
                    return False
            
            if img.format not in ("JPEG", "PNG", "WEBP"):
                return False
            return True
    except Exception:
        return False



def safe_int(v: Any, default: int = 0) -> int:
    """Safe string to int converter."""
    try:
        return int(v)
    except (ValueError, TypeError):
        return default

def parse_document(doc_path: str) -> Tuple[List[Dict[str, Any]], str, str, List[str]]:
    """
    Parses any Word document (.docx):
    - Extracts all genuine field survey photos in their CROPPED state (via DrawingML srcRect).
    - Dynamically detects Kabupaten, Provinsi, Tanggal, Desa, Dusun, and Kecamatan
      both from document paragraphs and the document filename.
    - Maps each photo to its corresponding section heading in the document.
    """
    doc_stat = os.stat(doc_path)
    doc_token = hashlib.md5(f"{os.path.abspath(doc_path)}_{doc_stat.st_mtime}_{doc_stat.st_size}".encode()).hexdigest()[:12]
    doc_media_dir = os.path.join(DOCX_MEDIA_DIR, doc_token)
    os.makedirs(doc_media_dir, exist_ok=True)
    clear_media_cache(keep_tokens=[doc_token])
    photos = []
    
    # 0. Clean and parse filename metadata
    raw_filename = os.path.basename(doc_path)
    clean_filename = re.sub(r'^[a-f0-9]{8,16}_', '', raw_filename)
    filename_text = clean_filename.replace('_', ' ').replace('%20', ' ')
    
    # Safely normalize dashed filename to preserve date ranges for text matching
    filename_normalized = re.sub(r'(\d{1,2})[-–—](\d{1,2})', r'\1 sampai \2', filename_text)
    filename_normalized = filename_normalized.replace('-', ' ').replace('_', ' ')
    filename_normalized = filename_normalized.replace(' sampai ', ' - ')




    
    with zipfile.ZipFile(doc_path, "r") as zin:
        namelist = zin.namelist()
        media_files = [n for n in namelist if n.startswith("word/media/")]
        
        def sort_key(name):
            m = re.search(r"image(\d+)", name)
            return int(m.group(1)) if m else 999
        media_files.sort(key=sort_key)
        
        root = None
        if "word/document.xml" in namelist:
            root = ET.fromstring(zin.read("word/document.xml"))
            
        rel_map = {}
        if "word/_rels/document.xml.rels" in namelist:
            rels_xml = zin.read("word/_rels/document.xml.rels").decode("utf-8", errors="ignore")
            for m in re.finditer(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels_xml):
                rel_map[m.group(1)] = m.group(2)
                
        # Extract clean text from paragraphs & tables
        paragraphs = []
        if root is not None:
            for p in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
                txt = ''.join([t.text for t in p.iter() if t.text]).strip()
                if txt:
                    paragraphs.append(txt)
        full_text = " \n ".join(paragraphs)
        combined_text = f"{filename_text} \n {filename_normalized} \n {full_text}"


        # 1. Parse DrawingML srcRect crops for each image
        # srcRect values are parts per 100,000 (1000 = 1%)
        img_crop_map = {}
        if root is not None:
            for elem in root.iter():
                if elem.tag.endswith('blipFill'):
                    blip = None
                    srcRect = None
                    for child in elem:
                        if child.tag.endswith('blip'):
                            blip = child
                        elif child.tag.endswith('srcRect'):
                            srcRect = child
                    if blip is not None and srcRect is not None and srcRect.attrib:
                        embed = blip.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
                        target = rel_map.get(embed, '')
                        bname = os.path.basename(target)
                        if bname:
                            img_crop_map[bname] = {
                                'l': safe_int(srcRect.attrib.get('l', 0)),
                                't': safe_int(srcRect.attrib.get('t', 0)),
                                'r': safe_int(srcRect.attrib.get('r', 0)),
                                'b': safe_int(srcRect.attrib.get('b', 0)),
                            }

        # Determine base year from document text (fallback 2026 or current year)
        doc_year = 2026
        m_yr = re.search(r'\b(?:TA\.?|Tahun\s+Anggaran|Tahun)?\s*(202[4-9]|203[0-9])\b', combined_text, re.IGNORECASE)
        if m_yr:
            try:
                doc_year = int(m_yr.group(1))
            except Exception:
                pass

        # 2. Detect Date (prioritize date RANGE first from filename or body text)
        date_info = None
        for candidate in [clean_filename, filename_text, filename_normalized, full_text]:
            di = extract_date_range(candidate, only_range=True, default_year=doc_year)
            if di:
                date_info = di
                break
        
        if not date_info:
            for candidate in [clean_filename, filename_text, filename_normalized, full_text]:
                di = extract_date_range(candidate, only_range=False, default_year=doc_year)
                if di:
                    date_info = di
                    break

        if not date_info:
            date_info = {
                'is_range': False,
                'start_date': (2026, 8, 15),
                'end_date': (2026, 8, 15),
                'start_iso': '2026-08-15',
                'end_iso': '2026-08-15',
                'total_days': 1,
                'range_str': '15 Agustus 2026',
                'start_day_name': 'Sabtu',
                'end_day_name': 'Sabtu'
            }

        doc_date = date_info['range_str']

        # 3. Detect Villages (Desa) from filename and document text
        detected_villages = []
        # Check filename pattern: "desa aditirto dan desa tlogosari" or "Karanganyar dan Sragen"
        # Split by 'dan' to catch multi-location patterns
        parts = re.split(r'\s+dan\s+', filename_text, flags=re.IGNORECASE)
        for part in parts:
            for m_v in re.finditer(r'\bdesa\s+([A-Za-z0-9]+)\b', part, re.IGNORECASE):
                v_name = fuzzy_match_village(m_v.group(1).strip())
                if v_name.lower() not in ('tersebut', 'ini', 'dan', 'pada', 'tingkat', 'wonogiri', 'karanganyar') and v_name not in detected_villages:
                    detected_villages.append(v_name)
            # Only match actual villages from KNOWN_COORDS if they are NOT kabupaten names
            for k in KNOWN_COORDS.keys():
                if k not in ['wonogiri', 'karanganyar', 'sragen', 'magelang', 'kebumen'] and re.search(rf'\b{k}\b', part, re.IGNORECASE):
                    v_matched = fuzzy_match_village(k)
                    if v_matched not in detected_villages:
                        detected_villages.append(v_matched)

        # Check body text for villages explicitly
        # 1. Match headings like "Desa Genito, Kab. Magelang" or "Desa Sugihan Kecamatan Jatiroto"
        for m_h in re.finditer(r'\bDesa\s+([A-Z][a-z0-9]+)\s*(?:,|\s+)\s*(?:Kab\.?|Kabupaten|Kec\.?|Kecamatan)\b', full_text):
            v_name = fuzzy_match_village(m_h.group(1).strip())
            if v_name.lower() not in ('wonogiri', 'karanganyar', 'tersebut', 'ini', 'dan', 'pada', 'tingkat', 'penerima', 'sesuai', 'adalah', 'di', 'yang') and v_name not in detected_villages:
                detected_villages.append(v_name)

        # Fallback 1: Check general pattern only if no primary headings found
        if not detected_villages:
            for m_v in re.finditer(r'\bDesa\s+((?!(?:tingkat|penerima|sesuai|adalah|di|yang|ini|tersebut)\b)[A-Z][A-Za-z0-9\s]{1,25}?)(?:\s+Kecamatan|\s+Kec\.|\r|\n|,|\.|$)', full_text):
                v_raw = m_v.group(1).strip()
                if ' dan ' in v_raw.lower():
                    for sub_v in re.split(r'\s+dan\s+', v_raw, flags=re.IGNORECASE):
                        sub_v_clean = fuzzy_match_village(sub_v.strip())
                        if sub_v_clean.lower() not in ('wonogiri', 'karanganyar') and sub_v_clean not in detected_villages:
                            detected_villages.append(sub_v_clean)
                else:
                    v_name = fuzzy_match_village(v_raw)
                    if v_name.lower() not in ('wonogiri', 'karanganyar') and v_name not in detected_villages:
                        detected_villages.append(v_name)

        # Fallback 2: Check known database villages in document text if still empty
        if not detected_villages:
            for k in KNOWN_COORDS.keys():
                if k not in ['wonogiri', 'karanganyar', 'sragen', 'magelang', 'kebumen', 'banyumas', 'purbalingga', 'temanggung'] and not is_indonesian_word(k) and re.search(rf'\b{k}\b', full_text, re.IGNORECASE):
                    v_cap = fuzzy_match_village(k)
                    if v_cap not in detected_villages and not is_indonesian_word(v_cap):
                        detected_villages.append(v_cap)

        # Check known villages in combined text if still empty
        if not detected_villages:
            for k in KNOWN_COORDS.keys():
                if not is_indonesian_word(k) and re.search(rf'\b{k}\b', combined_text, re.IGNORECASE):
                    v_matched = fuzzy_match_village(k)
                    if not is_indonesian_word(v_matched):
                        detected_villages.append(v_matched)

        global_desa = detected_villages[0] if detected_villages else ""

        # 4. Detect Kecamatan (Subdistrict)
        m_g_kec = re.search(r'\bKec(?:amatan|\.)\s+((?!(?:di|yang|ini)\b)[A-Za-z0-9\s]{1,25}?)(?:\s+Kabupaten|\s+Kab\.|\r|\n|,|\.|$)', combined_text, re.IGNORECASE)
        global_kec = m_g_kec.group(1).strip().title() if m_g_kec else ""
        if not global_kec and global_desa.lower() in KNOWN_COORDS:
            global_kec = KNOWN_COORDS[global_desa.lower()][2]

        # 5. Detect Dusun
        m_g_dusun = re.search(r'\bDusun\s+((?!(?:di|yang|ini)\b)[A-Za-z0-9\s]{1,25}?)(?:\r|\n|,|\.|$|;)', full_text, re.IGNORECASE)
        # Global dusun is reset to avoid carrying it over to villages that don't have one
        global_dusun = "" 

        # 6. Detect Kabupaten & Provinsi
        detected_kab = ""
        known_kabs_list = [
            "Banjarnegara", "Banyumas", "Batang", "Blora", "Boyolali", "Brebes",
            "Cilacap", "Demak", "Grobogan", "Jepara", "Karanganyar", "Kebumen",
            "Kendal", "Klaten", "Kudus", "Magelang", "Pati", "Pekalongan",
            "Pemalang", "Purbalingga", "Purworejo", "Rembang", "Semarang",
            "Sragen", "Sukoharjo", "Tegal", "Temanggung", "Wonogiri", "Wonosobo"
        ]

        # Priority 1: Check filename directly (e.g. Banjarnegara, Wonogiri)
        for k_name in known_kabs_list:
            if re.search(rf'\b{k_name}\b', filename_text, re.IGNORECASE):
                detected_kab = f"Kabupaten {k_name}"
                break

        # Priority 2: Count explicit "Kabupaten X" or "Kab. X" mentions in document
        if not detected_kab:
            kab_counts = {}
            for k_name in known_kabs_list:
                matches = len(re.findall(rf'\b(?:Kabupaten|Kab\.?)\s+{k_name}\b', full_text, re.IGNORECASE))
                if matches > 0:
                    kab_counts[k_name] = matches
            if kab_counts:
                best_kab = max(kab_counts.items(), key=lambda x: x[1])[0]
                detected_kab = f"Kabupaten {best_kab}"

        # Priority 3: General mention fallback
        if not detected_kab:
            found_kabs = []
            for k_name in known_kabs_list:
                if re.search(rf'\b{k_name}\b', combined_text, re.IGNORECASE):
                    found_kabs.append(k_name)
            if found_kabs:
                non_semarang = [k for k in found_kabs if k.lower() != 'semarang']
                chosen = non_semarang[0] if non_semarang else found_kabs[0]
                detected_kab = f"Kabupaten {chosen}"
            else:
                detected_kab = "Kabupaten Magelang"

        detected_prov = "Jawa Tengah"
        m_prov = re.search(r'(Jawa\s+Tengah|Jawa\s+Barat|Jawa\s+Timur|D\.?I\.?\s+Yogyakarta)', combined_text, re.IGNORECASE)
        if m_prov:
            detected_prov = m_prov.group(1).strip().title()

        # 7. Map blip images to headings in document order
        img_section_map = {}
        village_kec_map = {}
        current_desa = ""
        current_kec = ""
        current_dusun = ""

        if root is not None:
            # Enhanced context mapping: look for explicit sections "Desa X, Kab Y"
            # and match BLIPs to the most recent context
            for elem in root.iter():
                tag = elem.tag.split('}')[-1]
                if tag == 'p':
                    p_text = ''.join([node.text for node in elem.iter() if node.text]).strip()
                    if p_text:
                        # Match "Desa X, [Kab. Y / Kec. Z]" with optional comma and flexible spacing
                        m_heading = re.search(r'\bDesa\s+([A-Za-z0-9\s]+?)(?:,\s*|\s+)(Kec(?:amatan|\.)?|Kab(?:upaten|\.)?)\s+([A-Za-z0-9\s]+?)(?:\r|\n|,|\.|$)', p_text, re.IGNORECASE)
                        if m_heading:
                            current_desa = fuzzy_match_village(m_heading.group(1).strip())
                            w_type = m_heading.group(2).lower()
                            w_name = m_heading.group(3).strip().title()
                            if 'kec' in w_type:
                                current_kec = w_name
                                if current_desa:
                                    village_kec_map[current_desa] = current_kec
                        elif 'Desa' in p_text:
                            # Fallback simple
                            m_v = re.search(r'\bDesa\s+([A-Za-z0-9]+)', p_text, re.IGNORECASE)
                            if m_v:
                                v_cand = fuzzy_match_village(m_v.group(1).strip())
                                if v_cand.lower() not in ('wonogiri', 'karanganyar', 'tersebut', 'ini', 'dan', 'pada', 'tingkat', 'penerima', 'sesuai', 'adalah', 'di', 'yang'):
                                    current_desa = v_cand
                
                elif tag == 'blip':
                    embed = elem.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
                    target = rel_map.get(embed, '')
                    bname = os.path.basename(target)
                    if bname:
                        img_section_map[bname] = {
                            "desa": current_desa,
                            "kec": current_kec
                        }



        # 8. Extract photos with precision cropping applied
        survey_candidates = []
        for mf in media_files:
            bname = os.path.basename(mf)
            raw_data = zin.read(mf)

            # Apply Word DrawingML cropping if specified in srcRect
            if bname in img_crop_map:
                crop_info = img_crop_map[bname]
                try:
                    with Image.open(io.BytesIO(raw_data)) as img:
                        w, h = img.size
                        l_pct = max(0, safe_int(crop_info.get('l', 0))) / 100000.0
                        t_pct = max(0, safe_int(crop_info.get('t', 0))) / 100000.0
                        r_pct = max(0, safe_int(crop_info.get('r', 0))) / 100000.0
                        b_pct = max(0, safe_int(crop_info.get('b', 0))) / 100000.0
                        
                        left = int(w * l_pct)
                        top = int(h * t_pct)
                        right = w - int(w * r_pct)
                        bottom = h - int(h * b_pct)
                        
                        if right > left + 30 and bottom > top + 30:
                            cropped = img.crop((left, top, right, bottom))
                            buf = io.BytesIO()
                            fmt = img.format if img.format in ("JPEG", "PNG", "WEBP") else "JPEG"
                            if fmt == "JPEG" and cropped.mode in ("RGBA", "P"):
                                cropped = cropped.convert("RGB")
                            cropped.save(buf, format=fmt, quality=95)
                            raw_data = buf.getvalue()
                except Exception as e:
                    pass

            # Survey photo validation: skip logos, banners, PU emblems
            if not is_survey_photo(raw_data, bname):
                continue

            survey_candidates.append((mf, bname, raw_data))

        # Pre-assign authentic chronological times across the survey date(s)
        total_candidates = len(survey_candidates)
        img_counter = 1
        pre_assigned_times = []

        yr1, m1, d1_num = date_info['start_date']
        yr2, m2, d2_num = date_info['end_date']
        dt_start = date(yr1, m1, d1_num)
        dt_end = date(yr2, m2, d2_num)
        total_days = max(1, (dt_end - dt_start).days + 1)

        day_accum_minutes = {}
        for idx in range(total_candidates):
            day_step = min(total_days - 1, (idx * total_days) // total_candidates) if total_candidates > 0 else 0
            curr_day = dt_start + timedelta(days=day_step)
            day_key = curr_day.isoformat()

            if day_key not in day_accum_minutes:
                # Start between 09:12 and 09:28 (guarantee non-round minutes and seconds)
                m_init = 552 + ((idx * 7 + 3) % 17)
                if (m_init % 60) % 5 == 0:
                    m_init += 2
                day_accum_minutes[day_key] = m_init
            else:
                # Advance 45-75 minutes for next photo in same day
                step_m = 47 + ((idx * 13 + 7) % 29)
                if step_m % 5 == 0:
                    step_m += 2
                day_accum_minutes[day_key] += step_m

            mins = day_accum_minutes[day_key]
            if mins > 960: # cap at 16:00
                mins = 952 - ((idx * 3) % 11)
                if (mins % 60) % 5 == 0: mins -= 2

            h = mins // 60
            m = mins % 60
            s = (idx * 19 + 23) % 60
            if s % 5 == 0: s = (s + 2) % 60
            if m % 5 == 0: m = (m + 1) % 60

            day_name = INDO_DAYS[(curr_day.weekday() + 1) % 7]
            month_name = INDO_MONTH_NAMES[curr_day.month]
            time_str_val = f"{day_name}, {curr_day.day} {month_name} {curr_day.year} {h:02d}:{m:02d}:{s:02d} WIB"
            pre_assigned_times.append(time_str_val)


        for mf_idx, (mf, bname, raw_data) in enumerate(survey_candidates):
            out_path = os.path.join(doc_media_dir, bname)
            with open(out_path, "wb") as f_out:
                f_out.write(raw_data)


            m_num = re.search(r"image(\d+)", bname)
            img_num = int(m_num.group(1)) if m_num else img_counter
            img_counter += 1

            meta = img_section_map.get(bname, {})
            desa = meta.get("desa") or global_desa or ""
            
            # IMPROVED: distribute evenly across all detected villages
            if not meta.get("desa") and detected_villages and total_candidates > 0:
                v_idx = min(len(detected_villages) - 1, (mf_idx * len(detected_villages)) // total_candidates)
                desa = detected_villages[v_idx]

            kec = meta.get("kec") or global_kec or ""
            dusun = meta.get("dusun") or global_dusun or ""

            # Check known coordinate and subdistrict defaults
            lat = "-7.391520"
            lon = "110.312050"
            desa_key = desa.lower().strip()
            
            # Use pre-assigned strictly continuous chronological times
            time_str = pre_assigned_times[mf_idx] if mf_idx < len(pre_assigned_times) else doc_date


            # Ensure detected_villages is populated from both filename/text AND potential matches
            # from data_lokasi.csv (which is already in KNOWN_COORDS)
            all_detected_villages = []
            for v in detected_villages:
                if v not in all_detected_villages:
                    all_detected_villages.append(v)
            
            # If image section meta did not specify desa (common in single-table docs)
            # or if multiple villages detected, distribute evenly across detected villages.
            desa = meta.get("desa")
            
            # Use detected_villages list if it exists to ensure distribution
            if (not desa or len(set(detected_villages)) > 1) and detected_villages and total_candidates > 0:
                v_idx = (mf_idx * len(detected_villages)) // total_candidates
                desa = detected_villages[v_idx]
            elif not desa and detected_villages:
                desa = detected_villages[0]
            
            # If still no desa, fallback to global or empty
            if not desa:
                desa = global_desa or ""

            
            # Clean up suffix like 'Ta 2026' or 'Tahun 2026' from village name
            desa_clean = re.sub(r'\s+(?:ta|tahun)\s*\d{4}', '', desa, flags=re.I).strip()
            
            # Lookup accurate coordinates, kecamatan, and kabupaten using disambiguation
            mapped_kec = village_kec_map.get(desa_clean) or (meta.get("kec") if meta.get("desa") == desa else "")
            lat, lon, def_kec, def_kab = lookup_location(
                desa_name=desa_clean, 
                kec_hint=mapped_kec or global_kec or "", 
                doc_text_hint=combined_text
            )
            final_kec = mapped_kec or def_kec or global_kec or ""
            final_kab = def_kab

            # Apply coordinate jitter (~50-100 meters, ~0.00045 degrees)
            import random
            try:
                base_lat = float(lat) if lat else -7.500000
                base_lon = float(lon) if lon else 110.500000
                jitter_lat = base_lat + ((mf_idx * 7) % 11 - 5) * 0.00009 + (random.random() - 0.5) * 0.00008
                jitter_lon = base_lon + ((mf_idx * 13) % 11 - 5) * 0.00009 + (random.random() - 0.5) * 0.00008
                final_lat = f"{jitter_lat:.6f}"
                final_lon = f"{jitter_lon:.6f}"
            except Exception:
                final_lat = lat
                final_lon = lon

            # Extract dusun specific to the current section heading or paragraph context
            dusun_val = meta.get("dusun") or ""
            dusun_val = dusun_val if (dusun_val and dusun_val.lower() not in ["dusun", "lokasi pekerjaan", "mudal", "gopaan"]) else ""

            det_res = detect_timestamp(out_path)
            has_existing_stamp = det_res.get("has_timestamp", False)
            suggested_crop = det_res.get("suggested_crop_bottom", 0.18)

            photos.append({
                "id": img_num,
                "filename": bname,
                "url": f"/temp_media/{doc_token}/{bname}?t={int(doc_stat.st_mtime)}",
                "desa": desa_clean,
                "kecamatan": final_kec,
                "dusun": dusun_val,
                "time_str": time_str,
                "lat": final_lat,
                "lon": final_lon,
                "kabupaten": final_kab,
                "provinsi": detected_prov,
                "keep_original": has_existing_stamp,
                "skip_stamp": has_existing_stamp,
                "has_timestamp": has_existing_stamp,
                "timestamp_confidence": det_res.get("confidence", 0.0),
                "suggested_crop_bottom": suggested_crop,
                "is_cropped": False
            })

    seen_v = set()
    villages = []
    for p in photos:
        v = p.get("desa")
        if v and v != "Desa" and v not in seen_v:
            seen_v.add(v)
            villages.append(v)
    if not villages and detected_villages:
        villages = detected_villages
        
    return photos, detected_kab, detected_prov, villages, date_info


def _process_single_photo(args) -> Tuple[str, bytes]:
    img_num, raw_content, update_data, crop_info = args
    u = update_data
    if u.get("skip_stamp") or u.get("keep_original"):
        return img_num, raw_content

    img = Image.open(io.BytesIO(raw_content))
    try:
        did_xml_crop = False
        if crop_info:
            try:
                w, h = img.size
                l_pct = max(0, safe_int(crop_info.get('l', 0))) / 100000.0
                t_pct = max(0, safe_int(crop_info.get('t', 0))) / 100000.0
                r_pct = max(0, safe_int(crop_info.get('r', 0))) / 100000.0
                b_pct = max(0, safe_int(crop_info.get('b', 0))) / 100000.0
                left = int(w * l_pct)
                top = int(h * t_pct)
                right = w - int(w * r_pct)
                bottom = h - int(h * b_pct)
                if right > left + 30 and bottom > top + 30:
                    cropped = img.crop((left, top, right, bottom))
                    img.close()
                    img = cropped
                    if b_pct >= 0.10:
                        did_xml_crop = True
            except Exception as ce:
                print(f"Crop error during save: {ce}")

        # Check if photo contains legacy camera timestamp at the bottom
        # If so, clean it before applying the new Pamsimas stamp to eliminate duplicate/overlapping stamps!
        needs_bottom_clean = (
            not did_xml_crop and (
                u.get("has_timestamp") or
                u.get("is_cropped") or
                float(u.get("crop_bottom_pct", 0) or 0) > 0 or
                detect_timestamp(img).get("has_timestamp", False)
            )
        )

        if needs_bottom_clean:
            crop_pct = float(u.get("suggested_crop_bottom") or u.get("crop_bottom_pct") or 0.18)
            crop_pct = max(0.05, min(0.38, crop_pct))
            try:
                cleaned_img, _ = crop_image_bottom(img, crop_pct)
                img.close()
                img = cleaned_img
            except Exception as e:
                print(f"Failed to auto-clean legacy timestamp for image{img_num}: {e}")

        font_scale_val = float(u.get("font_scale") or u.get("fontScale") or 1.0)
        custom_addr = u.get("custom_address") or u.get("address") or u.get("raw_address")
        addr_mode = u.get("address_mode", "auto")
        stamped = apply_stamp(
            img,
            u.get("time_str", "Jumat, 14 Agustus 2026 09:14:23 WIB"),
            u.get("lat", "-7.422850"),
            u.get("lon", "110.133040"),
            u.get("dusun", "Dusun Grogol"),
            u.get("desa", "Tanjungsari"),
            u.get("kecamatan", "Windusari"),
            u.get("kabupaten", "Kabupaten Magelang"),
            u.get("provinsi", "Jawa Tengah"),
            font_scale=font_scale_val,
            custom_address=custom_addr,
            address_mode=addr_mode
        )
        sw, sh = stamped.size
        max_dim = 1280
        scale = min(1.0, max_dim / max(sw, sh))
        if scale < 1.0:
            resized = stamped.resize((int(sw * scale), int(sh * scale)), Image.Resampling.LANCZOS)
            stamped.close()
            stamped = resized
        buf = io.BytesIO()
        stamped.save(buf, format="JPEG", quality=82, optimize=True)
        stamped.close()
        result = buf.getvalue()
        buf.close()
        return img_num, result
    finally:
        try:
            img.close()
        except Exception:
            pass


def save_document(src_doc: str, updates: Dict[str, Any], out_doc: str, village_export_dir: Optional[str] = None) -> str:
    """
    Injects updated photos into Word docx, cleans XML constraints,
    resets <a:srcRect/> for modified photos so Word does not double-crop,
    and optionally exports stamped photos to respective village folders.
    Photo processing runs in parallel via ThreadPoolExecutor.
    """
    out_dir = os.path.dirname(out_doc)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    temp_out = out_doc + f".tmp_{uuid.uuid4().hex[:6]}"
    rel_id_to_img_num = {}
    rel_map = {}
    img_crop_map = {}
    with zipfile.ZipFile(src_doc, "r") as zin:
        if "word/_rels/document.xml.rels" in zin.namelist():
            rels_xml = zin.read("word/_rels/document.xml.rels").decode("utf-8", errors="ignore")
            for m in re.finditer(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels_xml):
                rel_map[m.group(1)] = m.group(2)
                target_img = m.group(2)
                m_num = re.search(r"image(\d+)\.", target_img)
                if m_num:
                    rel_id_to_img_num[m.group(1)] = m_num.group(1)

        if "word/document.xml" in zin.namelist():
            root = ET.fromstring(zin.read("word/document.xml"))
            for elem in root.iter():
                if elem.tag.endswith('blipFill'):
                    blip = None
                    srcRect = None
                    for child in elem:
                        if child.tag.endswith('blip'):
                            blip = child
                        elif child.tag.endswith('srcRect'):
                            srcRect = child
                    if blip is not None and srcRect is not None and srcRect.attrib:
                        embed = blip.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
                        target = rel_map.get(embed, '')
                        bname = os.path.basename(target)
                        if bname:
                            img_crop_map[bname] = {
                                'l': safe_int(srcRect.attrib.get('l', 0)),
                                't': safe_int(srcRect.attrib.get('t', 0)),
                                'r': safe_int(srcRect.attrib.get('r', 0)),
                                'b': safe_int(srcRect.attrib.get('b', 0)),
                            }
    updated_rids = set()
    for rid, img_num in rel_id_to_img_num.items():
        if img_num in updates and not (updates[img_num].get("skip_stamp") or updates[img_num].get("keep_original")):
            updated_rids.add(rid)
    raw_map: Dict[str, Tuple[bytes, str]] = {}
    with zipfile.ZipFile(src_doc, "r") as zin:
        for item in zin.infolist():
            m = re.search(r"word/media/image(\d+)\.(jpe?g|png)", item.filename, re.I)
            if m:
                img_num = str(m.group(1))
                if img_num in updates and not (updates[img_num].get("skip_stamp") or updates[img_num].get("keep_original")):
                    bname = os.path.basename(item.filename)
                    raw_bytes = zin.read(item.filename)
                    # If this photo was cropped in web UI, check if cleaned version exists in DOCX_MEDIA_DIR
                    if os.path.exists(DOCX_MEDIA_DIR):
                        for root, _, files in os.walk(DOCX_MEDIA_DIR):
                            if bname in files:
                                c_path = os.path.join(root, bname)
                                try:
                                    if os.path.getsize(c_path) > 1024:
                                        with open(c_path, "rb") as cf:
                                            raw_bytes = cf.read()
                                        break
                                except Exception:
                                    pass
                    raw_map[img_num] = (raw_bytes, bname)
    stamped_map: Dict[str, bytes] = {}
    if raw_map:
        work_items = [
            (img_num, raw_content, updates[img_num], img_crop_map.get(bname))
            for img_num, (raw_content, bname) in raw_map.items()
        ]
        max_workers = min(os.cpu_count() or 4, 8)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            for img_num, stamped_bytes in executor.map(_process_single_photo, work_items):
                stamped_map[img_num] = stamped_bytes
                del stamped_bytes
    if village_export_dir and stamped_map:
        for img_num, content in stamped_map.items():
            u = updates[img_num]
            desa_name = u.get("desa", "").strip()
            if desa_name:
                folder_desa = f"Desa {desa_name}" if not desa_name.lower().startswith("desa") else desa_name
                target_desa_dir = os.path.join(village_export_dir, folder_desa)
                os.makedirs(target_desa_dir, exist_ok=True)
                safe_dusun = re.sub(r'[\\/*?:"<>| ]', '_', u.get("dusun", "Lokasi"))
                photo_filename = f"Foto_{int(img_num):02d}_{desa_name}_{safe_dusun}.jpg"
                with open(os.path.join(target_desa_dir, photo_filename), "wb") as pf:
                    pf.write(content)

    with zipfile.ZipFile(src_doc, "r") as zin, zipfile.ZipFile(temp_out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            content = zin.read(item.filename)
            m = re.search(r"word/media/image(\d+)\.(jpe?g|png)", item.filename, re.I)
            if m:
                img_num = str(m.group(1))
                if img_num in stamped_map:
                    content = stamped_map[img_num]
            
            # Clean layout constraints, fix location typos & reset srcRect cropping for updated photos
            if item.filename == "word/document.xml":
                xml_text = content.decode("utf-8", errors="ignore")
                target_k = None
                if updates:
                    for _u in updates.values():
                        if isinstance(_u, dict) and _u.get("kabupaten"):
                            target_k = _u.get("kabupaten")
                            break
                xml_text = clean_xml_location_typos(xml_text, target_kab=target_k)
                xml_text = xml_text.replace('flipH="1"', '')
                
                # Reset srcRect for blipFills containing updated photos
                def reset_blip_crop(match):
                    block = match.group(0)
                    for rid in updated_rids:
                        if f'r:embed="{rid}"' in block or f'embed="{rid}"' in block:
                            block = re.sub(r'<a:srcRect\b[^>]*?/>', '<a:srcRect/>', block)
                            block = re.sub(r'<a:srcRect\b[^>]*?>.*?</a:srcRect>', '<a:srcRect/>', block, flags=re.DOTALL)
                            break
                    return block

                xml_text = re.sub(r'(<(?:pic|a):blipFill\b.*?</(?:pic|a):blipFill>)', reset_blip_crop, xml_text, flags=re.DOTALL)
                
                # Fallback clean known legacy crop constraints
                xml_text = re.sub(r'<a:srcRect[^>]*?b="30029"[^>]*?/>', '<a:srcRect/>', xml_text)
                xml_text = re.sub(r'<a:srcRect[^>]*?b="28091"[^>]*?/>', '<a:srcRect/>', xml_text)
                xml_text = re.sub(r'<a:srcRect[^>]*?b="23923"[^>]*?/>', '<a:srcRect/>', xml_text)
                content = xml_text.encode("utf-8")
                
            zout.writestr(item, content)
            
    # Atomically replace destination file
    if os.path.exists(out_doc):
        os.remove(out_doc)
    shutil.move(temp_out, out_doc)
    return out_doc
