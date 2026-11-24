import base64
import json
import os
import re
import subprocess
import threading
import time
from difflib import SequenceMatcher
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

import requests

from app.backend.config import BASE_DIR, reload_env_vars
from app.backend.logger import log_error
from app.backend.report_generator import (
    DEFAULT_API_KEY,
    DEFAULT_FALLBACK_API_KEY,
    KNOWN_BACK_TITLES_SET,
    KNOWN_FRONT_TITLES,
    _BUILTIN_FALLBACK_KEY,
    normalize_personel_title,
)
from app.backend.updater import _is_cloud_environment, _is_git_repository

LOCAL_PERSONEL_FILE = os.path.join(BASE_DIR, "data", "Nama Personel.txt")
GITHUB_OWNER = os.environ.get("PERSONEL_GITHUB_OWNER", "ryannovella").strip()
GITHUB_REPO = os.environ.get("PERSONEL_GITHUB_REPO", "Pamsimas-Studio").strip()
GITHUB_BRANCH = os.environ.get("PERSONEL_GITHUB_BRANCH", "data-store").strip()
GITHUB_FILE_PATH = "data/Nama Personel.txt"

_PERSONEL_LOCK = threading.Lock()
_CACHE: Dict[str, Any] = {
    "names": None,
    "sha": None,
    "fetched_at": 0.0,
    "source": "local",
    "last_error": "",
}
_CACHE_TTL_SECONDS = 20.0


def _get_github_token() -> str:
    reload_env_vars()
    return (
        os.environ.get("GITHUB_TOKEN_STUDIO_LAPORAN")
        or os.environ.get("GITHUB_TOKEN")
        or os.environ.get("GH_TOKEN")
        or os.environ.get("PERSONEL_GITHUB_TOKEN")
        or ""
    ).strip()


def _get_admin_pin() -> str:
    reload_env_vars()
    return (os.environ.get("PERSONEL_ADMIN_PIN") or "").strip()


def get_personel_storage_meta() -> Dict[str, Any]:
    """Returns non-sensitive storage and access-control metadata for UI."""
    is_cloud = _is_cloud_environment()
    has_token = bool(_get_github_token())
    local_git_sync = (not is_cloud) and _is_git_repository()
    admin_pin = _get_admin_pin()
    sync_mode = "api" if has_token else ("git" if local_git_sync else "readonly")
    return {
        "is_cloud": is_cloud,
        "remote_sync_enabled": bool(has_token or local_git_sync),
        "sync_mode": sync_mode,
        "github_branch": GITHUB_BRANCH,
        "source": _CACHE.get("source", "local"),
        "delete_requires_pin": bool(admin_pin),
        "delete_disabled": False,
    }


def _parse_personel_text(text: str) -> List[str]:
    names: List[str] = []
    seen_lower = set()
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        cleaned = re.sub(r"^\d+[\.\)]\s*", "", line).strip()
        cleaned = normalize_personel_title(cleaned)
        if cleaned and cleaned.lower() not in seen_lower:
            names.append(cleaned)
            seen_lower.add(cleaned.lower())
    return names


def _format_personel_text(names: List[str]) -> str:
    return "".join(f"{idx}. {n}\n" for idx, n in enumerate(names, 1))


def _write_local_personel_file(names: List[str]) -> None:
    os.makedirs(os.path.dirname(LOCAL_PERSONEL_FILE), exist_ok=True)
    tmp_file = LOCAL_PERSONEL_FILE + ".tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        f.write(_format_personel_text(names))
    if os.path.exists(LOCAL_PERSONEL_FILE):
        os.replace(tmp_file, LOCAL_PERSONEL_FILE)
    else:
        os.rename(tmp_file, LOCAL_PERSONEL_FILE)


def _read_local_personel_file() -> List[str]:
    if not os.path.exists(LOCAL_PERSONEL_FILE):
        return []
    with open(LOCAL_PERSONEL_FILE, "r", encoding="utf-8") as f:
        return _parse_personel_text(f.read())


def _github_contents_url() -> str:
    encoded_path = quote(GITHUB_FILE_PATH, safe="/")
    return f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/contents/{encoded_path}"


