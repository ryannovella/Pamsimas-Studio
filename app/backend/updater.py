import os
import json
import urllib.request
import urllib.error
import subprocess
from app.backend.config import BASE_DIR
from app.backend.logger import log_error

APP_BASE_VERSION = "4.1"
VERSION_FILE = os.path.join(BASE_DIR, "version.json")
GITHUB_REPO_API = "https://api.github.com/repos/ryannovella/Pamsimas-Studio"


def _is_git_repository() -> bool:
    """Checks whether the project root contains a valid .git directory."""
    return os.path.isdir(os.path.join(BASE_DIR, ".git"))


def _is_cloud_environment() -> bool:
    """Detects if running inside Hugging Face Spaces or similar containerized cloud."""
    return bool(
        os.getenv("SPACE_ID")
        or os.getenv("SPACE_REPO_NAME")
        or os.getenv("SPACE_AUTHOR_NAME")
        or os.getenv("GRADIO_SERVER_NAME")
    )


def _run_git(args: list[str], timeout: int = 15) -> tuple[str, str, int]:
    """Helper to run git commands inside the project root."""
    if not _is_git_repository():
        return "", "fatal: not a git repository", 128
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


def _fetch_github_api(endpoint: str, timeout: int = 10) -> tuple[dict | list | None, str]:
    """Helper to query GitHub REST API without external dependencies."""
    url = f"{GITHUB_REPO_API}/{endpoint}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Pamsimas-Studio-Updater",
            "Accept": "application/vnd.github.v3+json"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data, ""
    except urllib.error.HTTPError as e:
        if e.code == 403:
            return None, "Batas permintaan GitHub API terlampaui (rate limit). Coba beberapa saat lagi."
        return None, f"GitHub API error HTTP {e.code}: {e.reason}"
    except Exception as e:
        return None, f"Tidak dapat terhubung ke GitHub: {str(e)}"


def get_version_info() -> dict:
    """Returns real-time version info from local git repository or version.json fallback."""
    cached_version = None
    if os.path.exists(VERSION_FILE):
        try:
            with open(VERSION_FILE, "r", encoding="utf-8") as f:
                cached_version = json.load(f)
        except Exception:
            cached_version = None

    is_cloud = _is_cloud_environment()

    # 1. Fallback when .git does not exist (e.g. Hugging Face Spaces, Docker, or ZIP download)
    if not _is_git_repository():
        if cached_version and isinstance(cached_version, dict):
            return {
                "success": True,
                "version": cached_version.get("version", APP_BASE_VERSION),
                "display_tag": cached_version.get("display_tag", f"v{APP_BASE_VERSION}"),
                "commit": cached_version.get("commit", "cloud"),
                "commit_full": cached_version.get("commit_full", ""),
                "commit_date": cached_version.get("commit_date", "-"),
                "commit_message": cached_version.get("commit_message", "Hugging Face Spaces Cloud" if is_cloud else "Build Standalone"),
                "branch": cached_version.get("branch", "main"),
                "commit_count": cached_version.get("commit_count", 0),
                "is_dirty": False,
                "is_cloud": is_cloud,
                "display": cached_version.get("display", f"v{APP_BASE_VERSION}"),
                "full_display": cached_version.get("full_display", f"v{APP_BASE_VERSION}")
            }
        return {
            "success": True,
            "version": APP_BASE_VERSION,
            "commit": "cloud" if is_cloud else "standalone",
            "commit_full": "",
            "commit_date": "-",
            "commit_message": "Hugging Face Spaces Cloud" if is_cloud else "Build Standalone",
            "branch": "main",
            "commit_count": 0,
            "is_dirty": False,
            "is_cloud": is_cloud,
            "display": f"v{APP_BASE_VERSION}",
            "full_display": f"v{APP_BASE_VERSION}"
        }

    # 2. Local git repository exists: read live git metadata
    short_hash, _, rc_hash = _run_git(["rev-parse", "--short", "HEAD"], timeout=5)
    full_hash, _, _ = _run_git(["rev-parse", "HEAD"], timeout=5)
    commit_date, _, _ = _run_git(["log", "-1", "--format=%cd", "--date=short"], timeout=5)
    commit_msg, _, _ = _run_git(["log", "-1", "--format=%s"], timeout=5)
    branch, _, _ = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], timeout=5)
    commit_count, _, _ = _run_git(["rev-list", "--count", "HEAD"], timeout=5)
    status_out, _, _ = _run_git(["status", "--porcelain", "-uno"], timeout=5)

    if rc_hash != 0 or not short_hash:
        if cached_version and isinstance(cached_version, dict):
            return cached_version
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
            "is_cloud": False,
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
        "is_cloud": False,
        "display": short_label,
        "full_display": full_label
    }


