import os
import io
import re
import math
import random
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Any, Optional
from PIL import Image, ExifTags

# =========================================================
# 1. EXIF METADATA EXTRACTION (PRIORITY 1)
# =========================================================

def _convert_to_degrees(value) -> float:
    """Helper to convert GPS coordinates in EXIF format to degrees float."""
    try:
        if isinstance(value, (tuple, list)):
            d = float(value[0])
            m = float(value[1])
            s = float(value[2])
            return d + (m / 60.0) + (s / 3600.0)
        return float(value)
    except Exception:
        return 0.0

def extract_exif(image_path_or_bytes) -> Tuple[Optional[float], Optional[float], Optional[datetime]]:
    """
    Extracts GPS (lat, lon) and original capture datetime from EXIF if present.
    """
    try:
        if isinstance(image_path_or_bytes, (str, os.PathLike)):
            img = Image.open(image_path_or_bytes)
        else:
            img = Image.open(io.BytesIO(image_path_or_bytes))
            
        with img:
            exif_raw = img.getexif()
            if not exif_raw:
                return None, None, None
                
            exif = {}
            for tag_id, value in exif_raw.items():
                tag_name = ExifTags.TAGS.get(tag_id, tag_id)
                exif[tag_name] = value

            # Parse GPS Info
            gps_info = exif.get("GPSInfo")
            lat, lon = None, None
            if gps_info:
                gps_tags = {}
                for t in gps_info:
                    sub_tag = ExifTags.GPSTAGS.get(t, t)
                    gps_tags[sub_tag] = gps_info[t]
                    
                if "GPSLatitude" in gps_tags and "GPSLongitude" in gps_tags:
                    lat = _convert_to_degrees(gps_tags["GPSLatitude"])
                    if gps_tags.get("GPSLatitudeRef") == "S":
                        lat = -lat
                    lon = _convert_to_degrees(gps_tags["GPSLongitude"])
                    if gps_tags.get("GPSLongitudeRef") == "W":
                        lon = -lon
                        
            # Parse DateTimeOriginal
            dt = None
            dt_str = exif.get("DateTimeOriginal") or exif.get("DateTime")
            if dt_str:
                try:
                    dt = datetime.strptime(str(dt_str)[:19], "%Y:%m:%d %H:%M:%S")
                except Exception:
                    pass
                    
            return lat, lon, dt
    except Exception:
        return None, None, None

def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates ground distance between two GPS coordinates in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


# =========================================================
# 2. LIGHTWEIGHT VISUAL SIMILARITY (PRIORITY 2)
# =========================================================

def compute_dhash(img: Image.Image, hash_size: int = 8) -> List[bool]:
    """Computes difference hash (dHash) for gradient/structure comparison."""
    tmp = img.convert("L")
    gray = tmp.resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
    tmp.close()
    try:
        pixels = list(gray.getdata())
        diff = []
        for row in range(hash_size):
            for col in range(hash_size):
                pixel_left = pixels[row * (hash_size + 1) + col]
                pixel_right = pixels[row * (hash_size + 1) + col + 1]
                diff.append(pixel_left > pixel_right)
        return diff
    finally:
        gray.close()

def hamming_distance(h1: List[bool], h2: List[bool]) -> int:
    """Hamming distance between two dHash vectors."""
    return sum(b1 != b2 for b1, b2 in zip(h1, h2))

def compute_color_profile(img: Image.Image) -> Tuple[float, float, float]:
    """Computes mean RGB color values on downsampled image for environment detection."""
    tmp = img.convert("RGB")
    small = tmp.resize((16, 16), Image.Resampling.BILINEAR)
    tmp.close()
    try:
        pixels = list(small.getdata())
        r = sum(p[0] for p in pixels) / len(pixels)
        g = sum(p[1] for p in pixels) / len(pixels)
        b = sum(p[2] for p in pixels) / len(pixels)
        return (r, g, b)
    finally:
        small.close()