def _github_headers(token: str = "") -> Dict[str, str]:
    headers = {
        "User-Agent": "Pamsimas-Studio-PersonelSync",
        "Accept": "application/vnd.github.v3+json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _fetch_from_github_data_store() -> Tuple[Optional[List[str]], Optional[str], str]:
    """Fetches personnel list & blob SHA from GitHub data-store branch."""
    token = _get_github_token()
    url = f"{_github_contents_url()}?ref={quote(GITHUB_BRANCH)}"
    try:
        resp = requests.get(url, headers=_github_headers(token), timeout=8)
        if resp.status_code == 200:
            data = resp.json()
            raw_b64 = (data.get("content") or "").replace("\n", "")
            if not raw_b64:
                return None, data.get("sha"), "Konten GitHub kosong"
            decoded = base64.b64decode(raw_b64).decode("utf-8", errors="replace")
            return _parse_personel_text(decoded), data.get("sha"), ""
        return None, None, f"HTTP {resp.status_code}: {resp.text[:120]}"
    except Exception as e:
        return None, None, str(e)


def _commit_to_github_data_store(
    names: List[str],
    sha: Optional[str],
    commit_message: str,
) -> Tuple[bool, Optional[str], str]:
    """Commits updated Nama Personel.txt to GitHub data-store branch."""
    token = _get_github_token()
    if not token:
        return False, None, "GITHUB_TOKEN belum dikonfigurasi"

    content_bytes = _format_personel_text(names).encode("utf-8")
    payload: Dict[str, Any] = {
        "message": commit_message,
        "content": base64.b64encode(content_bytes).decode("ascii"),
        "branch": GITHUB_BRANCH,
    }
    if sha:
        payload["sha"] = sha

    try:
        resp = requests.put(
            _github_contents_url(),
            headers=_github_headers(token),
            json=payload,
            timeout=10,
        )
        if resp.status_code in (200, 201):
            new_sha = (resp.json().get("content") or {}).get("sha")
            return True, new_sha, ""
        return False, None, f"HTTP {resp.status_code}: {resp.text[:160]}"
    except Exception as e:
        return False, None, str(e)


def _run_git_bytes(args: List[str], stdin_bytes: Optional[bytes] = None, timeout: int = 12) -> Tuple[bytes, bytes, int]:
    """Runs git command inside BASE_DIR without touching the working tree."""
    res = subprocess.run(
        ["git"] + args,
        cwd=BASE_DIR,
        input=stdin_bytes,
        capture_output=True,
        timeout=timeout,
    )
    return res.stdout, res.stderr, res.returncode


def _fetch_from_local_git_data_store() -> Tuple[Optional[List[str]], Optional[str], str]:
    """Fallback read from origin/data-store via local git when GitHub API is unavailable."""
    if _is_cloud_environment() or not _is_git_repository():
        return None, None, "Git lokal tidak tersedia"
    try:
        _, err_f, rc_f = _run_git_bytes(["fetch", "origin", GITHUB_BRANCH], timeout=12)
        if rc_f != 0:
            return None, None, err_f.decode("utf-8", errors="replace").strip()
        out_s, err_s, rc_s = _run_git_bytes(
            ["show", f"origin/{GITHUB_BRANCH}:{GITHUB_FILE_PATH}"],
            timeout=8,
        )
        if rc_s != 0:
            return None, None, err_s.decode("utf-8", errors="replace").strip()
        decoded = out_s.decode("utf-8", errors="replace")
        return _parse_personel_text(decoded), None, ""
    except Exception as e:
        return None, None, str(e)


def _commit_via_local_git_data_store(names: List[str], commit_message: str) -> Tuple[bool, str]:
    """Pushes updated Nama Personel.txt to origin/data-store via git plumbing without altering HEAD."""
    if _is_cloud_environment() or not _is_git_repository():
        return False, "Git lokal tidak tersedia"
    try:
        _run_git_bytes(["fetch", "origin", GITHUB_BRANCH], timeout=12)
        parent_out, _, parent_rc = _run_git_bytes(
            ["rev-parse", f"origin/{GITHUB_BRANCH}"],
            timeout=5,
        )
        parent_sha = parent_out.decode("utf-8").strip() if parent_rc == 0 else ""

        content_bytes = _format_personel_text(names).encode("utf-8")
        blob_out, blob_err, blob_rc = _run_git_bytes(
            ["hash-object", "-w", "--stdin"],
            stdin_bytes=content_bytes,
            timeout=5,
        )
        if blob_rc != 0:
            return False, blob_err.decode("utf-8", errors="replace").strip()
        blob_sha = blob_out.decode("utf-8").strip()

        data_tree_out, dt_err, dt_rc = _run_git_bytes(
            ["mktree"],
            stdin_bytes=f"100644 blob {blob_sha}\tNama Personel.txt\n".encode("utf-8"),
            timeout=5,
        )
        if dt_rc != 0:
            return False, dt_err.decode("utf-8", errors="replace").strip()
        data_tree_sha = data_tree_out.decode("utf-8").strip()

        root_tree_out, rt_err, rt_rc = _run_git_bytes(
            ["mktree"],
            stdin_bytes=f"040000 tree {data_tree_sha}\tdata\n".encode("utf-8"),
            timeout=5,
        )
        if rt_rc != 0:
            return False, rt_err.decode("utf-8", errors="replace").strip()
        root_tree_sha = root_tree_out.decode("utf-8").strip()

        ct_args = ["commit-tree", root_tree_sha]
        if parent_sha:
            ct_args.extend(["-p", parent_sha])
        ct_args.extend(["-m", commit_message])
        commit_out, ct_err, ct_rc = _run_git_bytes(ct_args, timeout=5)
        if ct_rc != 0:
            return False, ct_err.decode("utf-8", errors="replace").strip()
        commit_sha = commit_out.decode("utf-8").strip()

        _, push_err, push_rc = _run_git_bytes(
            ["push", "origin", f"{commit_sha}:refs/heads/{GITHUB_BRANCH}"],
            timeout=15,
        )
        if push_rc != 0:
            return False, push_err.decode("utf-8", errors="replace").strip()

        _run_git_bytes(["update-ref", f"refs/heads/{GITHUB_BRANCH}", commit_sha], timeout=5)
        return True, ""
    except Exception as e:
        return False, str(e)


def load_personel_list(force_refresh: bool = False) -> Tuple[List[str], Dict[str, Any]]:
    """Loads master personnel list, syncing with GitHub data-store branch when available."""
    with _PERSONEL_LOCK:
        now = time.time()
        if (
            not force_refresh
            and _CACHE["names"] is not None
            and (now - _CACHE["fetched_at"]) < _CACHE_TTL_SECONDS
        ):
            return list(_CACHE["names"]), get_personel_storage_meta()

        remote_names, remote_sha, err = _fetch_from_github_data_store()
        if remote_names is None and (not _is_cloud_environment()) and _is_git_repository():
            remote_names, remote_sha, err = _fetch_from_local_git_data_store()

        if remote_names is not None:
            _CACHE["names"] = remote_names
            _CACHE["sha"] = remote_sha
            _CACHE["fetched_at"] = now
            _CACHE["source"] = "github_data_store"
            _CACHE["last_error"] = ""
            try:
                _write_local_personel_file(remote_names)
            except Exception as write_exc:
                log_error("personel_sync_write_local", write_exc)
            return list(remote_names), get_personel_storage_meta()

        local_names = _read_local_personel_file()
        _CACHE["names"] = local_names
        _CACHE["sha"] = None
        _CACHE["fetched_at"] = now
        _CACHE["source"] = "local"
        _CACHE["last_error"] = err
        return list(local_names), get_personel_storage_meta()


def _needs_kbbi_ai_check(raw_name: str, normalized_name: str) -> bool:
    """Detects whether the input has unrecognized titles or suspicious spelling worth AI verification."""
    parts = [p.strip() for p in normalized_name.split(",")]
    name_part = parts[0] if parts else ""
    title_parts = parts[1:] if len(parts) > 1 else []

    for tp in title_parts:
        if tp and tp not in KNOWN_BACK_TITLES_SET:
            return True

    tokens = [t for t in name_part.split() if t]
    for idx, tok in enumerate(tokens):
        if tok in KNOWN_FRONT_TITLES:
            continue
        if re.match(r"^[A-Za-z](?:\.[A-Za-z])*\.?$", tok) and "." in tok:
            continue
        # Suspicious abbreviation-like token without dots or title rule match (e.g. 'Skom', 'Msi', 'Amd', 'Drs')
        if idx > 0 and len(tok) <= 4 and re.search(r"[bcdfghjklmnpqrstvwxyz]{3,}", tok.lower()):
            return True
        if "." in tok:
            return True

    # Also trigger if user typed multiple commas or trailing dot on raw input not matched as known title
    if raw_name.strip().endswith(".") and len(title_parts) == 0:
        return True

    return False


def _call_gemini_kbbi_check(raw_name: str, local_normalized: str) -> Optional[Dict[str, Any]]:
    """Uses Gemini Flash Lite for conditional KBBI/EYD V spelling and academic title check."""
    reload_env_vars()
    keys_to_try: List[str] = []
    for k in (
        os.environ.get("GEMINI_API_KEY") or DEFAULT_API_KEY,
        os.environ.get("GEMINI_API_KEY_FALLBACK") or DEFAULT_FALLBACK_API_KEY,
        _BUILTIN_FALLBACK_KEY,
    ):
        k_clean = (k or "").strip()
        if k_clean and k_clean not in keys_to_try:
            keys_to_try.append(k_clean)

    if not keys_to_try:
        return None

    prompt = (
        "Rapikan penulisan nama personel dan gelar akademik/profesi Indonesia berikut sesuai EYD Edisi V & KBBI.\n"
        f"Input asli: {raw_name}\n"
        f"Hasil normalisasi awal: {local_normalized}\n\n"
        "ATURAN KETAT:\n"
        "1. Jangan mengubah ejaan nama diri/marga orang kecuali kapitalisasi huruf awal, spasi, dan partikel (bin/binti lowercase).\n"
        "2. Perbaiki tanda baca koma, spasi, dan titik pada gelar depan (Prof., Dr., dr., Ir., H., Hj., Drs., Dra.) maupun gelar belakang (contoh: S.T., M.T., S.Kom., M.Ak., S.Ag., Ph.D., Apt., Ns.).\n"
        "3. Jangan mengarang atau menambahkan gelar baru yang tidak ada pada input.\n"
        "4. Jawab HANYA dalam format JSON valid: "
        '{"formatted": "Nama Lengkap, Gelar.", "corrected": true/false, "note": "alasan singkat bahasa Indonesia"}'
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 160,
            "responseMimeType": "application/json",
        },
    }

    models = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gemini-flash-lite-latest"]
    for key in keys_to_try:
        for model in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            try:
                resp = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=8)
                if resp.status_code != 200:
                    if resp.status_code in (400, 401, 402, 403, 429):
                        break
                    continue
                candidates = resp.json().get("candidates", [])
                if not candidates:
                    continue
                parts = candidates[0].get("content", {}).get("parts", [])
                raw_text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
                match = re.search(r"\{.*\}", raw_text, re.DOTALL)
                if not match:
                    continue
                parsed = json.loads(match.group(0))
                formatted = (parsed.get("formatted") or "").strip()
                if not formatted:
                    continue
                # Ensure AI did not hallucinate an unrelated name
                ratio = SequenceMatcher(
                    None,
                    re.sub(r"[^a-z]", "", local_normalized.split(",")[0].lower()),
                    re.sub(r"[^a-z]", "", formatted.split(",")[0].lower()),
                ).ratio()
                if ratio < 0.75:
                    continue
                final_formatted = normalize_personel_title(formatted)
                return {
                    "formatted": final_formatted or local_normalized,
                    "corrected": bool(parsed.get("corrected")) or (final_formatted != local_normalized),
                    "note": (parsed.get("note") or "").strip(),
                }
            except Exception:
                continue
    return None