def _check_updates_via_github_api(current: dict) -> dict:
    """Checks for updates using the GitHub REST API (for cloud or non-git environments)."""
    is_cloud = _is_cloud_environment()
    commits, err = _fetch_github_api("commits?per_page=15", timeout=12)
    if err or not commits or not isinstance(commits, list):
        return {
            "success": False,
            "has_update": False,
            "error": err or "Gagal menghubungi GitHub API.",
            "current": current
        }

    latest_commit = commits[0]
    remote_sha = latest_commit.get("sha", "")
    remote_hash_short = remote_sha[:7]
    remote_date = latest_commit.get("commit", {}).get("committer", {}).get("date", "")[:10]
    remote_msg = latest_commit.get("commit", {}).get("message", "").split("\n")[0]

    current_commit = current.get("commit", "")
    current_commit_full = current.get("commit_full", "")

    # Compare remote commit with current commit
    is_same = False
    if current_commit_full and remote_sha:
        is_same = (remote_sha.lower() == current_commit_full.lower())
    elif current_commit and current_commit not in ["cloud", "unknown", "standalone"]:
        is_same = (remote_hash_short.lower() == current_commit.lower())

    changelog = []
    behind_count = 0

    if not is_same and current_commit not in ["cloud", "unknown", "standalone"]:
        for c in commits:
            c_sha = c.get("sha", "")
            c_short = c_sha[:7]
            if (current_commit_full and c_sha.lower() == current_commit_full.lower()) or (c_short.lower() == current_commit.lower()):
                break
            changelog.append({
                "commit": c_short,
                "date": c.get("commit", {}).get("committer", {}).get("date", "")[:10],
                "message": c.get("commit", {}).get("message", "").split("\n")[0]
            })
        behind_count = len(changelog)
    elif not is_same:
        for c in commits[:5]:
            changelog.append({
                "commit": c.get("sha", "")[:7],
                "date": c.get("commit", {}).get("committer", {}).get("date", "")[:10],
                "message": c.get("commit", {}).get("message", "").split("\n")[0]
            })
        behind_count = 1

    has_update = not is_same

    if is_cloud:
        msg = (
            "Aplikasi berjalan di Hugging Face Spaces (Cloud). Pembaruan disinkronkan otomatis oleh GitHub Actions saat ada rilis baru."
            if not has_update
            else f"Tersedia {behind_count} pembaruan di GitHub. Sinkronisasi Hugging Face berjalan otomatis via GitHub Actions."
        )
    else:
        msg = (
            "Aplikasi sudah menggunakan versi terbaru dari GitHub."
            if not has_update
            else f"Tersedia {behind_count} pembaruan baru di GitHub."
        )

    return {
        "success": True,
        "has_update": has_update,
        "behind_count": behind_count,
        "ahead_count": 0,
        "can_apply": False,
        "is_cloud": is_cloud,
        "current": current,
        "remote": {
            "commit": remote_hash_short,
            "commit_full": remote_sha,
            "commit_date": remote_date,
            "commit_message": remote_msg,
            "changelog": changelog
        },
        "message": msg
    }


def check_for_updates() -> dict:
    """Fetches origin/main and compares with local HEAD to check for updates."""
    current = get_version_info()

    # Step 0: If not a git repository (or running in cloud), use GitHub REST API directly
    if not _is_git_repository():
        return _check_updates_via_github_api(current)

    # Step 1: Fetch latest refs from remote
    fetch_out, fetch_err, fetch_rc = _run_git(["fetch", "origin", "main"], timeout=20)
    if fetch_rc != 0:
        # Fallback to GitHub API if git metadata is missing or corrupted
        if "not a git repository" in fetch_err.lower():
            return _check_updates_via_github_api(current)
        err_msg = fetch_err or fetch_out or "Gagal menghubungi repositori GitHub."
        if "Could not resolve host" in err_msg or "Failed to connect" in err_msg:
            err_msg = "Tidak dapat terhubung ke GitHub. Periksa koneksi internet atau firewall."
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
        "can_apply": True,
        "is_cloud": False,
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
    if not _is_git_repository():
        is_cloud = _is_cloud_environment()
        if is_cloud:
            return {
                "success": False,
                "error": "Aplikasi berjalan di Hugging Face Spaces (Cloud). Pembaruan disinkronkan dan di-deploy otomatis oleh GitHub Actions saat ada commit baru di branch main."
            }
        return {
            "success": False,
            "error": "Aplikasi berjalan dalam mode standalone tanpa repositori .git. Silakan clone repositori dengan git untuk mengaktifkan pembaruan otomatis satu-klik."
        }

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