def color_distance(c1: Tuple[float, float, float], c2: Tuple[float, float, float]) -> float:
    """Euclidean distance between two color profiles."""
    return math.sqrt((c1[0] - c2[0])**2 + (c1[1] - c2[1])**2 + (c1[2] - c2[2])**2)


# =========================================================
# 3. MULTI-STAGE PHOTO CLUSTERING
# =========================================================

def cluster_photos(photos: List[Dict[str, Any]], gps_threshold_meters: float = 80.0) -> List[Dict[str, Any]]:
    """
    Groups photos into distinct field spots:
    1. EXIF GPS distance (if available, >80m indicates different spot).
    2. Dusun / Location text cues.
    3. Visual similarity (dHash & Color profile).
    """
    if not photos:
        return []

    # Precompute visual fingerprints for each photo
    enriched = []
    for p in photos:
        img_obj = p.get("imgObj")
        img_path = p.get("path")
        
        # Load image if needed
        pil_img = None
        should_close = False
        if img_obj:
            pil_img = img_obj
        elif img_path and os.path.exists(img_path):
            try:
                pil_img = Image.open(img_path)
                should_close = True
            except Exception:
                pass
                
        d_hash = compute_dhash(pil_img) if pil_img else None
        c_prof = compute_color_profile(pil_img) if pil_img else None
        if should_close and pil_img:
            try:
                pil_img.close()
            except Exception:
                pass
        
        # Parse coordinates
        lat_val = None
        lon_val = None
        try:
            if p.get("lat") and p.get("lon"):
                lat_val = float(str(p["lat"]).replace(",", "."))
                lon_val = float(str(p["lon"]).replace(",", "."))
        except Exception:
            pass

        enriched.append({
            "meta": p,
            "hash": d_hash,
            "color": c_prof,
            "lat": lat_val,
            "lon": lon_val,
            "dusun": (p.get("dusun") or "").strip().lower(),
            "desa": (p.get("desa") or "").strip().lower()
        })

    clusters: List[List[Dict[str, Any]]] = []
    
    for item in enriched:
        matched_cluster = None
        
        # Check against existing clusters
        for cl in clusters:
            rep = cl[0] # Cluster representative
            
            # Rule 0: Village (Desa) boundary isolation - never merge across different villages
            if item["desa"] and rep["desa"] and item["desa"] != rep["desa"]:
                continue
            
            # Rule 1: Dusun name match / mismatch
            if item["dusun"] and rep["dusun"] and item["dusun"] == rep["dusun"]:
                matched_cluster = cl
                break
                
            # Rule 2: GPS Distance if both have valid coordinates
            if item["lat"] is not None and rep["lat"] is not None:
                dist = haversine_meters(item["lat"], item["lon"], rep["lat"], rep["lon"])
                if dist < gps_threshold_meters:
                    matched_cluster = cl
                    break
                else:
                    # Clearly distant GPS (> 80m) -> different spot
                    continue
                    
            # Rule 3: Visual similarity if hashes and color exist
            if item["hash"] and rep["hash"] and item["color"] and rep["color"]:
                h_dist = hamming_distance(item["hash"], rep["hash"])
                c_dist = color_distance(item["color"], rep["color"])
                
                # Close visual match (similar environment & palette)
                if h_dist <= 26 or c_dist <= 22.0:
                    matched_cluster = cl
                    break
                    
        if matched_cluster is not None:
            matched_cluster.append(item)
        else:
            clusters.append([item])

    # Format result structures
    formatted_clusters = []
    for idx, cl in enumerate(clusters):
        first = cl[0]["meta"]
        spot_name = first.get("dusun") or f"Lokasi #{idx + 1}"
        desa_name = first.get("desa") or ""
        
        formatted_clusters.append({
            "spot_id": idx + 1,
            "title": f"Spot #{idx + 1}: {spot_name}" + (f" ({desa_name})" if desa_name else ""),
            "dusun": spot_name,
            "desa": desa_name,
            "photos": [x["meta"] for x in cl]
        })
        
    return formatted_clusters