def refine_personel_name_kbbi(raw_name: str, use_ai: bool = True) -> Dict[str, Any]:
    """Runs hybrid KBBI/EYD V normalization: instant local rules + conditional Gemini verification."""
    local_normalized = normalize_personel_title(raw_name)
    ai_checked = False
    ai_refined = False
    note = ""
    final_name = local_normalized

    if use_ai and local_normalized and _needs_kbbi_ai_check(raw_name, local_normalized):
        ai_checked = True
        ai_res = _call_gemini_kbbi_check(raw_name, local_normalized)
        if ai_res and ai_res.get("formatted"):
            final_name = ai_res["formatted"]
            ai_refined = final_name != local_normalized
            note = ai_res.get("note") or ""

    return {
        "name": final_name,
        "local_normalized": local_normalized,
        "ai_checked": ai_checked,
        "ai_refined": ai_refined,
        "note": note,
    }


def _extract_core_name(full_name: str) -> str:
    """Extracts person's core name without front/back academic titles for duplicate checking."""
    base = (full_name or "").split(",")[0].strip()
    tokens = [t for t in base.split() if t and t not in KNOWN_FRONT_TITLES]
    cleaned = " ".join(tokens)
    return re.sub(r"[^a-z\s]", "", cleaned.lower()).strip()


