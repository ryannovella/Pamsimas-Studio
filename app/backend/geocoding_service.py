import os
import re
import json
import urllib.request
import urllib.parse
from typing import Dict, Any, Optional

from app.backend.docx_service import KNOWN_LOCATIONS, fuzzy_match_village

# Cache in-memory to prevent repeated API calls
_GEOCODE_CACHE = {}

def _fetch_json(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 6) -> Optional[Dict[str, Any]]:
    default_headers = {
        "User-Agent": "PamsimasStudioApp/3.8 (pamsimas.monev@pu.go.id)",
        "Accept-Language": "id,en-US;q=0.9,en;q=0.8",
        "Accept": "application/json"
    }
    if headers:
        default_headers.update(headers)
    req = urllib.request.Request(url, headers=default_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except Exception:
        return None

def reverse_geocode(lat: float, lon: float) -> Dict[str, Any]:
    """
    Performs high-accuracy reverse geocoding for Indonesian survey coordinates:
    1. Queries geocoding API with Indonesian language context.
    2. Extracts Dusun/Jalan, Desa/Kelurahan, Kecamatan, Kabupaten, Provinsi.
    3. Cross-references with master Pamsimas village database to guarantee official naming.
    """
    cache_key = f"{round(lat, 4)}_{round(lon, 4)}"
    if cache_key in _GEOCODE_CACHE:
        return _GEOCODE_CACHE[cache_key]

    # Primary: OpenStreetMap Nominatim with official User-Agent
    url = f"https://nominatim.openstreetmap.org/reverse?lat={lat:.6f}&lon={lon:.6f}&format=json&accept-language=id&addressdetails=1"
    data = _fetch_json(url)

    # Fallback: BigDataCloud Reverse Geocoding API if Nominatim fails or times out
    if not data or not data.get("address"):
        bdc_url = f"https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat:.6f}&longitude={lon:.6f}&localityLanguage=id"
        bdc_data = _fetch_json(bdc_url)
        if bdc_data:
            data = {
                "display_name": f"{bdc_data.get('locality', '')}, {bdc_data.get('principalSubdivision', '')}",
                "address": {
                    "hamlet": bdc_data.get("locality", ""),
                    "village": bdc_data.get("locality", ""),
                    "subdistrict": bdc_data.get("city", ""),
                    "county": bdc_data.get("principalSubdivision", ""),
                    "state": bdc_data.get("principalSubdivision", "")
                }
            }

    addr = (data and data.get("address")) or {}

    # 1. Dusun / Hamlet / Neighbourhood / Road
    dusun = ""
    road = addr.get("road") or ""
    hamlet = addr.get("hamlet") or addr.get("neighbourhood") or addr.get("quarter") or ""

    if hamlet:
        dusun = hamlet
        if not re.search(r"^(?:dusun|kampung|dukuh)\s+", dusun, re.I):
            dusun = f"Dusun {dusun}"
    elif road:
        dusun = road
    elif addr.get("suburb") and addr.get("village"):
        dusun = f"Dusun {addr.get('suburb')}"

    # 2. Desa / Kelurahan
    desa = addr.get("village") or addr.get("suburb") or ""
    if not desa:
        desa = addr.get("hamlet") or addr.get("residential") or addr.get("quarter") or ""
    desa = re.sub(r"^(?:desa|kelurahan)\s+", "", desa, flags=re.I).strip()

    # 3. Kecamatan
    kec = addr.get("subdistrict") or addr.get("district") or addr.get("city_district") or addr.get("municipality") or ""
    if not kec and addr.get("town") and (addr.get("village") or addr.get("hamlet")):
        kec = addr.get("town")
    kec = re.sub(r"^(?:kecamatan|kec\.?)\s+", "", kec, flags=re.I).strip()

    # 4. Kabupaten / Kota
    kab = addr.get("county") or addr.get("city") or addr.get("state_district") or addr.get("regency") or ""
    kab = re.sub(r"^(?:kabupaten|kab\.?)\s+", "", kab, flags=re.I).strip()

    # 5. Provinsi
    prov = addr.get("state") or "Jawa Tengah"

    # Cross-reference with Pamsimas Master Location database
    desa_title = desa.title() if desa else ""
    if desa:
        matched = fuzzy_match_village(desa)
        if matched and matched != desa_title:
            desa_title = matched

    # Find matching kecamatan and kabupaten from KNOWN_LOCATIONS
    d_clean = desa_title.lower()
    for loc in KNOWN_LOCATIONS:
        if loc.get("desa_key") == d_clean:
            if not kec and loc.get("kecamatan"):
                kec = loc.get("kecamatan")
            if not kab and loc.get("kabupaten"):
                kab = loc.get("kabupaten")
            break

    # Standardize official naming prefixes for Pamsimas geotag stamps
    kec_clean = f"Kecamatan {kec.title()}" if kec and not kec.lower().startswith("kecamatan") else (kec.title() if kec else "")
    kab_clean = f"Kabupaten {kab.title()}" if kab and not kab.lower().startswith(("kabupaten", "kota")) else (kab.title() if kab else "Kabupaten Magelang")
    prov_clean = prov.title() if prov else "Jawa Tengah"

    # Generate clean natural GPS Map Camera style address string without stiff administrative prefixes
    raw_display = (data.get("display_name") if data else "") or ""
    natural_address = re.sub(r",\s*\d{5}(?:,\s*Indonesia)?$", "", raw_display, flags=re.I).strip()
    if natural_address.endswith(", Indonesia"):
        natural_address = natural_address[:-11].strip()
    if not natural_address:
        natural_parts = [p for p in [dusun, desa_title, kec.title() if kec else "", kab.title() if kab else "", prov_clean] if p]
        natural_address = ", ".join(natural_parts) if natural_parts else f"{lat:.6f}, {lon:.6f}"

    # Structured address format with official prefixes
    addr_parts = [p for p in [dusun, (f"Desa {desa_title}" if desa_title else ""), kec_clean, kab_clean, prov_clean] if p]
    structured_address = ", ".join(addr_parts) if addr_parts else natural_address

    result = {
        "success": True,
        "lat": f"{lat:.6f}",
        "lon": f"{lon:.6f}",
        "dusun": dusun,
        "desa": desa_title,
        "kecamatan": kec_clean,
        "kabupaten": kab_clean,
        "provinsi": prov_clean,
        "natural_address": natural_address,
        "full_address": natural_address,
        "structured_address": structured_address,
        "display_name": raw_display or natural_address
    }

    _GEOCODE_CACHE[cache_key] = result
    return result

def search_location(query: str) -> Dict[str, Any]:
    """Searches coordinates by place name or village query in Indonesia."""
    clean_q = query.strip()
    if not clean_q:
        return {"success": False, "results": []}

    encoded = urllib.parse.quote(f"{clean_q}, Jawa Tengah, Indonesia")
    url = f"https://nominatim.openstreetmap.org/search?q={encoded}&format=json&limit=5&accept-language=id&addressdetails=1"
    data = _fetch_json(url)

    if not data:
        # Fallback without restricting to province
        encoded_loose = urllib.parse.quote(f"{clean_q}, Indonesia")
        url_loose = f"https://nominatim.openstreetmap.org/search?q={encoded_loose}&format=json&limit=5&accept-language=id&addressdetails=1"
        data = _fetch_json(url_loose)

    results = []
    if isinstance(data, list):
        for item in data:
            lat = float(item.get("lat", 0.0))
            lon = float(item.get("lon", 0.0))
            parsed = reverse_geocode(lat, lon)
            results.append({
                "display_name": item.get("display_name"),
                "lat": f"{lat:.6f}",
                "lon": f"{lon:.6f}",
                "dusun": parsed.get("dusun"),
                "desa": parsed.get("desa"),
                "kecamatan": parsed.get("kecamatan"),
                "kabupaten": parsed.get("kabupaten"),
                "provinsi": parsed.get("provinsi")
            })

    return {"success": True, "results": results}
