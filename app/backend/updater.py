import os
import subprocess
from app.backend.config import BASE_DIR
from app.backend.logger import log_error

APP_BASE_VERSION = "4.1"


def _run_git(args: list[str], timeout: int = 15) -> tuple[str, str, int]:
    """Helper to run git commands inside the project root."""
    try:
        res = subprocess.run(
            ["git"] + args,
            cwd=BASE_DIR,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return res.stdout.strip(), res.stderr.strip(), res.returncode
    except subprocess.TimeoutExpired:
        return "", "Operasi git melebihi batas waktu (timeout).", 124
    except FileNotFoundError:
        return "", "Git executable tidak ditemukan di sistem.", 127
    except Exception as e:
        return "", str(e), 1


def get_version_info() -> dict:
    """Returns real-time version info from local git repository."""
    short_hash, _, rc_hash = _run_git(["rev-parse", "--short", "HEAD"], timeout=5)
    full_hash, _, _ = _run_git(["rev-parse", "HEAD"], timeout=5)
    commit_date, _, _ = _run_git(["log", "-1", "--format=%cd", "--date=short"], timeout=5)
    commit_msg, _, _ = _run_git(["log", "-1", "--format=%s"], timeout=5)
    branch, _, _ = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], timeout=5)
    commit_count, _, _ = _run_git(["rev-list", "--count", "HEAD"], timeout=5)
    status_out, _, _ = _run_git(["status", "--porcelain", "-uno"], timeout=5)

    if rc_hash != 0 or not short_hash:
        # Fallback if git metadata is missing or inaccessible
        return {
            "success": True,
            "version": APP_BASE_VERSION,
            "commit": "unknown",
            "commit_full": "",
            "commit_date": "-",
            "commit_message": "Build Standalone",
            "branch": "main",
            "commit_count": 0,
            "is_dirty": False,
            "display": f"v{APP_BASE_VERSION}",
            "full_display": f"v{APP_BASE_VERSION}"
        }

    is_dirty = bool(status_out.strip())
    cnt = int(commit_count) if commit_count.isdigit() else 0
    display_tag = f"v{APP_BASE_VERSION}.{cnt}"
    short_label = f"{display_tag} ({short_hash})"
    full_label = f"{display_tag} · {short_hash} ({commit_date})"

    return {
        "success": True,
        "version": APP_BASE_VERSION,
        "display_tag": display_tag,
        "commit": short_hash,
        "commit_full": full_hash,
        "commit_date": commit_date,
        "commit_message": commit_msg,
        "branch": branch or "main",
        "commit_count": cnt,
        "is_dirty": is_dirty,
        "display": short_label,
        "full_display": full_label
    }


def check_for_updates() -> dict:
    """Fetches origin/main and compares with local HEAD to check for updates."""
    # First get current version
    current = get_version_info()

    # Step 1: Fetch latest refs from remote
    fetch_out, fetch_err, fetch_rc = _run_git(["fetch", "origin", "main"], timeout=20)
    if fetch_rc != 0:
        err_msg = fetch_err or fetch_out or "Gagal menghubungi repositori GitHub."
        if "Could not resolve host" in err_msg or "Failed to connect" in err_msg:
            err_msg = "Tidak dapat terhubung ke GitHub. Periksa koneksi internet atau Simplewall."
        return {
            "success": False,
            "has_update": False,
            "error": err_msg,
            "current": current
        }

    # Step 2: Compare local HEAD with origin/main
    remote_hash_short, _, _ = _run_git(["rev-parse", "--short", "origin/main"], timeout=5)
    remote_hash_full, _, _ = _run_git(["rev-parse", "origin/main"], timeout=5)
    remote_date, _, _ = _run_git(["log", "-1", "--format=%cd", "--date=short", "origin/main"], timeout=5)
    remote_msg, _, _ = _run_git(["log", "-1", "--format=%s", "origin/main"], timeout=5)

    behind_out, _, _ = _run_git(["rev-list", "--count", "HEAD..origin/main"], timeout=5)
    ahead_out, _, _ = _run_git(["rev-list", "--count", "origin/main..HEAD"], timeout=5)

    behind_count = int(behind_out) if behind_out.isdigit() else 0
    ahead_count = int(ahead_out) if ahead_out.isdigit() else 0

    has_update = behind_count > 0

    changelog = []
    if has_update:
        log_out, _, _ = _run_git(
            ["log", "HEAD..origin/main", "--format=%h|%cd|%s", "--date=short", "-n", "20"],
            timeout=5
        )
        for line in log_out.splitlines():
            parts = line.strip().split("|", 2)
            if len(parts) == 3:
                changelog.append({
                    "commit": parts[0],
                    "date": parts[1],
                    "message": parts[2]
                })

    return {
        "success": True,
        "has_update": has_update,
        "behind_count": behind_count,
        "ahead_count": ahead_count,
        "current": current,
        "remote": {
            "commit": remote_hash_short,
            "commit_full": remote_hash_full,
            "commit_date": remote_date,
            "commit_message": remote_msg,
            "changelog": changelog
        },
        "message": (
            f"Tersedia {behind_count} pembaruan baru di GitHub."
            if has_update
            else "Aplikasi sudah menggunakan versi terbaru dari GitHub."
        )
    }


def apply_update() -> dict:
    """Safely updates the local repository from GitHub origin/main."""
    try:
        # Step 1: Restore harmless gitkeep files if modified/deleted
        _run_git(["restore", "data/"], timeout=5)

        # Step 2: If there are uncommitted local modifications, safely stash them
        status_dirty, _, _ = _run_git(["status", "--porcelain", "-uno"], timeout=5)
        stashed = False
        if status_dirty.strip():
            _run_git(["stash", "push", "-m", "Auto-stash sebelum update aplikasi"], timeout=10)
            stashed = True

        # Step 3: Try fast-forward pull
        pull_out, pull_err, pull_rc = _run_git(["pull", "--ff-only", "origin", "main"], timeout=30)
        if pull_rc != 0:
            # If fast-forward fails, attempt standard pull
            pull_out, pull_err, pull_rc = _run_git(["pull", "origin", "main", "--no-edit"], timeout=30)

        if pull_rc != 0:
            err_msg = pull_err or pull_out or "Gagal melakukan git pull."
            return {
                "success": False,
                "error": f"Pembaruan gagal diterapkan: {err_msg}"
            }

        new_version = get_version_info()
        return {
            "success": True,
            "message": "Pembaruan berhasil diterapkan dari GitHub.",
            "version": new_version,
            "pull_output": pull_out,
            "stashed_local_changes": stashed
        }
    except Exception as e:
        log_error("apply_update", e)
        return {
            "success": False,
            "error": str(e)
        }
