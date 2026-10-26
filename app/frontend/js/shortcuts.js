// =========================================================
// PAMSIMAS STUDIO - CENTRALIZED KEYBOARD SHORTCUTS CONTROLLER
// =========================================================

export const SHORTCUTS_DATA = [
  {
    category: 'Jendela Editor Foto',
    description: 'Pintasan saat membuka modal editor stempel foto (docEditModal)',
    items: [
      { keys: ['Esc'], desc: 'Keluar / Tutup jendela editor foto (atau batalkan seleksi potong)' },
      { keys: ['Ctrl', 'S'], desc: 'Simpan perubahan stempel & posisi foto saat ini' },
      { keys: ['Alt', '←'], desc: 'Beralih ke foto sebelumnya di galeri (tersimpan otomatis)' },
      { keys: ['Alt', '→'], desc: 'Beralih ke foto berikutnya di galeri (tersimpan otomatis)' },
      { keys: ['Enter'], desc: 'Terapkan potongan foto (saat kotak potong aktif)' },
      { keys: ['Alt', 'R'], desc: 'Putar foto 90° searah jarum jam (Kanan)' },
      { keys: ['Alt', 'L'], desc: 'Putar foto 90° berlawanan arah jarum jam (Kiri)' },
      { keys: ['Alt', 'H'], desc: 'Balik foto horizontal (cermin kiri-kanan)' },
      { keys: ['Alt', 'V'], desc: 'Balik foto vertikal (cermin atas-bawah)' },
      { keys: ['Alt', 'P'], desc: 'Buka pemilih titik koordinat di Google Maps' },
      { keys: ['Alt', 'C'], desc: 'Aktifkan / nonaktifkan mode seleksi potong manual' },
      { keys: ['Alt', '4'], desc: 'Atur rasio cepat standar 4:3 landscape' },
      { keys: ['Alt', 'O'], desc: 'Beralih tampilan antara foto asli dan foto berstempel' },
      { keys: ['Ctrl', 'Shift', 'R'], desc: 'Reset potongan kembali ke foto asli' }
    ]
  },
  {
    category: 'Pratinjau Layar Penuh (Lightbox)',
    description: 'Pintasan saat melihat pratinjau foto resolusi penuh',
    items: [
      { keys: ['Esc'], desc: 'Keluar dari pratinjau foto layar penuh' },
      { keys: ['←', '→'], desc: 'Navigasi ke foto sebelumnya / berikutnya' },
      { keys: ['E'], desc: 'Buka panel edit stempel untuk foto ini' },
      { keys: ['O', 'Space'], desc: 'Beralih tampilan antara Foto Asli vs Stempel' },
      { keys: ['D'], desc: 'Download file foto JPG stempel saat ini' }
    ]
  },
  {
    category: 'Peta Lokasi Google Maps',
    description: 'Pintasan saat membuka jendela peta penentuan geotag & koordinat',
    items: [
      { keys: ['Esc'], desc: 'Tutup jendela pemilih peta lokasi' },
      { keys: ['Ctrl', 'Enter'], desc: 'Gunakan koordinat & alamat yang sedang dipilih' },
      { keys: ['Enter'], desc: 'Cari lokasi (saat kursor di kolom pencarian desa/jalan)' },
      { keys: ['1', '2', '3', '4'], desc: 'Ganti layer peta (1: Satelit Hybrid, 2: Jalan, 3: Medan, 4: OSM)' }
    ]
  },
  {
    category: 'Smart Timeline (Jadwal Otomatis)',
    description: 'Pintasan pada jendela kalkulasi sebaran waktu & koordinat survei',
    items: [
      { keys: ['Esc'], desc: 'Tutup jendela generator jadwal Smart Timeline' },
      { keys: ['Ctrl', 'Enter'], desc: 'Terapkan jadwal & koordinat hasil kalkulasi ke seluruh foto' },
      { keys: ['Ctrl', 'R'], desc: 'Acak ulang sebaran waktu dan koordinat GPS' }
    ]
  },
  {
    category: 'Layar Utama Laporan',
    description: 'Pintasan umum yang dapat diakses langsung dari lembar kerja laporan',
    items: [
      { keys: ['Ctrl', 'S'], desc: 'Download & susun dokumen laporan Word (.docx)' },
      { keys: ['Ctrl', 'O'], desc: 'Buka / upload berkas dokumen Word (.docx) yang ada' },
      { keys: ['Alt', 'U'], desc: 'Pilih & unggah berkas foto dokumentasi baru' },
      { keys: ['Alt', 'T'], desc: 'Buka jendela generator jadwal Smart Timeline' },
      { keys: ['Alt', 'P'], desc: 'Buka pemilih koordinat peta survei cepat' },
      { keys: ['F1', '?'], desc: 'Buka jendela panduan & daftar lengkap pintasan keyboard' },
      { keys: ['Esc'], desc: 'Tutup modal aktif / batalkan dropdown / lepas fokus input' }
    ]
  }
];

