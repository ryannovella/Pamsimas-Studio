import os
import io
import json
import zipfile
import uuid
import shutil
import re
import base64
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from bottle import Bottle, request, response, static_file, run, BaseRequest
from PIL import Image

# Allow up to 100MB payload for large photo uploads and base64 payloads
BaseRequest.MEMFILE_MAX = 100 * 1024 * 1024

from app.backend.config import (
    BASE_DIR, WEB_DIR, DOCX_MEDIA_DIR, DOCX_UPLOADS_DIR,
    OUTPUT_DIR, BACKUP_DIR, DEFAULT_DOCX, SERVER_HOST, SERVER_PORT
)
from app.backend.stamper import apply_stamp, stamp_to_bytes
from app.backend.stamp_detector import detect_timestamp, crop_image_bottom
from app.backend.docx_service import (
    parse_document, save_document, extract_date_range,
    cleanup_uploads, cleanup_temp_media, cleanup_backups
)
from app.backend.timeline_analyzer import cluster_photos, generate_humanized_timeline
from app.backend.geocoding_service import reverse_geocode, search_location
from app.backend.logger import log_error, get_recent_logs, clear_logs, ERROR_LOG_PATH
from app.backend.report_generator import (
    draft_village_narrative, generate_monev_docx, sanitize_pamsimas_text,
    build_structured_monev_narrative_local, format_to_indonesian_date,
    normalize_personel_title, get_village_kondisi_per_date, get_next_working_day
)
from app.backend.docx_inspector import inspect_and_import_monev_docx, merge_inspected_monev_reports
from app.backend.updater import get_version_info, check_for_updates, apply_update, _is_cloud_environment
from app.backend.personel_service import (
    load_personel_list, add_personel_entry, edit_personel_entry, delete_personel_entry,
    refine_personel_name_kbbi, validate_personel_input
)

app = Bottle()

# =========================================================
# STATIC FILE SERVING (NO-CACHE FOR INSTANT UPDATES)
# =========================================================
def no_cache_static(filename, root):
    res = static_file(filename, root=root)
    res.set_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
    res.set_header("Pragma", "no-cache")
    res.set_header("Expires", "0")
    return res

@app.route("/temp_media/<filepath:path>")
def serve_temp_media(filepath):
    return no_cache_static(filepath, root=DOCX_MEDIA_DIR)

@app.route("/")
def index():
    return no_cache_static("index.html", root=WEB_DIR)

@app.route("/style.css")
def serve_css():
    return no_cache_static("style.css", root=WEB_DIR)

@app.route("/js/<filepath:path>")
def serve_js_modules(filepath):
    return no_cache_static(filepath, root=os.path.join(WEB_DIR, "js"))

@app.route("/app.js")
def serve_legacy_app_js():
    return no_cache_static("app.js", root=os.path.join(WEB_DIR, "js"))


# =========================================================
# GEOCODING & REVERSE GEOCODING APIS
# =========================================================
@app.route("/api/geocoding/reverse", method="GET")
def api_reverse_geocode():
    try:
        lat = float(request.query.get("lat", 0.0))
        lon = float(request.query.get("lon", 0.0))
        res = reverse_geocode(lat, lon)
        response.content_type = "application/json"
        return json.dumps(res)
    except Exception as e:
        log_error("api_reverse_geocode", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/geocoding/search", method="GET")
def api_search_location():
    try:
        q = request.query.get("q", "").strip()
        res = search_location(q)
        response.content_type = "application/json"
        return json.dumps(res)
    except Exception as e:
        log_error("api_search_location", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})