def find_fuzzy_duplicate(candidate_name: str, existing_names: List[str]) -> Optional[Dict[str, str]]:
    """Checks for high-similarity duplicate personnel entries (same core name or near-identical spelling)."""
    cand_core = _extract_core_name(candidate_name)
    if len(cand_core) < 4:
        return None

    for existing in existing_names:
        if existing.lower() == candidate_name.lower():
            continue
        ex_core = _extract_core_name(existing)
        if not ex_core:
            continue
        if cand_core == ex_core:
            return {
                "existing": existing,
                "reason": f"Nama inti sama dengan '{existing}'",
            }
        ratio = SequenceMatcher(None, cand_core, ex_core).ratio()
        if ratio >= 0.90:
            return {
                "existing": existing,
                "reason": f"Ejaan sangat mirip dengan '{existing}'",
            }
    return None


def validate_personel_input(raw_name: str) -> Optional[str]:
    """Validates raw personnel name input; returns error string if invalid else None."""
    clean = (raw_name or "").strip()
    if not clean:
        return "Nama personel tidak boleh kosong."
    if len(clean) < 2:
        return "Nama personel terlalu pendek."
    if len(clean) > 120:
        return "Nama personel terlalu panjang (maksimal 120 karakter)."
    if not re.search(r"[a-zA-Z]", clean):
        return "Nama personel harus memuat huruf alfabet yang valid."
    if re.search(r"[<>{}\[\];]|https?://", clean, re.IGNORECASE):
        return "Nama personel mengandung karakter yang tidak diizinkan."
    return None