# =========================================================
# 4. ADAPTIVE REALISTIC TIMELINE GENERATOR (HUMANIZED JITTER)
# =========================================================

def _get_humanized_seconds(min_sec: int, max_sec: int) -> int:
    """
    Returns an irregular, non-round number of seconds:
    Avoids endings of 0 or 5 (e.g. chooses 18s, 24s, 37s, 42s, etc.)
    """
    valid_pool = [s for s in range(min_sec, max_sec + 1) if s % 5 != 0 and s % 10 != 0]
    if not valid_pool:
        valid_pool = [s for s in range(min_sec, max_sec + 1) if s % 10 != 0]
    return random.choice(valid_pool) if valid_pool else min_sec

def _step_humanized_time(cur_dt: datetime, min_sec: int, max_sec: int) -> Tuple[datetime, int]:
    """
    Advances datetime by an irregular delta, guaranteeing both the resulting clock second,
    clock minute, and the delta seconds do NOT end in 0 or 5.
    """
    for _ in range(100):
        delta_sec = _get_humanized_seconds(min_sec, max_sec)
        new_dt = cur_dt + timedelta(seconds=delta_sec)
        if new_dt.second % 5 != 0 and new_dt.minute % 5 != 0 and delta_sec % 5 != 0:
            return new_dt, delta_sec

    # Fallback with safe coprime shift
    for shift in [17, 23, 31, 47, 53, 67, 73, 83]:
        fallback_dt = cur_dt + timedelta(seconds=shift)
        if fallback_dt.second % 5 != 0 and fallback_dt.minute % 5 != 0:
            return fallback_dt, shift

    fallback_dt = cur_dt + timedelta(seconds=17)
    if fallback_dt.minute % 5 == 0:
        fallback_dt += timedelta(minutes=1)
    if fallback_dt.second % 5 == 0:
        fallback_dt += timedelta(seconds=2)
    return fallback_dt, 17

def _jitter_gps_coordinates(lat: Any, lon: Any, min_m: float = 6.0, max_m: float = 24.0) -> Tuple[str, str]:
    """
    Generates slight realistic ground drift for GPS coordinates (avoiding multiples of 5 meters),
    ensuring each photo has distinct, authentic survey coordinates (never plek ketiplek).
    """
    try:
        lat_f = float(str(lat).replace(",", "."))
        lon_f = float(str(lon).replace(",", "."))
        
        valid_m = [m for m in range(int(math.ceil(min_m)), int(math.floor(max_m)) + 1) if m % 5 != 0]
        base_m = random.choice(valid_m) if valid_m else 13
        frac = random.choice([0.13, 0.27, 0.38, 0.42, 0.63, 0.74, 0.86])
        radius = base_m + frac
        angle = random.uniform(0.0, 2.0 * math.pi)
        
        m_per_deg_lat = 111132.0
        m_per_deg_lon = 111320.0 * math.cos(math.radians(lat_f))
        
        d_lat = (radius * math.cos(angle)) / m_per_deg_lat
        d_lon = (radius * math.sin(angle)) / m_per_deg_lon
        
        new_lat = f"{lat_f + d_lat:.6f}"
        new_lon = f"{lon_f + d_lon:.6f}"
        return new_lat, new_lon
    except Exception:
        return str(lat), str(lon)

INDO_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
INDO_MONTH_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