# =========================================================
# PHOTO STAMP API
# =========================================================
@app.route("/api/photo/stamp", method="POST")
def stamp_single():
    try:
        upload = request.files.get("image")
        if not upload:
            response.status = 400
            response.content_type = "application/json"
            return json.dumps({"success": False, "error": "No image uploaded"})

        try:
            raw_scale = float(request.forms.get("font_scale") or request.forms.get("fontScale") or 1.0)
        except (TypeError, ValueError):
            raw_scale = 1.0
        font_scale_val = max(0.5, min(2.0, raw_scale))

        try:
            img = Image.open(upload.file)
            img.load()
        except Exception:
            response.status = 400
            response.content_type = "application/json"
            return json.dumps({"success": False, "error": "Berkas gambar tidak valid atau rusak"})

        result_bytes = stamp_to_bytes(
            img,
            request.forms.get("time_str", "Sabtu, 15 Agustus 2026 09:30:15 WIB"),
            request.forms.get("lat", "-7.391520"),
            request.forms.get("lon", "110.312050"),
            request.forms.get("dusun", "Dusun Bedoyo"),
            request.forms.get("desa", "Baleagung"),
            request.forms.get("kecamatan", "Grabag"),
            request.forms.get("kabupaten", "Kabupaten Magelang"),
            request.forms.get("provinsi", "Jawa Tengah"),
            font_scale=font_scale_val,
            custom_address=request.forms.get("custom_address")
        )

        response.content_type = "image/jpeg"
        return result_bytes
    except Exception as e:
        log_error("stamp_single", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})


# =========================================================
# SYSTEM & CLIENT ERROR LOGGING APIS
# =========================================================
@app.route("/api/logs/errors", method="GET")
def api_get_error_logs():
    try:
        logs = get_recent_logs(lines=100)
        response.content_type = "application/json"
        log_path = "cloud-log" if _is_cloud_environment() else ERROR_LOG_PATH
        return json.dumps({"success": True, "logs": logs, "path": log_path})
    except Exception as e:
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/logs/errors", method="DELETE")
def api_clear_error_logs():
    try:
        if _is_cloud_environment():
            response.status = 403
            response.content_type = "application/json"
            return json.dumps({"success": False, "error": "Penghapusan log dinonaktifkan pada mode publik."})
        clear_logs()
        response.content_type = "application/json"
        return json.dumps({"success": True})
    except Exception as e:
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/logs/client_error", method="POST")
def api_log_client_error():
    try:
        req = request.json or {}
        msg = req.get("message", "Unknown frontend error")
        details = req.get("details", "")
        stack = req.get("stack", "")
        log_error(f"FRONTEND: {msg}", f"{details}\nStack: {stack}")
        response.content_type = "application/json"
        return json.dumps({"success": True})
    except Exception as e:
        response.status = 500
        return json.dumps({"success": False, "error": str(e)})


# =========================================================
# SYSTEM VERSION & GITHUB UPDATE APIS
# =========================================================
@app.route("/api/system/version", method="GET")
def api_system_version():
    try:
        data = get_version_info()
        response.content_type = "application/json"
        return json.dumps(data)
    except Exception as e:
        log_error("api_system_version", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})


@app.route("/api/system/check_update", method=["GET", "POST"])
def api_system_check_update():
    try:
        data = check_for_updates()
        response.content_type = "application/json"
        return json.dumps(data)
    except Exception as e:
        log_error("api_system_check_update", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})


@app.route("/api/system/apply_update", method="POST")
def api_system_apply_update():
    try:
        data = apply_update()
        response.content_type = "application/json"
        return json.dumps(data)
    except Exception as e:
        log_error("api_system_apply_update", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})