def add_personel_entry(raw_name: str, force: bool = False, use_ai: bool = True) -> Tuple[int, Dict[str, Any]]:
    """Normalizes, checks duplicates, saves locally, and syncs permanently to GitHub data-store."""
def _load_latest_names_locked() -> Tuple[List[str], Optional[str]]:
    """Loads latest personnel list from remote data-store, local git, or local disk (caller holds lock)."""
    remote_names, remote_sha, _ = _fetch_from_github_data_store()
    if remote_names is None and (not _is_cloud_environment()) and _is_git_repository():
        remote_names, remote_sha, _ = _fetch_from_local_git_data_store()
    if remote_names is not None:
        return remote_names, remote_sha
    return _read_local_personel_file(), None


def _persist_and_sync_names(
    mutate_fn: Callable[[List[str]], List[str]],
    initial_names: List[str],
    initial_sha: Optional[str],
    commit_message: str,
    log_context: str,
) -> Tuple[List[str], bool]:
    """Atomically writes local file and syncs to GitHub data-store (via API or local git)."""
    synced_remote = False
    sync_error = ""
    current_sha = initial_sha
    updated_names = mutate_fn(list(initial_names))
    has_token = bool(_get_github_token())

    if has_token:
        for _ in range(3):
            _write_local_personel_file(updated_names)
            ok, new_sha, gh_err = _commit_to_github_data_store(
                updated_names,
                current_sha,
                commit_message,
            )
            if ok:
                synced_remote = True
                current_sha = new_sha
                break
            sync_error = gh_err
            if "HTTP 409" in gh_err or "HTTP 422" in gh_err:
                latest_names, latest_sha, _ = _fetch_from_github_data_store()
                if latest_names is not None:
                    current_sha = latest_sha
                    updated_names = mutate_fn(list(latest_names))
                    continue
            break
    else:
        _write_local_personel_file(updated_names)
        if (not _is_cloud_environment()) and _is_git_repository():
            ok_git, git_err = _commit_via_local_git_data_store(updated_names, commit_message)
            if ok_git:
                synced_remote = True
            else:
                sync_error = git_err

    _CACHE["names"] = updated_names
    _CACHE["sha"] = current_sha
    _CACHE["fetched_at"] = time.time()
    _CACHE["source"] = "github_data_store" if synced_remote else "local"
    _CACHE["last_error"] = sync_error

    if not synced_remote and sync_error and (has_token or not _is_cloud_environment()):
        log_error(log_context, details=sync_error)

    return updated_names, synced_remote