def generate_humanized_timeline(
    clusters: List[Dict[str, Any]],
    start_time_str: str = "09:14:23",
    end_time_str: str = "15:00:00",
    date_tuple: Tuple[int, int, int] = (2026, 8, 14),
    end_date_tuple: Optional[Tuple[int, int, int]] = None,
    day_name: Optional[str] = None,
    intra_min_sec: int = 47,       # Same spot min: 47 seconds (avoid multiple of 5)
    intra_max_sec: int = 163,      # Same spot max: 2m 43s (avoid multiple of 5)
    transit_min_min: int = 31,     # Moving between spots min: 31 minutes (avoid 30)
    transit_max_min: int = 49,     # Moving between spots max: 49 minutes (avoid 50)
    apply_gps_jitter: bool = True,
    min_gps_jitter_m: float = 6.0,
    max_gps_jitter_m: float = 24.0
) -> List[Dict[str, Any]]:
    """
    Generates realistic, authentic inspection timeline:
    - Multi-day & single-day support: automatically distributes spots across date range.
    - Realistic work hours: starts at start_time_str (e.g. 09:00 WIB) and strictly capped by end_time_str (e.g. 15:00 WIB).
    - Intra-cluster (same spot): 47s - 2m 43s with non-round humanized jitter.
    - Inter-cluster (between spots): transit time strictly avoiding multiples of 5 for minutes & seconds.
    - Clock minutes & seconds are guaranteed never ending in 0 or 5.
    - Daily morning clock starts naturally for each new day of the survey.
    - GPS Coordinates get realistic survey jitter (avoiding 5m, 10m, 15m, 20m, 25m).
    """
    time_parts = [int(p) for p in re.findall(r"\d+", start_time_str)]
    base_hh = time_parts[0] if len(time_parts) > 0 else 9
    base_mm = time_parts[1] if len(time_parts) > 1 else 14
    base_ss = time_parts[2] if len(time_parts) > 2 else 23

    end_time_parts = [int(p) for p in re.findall(r"\d+", end_time_str)]
    limit_hh = end_time_parts[0] if len(end_time_parts) > 0 else 15
    limit_mm = end_time_parts[1] if len(end_time_parts) > 1 else 0
    limit_ss = end_time_parts[2] if len(end_time_parts) > 2 else 0
    
    # Ensure starting seconds & minutes are non-round
    if base_ss % 5 == 0:
        base_ss = (base_ss + 2) % 60
    if base_mm % 5 == 0:
        base_mm = (base_mm + 2) % 60

    from datetime import date as _date
    d1 = _date(date_tuple[0], date_tuple[1], date_tuple[2])
    d2 = _date(end_date_tuple[0], end_date_tuple[1], end_date_tuple[2]) if end_date_tuple else d1
    if d2 < d1:
        d2 = d1
    total_days = max(1, (d2 - d1).days + 1)
    total_clusters = len(clusters)

    timeline_results = []
    global_photo_idx = 0
    current_day_offset = -1
    cur_dt = None

    for c_idx, cluster in enumerate(clusters):
        photos = cluster.get("photos", [])
        spot_title = cluster.get("title", f"Spot #{c_idx + 1}")
        
        # Calculate which day in the date range this spot belongs to
        day_offset = min(total_days - 1, (c_idx * total_days) // total_clusters) if total_clusters > 0 else 0
        is_new_day = (day_offset != current_day_offset)
        current_day_offset = day_offset

        if is_new_day:
            cur_day = d1 + timedelta(days=day_offset)
            # Starting time with authentic irregular jitter per day (e.g. 09:12, 09:18, 09:23)
            day_hh = base_hh
            day_mm = (base_mm + ((c_idx * 7 + 3) % 15)) % 60
            if day_mm % 5 == 0:
                day_mm = (day_mm + 2) % 60
            day_ss = (base_ss + ((c_idx * 13 + 17) % 30)) % 60
            if day_ss % 5 == 0:
                day_ss = (day_ss + 2) % 60
            cur_dt = datetime(cur_day.year, cur_day.month, cur_day.day, day_hh, day_mm, day_ss)

        for p_idx, p in enumerate(photos):
            global_photo_idx += 1
            transit_note = None
            delta_note = None

            if p_idx == 0:
                if is_new_day:
                    delta_note = f"Awal Hari ke-{day_offset + 1}" if total_days > 1 else "Waktu Awal"
                    if c_idx > 0 and total_days > 1:
                        day_lbl = INDO_DAYS[(cur_dt.weekday() + 1) % 7]
                        m_lbl = INDO_MONTH_NAMES[cur_dt.month]
                        transit_note = f"Hari ke-{day_offset + 1} ({day_lbl}, {cur_dt.day} {m_lbl}): {spot_title}"
                elif c_idx > 0:
                    # Travel / Transit between different locations on same day
                    valid_transit_mins = [m for m in range(transit_min_min, transit_max_min + 1) if m % 5 != 0]
                    t_m = random.choice(valid_transit_mins) if valid_transit_mins else 33
                    t_s_pool = [17, 23, 31, 38, 42, 53]
                    t_s = random.choice(t_s_pool)
                    transit_sec = t_m * 60 + t_s
                    cur_dt += timedelta(seconds=transit_sec)
                    if cur_dt.second % 5 == 0:
                        cur_dt += timedelta(seconds=2 if cur_dt.second < 58 else -2)
                    if cur_dt.minute % 5 == 0:
                        cur_dt += timedelta(minutes=1 if cur_dt.minute < 59 else -1)
                    transit_note = f"Perpindahan ke {spot_title}: +{t_m} menit {t_s} detik"
                    delta_note = f"+{t_m}m {t_s}s"
                else:
                    delta_note = "Waktu Awal"
            else:
                # Same spot inspection: irregular seconds avoiding multiples of 5
                cur_dt, step_sec = _step_humanized_time(cur_dt, intra_min_sec, intra_max_sec)
                s_m = step_sec // 60
                s_s = step_sec % 60
                delta_note = f"+{s_m}m {s_s}s" if s_m > 0 else f"+{s_s}s"

            # Enforce afternoon work hour ceiling (e.g. max 15:00 WIB)
            day_limit_dt = datetime(cur_dt.year, cur_dt.month, cur_dt.day, limit_hh, limit_mm, limit_ss)
            if cur_dt > day_limit_dt:
                cur_dt = day_limit_dt - timedelta(minutes=random.choice([2, 3, 4, 6, 7]), seconds=_get_humanized_seconds(18, 54))
                if cur_dt.second % 5 == 0:
                    cur_dt += timedelta(seconds=2 if cur_dt.second < 58 else -2)
                if cur_dt.minute % 5 == 0:
                    cur_dt += timedelta(minutes=1 if cur_dt.minute < 59 else -1)

            h_str = f"{cur_dt.hour:02d}"
            m_str = f"{cur_dt.minute:02d}"
            s_str = f"{cur_dt.second:02d}"

            photo_day_name = INDO_DAYS[(cur_dt.weekday() + 1) % 7]
            photo_month_name = INDO_MONTH_NAMES[cur_dt.month]
            full_time_str = f"{photo_day_name}, {cur_dt.day} {photo_month_name} {cur_dt.year} {h_str}:{m_str}:{s_str} WIB"

            # Apply GPS jitter if enabled and coordinates exist
            photo_lat = p.get("lat")
            photo_lon = p.get("lon")
            if apply_gps_jitter and photo_lat is not None and photo_lon is not None:
                photo_lat, photo_lon = _jitter_gps_coordinates(photo_lat, photo_lon, min_gps_jitter_m, max_gps_jitter_m)

            timeline_results.append({
                "photo_id": p.get("id"),
                "filename": p.get("filename") or p.get("name"),
                "spot_id": c_idx + 1,
                "spot_title": spot_title,
                "time_str": full_time_str,
                "clock": f"{h_str}:{m_str}:{s_str}",
                "delta_label": delta_note,
                "transit_note": transit_note,
                "url": p.get("url") or p.get("dataUrl"),
                "dusun": p.get("dusun"),
                "desa": p.get("desa"),
                "kecamatan": p.get("kecamatan"),
                "kabupaten": p.get("kabupaten"),
                "provinsi": p.get("provinsi"),
                "lat": photo_lat,
                "lon": photo_lon
            })

    return timeline_results