export class KeyboardShortcutsManager {
  constructor(app) {
    this.app = app;
    this.boundHandler = this.handleKeyDown.bind(this);
    this.toastTimeout = null;
  }

  init() {
    window.addEventListener('keydown', this.boundHandler);
  }

  destroy() {
    window.removeEventListener('keydown', this.boundHandler);
  }

  isTypingInInput(e) {
    const el = e.target || document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input') {
      const type = (el.type || '').toLowerCase();
      return !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes(type);
    }
    if (tag === 'textarea' || el.isContentEditable) return true;
    return false;
  }

  getActiveModal() {
    // Ordered by topmost hierarchy (sub-modals take precedence)
    const modalIds = [
      'photoLightboxModal',
      'mapPickerModal',
      'updateModal',
      'errorLogsModal',
      'helpModal',
      'smartTimelineModal',
      'docEditModal'
    ];
    for (const id of modalIds) {
      const el = document.getElementById(id);
      if (el && el.classList.contains('active')) {
        return id;
      }
    }
    return null;
  }

  handleKeyDown(e) {
    const activeModalId = this.getActiveModal();
    const isTyping = this.isTypingInInput(e);
    const key = e.key;
    const code = e.code;
    const hasCtrl = e.ctrlKey || e.metaKey;
    const hasAlt = e.altKey;
    const hasShift = e.shiftKey;

    // =========================================================
    // 1. ESCAPE: UNIVERSAL MODAL & CONTEXT DISMISSAL
    // =========================================================
    if (key === 'Escape') {
      if (activeModalId) {
        e.preventDefault();
        e.stopPropagation();

        switch (activeModalId) {
          case 'photoLightboxModal':
            window.closePhotoLightbox?.();
            break;
          case 'mapPickerModal':
            window.closeMapPicker?.();
            break;
          case 'docEditModal': {
            // If crop box is visible or crop draw mode is active, cancel crop box first
            const cropBox = document.getElementById('cropBoundingBox');
            const hasCropBox = cropBox && cropBox.style.display !== 'none';
            if (window.isCropDrawModeActive || hasCropBox) {
              window.modalCancelCropBox?.();
            } else {
              window.closeActivePhotoModal?.();
            }
            break;
          }
          case 'smartTimelineModal':
            window.closeSmartTimeline?.();
            break;
          case 'helpModal':
            window.closeHelpModal?.();
            break;
          case 'errorLogsModal':
            window.closeErrorLogsModal?.();
            break;
          case 'updateModal':
            window.closeUpdateModal?.();
            break;
          default:
            break;
        }
        return;
      }

      // No modal active: blur focused text element if any
      if (isTyping && document.activeElement) {
        document.activeElement.blur();
        return;
      }
    }

    // =========================================================
    // 2. MODAL SPECIFIC SHORTCUTS: PHOTO EDITOR (docEditModal)
    // =========================================================
    if (activeModalId === 'docEditModal') {
      // Ctrl+S / Cmd+S: Save photo changes
      if (hasCtrl && !hasAlt && (key === 's' || key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        window.saveActivePhotoChanges?.();
        return;
      }

      // Enter key: Apply crop if crop box is active and user is not inside a textarea
      if (key === 'Enter' && !hasCtrl && !hasAlt) {
        const cropBox = document.getElementById('cropBoundingBox');
        const hasCropBox = cropBox && cropBox.style.display !== 'none';
        const isTextarea = (e.target && (e.target.tagName || '').toLowerCase() === 'textarea');
        if (hasCropBox && !isTextarea) {
          e.preventDefault();
          window.modalApplyCrop?.();
          return;
        }
      }

      // Alt + Left / Alt + Right: Navigate between photos in gallery
      if (hasAlt && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        e.preventDefault();
        const dir = key === 'ArrowLeft' ? -1 : 1;
        window.navigateModalPhoto?.(dir, true);
        return;
      }

      // '[' and ']' bracket keys (when not typing in text fields): Navigate photos
      if (!isTyping && !hasCtrl && !hasAlt) {
        if (key === '[' || key === '{') {
          e.preventDefault();
          window.navigateModalPhoto?.(-1, true);
          return;
        }
        if (key === ']' || key === '}') {
          e.preventDefault();
          window.navigateModalPhoto?.(1, true);
          return;
        }
      }

      // Alt+R: Rotate Right 90°
      if (hasAlt && (key === 'r' || key === 'R')) {
        e.preventDefault();
        window.rotateActivePhoto?.(90);
        return;
      }

      // Alt+L: Rotate Left -90°
      if (hasAlt && (key === 'l' || key === 'L')) {
        e.preventDefault();
        window.rotateActivePhoto?.(-90);
        return;
      }

      // Alt+H: Flip Horizontal
      if (hasAlt && (key === 'h' || key === 'H')) {
        e.preventDefault();
        window.flipActivePhoto?.('h');
        return;
      }

      // Alt+V: Flip Vertical
      if (hasAlt && (key === 'v' || key === 'V')) {
        e.preventDefault();
        window.flipActivePhoto?.('v');
        return;
      }

      // Alt+P or Ctrl+Shift+L: Open Map Picker
      if ((hasAlt && (key === 'p' || key === 'P')) || (hasCtrl && hasShift && (key === 'l' || key === 'L'))) {
        e.preventDefault();
        window.openModalMapPicker?.();
        return;
      }

      // Alt+C: Toggle Crop Draw mode
      if (hasAlt && (key === 'c' || key === 'C')) {
        e.preventDefault();
        window.toggleCropDrawMode?.();
        return;
      }

      // Alt+4: Quick Crop 4:3 aspect ratio
      if (hasAlt && (key === '4' || code === 'Digit4')) {
        e.preventDefault();
        window.modalQuickCropAspect43?.();
        return;
      }

      // Alt+O: Toggle Raw / Stamped Photo
      if (hasAlt && (key === 'o' || key === 'O')) {
        e.preventDefault();
        window.toggleActiveModalRaw?.();
        return;
      }

      // Ctrl+Shift+R: Reset Crop
      if (hasCtrl && hasShift && (key === 'r' || key === 'R')) {
        e.preventDefault();
        window.modalResetCrop?.();
        return;
      }
    }

    // =========================================================
    // 3. MODAL SPECIFIC SHORTCUTS: SMART TIMELINE
    // =========================================================
    if (activeModalId === 'smartTimelineModal') {
      // Ctrl+Enter: Apply timeline to all photos
      if (hasCtrl && key === 'Enter') {
        e.preventDefault();
        document.getElementById('stBtnApply')?.click();
        return;
      }

      // Ctrl+R or Alt+R: Recalculate / Randomize jitter
      if ((hasCtrl || hasAlt) && (key === 'r' || key === 'R')) {
        e.preventDefault();
        document.getElementById('stBtnRecalculate')?.click();
        return;
      }
    }

    // =========================================================
    // 4. MODAL SPECIFIC SHORTCUTS: MAP PICKER
    // =========================================================
    if (activeModalId === 'mapPickerModal') {
      // Ctrl+Enter: Confirm / Use coordinates
      if (hasCtrl && key === 'Enter') {
        e.preventDefault();
        window.confirmMapCoords?.();
        return;
      }

      // Numbers 1-4 when not typing in the search box: switch map layer
      if (!isTyping && !hasCtrl && !hasAlt && !hasShift) {
        if (key === '1') {
          e.preventDefault();
          window.setMapLayer?.('googleHybrid');
          return;
        }
        if (key === '2') {
          e.preventDefault();
          window.setMapLayer?.('googleRoad');
          return;
        }
        if (key === '3') {
          e.preventDefault();
          window.setMapLayer?.('googleTerrain');
          return;
        }
        if (key === '4') {
          e.preventDefault();
          window.setMapLayer?.('osm');
          return;
        }
      }
    }

    // =========================================================
    // 5. MODAL SPECIFIC SHORTCUTS: LIGHTBOX VIEWER
    // =========================================================
    if (activeModalId === 'photoLightboxModal') {
      // E: Open Editor directly
      if (!hasCtrl && !hasAlt && (key === 'e' || key === 'E')) {
        e.preventDefault();
        window.openEditorFromLightbox?.();
        return;
      }

      // D or Ctrl+S: Download JPG
      if ((!hasCtrl && !hasAlt && (key === 'd' || key === 'D')) || (hasCtrl && !hasAlt && (key === 's' || key === 'S'))) {
        e.preventDefault();
        window.downloadLightboxPhoto?.();
        return;
      }

      // O or Space: Toggle Raw / Stamped
      if (!hasCtrl && !hasAlt && (key === 'o' || key === 'O' || code === 'Space')) {
        e.preventDefault();
        window.toggleLightboxRaw?.();
        return;
      }
    }

    // =========================================================
    // 6. GLOBAL SHORTCUTS (NO MODAL ACTIVE)
    // =========================================================
    if (!activeModalId) {
      // Ctrl+S / Cmd+S: Generate & Download Report Docx (Prevent browser Save Page)
      if (hasCtrl && !hasAlt && (key === 's' || key === 'S')) {
        e.preventDefault();
        const btnGen = document.getElementById('btnGenerateReportDocx');
        if (btnGen) {
          btnGen.click();
        } else if (window.reportBuilder?.generateDocx) {
          window.reportBuilder.generateDocx();
        }
        return;
      }

      // Ctrl+O / Cmd+O: Upload Existing Docx Document (Prevent browser Open File)
      if (hasCtrl && !hasAlt && (key === 'o' || key === 'O')) {
        e.preventDefault();
        const docxInput = document.getElementById('reportExistingDocxInput');
        if (docxInput) docxInput.click();
        return;
      }

      // Alt+U or Ctrl+Shift+U: Upload Documentation Photos
      if ((hasAlt && (key === 'u' || key === 'U')) || (hasCtrl && hasShift && (key === 'u' || key === 'U'))) {
        e.preventDefault();
        const photoInput = document.getElementById('reportPhotoFileInput');
        if (photoInput) photoInput.click();
        return;
      }

      // Alt+T or Ctrl+Shift+T: Open Smart Timeline Generator
      if ((hasAlt && (key === 't' || key === 'T')) || (hasCtrl && hasShift && (key === 't' || key === 'T'))) {
        e.preventDefault();
        window.openSmartTimeline?.('report');
        return;
      }

      // Alt+P: Open Quick Map Picker
      if (hasAlt && (key === 'p' || key === 'P')) {
        e.preventDefault();
        window.openReportQuickMapPicker?.();
        return;
      }
    }

    // =========================================================
    // 7. UNIVERSAL HELP & SHORTCUTS DIALOG (F1 or '?')
    // =========================================================
    // F1 works anywhere; '?' works when not typing in input/textarea
    if (key === 'F1' || (!isTyping && !hasCtrl && !hasAlt && (key === '?' || (hasShift && key === '/')))) {
      e.preventDefault();
      if (window.showHelpModal) {
        window.showHelpModal();
      } else {
        document.getElementById('helpModal')?.classList.add('active');
      }
    }
  }
}