def add_personel_entry(raw_name: str, force: bool = False, use_ai: bool = True) -> Tuple[int, Dict[str, Any]]:
    """Normalizes, checks duplicates, saves locally, and syncs permanently to GitHub data-store."""
    err_msg = validate_personel_input(raw_name)
    if err_msg:
        return 400, {"success": False, "error": err_msg}

    kbbi_info = refine_personel_name_kbbi(raw_name, use_ai=use_ai)
    final_name = kbbi_info["name"]
    if not final_name or len(final_name) < 2:
        return 400, {"success": False, "error": "Format nama tidak valid sesuai kaidah ejaan."}

    with _PERSONEL_LOCK:
        names, remote_sha = _load_latest_names_locked()

        norm_lower = final_name.lower()
        existing_match = next((n for n in names if n.lower() == norm_lower), None)
        if existing_match:
            _CACHE["names"] = names
            _CACHE["sha"] = remote_sha
            _CACHE["fetched_at"] = time.time()
            return 200, {
                "success": True,
                "name": existing_match,
                "is_new": False,
                "all_names": names,
                "kbbi": kbbi_info,
                "storage": get_personel_storage_meta(),
                "message": f"Personel '{existing_match}' sudah terdaftar di master data.",
            }

        if not force:
            dup = find_fuzzy_duplicate(final_name, names)
            if dup:
                return 409, {
                    "success": False,
                    "error": f"Terindikasi duplikat: {dup['reason']}.",
                    "duplicate_candidate": dup["existing"],
                    "normalized_name": final_name,
                    "kbbi": kbbi_info,
                }

        def _append_unique(cur: List[str]) -> List[str]:
            if any(n.lower() == norm_lower for n in cur):
                return cur
            return cur + [final_name]

        updated_names, synced_remote = _persist_and_sync_names(
            _append_unique,
            names,
            remote_sha,
            f"data(personel): add {final_name}",
            "personel_github_sync_add",
        )

        storage_meta = get_personel_storage_meta()
        sync_label = (
            " & tersinkron permanen ke GitHub"
            if synced_remote
            else (" (tersimpan lokal)" if not _is_cloud_environment() else " (tersimpan di sesi aktif)")
        )
        return 200, {
            "success": True,
            "name": final_name,
            "is_new": True,
            "synced_remote": synced_remote,
            "all_names": updated_names,
            "kbbi": kbbi_info,
            "storage": storage_meta,
            "message": f"Personel '{final_name}' dirapikan (KBBI/EYD V){sync_label}.",
        }


