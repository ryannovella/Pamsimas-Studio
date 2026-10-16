import os

# Base Directories
# app/backend/config.py is 2 levels deep, so BASE_DIR = project root
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))   # .../app/backend
_APP_DIR  = os.path.dirname(_THIS_DIR)                   # .../app
BASE_DIR  = os.path.dirname(_APP_DIR)                    # .../Laporan Monev Pamsimas (root)

# Load .env if present
_env_path = os.path.join(BASE_DIR, ".env")
if os.path.exists(_env_path):
    try:
        with open(_env_path, "r", encoding="utf-8") as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
    except Exception:
        pass

WEB_DIR        = os.path.join(BASE_DIR, "app", "frontend")
DATA_DIR       = os.path.join(BASE_DIR, "data")
DOCX_MEDIA_DIR = os.path.join(DATA_DIR, "temp_media")
DOCX_UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
OUTPUT_DIR     = os.path.join(BASE_DIR, "output")
BACKUP_DIR     = os.path.join(OUTPUT_DIR, "backups")
LOGS_DIR       = os.path.join(DATA_DIR, "logs")

# Auto-create required dirs on import
for _d in [DATA_DIR, DOCX_MEDIA_DIR, DOCX_UPLOADS_DIR, WEB_DIR, OUTPUT_DIR, BACKUP_DIR, LOGS_DIR]:
    os.makedirs(_d, exist_ok=True)

# Default Document — look in samples/ first, then root fallback
_SAMPLES_DIR = os.path.join(BASE_DIR, "samples")
DEFAULT_DOCX = None
for _fname in [
    "Laporan Monev 13-15 Agustus 2026 - Kabupaten Magelang (Geotagged).docx",
    "Laporan Monev 13-15 Agustus 2026 - Kabupaten Magelang.docx",
]:
    for _search_dir in [_SAMPLES_DIR, BASE_DIR]:
        _candidate = os.path.join(_search_dir, _fname)
        if os.path.exists(_candidate):
            DEFAULT_DOCX = _candidate
            break
    if DEFAULT_DOCX:
        break

if not DEFAULT_DOCX:
    DEFAULT_DOCX = os.path.join(_SAMPLES_DIR, "Laporan Monev.docx")  # placeholder

# Server Config
SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8501

# Locked Official Stamping Standards
STAMP_FONT_PATH   = "C:\\Windows\\Fonts\\arial.ttf"
FALLBACK_FONT_PATH = "arial.ttf"

# Proportions & Styling (Strictly preserved matching official reference)
FONT_SIZE_RATIO    = 0.04237   # ~20px on 472px image height
LINE_HEIGHT_RATIO  = 1.15      # Line height multiplier
MARGIN_RIGHT_RATIO = 0.0222    # Right padding
MARGIN_BOTTOM_RATIO = 0.0254   # Bottom padding

SHADOW_DX_SCALE  = 1.2
SHADOW_DY_SCALE  = 1.2
SHADOW_BLUR_SCALE = 0.8
SHADOW_OPACITY   = 235
TEXT_COLOR       = (255, 255, 255, 255)