# =========================================================
# REPORT BUILDER REST APIS (MONEV WORD GENERATOR)
# =========================================================
@app.route("/api/locations", method="GET")
def api_get_locations():
    """Returns master location list from data_lokasi.csv."""
    try:
        from app.backend.docx_service import KNOWN_LOCATIONS
        response.content_type = "application/json"
        return json.dumps({"success": True, "locations": KNOWN_LOCATIONS})
    except Exception as e:
        log_error("api_get_locations", e)
        response.status = 500
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/personel", method="GET")
def api_get_personel():
    """Returns master personnel list synced with GitHub data-store and local cache."""
    try:
        force_refresh = request.query.get("refresh", "").strip() in ("1", "true", "yes")
        names, storage_meta = load_personel_list(force_refresh=force_refresh)
        response.content_type = "application/json"
        return json.dumps({
            "success": True,
            "personel": names,
            "storage": storage_meta
        })
    except Exception as e:
        log_error("api_get_personel", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/personel/check_kbbi", method="POST")
def api_check_personel_kbbi():
    """Validates and formats a personnel name with hybrid KBBI/EYD V + conditional Gemini AI check."""
    try:
        req = request.json or {}
        raw_name = (req.get("name") or "").strip()
        err = validate_personel_input(raw_name)
        if err:
            response.status = 400
            response.content_type = "application/json"
            return json.dumps({"success": False, "error": err})
        use_ai = req.get("use_ai", True)
        result = refine_personel_name_kbbi(raw_name, use_ai=bool(use_ai))
        response.content_type = "application/json"
        return json.dumps({"success": True, **result})
    except Exception as e:
        log_error("api_check_personel_kbbi", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/personel", method="POST")
def api_add_personel():
    """Validates name via hybrid KBBI/EYD V and permanently saves locally + GitHub data-store."""
    try:
        req = request.json or {}
        raw_name = (req.get("name") or "").strip()
        force = bool(req.get("force", False))
        use_ai = bool(req.get("use_ai", True))
        status_code, payload = add_personel_entry(raw_name, force=force, use_ai=use_ai)
        response.status = status_code
        response.content_type = "application/json"
        return json.dumps(payload)
    except Exception as e:
        log_error("api_add_personel", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/personel", method="PUT")
def api_edit_personel():
    """Updates an existing personnel name via hybrid KBBI/EYD V and syncs locally + GitHub data-store."""
    try:
        req = request.json or {}
        old_name = (req.get("old_name") or "").strip()
        new_name = (req.get("new_name") or "").strip()
        force = bool(req.get("force", False))
        use_ai = bool(req.get("use_ai", True))
        pin = (req.get("pin") or "").strip()
        status_code, payload = edit_personel_entry(
            old_name, new_name, force=force, use_ai=use_ai, pin=pin
        )
        response.status = status_code
        response.content_type = "application/json"
        return json.dumps(payload)
    except Exception as e:
        log_error("api_edit_personel", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/personel", method="DELETE")
def api_delete_personel():
    """Removes a personnel name permanently from local cache & GitHub data-store."""
    try:
        req = request.json or {}
        target_name = (req.get("name") or "").strip()
        pin = (req.get("pin") or "").strip()
        status_code, payload = delete_personel_entry(target_name, pin=pin)
        response.status = status_code
        response.content_type = "application/json"
        return json.dumps(payload)
    except Exception as e:
        log_error("api_delete_personel", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/report/draft_narrative", method="POST")
def api_report_draft_narrative():
    """Drafts official Monev report narrative via Gemini 3.8 Flash."""
    try:
        req = request.json or {}
        notes = req.get("notes", "")
        desa = req.get("desa", "")
        kecamatan = req.get("kecamatan", "")
        kabupaten = req.get("kabupaten", "")
        tanggal = req.get("tanggal", "")
        tahun = req.get("tahun", "2026")
        extra_data = req.get("extra_data", {})
        api_key = req.get("api_key")

        res = draft_village_narrative(
            notes=notes,
            desa=desa,
            kecamatan=kecamatan,
            kabupaten=kabupaten,
            tanggal=tanggal,
            tahun=tahun,
            extra_data=extra_data,
            api_key=api_key
        )
        if not res.get("success") or res.get("fallback"):
            response.status = 503
            response.content_type = "application/json"
            return json.dumps({
                "success": False,
                "offline": True,
                "error": res.get("error") or "Koneksi internet tidak terhubung atau layanan AI sedang tidak dapat dijangkau."
            })
        response.content_type = "application/json"
        return json.dumps(res)
    except Exception as e:
        log_error("api_report_draft_narrative", e)
        response.status = 500
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/report/generate_docx", method="POST")
def api_report_generate_docx():
    """Builds and packages complete Word (.docx) Monev report with 2-col photo table."""
    try:
        req = request.json or {}
        report_data = req.get("report_data", {})
        photos_req = req.get("photos", [])

        # Auto-draft official narrative for each village if notes exist but narrative is not yet composed
        kab = report_data.get("kabupaten", "")
        thn = report_data.get("tahun", "2026")
        for v in report_data.get("villages", []):
            notes = (v.get("notes") or "").strip()
            narrative = (v.get("narrative") or "").strip()
            v_kondisi_date = get_village_kondisi_per_date(v, report_data)
            if notes and (not narrative or narrative == notes or len(narrative) < 60):
                v_kab = (v.get("kabupaten") or kab).strip()
                res_draft = draft_village_narrative(
                    notes=notes,
                    desa=v.get("desa", ""),
                    kecamatan=v.get("kecamatan", ""),
                    kabupaten=v_kab,
                    tanggal=v_kondisi_date,
                    tahun=thn
                )
                if res_draft.get("success") and res_draft.get("narrative"):
                    v["narrative"] = res_draft["narrative"]
                else:
                    err_msg = res_draft.get("error") or "Koneksi internet tidak terhubung atau layanan AI sedang tidak dapat dijangkau. Pembuatan laporan dihentikan."
                    response.status = 503
                    response.content_type = "application/json"
                    return json.dumps({
                        "success": False,
                        "offline": True,
                        "error": err_msg
                    })

            if v.get("narrative"):
                v["narrative"] = sanitize_pamsimas_text(v["narrative"])
                # Pastikan tanggal 'kondisi per' pada kalimat pengantar narasi sesuai tanggal monev desa
                v["narrative"] = re.sub(
                    r'(kondisi\s+per\s+)[A-Za-z0-9\s–\-]+?(\s+(?:adalah\s+sebagai\s+berikut|menunjukkan|sebagai\s+berikut|merupakan|yakni)|[.:])',
                    rf'\g<1>{v_kondisi_date}\g<2>',
                    v["narrative"],
                    flags=re.I
                )

        processed_photos = []
        for p in photos_req:
            p_data = dict(p)
            url = p.get("dataUrl") or p.get("url") or ""
            target_bytes = None
            if "/temp_media/" in url:
                clean_rel = url.split("/temp_media/", 1)[1].split("?")[0].lstrip("/\\")
                exact_path = os.path.abspath(os.path.join(DOCX_MEDIA_DIR, os.path.normpath(clean_rel)))
                media_root = os.path.abspath(DOCX_MEDIA_DIR)
                try:
                    is_within_media = os.path.commonpath([media_root, exact_path]) == media_root
                except Exception:
                    is_within_media = False

                if is_within_media and os.path.isfile(exact_path):
                    with open(exact_path, "rb") as f:
                        target_bytes = f.read()
                else:
                    fname = os.path.basename(clean_rel)
                    for root, _, fs in os.walk(DOCX_MEDIA_DIR):
                        if fname in fs:
                            cand_p = os.path.join(root, fname)
                            try:
                                with open(cand_p, "rb") as f:
                                    target_bytes = f.read()
                                break
                            except Exception:
                                pass
            elif url.startswith("data:"):
                try:
                    b64_part = url.split(",", 1)[1] if "," in url else url
                    target_bytes = base64.b64decode(b64_part)
                except Exception:
                    pass
            elif p.get("bytes"):
                b_val = p.get("bytes")
                target_bytes = bytes(b_val) if isinstance(b_val, list) else b_val

            if target_bytes:
                p_data["bytes"] = target_bytes
                processed_photos.append(p_data)
            elif p.get("path"):
                cand_path = os.path.abspath(p["path"])
                allowed_roots = [os.path.abspath(DOCX_MEDIA_DIR), os.path.abspath(DOCX_UPLOADS_DIR)]
                is_safe = False
                for ar in allowed_roots:
                    try:
                        if os.path.commonpath([ar, cand_path]) == ar:
                            is_safe = True
                            break
                    except Exception:
                        pass
                if is_safe and os.path.isfile(cand_path):
                    try:
                        with open(cand_path, "rb") as f:
                            p_data["bytes"] = f.read()
                        processed_photos.append(p_data)
                    except Exception:
                        pass

        output_file = generate_monev_docx(report_data, processed_photos)
        fn = os.path.basename(output_file)

        response.content_type = "application/json"
        return json.dumps({
            "success": True,
            "filename": fn,
            "download_url": f"/api/report/download/{fn}",
            "villages": report_data.get("villages", [])
        })
    except Exception as e:
        log_error("api_report_generate_docx", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})

@app.route("/api/report/download/<filename:path>", method="GET")
def api_report_download(filename):
    """Serves generated Monev report docx for download."""
    safe_name = os.path.basename(filename or "")
    if not safe_name or safe_name != filename or not safe_name.lower().endswith(".docx"):
        response.status = 400
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": "Nama berkas unduhan tidak valid."})
    output_root = os.path.abspath(OUTPUT_DIR)
    target_path = os.path.abspath(os.path.join(output_root, safe_name))
    try:
        is_inside = os.path.commonpath([output_root, target_path]) == output_root
    except Exception:
        is_inside = False
    if not is_inside or not os.path.isfile(target_path):
        response.status = 404
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": "Berkas laporan tidak ditemukan."})
    return static_file(safe_name, root=OUTPUT_DIR, download=safe_name)

@app.route("/api/report/import_existing_docx", method="POST")
def api_report_import_existing_docx():
    """Uploads an existing or in-progress Monev Word (.docx) document,
    inspects present and missing sections, extracts administrative data,
    personnel, villages, field notes/narratives, and embedded photos,
    and returns a structured data payload with an audit readiness report.
    Supports single docx or merging multiple (up to 3) docx files.
    """
    try:
        uploads = []
        if hasattr(request.files, "getall"):
            uploads = request.files.getall("files") or request.files.getall("file")
        if not uploads:
            single = request.files.get("files") or request.files.get("file") or request.files.get("doc_file")
            if single:
                uploads = [single]

        if not uploads:
            response.status = 400
            response.content_type = "application/json"
            return json.dumps({"success": False, "error": "Harap pilih berkas Word (.docx) yang valid"})

        if len(uploads) > 3:
            response.status = 400
            response.content_type = "application/json"
            return json.dumps({"success": False, "error": "Maksimal 3 dokumen yang dapat digabungkan sekaligus"})

        os.makedirs(DOCX_UPLOADS_DIR, exist_ok=True)
        uploads_root = os.path.abspath(DOCX_UPLOADS_DIR)

        inspected_reports = []
        for upload in uploads:
            raw_filename = os.path.basename(getattr(upload, "filename", "") or "")
            if not upload or not raw_filename.lower().endswith(".docx"):
                response.status = 400
                response.content_type = "application/json"
                return json.dumps({"success": False, "error": f"Berkas '{raw_filename or 'unknown'}' bukan berkas Word (.docx) yang valid"})

            safe_filename = re.sub(r"[^A-Za-z0-9._\-\s()]", "_", raw_filename).strip() or "dokumen.docx"
            save_path = os.path.abspath(os.path.join(uploads_root, f"inspect_{uuid.uuid4().hex[:8]}_{safe_filename}"))
            if os.path.commonpath([uploads_root, save_path]) != uploads_root:
                response.status = 400
                response.content_type = "application/json"
                return json.dumps({"success": False, "error": "Nama berkas tidak valid."})
            upload.save(save_path)

            res = inspect_and_import_monev_docx(save_path)
            if not res.get("success"):
                response.status = 400
                response.content_type = "application/json"
                return json.dumps({"success": False, "error": f"Gagal membaca '{safe_filename}': {res.get('error')}"})
            res["filename"] = safe_filename
            inspected_reports.append(res)

        if len(inspected_reports) == 1:
            final_res = inspected_reports[0]
        else:
            final_res = merge_inspected_monev_reports(inspected_reports)
            if not final_res.get("success"):
                response.status = 400
                response.content_type = "application/json"
                return json.dumps(final_res)

        response.content_type = "application/json"
        return json.dumps(final_res)
    except Exception as e:
        log_error("api_report_import_existing_docx", e)
        response.status = 500
        response.content_type = "application/json"
        return json.dumps({"success": False, "error": str(e)})


from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer

class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    try:
        cleanup_uploads()
        cleanup_temp_media()
        cleanup_backups()
    except Exception:
        pass
    print(f"Pamsimas Studio (Laporan Word Monev) running on http://{SERVER_HOST}:{SERVER_PORT} ...")
    import time
    while True:
        try:
            run(app, host=SERVER_HOST, port=SERVER_PORT, debug=False, server_class=ThreadingWSGIServer)
        except KeyboardInterrupt:
            print("Server dihentikan.")
            break
        except Exception as e:
            print(f"[Server Resilience] WSGI exception caught ({e}). Merestart socket...")
            time.sleep(1.0)