def edit_personel_entry(
    old_name: str,
    new_raw_name: str,
    force: bool = False,
    use_ai: bool = True,
    pin: str = "",
) -> Tuple[int, Dict[str, Any]]:
    """Updates an existing personnel name in-place with KBBI/EYD V normalization and GitHub sync."""
    clean_old = (old_name or "").strip()
    if not clean_old:
        return 400, {"success": False, "error": "Nama personel asal tidak boleh kosong."}

    err_msg = validate_personel_input(new_raw_name)
    if err_msg:
        return 400, {"success": False, "error": err_msg}

    admin_pin = _get_admin_pin()
    if admin_pin and (pin or "").strip() != admin_pin:
        return 403, {"success": False, "error": "PIN Admin tidak valid untuk mengubah master data."}

    kbbi_info = refine_personel_name_kbbi(new_raw_name, use_ai=use_ai)
    final_name = kbbi_info["name"]
    if not final_name or len(final_name) < 2:
        return 400, {"success": False, "error": "Format nama baru tidak valid sesuai kaidah ejaan."}

    with _PERSONEL_LOCK:
        names, remote_sha = _load_latest_names_locked()
        old_lower = clean_old.lower()
        old_idx = next((i for i, n in enumerate(names) if n.lower() == old_lower), None)
        if old_idx is None:
            return 404, {"success": False, "error": f"Personel '{clean_old}' tidak ditemukan di master data."}

        actual_old = names[old_idx]
        if final_name == actual_old:
            return 200, {
                "success": True,
                "old_name": actual_old,
                "name": actual_old,
                "synced_remote": False,
                "all_names": names,
                "kbbi": kbbi_info,
                "storage": get_personel_storage_meta(),
                "message": f"Tidak ada perubahan pada '{actual_old}'.",
            }

        other_names = [n for i, n in enumerate(names) if i != old_idx]
        exact_other = next((n for n in other_names if n.lower() == final_name.lower()), None)
        if exact_other:
            return 409, {
                "success": False,
                "error": f"Personel '{exact_other}' sudah terdaftar pada baris lain.",
            }

        if not force:
            dup = find_fuzzy_duplicate(final_name, other_names)
            if dup:
                return 409, {
                    "success": False,
                    "error": f"Terindikasi duplikat dengan entri lain: {dup['reason']}.",
                    "duplicate_candidate": dup["existing"],
                    "normalized_name": final_name,
                    "kbbi": kbbi_info,
                }

        def _replace_entry(cur: List[str]) -> List[str]:
            res = list(cur)
            idx = next((i for i, n in enumerate(res) if n.lower() == old_lower), None)
            if idx is not None:
                res[idx] = final_name
            return res

        updated_names, synced_remote = _persist_and_sync_names(
            _replace_entry,
            names,
            remote_sha,
            f"data(personel): edit {actual_old} -> {final_name}",
            "personel_github_sync_edit",
        )

        return 200, {
            "success": True,
            "old_name": actual_old,
            "name": final_name,
            "synced_remote": synced_remote,
            "all_names": updated_names,
            "kbbi": kbbi_info,
            "storage": get_personel_storage_meta(),
            "message": f"Personel diperbarui ke '{final_name}' (KBBI/EYD V){' & tersinkron permanen ke GitHub' if synced_remote else ''}.",
        }


def delete_personel_entry(target_name: str, pin: str = "") -> Tuple[int, Dict[str, Any]]:
    """Deletes a personnel name permanently (requires PIN only when PERSONEL_ADMIN_PIN is configured)."""
    clean_target = (target_name or "").strip()
    if not clean_target:
        return 400, {"success": False, "error": "Nama personel target tidak boleh kosong."}

    admin_pin = _get_admin_pin()
    if admin_pin and (pin or "").strip() != admin_pin:
        return 403, {
            "success": False,
            "error": "PIN Admin tidak valid untuk menghapus master data permanen.",
        }

    with _PERSONEL_LOCK:
        names, remote_sha = _load_latest_names_locked()
        target_lower = clean_target.lower()
        if not any(n.lower() == target_lower for n in names):
            return 404, {"success": False, "error": f"Personel '{clean_target}' tidak ditemukan di master data."}

        updated_names, synced_remote = _persist_and_sync_names(
            lambda cur: [n for n in cur if n.lower() != target_lower],
            names,
            remote_sha,
            f"data(personel): remove {clean_target}",
            "personel_github_sync_delete",
        )

        return 200, {
            "success": True,
            "name": clean_target,
            "synced_remote": synced_remote,
            "all_names": updated_names,
            "storage": get_personel_storage_meta(),
            "message": f"Personel '{clean_target}' berhasil dihapus dari master data{' & GitHub' if synced_remote else ''}.",
        }
