// =========================================================
// PAMSIMAS STUDIO - REPORT BUILDER CONTROLLER (MONEV WORD GENERATOR)
// =========================================================
import {
  generateSequentialTimestamps,
  generateMultiDayTimeline,
  generateTripSchedule,
  applyGpsJitter,
  applyTimeJitter,
  parseIndonesianTimestamp,
  formatIndonesianTimestamp,
  formatIndonesianDateOnly,
  getNextDayIso,
  toIndonesianDateText
} from './dateUtils.js';
import { KNOWN_COORDS_FRONTEND, KABUPATEN_COORDS_FRONTEND } from './config.js';
import { renderStampedPhoto } from './canvasRenderer.js';
import { Autocomplete, highlightText } from './autocomplete.js';

export class ReportBuilder {
  constructor() {
    this.kabupaten = '';
    this.kabupatens = [];
    this.tahun = '2026';
    this.sptPrefix = this.getStoredSptPrefix();
    this.sptSuffix = '';
    this.nomorSpt = '';
    this.tanggalSpt = '';
    this.tanggalLaporan = '';
    this.tempatPembuatan = 'Semarang';
    this.includePelaksana = true;
    this.pelaksanaList = [];
    this.personelMaster = [];
    this.villageAutocompletes = new Map();
    this.kabupatenAutocomplete = null;
    this.personelAutocomplete = null;
    this.villages = [
      {
        id: 'v_init',
        desa: '',
        kecamatan: '',
        kabupaten: '',
        notes: '',
        narrative: ''
      }
    ];
    this.photos = [];
    this.selectedPhotoIds = new Set();
    this.lastSelectedPhotoIndex = null;
    this.activePhotoId = null;
    this.showRawGrid = false;
    this.modalShowRaw = false;
    this.imageCache = new Map();
    this.locations = [];
    this.isGenerating = false;

    // Perjalanan Dinas & Jam Kerja
    this.tripMode = 'single'; // 'single' (hanya sehari) atau 'multiple' (multiple hari)
    this.tripStartDate = '';
    this.tripEndDate = '';
    this.tripStartTime = '09:14:23';
    this.tripEndTime = '15:47:38';

    // Interactive Crop Draw Bounding Box
    this.isCropDrawMode = false;
    this.isDrawingCrop = false;
    this.cropStart = null;
    this.activeCropPixels = null;
    this.currentLoadedDocxName = '';

    // Segment Locks (Administrasi, Pelaksana, Villages, Photos)
    this.lockedSegments = {
      administrasi: false,
      pelaksana: false,
      villages: false,
      photos: false
    };

    // Mode Tampilan Foto (Simulasi Tabel Word vs Grid) & Drag Reordering State
    this.photoViewMode = 'table';
    this.draggedPhotoIndex = null;
  }

  findBestMatch(query, candidates, keyExtractor = null) {
    if (!query || !candidates || candidates.length === 0) return null;
    const q = query.trim().toLowerCase();
    if (!q) return null;

    const getText = (item) => {
      if (typeof keyExtractor === 'function') return (keyExtractor(item) || '').trim();
      return (typeof item === 'string' ? item : (item?.name || item?.desa || '')).trim();
    };

    // 1. Exact match
    const exact = candidates.find(item => getText(item).toLowerCase() === q);
    if (exact) return exact;

    // 2. Starts with query (contoh: "rud" -> "Rudy Suryanto, ST", "boy" -> "Boyolali", "moj" -> "Mojosari")
    const starts = candidates.find(item => getText(item).toLowerCase().startsWith(q));
    if (starts) return starts;

    // 3. Word in string starts with query (contoh: "adi" atau "adhi" -> "FX Adhi Cahyo")
    const wordStarts = candidates.find(item => {
      const words = getText(item).toLowerCase().split(/[\s,\.\-_]+/);
      return words.some(w => w.startsWith(q));
    });
    if (wordStarts) return wordStarts;

    // 4. Substring contains
    const contains = candidates.find(item => getText(item).toLowerCase().includes(q));
    if (contains) return contains;

    return null;
  }

  async init() {
    const noticeEl = document.getElementById('reportSuccessNotice');
    if (noticeEl) noticeEl.style.display = 'none';

    this.initQuickSetupElements();
    this.initTripPanel();
    this.initCropDrawEvents();
    this.bindStaticEvents();
    this.initKabupatenAutocomplete();
    this.renderKabupatenChips();
    await this.fetchLocations();
    await this.fetchPersonel();
    this.renderPelaksanaList();
    this.renderVillages();
    this.renderPhotos();
    this.updateDocumentTitlePreview();
    this.updateSummaryBadge();

    // Inisialisasi status kunci segmen UI
    ['administrasi', 'pelaksana', 'villages', 'photos'].forEach(key => {
      this.applySegmentLockUI(key);
    });
  }

  initQuickSetupElements() {
    this.quickPanel = document.getElementById('reportQuickSetupPanel');
    this.quickToggleBtn = document.getElementById('btnToggleReportQuickPanel');
    this.quickToggleText = document.getElementById('reportQuickToggleText');
    this.quickVillageTarget = document.getElementById('reportQuickVillageTarget');
    this.quickDesa = document.getElementById('reportQuickDesa');
    this.quickKec = document.getElementById('reportQuickKec');
    this.quickDusun = document.getElementById('reportQuickDusun');
    this.quickKab = document.getElementById('reportQuickKab');
    this.quickProv = document.getElementById('reportQuickProv');
    this.quickAddressMode = document.getElementById('reportQuickAddressMode');
    this.quickCustomAddress = document.getElementById('reportQuickCustomAddress');
    this.quickDate = document.getElementById('reportQuickDate');
    this.quickEndDate = document.getElementById('reportQuickEndDate');
    this.quickEndDateGroup = document.getElementById('reportQuickEndDateGroup');
    this.quickTime = document.getElementById('reportQuickTime');
    this.quickEndTime = document.getElementById('reportQuickEndTime');
    this.quickEndTimeGroup = document.getElementById('reportQuickEndTimeGroup');
    this.quickTimeMode = document.getElementById('reportQuickTimeMode');
    this.quickLat = document.getElementById('reportQuickLat');
    this.quickLon = document.getElementById('reportQuickLon');
    this.quickFontScale = document.getElementById('reportQuickFontScale');
    this.quickGpsJitter = document.getElementById('reportQuickGpsJitter');

    // Modal elements
    this.modal = document.getElementById('docEditModal');
    this.modalTitle = document.getElementById('modalPhotoTitle') || document.getElementById('modalTitle');
    this.modalDatePicker = document.getElementById('modalDatePicker');
    this.modalTimePicker = document.getElementById('modalTimePicker');
    this.modalTimeStr = document.getElementById('modalTimeStr');
    this.modalLat = document.getElementById('modalLat');
    this.modalLon = document.getElementById('modalLon');
    this.modalDusun = document.getElementById('modalDusun');
    this.modalDesa = document.getElementById('modalDesa');
    this.modalKecamatan = document.getElementById('modalKecamatan');
    this.modalKabupaten = document.getElementById('modalKabupaten');
    this.modalProvinsi = document.getElementById('modalProvinsi');
    this.modalCustomAddress = document.getElementById('modalCustomAddress');
    this.modalAddressMode = document.getElementById('modalAddressMode');
    this.modalFontScale = document.getElementById('modalFontScale');
    this.modalKeepOriginal = document.getElementById('modalKeepOriginal');
    this.modalPreviewCanvas = document.getElementById('modalPreviewCanvas');
    this.btnToggleModalRaw = document.getElementById('btnToggleModalRaw');

    this.updateQuickVillageTargetOptions();
  }

  showToast(msg, type = 'info', duration = null) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type, duration);
    } else {
      alert(msg);
    }
  }

  initTripPanel() {
    const sInput = document.getElementById('reportTripStartDate');
    const eInput = document.getElementById('reportTripEndDate');

    // Jangan otomatis mengisi Tgl Mulai saat pertama kali membuka WebUI
    if (sInput) {
      sInput.value = '';
      this.syncDateInputColor(sInput);
    }
    this.tripStartDate = '';

    if (eInput) {
      eInput.value = '';
      this.syncDateInputColor(eInput);
    }
    this.tripEndDate = '';

    // Randomize Jam Mulai (~09:xx) & Jam Selesai (~15:xx s/d 16:xx) setiap launch
    this.randomizeWorkHours(false);

    // Tanggal SPT & Tanggal Laporan default kosong saat webui baru dibuka
    if (!this.tanggalSpt) {
      this.setReportTanggalSpt('');
    } else {
      this.setReportTanggalSpt(this.tanggalSpt);
    }
    if (!this.tanggalLaporan) {
      this.setReportTanggalLaporan('', false);
    } else {
      this.setReportTanggalLaporan(this.tanggalLaporan, false);
    }

    this.setTripMode('single', false);
    this.onTripDatesChange();
    this.updatePhotoUploadState();
  }

  async fetchLocations() {
    try {
      const res = await fetch('/api/locations');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.locations)) {
          this.locations = data.locations;
          this.populateLocationDatalists();
        }
      }
    } catch (e) {
      console.warn('Gagal memuat master lokasi:', e);
    }
  }

  populateLocationDatalists() {
    this.initKabupatenAutocomplete();
    this.initVillageAutocompletes();
    if (this.villages && this.villages.length > 0) {
      this.renderVillages();
    }
  }

  setKabupatens(kabs) {
    if (!Array.isArray(kabs)) {
      if (typeof kabs === 'string' && kabs.trim()) {
        kabs = kabs.split(/[,;/]|\s+dan\s+/i).map(s => s.trim()).filter(Boolean);
      } else {
        kabs = [];
      }
    }
    const cleanList = [];
    kabs.forEach(k => {
      const c = (k || '').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
      if (c && !cleanList.some(item => item.toLowerCase() === c.toLowerCase())) {
        cleanList.push(c);
      }
    });
    this.kabupatens = cleanList;
    this.kabupaten = cleanList.join(', ');
    const hiddenInp = document.getElementById('reportKabupaten');
    if (hiddenInp) hiddenInp.value = this.kabupaten;
    if (this.quickKab && cleanList[0]) this.quickKab.value = cleanList[0];
    this.renderKabupatenChips();
    this.updateMultiKabIndicator();
    this.updateDocumentTitlePreview();
    this.evaluateRealtimeAudit();
    this.renderVillages();
    this.updateQuickVillageTargetOptions();
  }

  addKabupaten(kabName) {
    const c = (kabName || '').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
    if (!c) return false;
    if (this.kabupatens.some(k => k.toLowerCase() === c.toLowerCase())) return false;
    this.kabupatens.push(c);
    this.kabupaten = this.kabupatens.join(', ');
    const hiddenInp = document.getElementById('reportKabupaten');
    if (hiddenInp) hiddenInp.value = this.kabupaten;
    if (this.quickKab && !this.quickKab.value) this.quickKab.value = c;
    this.renderKabupatenChips();
    this.updateMultiKabIndicator();
    this.updateDocumentTitlePreview();
    this.evaluateRealtimeAudit();
    this.renderVillages();
    this.updateQuickVillageTargetOptions();
    return true;
  }

  removeKabupaten(kabName) {
    if (this.lockedSegments.administrasi) {
      this.showToast('Segmen Data Administrasi sedang terkunci.', 'warning');
      return;
    }
    const c = (kabName || '').trim().toLowerCase();
    this.kabupatens = this.kabupatens.filter(k => k.toLowerCase() !== c);
    this.kabupaten = this.kabupatens.join(', ');
    const hiddenInp = document.getElementById('reportKabupaten');
    if (hiddenInp) hiddenInp.value = this.kabupaten;
    this.renderKabupatenChips();
    this.updateMultiKabIndicator();
    this.updateDocumentTitlePreview();
    this.evaluateRealtimeAudit();
    this.renderVillages();
    this.updateQuickVillageTargetOptions();
  }

  updateMultiKabIndicator() {
    const ind = document.getElementById('multiKabIndicator');
    if (ind) {
      ind.style.display = this.kabupatens.length > 1 ? 'inline-block' : 'none';
      if (this.kabupatens.length > 1) {
        ind.textContent = `${this.kabupatens.length} Kab`;
      }
    }
  }

  renderKabupatenChips() {
    const chipsContainer = document.getElementById('reportKabupatenChips');
    const inputEl = document.getElementById('reportKabupatenInput');
    if (!chipsContainer) return;

    chipsContainer.innerHTML = this.kabupatens.map(k => `
      <span class="kab-chip">
        <span>Kab. ${this.escapeHtml(k)}</span>
        <button type="button" class="chip-remove" onclick="event.stopPropagation(); window.reportBuilder.removeKabupaten('${this.escapeHtml(k)}')" title="Hapus ${this.escapeHtml(k)}">&times;</button>
      </span>
    `).join('');

    if (inputEl) {
      if (this.kabupatens.length === 0) {
        inputEl.placeholder = 'Pilih kabupaten...';
      } else {
        inputEl.placeholder = '+ Tambah...';
      }
    }
  }

  renderVillageKabOptions(currentKab) {
    const defaultKab = (currentKab || this.kabupatens[0] || 'Magelang').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
    let kabs = [...this.kabupatens];
    if (defaultKab && !kabs.some(k => k.toLowerCase() === defaultKab.toLowerCase())) {
      kabs.push(defaultKab);
    }
    if (kabs.length === 0) {
      kabs = ['Magelang'];
    }
    return kabs.map(k => `
      <option value="${this.escapeHtml(k)}"${k.toLowerCase() === defaultKab.toLowerCase() ? ' selected' : ''}>Kab. ${this.escapeHtml(k)}</option>
    `).join('');
  }

  getVillageKabupaten(v) {
    if (v && v.kabupaten && v.kabupaten.trim()) {
      return v.kabupaten.replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
    }
    return this.kabupatens[0] || this.kabupaten || 'Magelang';
  }

  initKabupatenAutocomplete() {
    const inputEl = document.getElementById('reportKabupatenInput') || document.getElementById('reportKabupaten');
    if (!inputEl) return;
    if (this.kabupatenAutocomplete) {
      this.kabupatenAutocomplete.destroy();
    }

    this.kabupatenAutocomplete = new Autocomplete({
      input: inputEl,
      minChars: 0,
      maxResults: 15,
      getItems: (query) => this.searchKabupatens(query),
      renderItem: (kab, query) => {
        const qClean = (query || '').trim().replace(/^(?:kabupaten|kota)\s*/i, '');
        return `
          <div class="autocomplete-item-main">
            <span>Kabupaten <strong>${highlightText(kab, qClean)}</strong></span>
          </div>
        `;
      },
      onSelect: (kab) => {
        this.addKabupaten(kab);
        inputEl.value = '';
        setTimeout(() => inputEl.focus(), 50);
      }
    });

    // Event listener untuk menambahkan via Enter / Koma dan backspace hapus chip terakhir
    if (!inputEl._kabListenerBound) {
      inputEl._kabListenerBound = true;
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          if (this.kabupatenAutocomplete && this.kabupatenAutocomplete.isOpen && this.kabupatenAutocomplete.items.length > 0) {
            return;
          }
          e.preventDefault();
          const val = inputEl.value.trim().replace(/^,+|,+$/g, '');
          if (val) {
            const match = this.locations?.find(l => (l.kabupaten || '').toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, '').trim() === val.toLowerCase());
            const finalVal = match ? match.kabupaten.replace(/^(?:kabupaten|kota)\s*/i, '').trim() : val;
            this.addKabupaten(finalVal);
            inputEl.value = '';
          }
        } else if (e.key === 'Backspace' && !inputEl.value && this.kabupatens.length > 0) {
          this.removeKabupaten(this.kabupatens[this.kabupatens.length - 1]);
        }
      });
    }
  }

  searchKabupatens(query) {
    if (!this.locations || this.locations.length === 0) return [];
    const q = (query || '').trim().toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, '');
    const uniqueKabs = [...new Set(this.locations.map(l => (l.kabupaten || '').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim()))].filter(Boolean);
    const availableKabs = uniqueKabs.filter(k => !this.kabupatens.some(sel => sel.toLowerCase() === k.toLowerCase()));

    // KASUS 1: Query kosong (User klik kolom kabupaten)
    if (!q) {
      return availableKabs.sort((a, b) => a.localeCompare(b)).slice(0, 15);
    }

    // KASUS 2: Query terisi (Pencarian per-huruf)
    const matches = [];
    let hasExact = false;
    for (const kab of availableKabs) {
      const kabLower = kab.toLowerCase();
      let score = 0;
      if (kabLower === q) {
        score = 100;
        hasExact = true;
      } else if (kabLower.startsWith(q)) {
        score = 80;
      } else {
        const words = kabLower.split(/[\s,\.\-_]+/);
        if (words.some(w => w.startsWith(q))) {
          score = 60;
        } else if (kabLower.includes(q)) {
          score = 40;
        }
      }

      if (score > 0) {
        matches.push({ kab, score });
      }
    }

    if (hasExact) {
      for (const kab of availableKabs) {
        if (!matches.some(m => m.kab.toLowerCase() === kab.toLowerCase())) {
          matches.push({ kab, score: 10 });
        }
      }
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.kab.localeCompare(b.kab);
    });

    return matches.slice(0, 15).map(m => m.kab);
  }

  initVillageAutocompletes() {
    if (!this.villages || this.villages.length === 0) return;
    this.villages.forEach(v => {
      // 1. Autocomplete Desa
      const inputDesa = document.getElementById(`desa_${v.id}`);
      if (inputDesa) {
        if (this.villageAutocompletes && this.villageAutocompletes.has(`desa_${v.id}`)) {
          this.villageAutocompletes.get(`desa_${v.id}`).destroy();
        }

        const acDesa = new Autocomplete({
          input: inputDesa,
          minChars: 0,
          maxResults: 15,
          getItems: (query) => this.searchVillages(query, v.kabupaten),
          renderItem: (item, query) => {
            const qClean = (query || '').trim().replace(/^desa\s+/i, '');
            const kabClean = (item.kabupaten || '').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
            return `
              <div class="autocomplete-item-main">
                <span>Desa <strong>${highlightText(item.desa, qClean)}</strong></span>
              </div>
              <div class="autocomplete-item-sub">
                <span>Kecamatan ${highlightText(item.kecamatan, qClean)}${kabClean ? ' • Kab. ' + kabClean : ''}</span>
              </div>
            `;
          },
          onSelect: (item) => {
            this.onSelectDesaPreset(v.id, `${item.desa}|${item.kecamatan}|${item.kabupaten}`);
          }
        });

        if (!this.villageAutocompletes) {
          this.villageAutocompletes = new Map();
        }
        this.villageAutocompletes.set(`desa_${v.id}`, acDesa);
      }

      // 2. Autocomplete Kecamatan
      const inputKec = document.getElementById(`kec_${v.id}`);
      if (inputKec) {
        if (this.villageAutocompletes && this.villageAutocompletes.has(`kec_${v.id}`)) {
          this.villageAutocompletes.get(`kec_${v.id}`).destroy();
        }

        const acKec = new Autocomplete({
          input: inputKec,
          minChars: 0,
          maxResults: 15,
          getItems: (query) => this.searchKecamatans(query, v.kabupaten),
          renderItem: (kec, query) => {
            const qClean = (query || '').trim().replace(/^kec(?:amatan)?\s+/i, '');
            return `
              <div class="autocomplete-item-main">
                <span>Kecamatan <strong>${highlightText(kec, qClean)}</strong></span>
              </div>
            `;
          },
          onSelect: (kec) => {
            inputKec.value = kec;
            this.onVillageFieldChange(v.id, 'kecamatan', kec);
          }
        });

        this.villageAutocompletes.set(`kec_${v.id}`, acKec);
      }
    });
  }

  searchVillages(query, targetKab = null) {
    if (!this.locations || this.locations.length === 0) return [];
    const q = (query || '').trim().toLowerCase().replace(/^desa\s+/, '');
    
    // Tentukan pool kabupaten
    const kabsToFilter = [];
    if (targetKab && targetKab.trim()) {
      kabsToFilter.push(targetKab.trim().toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, ''));
    } else if (this.kabupatens.length > 0) {
      this.kabupatens.forEach(k => kabsToFilter.push(k.trim().toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, '')));
    } else if (this.kabupaten && this.kabupaten.trim()) {
      kabsToFilter.push(this.kabupaten.trim().toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, ''));
    }

    let pool = this.locations;
    if (kabsToFilter.length > 0) {
      const scopedPool = this.locations.filter(loc => {
        const kabClean = (loc.kabupaten || '').toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, '').trim();
        return kabsToFilter.some(fk => kabClean === fk || kabClean.includes(fk) || fk.includes(kabClean));
      });
      // Gunakan scopedPool jika query kosong atau jika ada hasil di scopedPool
      if (!q || scopedPool.length > 0) {
        pool = scopedPool;
      }
    }

    // KASUS 1: Query kosong (User klik kolom desa tanpa mengetik)
    if (!q) {
      return pool.map(loc => ({
        desa: (loc.desa || '').trim(),
        kecamatan: (loc.kecamatan || '').trim(),
        kabupaten: (loc.kabupaten || '').trim()
      })).sort((a, b) => a.desa.localeCompare(b.desa)).slice(0, 20);
    }

    // KASUS 2: Query terisi (Pencarian per-huruf mengerucut strictly di dalam pool kabupaten)
    const matches = [];
    let hasExactMatch = false;

    for (let i = 0; i < pool.length; i++) {
      const loc = pool[i];
      const desa = (loc.desa || '').trim();
      const desaLower = desa.toLowerCase();
      const kec = (loc.kecamatan || '').trim();
      const kecLower = kec.toLowerCase();

      let score = 0;
      if (desaLower === q) {
        score = 100;
        hasExactMatch = true;
      } else if (desaLower.startsWith(q)) {
        score = 80;
      } else {
        const words = desaLower.split(/[\s,\.\-_]+/);
        if (words.some(w => w.startsWith(q))) {
          score = 60;
        } else if (desaLower.includes(q)) {
          score = 40;
        } else if (kecLower.startsWith(q)) {
          score = 25;
        }
      }

      if (score > 0) {
        matches.push({
          desa,
          kecamatan: kec,
          kabupaten: (loc.kabupaten || '').trim(),
          score
        });
      }
    }

    // Jika user klik kolom yang sudah terisi nama desa persis, sertakan desa lainnya di kabupaten yang sama
    if (hasExactMatch) {
      for (const loc of pool) {
        const desa = (loc.desa || '').trim();
        if (desa.toLowerCase() !== q && !matches.some(m => m.desa.toLowerCase() === desa.toLowerCase())) {
          matches.push({
            desa,
            kecamatan: (loc.kecamatan || '').trim(),
            kabupaten: (loc.kabupaten || '').trim(),
            score: 10
          });
        }
      }
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.desa.localeCompare(b.desa);
    });

    return matches.slice(0, 20);
  }

  searchKecamatans(query, targetKab = null) {
    if (!this.locations || this.locations.length === 0) return [];
    const q = (query || '').trim().toLowerCase().replace(/^kec(?:amatan)?\s+/, '');
    
    const kabsToFilter = [];
    if (targetKab && targetKab.trim()) {
      kabsToFilter.push(targetKab.trim().toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, ''));
    } else if (this.kabupatens.length > 0) {
      this.kabupatens.forEach(k => kabsToFilter.push(k.trim().toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, '')));
    } else if (this.kabupaten && this.kabupaten.trim()) {
      kabsToFilter.push(this.kabupaten.trim().toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, ''));
    }

    let pool = this.locations;
    if (kabsToFilter.length > 0) {
      const scopedPool = this.locations.filter(loc => {
        const kabClean = (loc.kabupaten || '').toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, '').trim();
        return kabsToFilter.some(fk => kabClean === fk || kabClean.includes(fk) || fk.includes(kabClean));
      });
      if (!q || scopedPool.length > 0) {
        pool = scopedPool;
      }
    }

    const uniqueKecs = [...new Set(pool.map(l => (l.kecamatan || '').trim()))].filter(Boolean);

    // KASUS 1: Query kosong (User klik kolom kecamatan tanpa mengetik)
    if (!q) {
      return uniqueKecs.sort((a, b) => a.localeCompare(b)).slice(0, 20);
    }

    // KASUS 2: Query terisi (Pencarian per-huruf)
    const matches = [];
    let hasExact = false;

    for (const kec of uniqueKecs) {
      const kecLower = kec.toLowerCase();
      let score = 0;
      if (kecLower === q) {
        score = 100;
        hasExact = true;
      } else if (kecLower.startsWith(q)) {
        score = 80;
      } else {
        const words = kecLower.split(/[\s,\.\-_]+/);
        if (words.some(w => w.startsWith(q))) {
          score = 60;
        } else if (kecLower.includes(q)) {
          score = 40;
        }
      }

      if (score > 0) {
        matches.push({ kec, score });
      }
    }

    if (hasExact) {
      for (const kec of uniqueKecs) {
        if (!matches.some(m => m.kec.toLowerCase() === kec.toLowerCase())) {
          matches.push({ kec, score: 10 });
        }
      }
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.kec.localeCompare(b.kec);
    });

    return matches.slice(0, 20).map(m => m.kec);
  }

  getLocationMatch(desaQuery) {
    if (!desaQuery || !this.locations || this.locations.length === 0) return null;
    const clean = desaQuery.trim().toLowerCase().replace(/^desa\s+/, '');
    if (!clean) return null;

    // 1. Exact match nama desa
    let match = this.locations.find(l => (l.desa || '').trim().toLowerCase() === clean);
    if (match) return match;

    // 2. Format pencarian jika user memilih dari datalist / string "Desa (Kecamatan)"
    const mParen = desaQuery.match(/^([^(]+)\(([^)]+)\)/);
    if (mParen) {
      const dName = mParen[1].trim().toLowerCase().replace(/^desa\s+/, '');
      match = this.locations.find(l => (l.desa || '').trim().toLowerCase() === dName);
      if (match) return match;
    }

    // 3. Match awalan (startsWith) jika panjang karakter >= 3
    if (clean.length >= 3) {
      match = this.locations.find(l => (l.desa || '').trim().toLowerCase().startsWith(clean));
      if (match) return match;
    }

    return null;
  }

  async fetchPersonel() {
    try {
      const res = await fetch('/api/personel');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.personel)) {
          this.personelMaster = data.personel;
          this.renderPersonelOptions();
        }
      }
    } catch (e) {
      console.warn('Gagal memuat master personel:', e);
    }
  }

  renderPersonelOptions() {
    if (!this.personelMaster || this.personelMaster.length === 0) return;
    this.initPersonelAutocomplete();
  }

  initPersonelAutocomplete() {
    const inputEl = document.getElementById('reportPersonelInput');
    if (!inputEl) return;
    if (this.personelAutocomplete) {
      this.personelAutocomplete.destroy();
    }

    this.personelAutocomplete = new Autocomplete({
      input: inputEl,
      minChars: 0,
      maxResults: 100,
      getItems: (query) => this.searchPersonel(query),
      renderItem: (name, query) => {
        return `
          <div class="autocomplete-item-main">
            <span><strong>${highlightText(name, query)}</strong></span>
          </div>
        `;
      },
      onSelect: (name) => {
        this.addPelaksana(name);
        inputEl.value = '';
        setTimeout(() => {
          inputEl.focus();
        }, 50);
      }
    });
  }

  searchPersonel(query) {
    if (!this.personelMaster || this.personelMaster.length === 0) return [];
    const q = (query || '').trim().toLowerCase();

    // KASUS 1: Query kosong (User klik kolom personel) -> Tampilkan SEMUA nama di dropdown
    if (!q) {
      return [...this.personelMaster];
    }

    // KASUS 2: Query terisi (Pencarian per-huruf mengerucut)
    const matches = [];
    for (const name of this.personelMaster) {
      const nameLower = name.toLowerCase();
      let score = 0;
      if (nameLower === q) {
        score = 100;
      } else if (nameLower.startsWith(q)) {
        score = 80;
      } else {
        const words = nameLower.split(/[\s,\.\-_]+/);
        if (words.some(w => w.startsWith(q))) {
          score = 60;
        } else if (nameLower.includes(q)) {
          score = 40;
        }
      }

      if (score > 0) {
        matches.push({ name, score });
      }
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });

    return matches.map(m => m.name);
  }

  onPersonelInput(event) {
    const val = (event.target.value || '').trim();
    if (!val) return;

    // Cek apakah nilai cocok persis dengan salah satu nama di master personel (indikasi user klik salah satu opsi dari auto-suggest)
    const exactMatch = this.personelMaster.find(n => n.toLowerCase() === val.toLowerCase());
    if (exactMatch) {
      this.addPelaksana(exactMatch);
      event.target.value = '';
      if (this.personelAutocomplete) {
        this.personelAutocomplete.close();
      }
      if (document.activeElement === event.target) {
        event.target.blur();
        setTimeout(() => {
          const inp = document.getElementById('reportPersonelInput');
          if (inp) inp.focus();
        }, 50);
      }
    }
  }

  onPersonelKeydown(event) {
    if (event.key === 'Enter') {
      if (this.personelAutocomplete && this.personelAutocomplete.isOpen && this.personelAutocomplete.items.length > 0) {
        return;
      }
      event.preventDefault();
      this.addPelaksanaFromInput();
    }
  }

  addPelaksanaFromInput() {
    if (this.lockedSegments.pelaksana) {
      this.showToast('Segmen Tim Pelaksana sedang terkunci. Buka kunci segmen terlebih dahulu.', 'warning');
      return;
    }
    const inp = document.getElementById('reportPersonelInput');
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) {
      return;
    }
    // Jika cocok dengan master personel (menggunakan pencarian cerdas prefix/nama), gunakan format master agar gelar rapi
    const matched = this.findBestMatch(val, this.personelMaster || []);
    const finalName = matched || this.normalizePersonelTitle(val);
    this.addPelaksana(finalName);
    inp.value = '';
    if (this.personelAutocomplete) {
      this.personelAutocomplete.close();
    }
  }

  normalizePersonelTitle(name) {
    if (!name) return '';
    let raw = String(name).trim();
    raw = raw.replace(/^\d+\.\s*/, '').trim();
    raw = raw.replace(/\bFX\b\.?/g, 'F.X.');

    const rules = [
      [/\bS\.?I\.?Kom\b\.?/gi, 'S.I.Kom.'],
      [/\bM\.?I\.?Kom\b\.?/gi, 'M.I.Kom.'],
      [/\bS\.?K\.?M\b\.?/gi, 'S.K.M.'],
      [/\bM\.?K\.?M\b\.?/gi, 'M.K.M.'],
      [/\bS\.?A\.?P\b\.?/gi, 'S.A.P.'],
      [/\bM\.?A\.?P\b\.?/gi, 'M.A.P.'],
      [/\bS\.?I\.?P\b\.?/gi, 'S.I.P.'],
      [/\bM\.?I\.?P\b\.?/gi, 'M.I.P.'],
      [/\bA\.?Md\.?Kom\b\.?/gi, 'A.Md.Kom.'],
      [/\bA\.?Md\.?T\b\.?/gi, 'A.Md.T.'],
      [/\bA\.?Md\b\.?/gi, 'A.Md.'],
      [/\bS\.?Ars\b\.?/gi, 'S.Ars.'],
      [/\bM\.?Ars\b\.?/gi, 'M.Ars.'],
      [/\bS\.?Kom\b\.?/gi, 'S.Kom.'],
      [/\bM\.?Kom\b\.?/gi, 'M.Kom.'],
      [/\bS\.?Pt\b\.?/gi, 'S.Pt.'],
      [/\bM\.?Pt\b\.?/gi, 'M.Pt.'],
      [/\bS\.?Pd\b\.?/gi, 'S.Pd.'],
      [/\bM\.?Pd\b\.?/gi, 'M.Pd.'],
      [/\bS\.?Si\b\.?/gi, 'S.Si.'],
      [/\bM\.?Si\b\.?/gi, 'M.Si.'],
      [/\bS\.?Sos\b\.?/gi, 'S.Sos.'],
      [/\bM\.?Sos\b\.?/gi, 'M.Sos.'],
      [/\bS\.?Ked\b\.?/gi, 'S.Ked.'],
      [/\bS\.?T\b\.?/gi, 'S.T.'],
      [/\bM\.?T\b\.?/gi, 'M.T.'],
      [/\bS\.?E\b\.?/gi, 'S.E.'],
      [/\bM\.?E\b\.?/gi, 'M.E.'],
      [/\bS\.?H\b\.?/gi, 'S.H.'],
      [/\bM\.?H\b\.?/gi, 'M.H.'],
      [/\bIr\b\.?/gi, 'Ir.'],
      [/\bDrs\b\.?/gi, 'Drs.'],
      [/\bDra\b\.?/gi, 'Dra.']
    ];

    for (const [pat, rep] of rules) {
      raw = raw.replace(pat, rep);
    }

    raw = raw.replace(/\s*,\s*/g, ', ');
    raw = raw.replace(/([^,])\s+(S\.[A-Za-z\.]+|M\.[A-Za-z\.]+|A\.Md\.[A-Za-z\.]*|A\.Md\.)/g, '$1, $2');
    raw = raw.replace(/(\b[A-Z][A-Za-z\.]*\.)\s+(S\.[A-Za-z\.]+|M\.[A-Za-z\.]+|A\.Md\.[A-Za-z\.]*|A\.Md\.)/g, '$1, $2');
    raw = raw.replace(/(?:,\s*)+/g, ', ');
    return raw.replace(/[ \t]{2,}/g, ' ').trim();
  }

  bindStaticEvents() {
    // Personel input Enter key
    const personelInput = document.getElementById('reportPersonelInput');
    if (personelInput) {
      personelInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (this.personelAutocomplete && this.personelAutocomplete.isOpen && this.personelAutocomplete.items.length > 0) {
            return;
          }
          e.preventDefault();
          this.addPelaksanaFromInput();
        }
      });
    }

    // Kabupaten change & Auto-Sync
    const kabInput = document.getElementById('reportKabupaten');
    if (kabInput) {
      kabInput.addEventListener('change', (e) => {
        this.setKabupatens(e.target.value);
      });
    }

    // Tahun change & Auto-Sync Tahun di Prefix SPT
    const tahunInput = document.getElementById('reportTahun');
    if (tahunInput) {
      tahunInput.addEventListener('input', (e) => {
        this.tahun = e.target.value.trim() || '2026';
        if (this.sptPrefix && /\/(202\d)\//.test(this.sptPrefix)) {
          this.sptPrefix = this.sptPrefix.replace(/\/(202\d)\//, `/${this.tahun}/`);
          this.saveStoredSptPrefix(this.sptPrefix);
          this.nomorSpt = this.sptSuffix ? `${this.sptPrefix}${this.sptSuffix}` : '';
          this.syncSptInputs();
        }
        this.updateDocumentTitlePreview();
        this.evaluateRealtimeAudit();
      });
    }

    // Inisialisasi awal nilai input SPT
    this.syncSptInputs();

    // Suffix (nomor urut) change & paste
    const sptSuffixInput = document.getElementById('reportNomorSptSuffix');
    if (sptSuffixInput) {
      sptSuffixInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (val.includes('/')) {
          this.handleSptFullPaste(val);
          return;
        }
        this.sptSuffix = val;
        this.nomorSpt = this.sptSuffix ? `${this.sptPrefix}${this.sptSuffix}` : '';
        const hiddenInp = document.getElementById('reportNomorSpt');
        if (hiddenInp) hiddenInp.value = this.nomorSpt;
        this.evaluateRealtimeAudit();
      });

      sptSuffixInput.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData)?.getData('text');
        if (text && text.includes('/')) {
          e.preventDefault();
          this.handleSptFullPaste(text);
        }
      });
    }

    // Prefix change & paste
    const sptPrefixInput = document.getElementById('reportNomorSptPrefix');
    if (sptPrefixInput) {
      sptPrefixInput.addEventListener('input', (e) => {
        this.sptPrefix = e.target.value;
        this.saveStoredSptPrefix(this.sptPrefix);
        this.nomorSpt = this.sptSuffix ? `${this.sptPrefix}${this.sptSuffix}` : '';
        const hiddenInp = document.getElementById('reportNomorSpt');
        if (hiddenInp) hiddenInp.value = this.nomorSpt;
        this.evaluateRealtimeAudit();
      });

      sptPrefixInput.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData)?.getData('text');
        if (text && text.includes('/')) {
          const lastSlash = text.trim().lastIndexOf('/');
          if (lastSlash !== -1 && lastSlash < text.trim().length - 1) {
            e.preventDefault();
            this.handleSptFullPaste(text);
          }
        }
      });
    }

    // Global Date / Time Picker Color Sync (Greyed-out placeholder bila kosong, putih saat terisi)
    document.addEventListener('input', (e) => {
      if (e.target && ['date', 'time', 'datetime-local'].includes(e.target.type)) {
        this.syncDateInputColor(e.target);
      }
    }, true);
    document.addEventListener('change', (e) => {
      if (e.target && ['date', 'time', 'datetime-local'].includes(e.target.type)) {
        this.syncDateInputColor(e.target);
      }
    }, true);
    this.syncAllDateInputColors();

    // Tanggal SPT change (Date Picker)
    const tglSptInput = document.getElementById('reportTanggalSpt');
    if (tglSptInput) {
      tglSptInput.addEventListener('change', (e) => {
        this.onTanggalSptChange(e.target.value);
      });
    }

    // Tanggal Laporan change (Date Picker)
    const tglLapInput = document.getElementById('reportTanggalLaporan');
    if (tglLapInput) {
      tglLapInput.addEventListener('change', (e) => {
        this.onTanggalLaporanChange(e.target.value);
      });
    }

    // Pelaksana Toggle Checkbox
    const chkPelaksana = document.getElementById('reportIncludePelaksana');
    if (chkPelaksana) {
      chkPelaksana.addEventListener('change', (e) => {
        this.includePelaksana = e.target.checked;
        const container = document.getElementById('reportPelaksanaContainer');
        if (container) {
          container.style.display = this.includePelaksana ? 'block' : 'none';
        }
        this.updateSummaryBadge();
      });
    }

    // File input & Drag & Drop for Photos
    const photoFileInput = document.getElementById('reportPhotoFileInput');
    if (photoFileInput) {
      photoFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.handlePhotoFiles(Array.from(e.target.files));
        }
        e.target.value = '';
      });
    }

    const dropZone = document.getElementById('reportPhotoDropZone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-active');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-active');
      });
      dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-active');
        if (!this.areAllDatesFilled()) {
          this.promptDatesRequired();
          return;
        }

        // 1. Ambil berkas dari dataTransfer.files
        let files = [];
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          files = Array.from(e.dataTransfer.files);
        }

        // 2. Fallback WhatsApp Web: jika files kosong (drag dari chat), ekstrak dari items
        if (files.length === 0 && e.dataTransfer.items && e.dataTransfer.items.length > 0) {
          for (const item of e.dataTransfer.items) {
            if (item.kind === 'file') {
              const f = item.getAsFile();
              if (f) files.push(f);
            }
          }
        }

        // 3. Fallback WhatsApp Web: ekstrak tag <img> dari payload text/html jika ada
        if (files.length === 0 && e.dataTransfer.types && e.dataTransfer.types.includes('text/html')) {
          try {
            const htmlData = e.dataTransfer.getData('text/html');
            const doc = new DOMParser().parseFromString(htmlData, 'text/html');
            const imgEl = doc.querySelector('img');
            if (imgEl && imgEl.src) {
              const res = await fetch(imgEl.src);
              const blob = await res.blob();
              files.push(new File([blob], 'whatsapp_photo.jpg', { type: blob.type || 'image/jpeg' }));
            }
          } catch (err) {
            console.warn('Gagal membaca gambar dari HTML drag WhatsApp Web:', err);
          }
        }

        if (files.length > 0) {
          await this.handlePhotoFiles(files);
        }
      });
    }

    // Dukungan Paste (Ctrl+V) langsung dari WhatsApp Web / Clipboard
    window.addEventListener('paste', async (e) => {
      const targetTag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
      if (targetTag === 'input' || targetTag === 'textarea' || e.target.isContentEditable) {
        return;
      }
      if (!e.clipboardData || !e.clipboardData.items) return;
      const pasteFiles = [];
      for (const item of e.clipboardData.items) {
        if (item.type && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) pasteFiles.push(f);
        }
      }
      if (pasteFiles.length > 0) {
        e.preventDefault();
        if (!this.areAllDatesFilled()) {
          this.promptDatesRequired();
          return;
        }
        await this.handlePhotoFiles(pasteFiles);
        this.showToast(`${pasteFiles.length} foto berhasil ditempel dari clipboard / WhatsApp.`, 'success');
      }
    });

    // Modal Date & Time Picker listeners for real-time watermark sync
    if (this.modalDatePicker) {
      this.modalDatePicker.addEventListener('change', () => this.onModalDateTimeChange());
      this.modalDatePicker.addEventListener('input', () => this.onModalDateTimeChange());
    }
    if (this.modalTimePicker) {
      this.modalTimePicker.addEventListener('change', () => this.onModalDateTimeChange());
      this.modalTimePicker.addEventListener('input', () => this.onModalDateTimeChange());
    }
    if (this.modalTimeStr) {
      this.modalTimeStr.addEventListener('input', () => this.onModalTimeStrInput());
      this.modalTimeStr.addEventListener('change', () => this.onModalTimeStrInput());
    }
    ['modalLat', 'modalLon', 'modalDusun', 'modalDesa', 'modalKecamatan', 'modalKabupaten', 'modalProvinsi'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => this.updateModalLivePreview());
      }
    });

    // Dismiss context menu and batch dropdown on outside pointerdown or scroll
    document.addEventListener('pointerdown', (e) => {
      const ctxMenu = document.getElementById('photoContextMenu');
      if (ctxMenu && ctxMenu.style.display !== 'none' && !ctxMenu.contains(e.target)) {
        this.closeContextMenu();
      }
      const batchDropdown = document.getElementById('reportBatchTimeDropdown');
      const batchWrap = document.getElementById('reportBatchTimeDropdownWrap');
      if (batchDropdown && batchDropdown.style.display !== 'none' && batchWrap && !batchWrap.contains(e.target)) {
        batchDropdown.style.display = 'none';
      }
    });

    window.addEventListener('scroll', () => {
      this.closeContextMenu();
    }, { passive: true });
  }

  // =========================================================
  // TANGGAL SPT & TANGGAL LAPORAN (DATE PICKER & AUTO H+1)
  // =========================================================
  syncDateInputColor(el) {
    if (!el) return;
    if (el.value && el.value.trim()) {
      el.classList.add('has-value');
    } else {
      el.classList.remove('has-value');
    }
  }

  syncAllDateInputColors() {
    document.querySelectorAll('input[type="date"], input[type="time"], input[type="datetime-local"]').forEach(el => {
      this.syncDateInputColor(el);
    });
  }

  setReportTanggalLaporan(isoDate, isManual = false) {
    this.tanggalLaporan = isoDate || '';
    const el = document.getElementById('reportTanggalLaporan');
    if (el && el.value !== this.tanggalLaporan) {
      el.value = this.tanggalLaporan;
    }
    this.syncDateInputColor(el);
    const tag = document.getElementById('reportTanggalLaporanTag');
    if (tag) {
      const isMultiDay = (this.tripMode === 'multiple') && !!(this.tripStartDate && this.tripEndDate && this.tripStartDate !== this.tripEndDate);
      const lastTripDate = (this.tripMode === 'multiple' ? this.tripEndDate : this.tripStartDate) || this.tripStartDate || '';
      const tglSptVal = (this.tanggalSpt || '').trim();
      const hPlus1End = lastTripDate ? getNextDayIso(lastTripDate) : '';
      const hPlus1Spt = tglSptVal ? getNextDayIso(tglSptVal) : '';

      if (isManual) {
        tag.textContent = '(Manual)';
        tag.style.color = '#f59e0b';
        tag.title = 'Tanggal laporan diubah manual';
      } else if (isMultiDay && this.tanggalLaporan === hPlus1End) {
        tag.textContent = '(H+1 Hari Akhir)';
        tag.style.color = '#38bdf8';
        tag.title = 'Otomatis dihitung H+1 hari kerja dari hari akhir dinas (melewati weekend & libur nasional)';
      } else if (this.tanggalLaporan === hPlus1Spt) {
        tag.textContent = '(H+1 SPT)';
        tag.style.color = '#38bdf8';
        tag.title = 'Otomatis dihitung H+1 hari kerja dari Tanggal SPT (melewati weekend & libur nasional)';
      } else {
        tag.textContent = isMultiDay ? '(H+1 Hari Akhir)' : '(H+1 SPT)';
        tag.style.color = '#38bdf8';
        tag.title = 'Otomatis dihitung H+1 hari kerja berikutnya (melewati weekend & libur nasional)';
      }
    }
    this.updateTanggalLaporanPreview();
    this.evaluateRealtimeAudit();
    this.updatePhotoUploadState();
  }

  updateTanggalLaporanPreview() {
    const previewEl = document.getElementById('reportTanggalLaporanPreview');
    if (previewEl) {
      previewEl.textContent = this.tanggalLaporan ? formatIndonesianDateOnly(this.tanggalLaporan) : '';
    }
  }

  onTanggalLaporanChange(val) {
    this.setReportTanggalLaporan(val, true);
  }

  getStoredSptPrefix() {
    let saved = '';
    try {
      saved = localStorage.getItem('pamsimas_spt_prefix') || '';
    } catch (_) {}
    if (saved && saved.trim()) {
      let pref = saved.trim();
      if (!pref.endsWith('/')) pref += '/';
      const yr = this.tahun || '2026';
      return pref.replace(/\/(202\d)\//, `/${yr}/`);
    }
    return `CK07/T/Bpbpk11/${this.tahun || '2026'}/`;
  }

  saveStoredSptPrefix(prefix) {
    if (!prefix || !prefix.trim()) return;
    try {
      localStorage.setItem('pamsimas_spt_prefix', prefix.trim());
    } catch (_) {}
  }

  setReportNomorSpt(fullVal) {
    const val = (fullVal || '').trim();
    if (!val) {
      this.sptSuffix = '';
      this.nomorSpt = '';
      this.syncSptInputs();
      this.evaluateRealtimeAudit();
      return;
    }

    const lastSlash = val.lastIndexOf('/');
    if (lastSlash !== -1) {
      this.sptPrefix = val.slice(0, lastSlash + 1);
      this.sptSuffix = val.slice(lastSlash + 1).trim();
      this.saveStoredSptPrefix(this.sptPrefix);
    } else {
      if (/^\d+$/.test(val)) {
        this.sptSuffix = val;
      } else {
        this.sptPrefix = val.endsWith('/') ? val : `${val}/`;
        this.sptSuffix = '';
        this.saveStoredSptPrefix(this.sptPrefix);
      }
    }

    this.nomorSpt = this.sptSuffix ? `${this.sptPrefix}${this.sptSuffix}` : '';
    this.syncSptInputs();
    this.evaluateRealtimeAudit();
  }

  syncSptInputs() {
    const prefInp = document.getElementById('reportNomorSptPrefix');
    if (prefInp && prefInp.value !== this.sptPrefix) {
      prefInp.value = this.sptPrefix;
    }
    const suffInp = document.getElementById('reportNomorSptSuffix');
    if (suffInp && suffInp.value !== this.sptSuffix) {
      suffInp.value = this.sptSuffix;
    }
    const hiddenInp = document.getElementById('reportNomorSpt');
    if (hiddenInp && hiddenInp.value !== this.nomorSpt) {
      hiddenInp.value = this.nomorSpt;
    }
  }

  handleSptFullPaste(pastedText) {
    const clean = (pastedText || '').trim();
    if (!clean) return;
    const lastSlash = clean.lastIndexOf('/');
    if (lastSlash !== -1) {
      this.sptPrefix = clean.slice(0, lastSlash + 1);
      this.sptSuffix = clean.slice(lastSlash + 1).trim();
      this.saveStoredSptPrefix(this.sptPrefix);
      this.nomorSpt = this.sptSuffix ? `${this.sptPrefix}${this.sptSuffix}` : '';
      this.syncSptInputs();
      this.evaluateRealtimeAudit();
      const suffInp = document.getElementById('reportNomorSptSuffix');
      if (suffInp) {
        suffInp.focus();
        suffInp.select();
      }
    }
  }

  setReportTanggalSpt(isoDate) {
    this.tanggalSpt = isoDate || '';
    const el = document.getElementById('reportTanggalSpt');
    if (el && el.value !== this.tanggalSpt) {
      el.value = this.tanggalSpt;
    }
    this.syncDateInputColor(el);
    this.updateTanggalSptPreview();
    this.evaluateRealtimeAudit();
  }

  updateTanggalSptPreview() {
    const previewEl = document.getElementById('reportTanggalSptPreview');
    if (previewEl) {
      if (this.tripMode === 'multiple' && this.tripStartDate && this.tripEndDate && this.tripStartDate !== this.tripEndDate) {
        const s = formatIndonesianDateOnly(this.tripStartDate);
        const e = formatIndonesianDateOnly(this.tripEndDate);
        previewEl.textContent = `${s} - ${e}`;
      } else if (this.tanggalSpt) {
        previewEl.textContent = formatIndonesianDateOnly(this.tanggalSpt);
      } else if (this.tripStartDate) {
        previewEl.textContent = formatIndonesianDateOnly(this.tripStartDate);
      } else {
        previewEl.textContent = '';
      }
    }
  }

  onTanggalSptChange(val) {
    this.setReportTanggalSpt(val);
    if (val) {
      // 1. Tanggal Mulai Kegiatan otomatis disamakan dengan Tanggal SPT
      const sInput = document.getElementById('reportTripStartDate');
      if (sInput && (!this.lockedSegments.administrasi)) {
        sInput.value = val;
        this.tripStartDate = val;
      }

      // 2. Tanggal Laporan: Jika dinas multi-hari diset H+1 hari akhir, jika 1 hari diset H+1 Tanggal SPT
      if (!this.lockedSegments.administrasi) {
        if (this.tripEndDate && this.tripEndDate !== val) {
          const hPlus1End = getNextDayIso(this.tripEndDate);
          if (hPlus1End) this.setReportTanggalLaporan(hPlus1End, false);
        } else {
          const hPlus1Spt = getNextDayIso(val);
          if (hPlus1Spt) this.setReportTanggalLaporan(hPlus1Spt, false);
        }
      }
      this.onTripDatesChange();
    } else {
      this.setReportTanggalLaporan('', false);
      const sInput = document.getElementById('reportTripStartDate');
      if (sInput && (!this.lockedSegments.administrasi)) {
        sInput.value = '';
        this.tripStartDate = '';
      }
      this.onTripDatesChange();
    }
    this.updatePhotoUploadState();
  }

  updateDocumentTitlePreview() {
    const el = document.getElementById('reportTitlePreview');
    if (el) {
      if (this.kabupatens.length === 1) {
        el.textContent = `Monev Pamsimas Kab. ${this.kabupatens[0]} (TA ${this.tahun})`;
      } else if (this.kabupatens.length === 2) {
        el.textContent = `Monev Pamsimas Kab. ${this.kabupatens[0]} & ${this.kabupatens[1]} (TA ${this.tahun})`;
      } else if (this.kabupatens.length > 2) {
        el.textContent = `Monev Pamsimas Kab. ${this.kabupatens[0]} dkk (${this.kabupatens.length} Kab.) (TA ${this.tahun})`;
      } else if (this.kabupaten && this.kabupaten.trim()) {
        const clean = this.kabupaten.replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
        el.textContent = `Monev Pamsimas Kab. ${clean} (TA ${this.tahun})`;
      } else {
        el.textContent = `Laporan Monev Pamsimas (TA ${this.tahun})`;
      }
    }
  }

  // =========================================================
  // PERJALANAN DINAS & RENTANG JAM MANAGEMENT
  // =========================================================
  setTripMode(mode, triggerChange = true) {
    this.tripMode = (mode === 'multiple') ? 'multiple' : 'single';
    const singleRadio = document.getElementById('tripModeSingle');
    const multiRadio = document.getElementById('tripModeMultiple');
    if (singleRadio) singleRadio.checked = (this.tripMode === 'single');
    if (multiRadio) multiRadio.checked = (this.tripMode === 'multiple');

    const endGroup = document.getElementById('reportTripEndDateGroup');
    const startLabel = document.getElementById('reportTripStartDateLabel');
    const eInput = document.getElementById('reportTripEndDate');

    if (this.tripMode === 'single') {
      if (endGroup) endGroup.style.display = 'none';
      if (startLabel) startLabel.textContent = 'Tanggal Dinas';
      if (eInput) eInput.value = '';
      this.tripEndDate = '';
    } else {
      if (endGroup) endGroup.style.display = 'block';
      if (startLabel) startLabel.textContent = 'Tgl Mulai Dinas';
      if (eInput && this.tripEndDate) {
        eInput.value = this.tripEndDate;
      }
    }

    if (triggerChange) {
      this.onTripDatesChange();
    } else {
      this.updateTripDurationBadge();
      this.updatePhotoUploadState();
    }
  }

  onTripModeChange(mode) {
    this.setTripMode(mode, true);
  }

  areAllDatesFilled() {
    const tglSpt = (this.tanggalSpt || document.getElementById('reportTanggalSpt')?.value || '').trim();
    const tglLap = (this.tanggalLaporan || document.getElementById('reportTanggalLaporan')?.value || '').trim();
    const sTrip = (this.tripStartDate || document.getElementById('reportTripStartDate')?.value || '').trim();

    if (!tglSpt || !tglLap || !sTrip) {
      return false;
    }

    if (this.tripMode === 'multiple') {
      const eTrip = (this.tripEndDate || document.getElementById('reportTripEndDate')?.value || '').trim();
      if (!eTrip) {
        return false;
      }
    }

    return true;
  }

  updatePhotoUploadState() {
    const dropZone = document.getElementById('reportPhotoDropZone');
    const fileInput = document.getElementById('reportPhotoFileInput');
    const noticeEl = document.getElementById('reportPhotoDisabledNotice');
    const noticeMsg = document.getElementById('reportPhotoDisabledMsg');
    const btnAuto = document.getElementById('btnAutoGenerateTimestamps');

    const isFilled = this.areAllDatesFilled();

    if (isFilled) {
      if (dropZone) {
        dropZone.classList.remove('dropzone-disabled');
        dropZone.title = 'Pilih atau seret berkas foto dokumentasi ke sini (Alt+U)';
      }
      if (fileInput) fileInput.disabled = false;
      if (btnAuto) {
        btnAuto.disabled = false;
        btnAuto.title = 'Terapkan Jadwal & Geotag ke Foto';
      }
      if (noticeEl) noticeEl.style.display = 'none';
    } else {
      if (dropZone) {
        dropZone.classList.add('dropzone-disabled');
        dropZone.title = 'Lengkapi semua tanggal dinas terlebih dahulu untuk membuka upload foto';
      }
      if (fileInput) fileInput.disabled = true;
      if (btnAuto) {
        btnAuto.disabled = true;
        btnAuto.title = 'Lengkapi tanggal dinas terlebih dahulu untuk menerapkan timestamp';
      }

      // Compute precise missing explanation
      const missing = [];
      const tglSpt = (this.tanggalSpt || document.getElementById('reportTanggalSpt')?.value || '').trim();
      const sTrip = (this.tripStartDate || document.getElementById('reportTripStartDate')?.value || '').trim();
      const tglLap = (this.tanggalLaporan || document.getElementById('reportTanggalLaporan')?.value || '').trim();

      if (!tglSpt) missing.push('Tanggal SPT');
      if (!sTrip) missing.push(this.tripMode === 'multiple' ? 'Tgl Mulai' : 'Tanggal Dinas');
      if (this.tripMode === 'multiple') {
        const eTrip = (this.tripEndDate || document.getElementById('reportTripEndDate')?.value || '').trim();
        if (!eTrip) missing.push('Tgl Selesai');
      }
      if (!tglLap) missing.push('Tanggal Laporan');

      if (noticeMsg) {
        const mStr = missing.length > 0 ? missing.join(' & ') : 'Tanggal';
        noticeMsg.textContent = `Upload foto terkunci: Lengkapi ${mStr} terlebih dahulu`;
      }
      if (noticeEl) noticeEl.style.display = 'flex';
    }
  }

  triggerPhotoUpload() {
    if (!this.areAllDatesFilled()) {
      this.promptDatesRequired();
      return;
    }
    const input = document.getElementById('reportPhotoFileInput');
    if (input && !input.disabled) input.click();
  }

  promptDatesRequired() {
    const missing = [];
    const tglSpt = (this.tanggalSpt || document.getElementById('reportTanggalSpt')?.value || '').trim();
    const sTrip = (this.tripStartDate || document.getElementById('reportTripStartDate')?.value || '').trim();
    const tglLap = (this.tanggalLaporan || document.getElementById('reportTanggalLaporan')?.value || '').trim();

    if (!tglSpt) missing.push('Tanggal SPT');
    if (!sTrip) missing.push(this.tripMode === 'multiple' ? 'Tgl Mulai Dinas' : 'Tanggal Dinas');
    if (this.tripMode === 'multiple') {
      const eTrip = (this.tripEndDate || document.getElementById('reportTripEndDate')?.value || '').trim();
      if (!eTrip) missing.push('Tgl Selesai Dinas');
    }
    if (!tglLap) missing.push('Tanggal Laporan');

    const warn = `Penguploadan foto belum dapat dilakukan! Harap lengkapi ${missing.join(', ')} terlebih dahulu.`;
    this.showToast(warn, 'warning');

    // Auto-focus first missing date field
    if (!tglSpt) {
      document.getElementById('reportTanggalSpt')?.focus();
    } else if (!sTrip) {
      document.getElementById('reportTripStartDate')?.focus();
    } else if (this.tripMode === 'multiple' && !this.tripEndDate) {
      document.getElementById('reportTripEndDate')?.focus();
    } else if (!tglLap) {
      document.getElementById('reportTanggalLaporan')?.focus();
    }
  }

  onTripDatesChange() {
    const sInput = document.getElementById('reportTripStartDate');
    const eInput = document.getElementById('reportTripEndDate');

    const sVal = (sInput?.value || '').trim();
    let eVal = (eInput?.value || '').trim();

    if (this.tripMode === 'single') {
      eVal = sVal;
      if (eInput) eInput.value = '';
      this.tripEndDate = '';
    } else {
      this.tripEndDate = eVal;
    }

    this.tripStartDate = sVal;
    this.syncDateInputColor(sInput);
    if (eInput) this.syncDateInputColor(eInput);

    // Otomatis sinkronkan Tanggal Laporan:
    // Jika dinas lebih dari satu hari maka tanggal laporan diset ke H+1 hari akhir,
    // jika 1 hari dinas maka diset ke H+1 Tanggal SPT (atau H+1 tanggal mulai)
    if (!this.lockedSegments.administrasi) {
      if (this.tripMode === 'multiple' && eVal && sVal && eVal !== sVal) {
        // Multi-hari dinas: H+1 hari akhir
        const hPlus1End = getNextDayIso(eVal);
        if (hPlus1End) {
          this.setReportTanggalLaporan(hPlus1End, false);
        }
      } else if (sVal || this.tanggalSpt) {
        // 1 hari dinas: H+1 Tanggal SPT
        const baseDate = this.tanggalSpt || sVal;
        const hPlus1Spt = getNextDayIso(baseDate);
        if (hPlus1Spt) {
          this.setReportTanggalLaporan(hPlus1Spt, false);
        }
      }
    }

    this.updateTanggalSptPreview();

    if (sVal && this.quickDate && !this.quickDate.value) {
      this.quickDate.value = sVal;
    }

    this.updateTripDurationBadge();
    this.updatePhotoUploadState();

    // Jika seluruh tanggal telah terisi dan segmen foto tidak terkunci,
    // otomatis sinkronkan jadwal timestamp merata melintasi rentang tanggal & kabupaten
    if (this.areAllDatesFilled() && this.photos.length > 0 && !this.lockedSegments.photos) {
      const validVillages = this.villages.filter(v => v.desa && v.desa.trim());
      if (validVillages.length > 0) {
        this.autoGenerateAllTimestamps(true);
      }
    }

    this.evaluateRealtimeAudit();
  }

  updateTripDurationBadge() {
    const badge = document.getElementById('reportTripDurationBadge');
    if (!badge) return;

    const sVal = (this.tripStartDate || '').trim();
    const eVal = (this.tripEndDate || '').trim();

    if (!sVal) {
      badge.textContent = 'Belum Diatur';
      badge.style.background = 'rgba(203,213,225,0.12)';
      badge.style.color = '#cbd5e1';
      return;
    }

    if (this.tripMode === 'single' || !eVal || eVal === sVal) {
      badge.textContent = `1 Hari (${formatIndonesianDateOnly(sVal)})`;
      badge.style.background = 'rgba(56,189,248,0.15)';
      badge.style.color = '#38bdf8';
    } else {
      const sParts = sVal.split('-').map(Number);
      const eParts = eVal.split('-').map(Number);
      const sDate = new Date(sParts[0], sParts[1] - 1, sParts[2]);
      const eDate = new Date(eParts[0], eParts[1] - 1, eParts[2]);
      const diffDays = Math.round((eDate - sDate) / (1000 * 60 * 60 * 24)) + 1;

      if (diffDays < 1) {
        badge.textContent = 'Tgl Selesai Kurang dari Tgl Mulai';
        badge.style.background = 'rgba(239,68,68,0.18)';
        badge.style.color = '#f87171';
      } else {
        badge.textContent = `${diffDays} Hari (${formatIndonesianDateOnly(sVal)} s/d ${formatIndonesianDateOnly(eVal)})`;
        badge.style.background = 'rgba(16,185,129,0.18)';
        badge.style.color = '#34d399';
      }
    }
  }

  randomizeWorkHours(showToast = true) {
    // Jam mulai: selalu di sekitaran jam 9-an (09:02 s/d 09:49, hindari kelipatan 5)
    const sH = 9;
    const sMPool = [];
    for (let m = 2; m <= 49; m++) {
      if (m % 5 !== 0) sMPool.push(m);
    }
    const sM = sMPool[Math.floor(Math.random() * sMPool.length)];
    const sSPool = [];
    for (let s = 11; s <= 58; s++) {
      if (s % 5 !== 0) sSPool.push(s);
    }
    const sS = sSPool[Math.floor(Math.random() * sSPool.length)];

    // Jam selesai: selalu di sekitaran jam 15 sampai 16-an (15:04 s/d 16:48, hindari kelipatan 5)
    const endHourPool = [15, 16];
    const eH = endHourPool[Math.floor(Math.random() * endHourPool.length)];
    const eMPool = [];
    const minEndM = eH === 15 ? 4 : 1;
    const maxEndM = eH === 15 ? 58 : 48;
    for (let m = minEndM; m <= maxEndM; m++) {
      if (m % 5 !== 0) eMPool.push(m);
    }
    const eM = eMPool[Math.floor(Math.random() * eMPool.length)];
    const eSPool = [];
    for (let s = 11; s <= 58; s++) {
      if (s % 5 !== 0) eSPool.push(s);
    }
    const eS = eSPool[Math.floor(Math.random() * eSPool.length)];

    const tStartStr = `${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}:${String(sS).padStart(2, '0')}`;
    const tEndStr = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}:${String(eS).padStart(2, '0')}`;

    const tStart = document.getElementById('reportTripStartTime');
    const tEnd = document.getElementById('reportTripEndTime');
    if (tStart) tStart.value = tStartStr;
    if (tEnd) tEnd.value = tEndStr;

    if (this.quickTime) this.quickTime.value = tStartStr;
    if (this.quickEndTime) this.quickEndTime.value = tEndStr;

    const stStart = document.getElementById('stStartTime');
    const stEnd = document.getElementById('stEndTime');
    if (stStart) stStart.value = tStartStr;
    if (stEnd) stEnd.value = tEndStr;

    this.tripStartTime = tStartStr;
    this.tripEndTime = tEndStr;

    if (showToast) {
      this.showToast(`Rentang jam kegiatan disesuaikan: ${tStartStr.slice(0, 5)} - ${tEndStr.slice(0, 5)} WIB.`, 'info');
    }
  }

  // =========================================================
  // ONE-CLICK AUTO GENERATE TIMESTAMPS FOR ALL PHOTOS
  // =========================================================
  autoGenerateAllTimestamps(silent = false) {
    if (this.lockedSegments.photos) {
      if (!silent) this.showToast('Segmen Foto sedang terkunci. Buka kunci segmen foto terlebih dahulu untuk memperbarui.', 'warning');
      return;
    }
    if (this.photos.length === 0) {
      if (!silent) this.showToast('Belum ada foto yang diunggah.', 'warning');
      return;
    }
    if (!this.areAllDatesFilled()) {
      if (!silent) this.promptDatesRequired();
      return;
    }

    const validVillages = this.villages.filter(v => v.desa && v.desa.trim());
    if (validVillages.length === 0) {
      if (!silent) this.showToast('Harap isi minimal satu nama desa terlebih dahulu.', 'warning');
      return;
    }

    // Pastikan setiap desa memiliki kabupaten yang terdefinisi rapi (tidak kosong/undefined)
    validVillages.forEach(v => {
      if (!v.kabupaten || !v.kabupaten.trim()) {
        v.kabupaten = this.getVillageKabupaten(v);
      }
    });

    const sInput = document.getElementById('reportTripStartDate');
    const eInput = document.getElementById('reportTripEndDate');
    const tStart = document.getElementById('reportTripStartTime');
    const tEnd = document.getElementById('reportTripEndTime');

    const startIso = sInput?.value || this.tripStartDate || this.getSurveyIsoDate();
    const endIso = (this.tripMode === 'multiple')
      ? (eInput?.value || this.tripEndDate || startIso)
      : startIso;
    const startTimeStr = tStart?.value || this.tripStartTime || '09:14:23';
    const endTimeStr = tEnd?.value || this.tripEndTime || '15:47:38';

    // 1. Generate jadwal merata multi-hari/sehari dan merata antar-desa
    const schedule = generateTripSchedule({
      startIso,
      endIso,
      startTimeStr,
      endTimeStr,
      villages: validVillages,
      photoCount: this.photos.length,
      tz: 'WIB',
      forceReschedule: true
    });

    if (!schedule || schedule.length === 0) {
      if (!silent) this.showToast('Gagal mengatur jadwal foto.', 'error');
      return;
    }

    // 2. Terapkan jadwal, koordinat acak terarah (5 meter s/d 2 KM sekitar desa), dan wilayah ke tiap foto
    this.photos.forEach((photo, idx) => {
      const item = schedule[idx] || schedule[0];
      const targetVillage = item.village || validVillages[0];

      photo.timeStr = item.timeStr;
      photo.time_str = item.timeStr;
      photo.desa = targetVillage.desa || photo.desa || '';
      photo.kecamatan = targetVillage.kecamatan || photo.kecamatan || '';
      const resolvedKab = (targetVillage.kabupaten || this.getVillageKabupaten(targetVillage) || this.kabupatens[0] || 'Magelang').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
      photo.kabupaten = resolvedKab;
      photo.provinsi = 'Jawa Tengah';

      if (item.isoDate) {
        targetVillage.survey_date = item.isoDate;
        targetVillage.tanggal = item.isoDate;
      }

      // Titik koordinat acak terarah di sekitaran daerah desa terkait (rentang 5 meter s/d 2 KM)
      const baseCoords = this.getVillageCoordinates(photo.desa, photo.kabupaten);
      const jittered = applyGpsJitter(baseCoords.lat, baseCoords.lon, 5, 2000);
      photo.lat = jittered.lat;
      photo.lon = jittered.lon;

      // Reset status original agar live stamp aktif
      photo.alreadyStamped = false;
      photo.is_original = false;
      photo.keep_original = false;
    });

    this.renderPhotos();
    this.updateBatchBar();
    this.updateSummaryBadge();
    this.evaluateRealtimeAudit();

    if (!silent) {
      this.showToast(`Waktu dan koordinat (radius 5m – 2km) berhasil diterapkan ke ${this.photos.length} foto.`, 'success');
    }
  }

  getVillageCoordinates(desaName, kabName) {
    const cleanDesa = (desaName || '').trim().toLowerCase().replace(/^(?:desa|kelurahan)\s+/i, '');
    const cleanKab = (kabName || this.kabupaten || '').trim().toLowerCase().replace(/^(?:kabupaten|kota)\s+/i, '');

    // 1. Cari pada master lokasi dari backend (data_lokasi.csv + KNOWN_COORDS)
    if (cleanDesa && this.locations && this.locations.length > 0) {
      const locMatch = this.locations.find(loc => {
        const dKey = (loc.desa || '').trim().toLowerCase();
        const kKey = (loc.kabupaten || '').trim().toLowerCase().replace(/^(?:kabupaten|kota)\s+/i, '');
        if (cleanKab) {
          return dKey === cleanDesa && (kKey === cleanKab || kKey.includes(cleanKab) || cleanKab.includes(kKey));
        }
        return dKey === cleanDesa;
      }) || this.locations.find(loc => (loc.desa || '').trim().toLowerCase() === cleanDesa);

      if (locMatch && locMatch.lat && locMatch.lon && locMatch.lat !== '-7.500000') {
        return { lat: String(locMatch.lat), lon: String(locMatch.lon) };
      }
    }

    // 2. Cari pada KNOWN_COORDS_FRONTEND
    if (cleanDesa && KNOWN_COORDS_FRONTEND && KNOWN_COORDS_FRONTEND[cleanDesa]) {
      return {
        lat: KNOWN_COORDS_FRONTEND[cleanDesa].lat,
        lon: KNOWN_COORDS_FRONTEND[cleanDesa].lon
      };
    }

    // 3. Fallback ke koordinat Kabupaten/Kota di Jawa Tengah
    if (cleanKab && KABUPATEN_COORDS_FRONTEND) {
      if (KABUPATEN_COORDS_FRONTEND[cleanKab]) {
        return {
          lat: KABUPATEN_COORDS_FRONTEND[cleanKab].lat,
          lon: KABUPATEN_COORDS_FRONTEND[cleanKab].lon
        };
      }
      for (const [k, coords] of Object.entries(KABUPATEN_COORDS_FRONTEND)) {
        if (cleanKab.includes(k) || k.includes(cleanKab)) {
          return { lat: coords.lat, lon: coords.lon };
        }
      }
    }

    return { lat: '-7.500000', lon: '110.500000' };
  }

  // =========================================================
  // PELAKSANA MONEV MANAGEMENT
  // =========================================================
  addPelaksana(name = '') {
    const cleanName = this.normalizePersonelTitle(name);
    if (cleanName && !this.pelaksanaList.includes(cleanName)) {
      this.pelaksanaList.push(cleanName);
    } else if (!cleanName) {
      this.pelaksanaList.push('');
    }
    this.renderPelaksanaList();
    this.updateSummaryBadge();
  }

  removePelaksana(index) {
    if (this.lockedSegments.pelaksana) {
      this.showToast('Segmen Tim Pelaksana sedang terkunci.', 'warning');
      return;
    }
    this.pelaksanaList.splice(index, 1);
    this.renderPelaksanaList();
    this.updateSummaryBadge();
  }

  clearPelaksana() {
    if (this.lockedSegments.pelaksana) {
      this.showToast('Segmen Tim Pelaksana sedang terkunci.', 'warning');
      return;
    }
    this.pelaksanaList = [];
    this.renderPelaksanaList();
    this.updateSummaryBadge();
  }

  renderPelaksanaList() {
    const listEl = document.getElementById('reportPelaksanaList');
    const countLabel = document.getElementById('reportPelaksanaCountLabel');
    if (countLabel) {
      const activeCount = this.pelaksanaList.filter(n => n && n.trim()).length;
      countLabel.textContent = `${activeCount} Pelaksana Terpilih`;
    }
    if (!listEl) return;

    if (this.pelaksanaList.length === 0) {
      listEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = this.pelaksanaList.map((nama, idx) => `
      <div class="pelaksana-row" style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <span class="font-mono" style="font-size:0.72rem; color:var(--text-dim); min-width:20px;">${idx + 1}.</span>
        <input type="text" class="form-input form-input-sm" value="${this.escapeHtml(nama)}" placeholder="Nama personel..." style="flex:1;" oninput="window.reportBuilder.onPelaksanaChange(${idx}, this.value)">
        <span class="badge font-mono" style="font-size:0.65rem; color:var(--text-muted);">${idx % 2 === 0 ? 'Ttd Kiri' : 'Ttd Kanan'}</span>
        <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="window.reportBuilder.removePelaksana(${idx})" title="Hapus pegawai ini" style="padding:4px 6px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('');
  }

  onPelaksanaChange(index, value) {
    this.pelaksanaList[index] = value;
  }

  // =========================================================
  // VILLAGES MANAGEMENT
  // =========================================================
  addVillage(data = null) {
    if (this.lockedSegments.villages) {
      this.showToast('Segmen Data Desa sedang terkunci.', 'warning');
      return;
    }
    const vId = 'v_' + Math.random().toString(36).substr(2, 9);
    const defKab = (this.kabupatens.length > 0)
      ? (this.kabupatens[this.villages.length % this.kabupatens.length] || this.kabupatens[0])
      : (this.kabupaten ? this.kabupaten.split(',')[0].trim() : 'Magelang');
    const v = data || {
      id: vId,
      desa: '',
      kecamatan: '',
      kabupaten: defKab,
      notes: '',
      narrative: ''
    };
    if (!v.id) v.id = vId;
    if (!v.kabupaten) v.kabupaten = defKab;
    this.villages.push(v);
    this.renderVillages();
    this.updateQuickVillageTargetOptions();
    this.updateSummaryBadge();
  }

  removeVillage(id) {
    if (this.lockedSegments.villages) {
      this.showToast('Segmen Data Desa sedang terkunci.', 'warning');
      return;
    }
    if (this.villages.length <= 1) {
      this.showToast('Dokumen minimal harus memuat satu desa.', 'warning');
      return;
    }
    if (this.villageAutocompletes && this.villageAutocompletes.has(id)) {
      this.villageAutocompletes.get(id).destroy();
      this.villageAutocompletes.delete(id);
    }
    this.villages = this.villages.filter(v => v.id !== id);
    this.renderVillages();
    this.updateQuickVillageTargetOptions();
    this.updateSummaryBadge();
  }

  renderVillages() {
    const container = document.getElementById('reportVillagesContainer');
    if (!container) return;

    if (this.villageAutocompletes) {
      this.villageAutocompletes.forEach(ac => ac.destroy());
      this.villageAutocompletes.clear();
    }

    const isMultiKab = this.kabupatens.length > 1;

    container.innerHTML = this.villages.map((v, idx) => {
      if (!v.kabupaten || !v.kabupaten.trim()) {
        v.kabupaten = this.getVillageKabupaten(v);
      }
      const vKab = this.getVillageKabupaten(v);
      return `
      <div class="village-card" id="card_${v.id}">
        <div class="village-card-header">
          <div class="village-header-left">
            <span class="village-index-badge">Desa #${idx + 1}</span>
            <span class="village-kab-badge" id="vKabBadge_${v.id}" style="${isMultiKab ? '' : 'display:none;'}">
              Kab. ${this.escapeHtml(vKab)}
            </span>
            <strong class="village-title" id="vTitle_${v.id}">
              ${v.desa ? 'Desa ' + this.escapeHtml(v.desa) : 'Desa Baru'}
              ${v.kecamatan ? ' (' + this.escapeHtml(v.kecamatan) + ')' : ''}
            </strong>
          </div>
          <div class="village-header-right">
            ${this.villages.length > 1 ? `
              <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="window.reportBuilder.removeVillage('${v.id}')" title="Hapus desa ini">
                Hapus
              </button>
            ` : ''}
          </div>
        </div>

        ${isMultiKab ? `
        <!-- Form 3 Kolom: Kabupaten > Nama Desa > Kecamatan (Autofill) -->
        <div class="form-row village-loc-grid village-loc-grid-3" style="margin-bottom:8px;">
          <div class="form-group" style="margin-bottom:0; position:relative;">
            <label class="form-label">Kabupaten</label>
            <select id="kab_${v.id}" class="form-select form-input-sm" onchange="window.reportBuilder.onVillageFieldChange('${v.id}', 'kabupaten', this.value)">
              ${this.renderVillageKabOptions(v.kabupaten)}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0; position:relative;">
            <label class="form-label">Nama Desa</label>
            <input type="text" id="desa_${v.id}" class="form-input form-input-sm" value="${this.escapeHtml(v.desa)}" placeholder="Nama desa..." autocomplete="off" oninput="window.reportBuilder.onVillageFieldChange('${v.id}', 'desa', this.value)">
          </div>
          <div class="form-group" style="margin-bottom:0; position:relative;">
            <label class="form-label">Kecamatan</label>
            <input type="text" id="kec_${v.id}" class="form-input form-input-sm" value="${this.escapeHtml(v.kecamatan)}" placeholder="Kecamatan (autofill)..." autocomplete="off" oninput="window.reportBuilder.onVillageFieldChange('${v.id}', 'kecamatan', this.value)">
          </div>
        </div>
        ` : `
        <!-- Form 2 Kolom: Nama Desa > Kecamatan (Autofill) -->
        <div class="form-row form-grid-2" style="margin-bottom:8px;">
          <div class="form-group" style="margin-bottom:0; position:relative;">
            <label class="form-label">Nama Desa</label>
            <input type="text" id="desa_${v.id}" class="form-input form-input-sm" value="${this.escapeHtml(v.desa)}" placeholder="Nama desa..." autocomplete="off" oninput="window.reportBuilder.onVillageFieldChange('${v.id}', 'desa', this.value)">
          </div>
          <div class="form-group" style="margin-bottom:0; position:relative;">
            <label class="form-label">Kecamatan</label>
            <input type="text" id="kec_${v.id}" class="form-input form-input-sm" value="${this.escapeHtml(v.kecamatan)}" placeholder="Kecamatan (autofill)..." autocomplete="off" oninput="window.reportBuilder.onVillageFieldChange('${v.id}', 'kecamatan', this.value)">
          </div>
        </div>
        `}

        <!-- Catatan Lapangan -->
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">
            Catatan Lapangan
          </label>
          <textarea class="form-textarea" rows="3" placeholder="Catatan lapangan..." oninput="window.reportBuilder.onVillageFieldChange('${v.id}', 'notes', this.value)">${this.escapeHtml(v.notes)}</textarea>
        </div>
      </div>
    `;
    }).join('');

    this.initVillageAutocompletes();
  }

  renderDesaSelectOptions(currentVillage) {
    if (!this.locations || this.locations.length === 0) {
      return '<option value="">-- Master lokasi sedang dimuat... --</option>';
    }

    const currentKab = (this.kabupaten || '').trim().toLowerCase().replace(/^(?:kabupaten|kota)\s*/i, '');
    const grouped = {};
    for (const loc of this.locations) {
      const kabClean = (loc.kabupaten || '').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
      if (!grouped[kabClean]) grouped[kabClean] = [];
      grouped[kabClean].push(loc);
    }

    let html = '<option value="">Pilih Desa (Kecamatan Otomatis Terisi)...</option>';

    const sortedKabKeys = Object.keys(grouped).sort((a, b) => {
      const aIsCurrent = currentKab && a.toLowerCase().includes(currentKab);
      const bIsCurrent = currentKab && b.toLowerCase().includes(currentKab);
      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;
      return a.localeCompare(b);
    });

    for (const kab of sortedKabKeys) {
      const list = grouped[kab].sort((a, b) => (a.desa || '').localeCompare(b.desa || ''));
      const isCurrentGroup = currentKab && kab.toLowerCase().includes(currentKab);
      const optgroupLabel = isCurrentGroup ? `Kabupaten ${kab} (Sesuai Laporan)` : `Kabupaten ${kab}`;

      html += `<optgroup label="${this.escapeHtml(optgroupLabel)}">`;
      for (const loc of list) {
        const val = `${loc.desa}|${loc.kecamatan}|${loc.kabupaten}`;
        const isSelected = (currentVillage.desa && currentVillage.desa.toLowerCase() === loc.desa.toLowerCase()) ? 'selected' : '';
        html += `<option value="${this.escapeHtml(val)}" ${isSelected}>Desa ${this.escapeHtml(loc.desa)} (Kec. ${this.escapeHtml(loc.kecamatan)})</option>`;
      }
      html += '</optgroup>';
    }

    return html;
  }

  onSelectDesaPreset(villageId, selectedValue) {
    if (!selectedValue) return;
    const parts = selectedValue.split('|');
    const desaName = parts[0] || '';
    const kecName = parts[1] || '';
    const kabName = parts[2] || '';

    const v = this.villages.find(item => item.id === villageId);
    if (!v) return;

    v.desa = desaName;
    v.kecamatan = kecName;
    v.narrative = ''; // Reset narrative agar otomatis diproses AI dengan lokasi baru
    const kabClean = kabName.replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
    if (kabClean) {
      v.kabupaten = kabClean;
      if (!this.kabupatens.some(k => k.toLowerCase() === kabClean.toLowerCase())) {
        this.addKabupaten(kabClean);
      }
    }

    // Update DOM inputs langsung tanpa merusak fokus atau form lain
    const inpDesa = document.getElementById(`desa_${v.id}`);
    const inpKec = document.getElementById(`kec_${v.id}`);
    const selKab = document.getElementById(`kab_${v.id}`);
    const vTitle = document.getElementById(`vTitle_${v.id}`);
    const vKabBadge = document.getElementById(`vKabBadge_${v.id}`);
    const notice = document.getElementById(`autofillNotice_${v.id}`);

    if (inpDesa) inpDesa.value = desaName;
    if (inpKec) inpKec.value = kecName;
    if (selKab && kabClean) selKab.value = kabClean;
    if (vKabBadge) {
      vKabBadge.textContent = `Kab. ${kabClean || this.getVillageKabupaten(v)}`;
      vKabBadge.style.display = this.kabupatens.length > 1 ? 'inline-block' : 'none';
    }
    if (vTitle) {
      vTitle.textContent = `Desa ${desaName}${kecName ? ' (' + kecName + ')' : ''}`;
    }

    this.updateQuickVillageTargetOptions();
    this.syncPhotosToVillages();
    this.updateSummaryBadge();
  }

  syncPhotosToVillages() {
    if (!this.photos || this.photos.length === 0) return;
    const validVillages = this.villages.filter(v => v.desa && v.desa.trim());
    if (validVillages.length === 0) return;

    if (this.areAllDatesFilled() && !this.lockedSegments.photos) {
      this.autoGenerateAllTimestamps(true);
      return;
    }

    const numVillages = validVillages.length;
    const basePerVillage = Math.floor(this.photos.length / numVillages);
    const remVillage = this.photos.length % numVillages;

    let pIdx = 0;
    for (let vIdx = 0; vIdx < numVillages; vIdx++) {
      const count = basePerVillage + (vIdx < remVillage ? 1 : 0);
      const targetV = validVillages[vIdx];
      for (let c = 0; c < count; c++) {
        if (pIdx < this.photos.length) {
          const p = this.photos[pIdx];
          p.desa = targetV.desa || p.desa || '';
          p.kecamatan = targetV.kecamatan || p.kecamatan || '';
          p.kabupaten = (targetV.kabupaten || this.getVillageKabupaten(targetV) || this.kabupatens[0] || 'Magelang').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
          const baseCoords = this.getVillageCoordinates(p.desa, p.kabupaten);
          const jittered = applyGpsJitter(baseCoords.lat, baseCoords.lon, 5, 2000);
          p.lat = jittered.lat;
          p.lon = jittered.lon;
          pIdx++;
        }
      }
    }
    this.renderPhotos();
  }

  onVillageFieldChange(id, field, value) {
    const v = this.villages.find(item => item.id === id);
    if (v) {
      v[field] = value;
      if (field === 'notes') {
        // Reset narrative agar backend selalu menyusun narasi profesional baru dari catatan lapangan ini
        v.narrative = '';
      }

      if (field === 'kabupaten') {
        const kabClean = (value || '').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
        v.kabupaten = kabClean;
        const vKabBadge = document.getElementById(`vKabBadge_${id}`);
        if (vKabBadge) vKabBadge.textContent = `Kab. ${kabClean}`;
        if (kabClean && !this.kabupatens.some(k => k.toLowerCase() === kabClean.toLowerCase())) {
          this.addKabupaten(kabClean);
        }
        this.updateQuickVillageTargetOptions();
        this.syncPhotosToVillages();
      }

      // AUTOFILL KECAMATAN & KABUPATEN OTOMATIS KETIKA DESA DIKETIK
      if (field === 'desa') {
        const match = this.getLocationMatch(value);
        if (match && match.kecamatan) {
          v.kecamatan = match.kecamatan;
          const inpKec = document.getElementById(`kec_${id}`);
          if (inpKec) inpKec.value = match.kecamatan;

          if (match.kabupaten) {
            const kabClean = match.kabupaten.replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
            v.kabupaten = kabClean;
            const selKab = document.getElementById(`kab_${id}`);
            if (selKab) selKab.value = kabClean;
            const vKabBadge = document.getElementById(`vKabBadge_${id}`);
            if (vKabBadge) {
              vKabBadge.textContent = `Kab. ${kabClean}`;
              vKabBadge.style.display = this.kabupatens.length > 1 ? 'inline-block' : 'none';
            }
            if (!this.kabupatens.some(k => k.toLowerCase() === kabClean.toLowerCase())) {
              this.addKabupaten(kabClean);
            }
          }
        }
      }

      if (field === 'desa' || field === 'kecamatan') {
        const titleEl = document.getElementById(`vTitle_${id}`);
        if (titleEl) {
          titleEl.textContent = `${v.desa ? 'Desa ' + v.desa : 'Desa Baru'}${v.kecamatan ? ' (' + v.kecamatan + ')' : ''}`;
        }
        this.updateQuickVillageTargetOptions();
        if (field === 'desa' && v.desa) {
          this.syncPhotosToVillages();
        }
      }
      this.updateSummaryBadge();
    }
  }

  onVillageFieldKeydown(event, id, field) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const val = (event.target.value || '').trim();
      if (!val || !this.locations || this.locations.length === 0) return;

      if (field === 'desa') {
        const matched = this.findBestMatch(val, this.locations, l => l.desa);
        if (matched) {
          this.onSelectDesaPreset(id, `${matched.desa}|${matched.kecamatan}|${matched.kabupaten}`);
          event.target.blur();
        }
      } else if (field === 'kecamatan') {
        const uniqueKecs = [...new Set(this.locations.map(l => l.kecamatan))];
        const matchedKec = this.findBestMatch(val, uniqueKecs);
        if (matchedKec) {
          event.target.value = matchedKec;
          this.onVillageFieldChange(id, 'kecamatan', matchedKec);
          event.target.blur();
        }
      }
    }
  }

  // =========================================================
  // ADVANCE SETTINGS PANEL CONTROLLER
  // =========================================================
  toggleQuickPanel() {
    if (!this.quickPanel) return;
    const isCollapsed = this.quickPanel.classList.toggle('collapsed');
    this.quickPanel.style.display = isCollapsed ? 'none' : 'block';
    if (this.quickToggleText) {
      this.quickToggleText.textContent = isCollapsed ? 'Pengaturan Lanjutan' : 'Tutup Pengaturan';
    }
  }

  updateQuickVillageTargetOptions() {
    if (!this.quickVillageTarget) return;
    const currentVal = this.quickVillageTarget.value || 'preserve';
    const validVillages = this.villages.filter(v => v.desa && v.desa.trim());

    let html = `<option value="preserve"${currentVal === 'preserve' ? ' selected' : ''}>Pertahankan Wilayah Tiap Foto</option>`;
    validVillages.forEach(v => {
      const dName = v.desa.trim();
      const kName = (v.kecamatan || '').trim();
      const vKab = (v.kabupaten || this.kabupatens[0] || '').trim();
      let label = `Desa ${dName}`;
      if (this.kabupatens.length > 1 && vKab) {
        label += ` (${kName ? kName + ', ' : ''}Kab. ${vKab})`;
      } else if (kName) {
        label += ` (${kName})`;
      }
      const isSel = currentVal.toLowerCase() === dName.toLowerCase() ? ' selected' : '';
      html += `<option value="${this.escapeHtml(dName)}"${isSel}>${this.escapeHtml(label)}</option>`;
    });

    this.quickVillageTarget.innerHTML = html;
  }

  onVillageTargetChange(val) {
    if (!val || val === 'preserve') return;
    const matched = this.villages.find(v => (v.desa || '').trim().toLowerCase() === val.toLowerCase());
    if (matched) {
      if (this.quickDesa) this.quickDesa.value = matched.desa || '';
      if (this.quickKec) this.quickKec.value = matched.kecamatan || '';
      const resolvedKab = (matched.kabupaten || this.getVillageKabupaten(matched) || this.kabupatens[0] || '').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
      if (this.quickKab) this.quickKab.value = resolvedKab;
      this.onQuickDesaInput(matched.desa);
      if (matched.survey_date && this.quickDate) {
        this.quickDate.value = matched.survey_date;
        this.syncDateInputColor(this.quickDate);
      }
    }
  }

  onQuickDesaInput(val) {
    const clean = (val || '').trim().toLowerCase().replace(/^desa\s+/, '');
    const match = this.getLocationMatch(val);
    if (match) {
      if (match.kecamatan && this.quickKec) {
        this.quickKec.value = match.kecamatan;
      }
      if (match.kabupaten && this.quickKab && (!this.quickKab.value || this.quickKab.value === 'Magelang')) {
        this.quickKab.value = match.kabupaten.replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
      }
    }
    if (clean && KNOWN_COORDS_FRONTEND && KNOWN_COORDS_FRONTEND[clean]) {
      const coords = KNOWN_COORDS_FRONTEND[clean];
      if (this.quickLat) this.quickLat.value = coords.lat;
      if (this.quickLon) this.quickLon.value = coords.lon;
    }
  }

  onTimeModeChange(mode) {
    if (this.quickEndDateGroup) {
      this.quickEndDateGroup.style.display = (mode === 'multiday') ? 'block' : 'none';
    }
    if (this.quickEndTimeGroup) {
      this.quickEndTimeGroup.style.display = (mode === 'multiday') ? 'block' : 'none';
    }
    const labelDate = document.getElementById('reportQuickDateLabel');
    if (labelDate) {
      labelDate.textContent = (mode === 'multiday') ? 'Tanggal Mulai' : 'Tanggal';
    }
  }

  applyQuickSetup(target = 'all') {
    if (this.photos.length === 0) {
      this.showToast('Belum ada foto dokumentasi yang diunggah.', 'warning');
      return;
    }

    let targetPhotos = [];
    if (target === 'selected') {
      if (this.selectedPhotoIds.size === 0) {
        this.showToast('Pilih minimal satu foto terlebih dahulu.', 'warning');
        return;
      }
      targetPhotos = this.photos.filter(p => this.selectedPhotoIds.has(p.id));
    } else {
      targetPhotos = this.photos;
    }

    const villageTarget = this.quickVillageTarget?.value || 'preserve';
    const desa = (this.quickDesa?.value || '').trim();
    const kec = (this.quickKec?.value || '').trim();
    const dusun = (this.quickDusun?.value || '').trim();
    const kab = (this.quickKab?.value || this.kabupaten || '').trim();
    const prov = (this.quickProv?.value || 'Jawa Tengah').trim();

    const isoDate = this.quickDate?.value || this.getSurveyIsoDate();
    const baseTime = this.quickTime?.value || '09:14:23';
    const timeMode = this.quickTimeMode?.value || 'sequential';

    const lat = (this.quickLat?.value || '').trim();
    const lon = (this.quickLon?.value || '').trim();
    const doGpsJitter = this.quickGpsJitter ? this.quickGpsJitter.checked : true;
    const fontScale = parseFloat(this.quickFontScale?.value || 1.0) || 1.0;
    const customAddr = (this.quickCustomAddress?.value || '').trim();
    const addrMode = this.quickAddressMode?.value || 'natural';

    let timestamps = [];
    if (timeMode === 'multiday') {
      const endIso = this.quickEndDate?.value || isoDate;
      const endTime = this.quickEndTime?.value || '15:00:00';
      timestamps = generateMultiDayTimeline(isoDate, endIso, targetPhotos.length, baseTime, endTime, 'WIB');
    } else if (timeMode === 'sequential') {
      timestamps = generateSequentialTimestamps(isoDate, baseTime, targetPhotos.length, 3, 7, 'WIB');
    } else if (timeMode === 'jitter') {
      const baseStr = formatIndonesianTimestamp(isoDate, baseTime, 'WIB');
      for (let i = 0; i < targetPhotos.length; i++) {
        timestamps.push(applyTimeJitter(baseStr, -45, 45));
      }
    } else {
      const exactStr = formatIndonesianTimestamp(isoDate, baseTime, 'WIB');
      for (let i = 0; i < targetPhotos.length; i++) {
        timestamps.push(exactStr);
      }
    }

    const shouldPreserveVillage = (villageTarget === 'preserve');

    targetPhotos.forEach((p, idx) => {
      if (!shouldPreserveVillage) {
        if (desa) p.desa = desa;
        if (kec) p.kecamatan = kec;
      }
      if (dusun) p.dusun = dusun;
      if (kab) p.kabupaten = kab.replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
      if (prov) p.provinsi = prov;
      if (customAddr) p.customAddress = customAddr;
      p.address_mode = addrMode;

      if (timestamps[idx]) {
        p.timeStr = timestamps[idx];
      }
      p.font_scale = fontScale;
      p.alreadyStamped = false;
      p.is_original = false;

      if (lat && lon) {
        if (doGpsJitter) {
          const jittered = applyGpsJitter(lat, lon, 5, 2000);
          p.lat = jittered.lat;
          p.lon = jittered.lon;
        } else {
          p.lat = lat;
          p.lon = lon;
        }
      } else if (doGpsJitter) {
        const baseCoords = this.getVillageCoordinates(p.desa || desa, p.kabupaten || kab);
        const jittered = applyGpsJitter(baseCoords.lat, baseCoords.lon, 5, 2000);
        p.lat = jittered.lat;
        p.lon = jittered.lon;
      }
    });

    this.renderPhotos();
    this.updateBatchBar();
    this.showToast(`Pengaturan berhasil diterapkan ke ${targetPhotos.length} foto.`, 'success');
  }

  // =========================================================
  // FIELD PHOTOS MANAGEMENT & CANVAS RENDERING
  // =========================================================
  getSurveyIsoDate() {
    if (this.tripStartDate) return this.tripStartDate;
    if (this.tanggalSpt) return this.tanggalSpt;
    if (this.tanggalLaporan) {
      const parsed = parseIndonesianTimestamp(this.tanggalLaporan);
      if (parsed && parsed.isoDate) return parsed.isoDate;
    }
    return '';
  }

  async getImage(photoItem) {
    if (this.imageCache.has(photoItem.id)) {
      return this.imageCache.get(photoItem.id);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        photoItem.imgObj = img;
        this.imageCache.set(photoItem.id, img);
        resolve(img);
      };
      img.onerror = (e) => reject(e);
      img.src = photoItem.dataUrl;
    });
  }

  async handlePhotoFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    if (!this.areAllDatesFilled()) {
      this.promptDatesRequired();
      return;
    }

    const validFiles = fileList.filter(f => {
      if (f.type && f.type.startsWith('image/')) return true;
      if (/\.(jpe?g|png|webp|bmp|gif|tiff?|heic|jfif)$/i.test(f.name || '')) return true;
      // Mendukung drag dari WhatsApp Web yang terkadang bertipe octet-stream atau tanpa ekstensi
      if (!f.type || f.type === 'application/octet-stream') return true;
      return false;
    });
    if (validFiles.length === 0) {
      this.showToast('Berkas yang dipilih bukan berkas foto/gambar yang didukung (JPG, PNG, WEBP).', 'warning');
      return;
    }

    const newlyLoadedPhotos = [];

    for (const file of validFiles) {
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (!dataUrl) continue;

      const imgInfo = await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve({ img, width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ img: null, width: 0, height: 0 });
        img.src = dataUrl;
      });

      if (!imgInfo.img || imgInfo.width <= 0 || imgInfo.height <= 0) {
        continue;
      }

      // Deteksi rasio foto: target rasio baku laporan Kementerian PU adalah landscape 4:3 (1.333)
      const targetRatio = 4 / 3;
      const w = imgInfo.width;
      const h = imgInfo.height;
      const srcRatio = w / h;
      const isMismatched = Math.abs(srcRatio - targetRatio) > 0.035;

      let cropW = w;
      let cropH = h;
      let cropX = 0;
      let cropY = 0;

      if (isMismatched) {
        if (srcRatio < targetRatio) {
          // Portrait / Square: crop vertikal simetris
          cropW = w;
          cropH = Math.round(w / targetRatio);
          cropY = Math.max(0, Math.round((h - cropH) / 2));
        } else {
          // Wide landscape: crop horizontal simetris
          cropH = h;
          cropW = Math.round(h * targetRatio);
          cropX = Math.max(0, Math.round((w - cropW) / 2));
        }
      }

      // Selalu konversi & normalisasi ke standard baseline RGB JPEG 4:3 via canvas
      // Ini menyelesaikan masalah foto WhatsApp Web (WebP/RGBA/transparansi/corrupt EXIF)
      // agar selalu menjadi JPEG murni yang 100% didukung Word tanpa 'cant be displayed'
      const normCanvas = document.createElement('canvas');
      normCanvas.width = cropW;
      normCanvas.height = cropH;
      const normCtx = normCanvas.getContext('2d');
      normCtx.fillStyle = '#ffffff';
      normCtx.fillRect(0, 0, cropW, cropH);
      normCtx.drawImage(imgInfo.img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      const cleanJpegUrl = normCanvas.toDataURL('image/jpeg', 0.95);

      const photoId = 'p_' + Math.random().toString(36).substr(2, 9);
      const firstVillage = this.villages[0] || {};
      const initDesa = firstVillage.desa || '';
      const initKec = firstVillage.kecamatan || '';
      const initKab = this.getVillageKabupaten(firstVillage);
      const baseCoords = this.getVillageCoordinates(initDesa, initKab);
      const initJittered = applyGpsJitter(baseCoords.lat, baseCoords.lon, 5, 2000);

      let cleanName = (file.name || 'foto_lapangan').replace(/\.[^.]+$/, '');
      if (!cleanName) cleanName = 'foto_lapangan';
      cleanName += '.jpg';

      const photoItem = {
        id: photoId,
        filename: cleanName,
        dataUrl: cleanJpegUrl,
        originalDataUrl: cleanJpegUrl,
        naturalWidth: cropW,
        naturalHeight: cropH,
        is_portrait: false,
        is_mismatched: false,
        timeStr: '',
        lat: initJittered.lat,
        lon: initJittered.lon,
        desa: initDesa,
        kecamatan: initKec,
        kabupaten: initKab,
        provinsi: 'Jawa Tengah',
        dusun: '',
        customAddress: '',
        address_mode: 'natural',
        font_scale: 1.0,
        alreadyStamped: false,
        is_original: false,
        is_cropped: isMismatched
      };

      this.photos.push(photoItem);
      newlyLoadedPhotos.push(photoItem);
    }

    // Otomatis jalankan generate timestamp merata jika tanggal & desa sudah terisi
    const validVillages = this.villages.filter(v => v.desa && v.desa.trim());
    if (this.areAllDatesFilled() && validVillages.length > 0) {
      this.autoGenerateAllTimestamps(true);
    } else {
      this.renderPhotos();
      this.updateSummaryBadge();
      this.updateBatchBar();
    }
    this.updateSummaryBadge();
    this.evaluateRealtimeAudit();
  }

  async normalizePhotoAspect(photoItem, targetRatio = 4 / 3) {
    if (!photoItem) return;
    try {
      const baseImg = new Image();
      baseImg.src = photoItem.dataUrl;
      await new Promise((res, rej) => {
        baseImg.onload = res;
        baseImg.onerror = rej;
      });

      const w = baseImg.naturalWidth;
      const h = baseImg.naturalHeight;
      if (!w || !h) return;

      const srcRatio = w / h;
      if (Math.abs(srcRatio - targetRatio) < 0.02) {
        photoItem.is_portrait = false;
        photoItem.is_mismatched = false;
        return;
      }

      let cropW, cropH, cropX, cropY;
      if (srcRatio < targetRatio) {
        // Foto portrait/tegak: potong atas dan bawah secara simetris
        cropW = w;
        cropH = Math.round(w / targetRatio);
        cropX = 0;
        cropY = Math.max(0, Math.round((h - cropH) / 2));
      } else {
        // Foto lebih lebar (wide landscape): potong kiri dan kanan secara simetris
        cropH = h;
        cropW = Math.round(h * targetRatio);
        cropY = 0;
        cropX = Math.max(0, Math.round((w - cropW) / 2));
      }

      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(baseImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      if (!photoItem.originalDataUrl) {
        photoItem.originalDataUrl = photoItem.dataUrl;
      }
      photoItem.dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      photoItem.naturalWidth = cropW;
      photoItem.naturalHeight = cropH;
      photoItem.is_cropped = true;
      photoItem.is_portrait = false;
      photoItem.is_mismatched = false;
      this.imageCache.delete(photoItem.id);
    } catch (e) {
      console.warn('Gagal menormalkan aspek rasio:', e);
    }
  }

  async normalizeSinglePhotoAspect(photoId) {
    const p = this.photos.find(item => item.id === photoId);
    if (!p) return;
    await this.normalizePhotoAspect(p, 4 / 3);
    this.renderPhotos();
  }

  resetSinglePhotoAspect(photoId) {
    const p = this.photos.find(item => item.id === photoId);
    if (!p || !p.originalDataUrl) return;
    p.dataUrl = p.originalDataUrl;
    p.is_cropped = false;
    const img = new Image();
    img.onload = () => {
      p.is_portrait = img.naturalHeight > img.naturalWidth * 1.05;
      this.imageCache.delete(p.id);
      this.renderPhotos();
    };
    img.src = p.dataUrl;
  }

  toggleSelectAll(checked) {
    if (checked) {
      this.photos.forEach(p => this.selectedPhotoIds.add(p.id));
    } else {
      this.selectedPhotoIds.clear();
      this.lastSelectedPhotoIndex = null;
    }
    this.renderPhotosSelectionState();
    this.updateBatchBar();
  }

  toggleSelectPhoto(photoId, idx) {
    if (this.selectedPhotoIds.has(photoId)) {
      this.selectedPhotoIds.delete(photoId);
    } else {
      this.selectedPhotoIds.add(photoId);
      this.lastSelectedPhotoIndex = idx;
    }
    this.renderPhotosSelectionState();
    this.updateBatchBar();
  }

  selectRange(targetIndex, additive = false) {
    if (!this.photos || this.photos.length === 0) return;
    const lastIdx = (this.lastSelectedPhotoIndex !== null && this.lastSelectedPhotoIndex >= 0 && this.lastSelectedPhotoIndex < this.photos.length)
      ? this.lastSelectedPhotoIndex
      : 0;

    const start = Math.min(lastIdx, targetIndex);
    const end = Math.max(lastIdx, targetIndex);

    if (!additive) {
      this.selectedPhotoIds.clear();
    }

    for (let i = start; i <= end; i++) {
      if (this.photos[i]) {
        this.selectedPhotoIds.add(this.photos[i].id);
      }
    }

    this.lastSelectedPhotoIndex = targetIndex;
    this.renderPhotosSelectionState();
    this.updateBatchBar();
  }

  handleCheckboxClick(e, photoId, idx) {
    e.stopPropagation();
    if (e.shiftKey && this.lastSelectedPhotoIndex !== null) {
      e.preventDefault();
      this.selectRange(idx, true);
      return;
    }
    this.toggleSelectPhoto(photoId, idx);
  }

  handleCheckboxLabelClick(e, photoId, idx) {
    e.stopPropagation();
    if (e.target && e.target.tagName === 'INPUT') {
      return;
    }
    if (e.shiftKey && this.lastSelectedPhotoIndex !== null) {
      e.preventDefault();
      this.selectRange(idx, true);
      return;
    }
    this.toggleSelectPhoto(photoId, idx);
  }

  handleCardMediaClick(e, photoId, idx) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      this.toggleSelectPhoto(photoId, idx);
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      this.selectRange(idx, false);
      return;
    }
    // Normal click: open modal
    this.lastSelectedPhotoIndex = idx;
    this.openModal(photoId);
  }

  handleCardClick(e, photoId, idx) {
    // Abaikan jika klik terjadi pada tombol aksi, input, atau link
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('label') || e.target.closest('a')) {
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.toggleSelectPhoto(photoId, idx);
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      this.selectRange(idx, false);
      return;
    }
    // Klik biasa di luar tombol: seleksi eksklusif 1 foto ini
    this.selectedPhotoIds.clear();
    this.selectedPhotoIds.add(photoId);
    this.lastSelectedPhotoIndex = idx;
    this.renderPhotosSelectionState();
    this.updateBatchBar();
  }

  handleCardContextMenu(e, photoId, idx) {
    e.preventDefault();
    e.stopPropagation();

    // Jika foto yang diklik kanan belum terseleksi, seleksi hanya foto ini
    if (!this.selectedPhotoIds.has(photoId)) {
      this.selectedPhotoIds.clear();
      this.selectedPhotoIds.add(photoId);
      this.lastSelectedPhotoIndex = idx;
      this.renderPhotosSelectionState();
      this.updateBatchBar();
    }

    this.openPhotoContextMenu(e.clientX, e.clientY, photoId);
  }

  closeContextMenu() {
    const menu = document.getElementById('photoContextMenu');
    if (menu) {
      menu.style.display = 'none';
      menu.classList.remove('active');
    }
  }

  openPhotoContextMenu(clientX, clientY, photoId) {
    let menu = document.getElementById('photoContextMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'photoContextMenu';
      menu.className = 'photo-context-menu';
      document.body.appendChild(menu);
    }

    const selCount = this.selectedPhotoIds.size;
    const tStartRaw = (document.getElementById('reportTripStartTime')?.value || this.tripStartTime || '08:30').slice(0, 5);

    menu.innerHTML = `
      <div class="ctx-header">
        <span>Terapkan Waktu</span>
        <span class="badge badge-accent" style="font-size:0.65rem; padding:1px 5px;">${selCount} Foto</span>
      </div>
      <div class="ctx-item" onclick="window.reportBuilder.applyTimeCategoryToSelected('pagi')">
        <div class="ctx-item-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2.2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          <span>Pagi</span>
        </div>
        <span class="ctx-time-range">${tStartRaw} – 11:00</span>
      </div>
      <div class="ctx-item" onclick="window.reportBuilder.applyTimeCategoryToSelected('siang')">
        <div class="ctx-item-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
          <span>Siang</span>
        </div>
        <span class="ctx-time-range">11:00 – 14:00</span>
      </div>
      <div class="ctx-item" onclick="window.reportBuilder.applyTimeCategoryToSelected('sore')">
        <div class="ctx-item-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2.2"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/></svg>
          <span>Sore</span>
        </div>
        <span class="ctx-time-range">14:00 – 18:00</span>
      </div>
      <div class="ctx-item" onclick="window.reportBuilder.applyTimeCategoryToSelected('malam')">
        <div class="ctx-item-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <span>Malam</span>
        </div>
        <span class="ctx-time-range">18:00 – 19:00</span>
      </div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" onclick="window.reportBuilder.closeContextMenu(); window.reportBuilder.openModal('${photoId}')">
        <div class="ctx-item-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span>Edit Foto Ini</span>
        </div>
      </div>
      <div class="ctx-item" onclick="window.reportBuilder.closeContextMenu(); window.openPhotoLightbox('${photoId}', 'report')">
        <div class="ctx-item-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>Pratinjau Layar Penuh</span>
        </div>
      </div>
      <div class="ctx-divider"></div>
      <div class="ctx-item text-danger" onclick="window.reportBuilder.closeContextMenu(); window.reportBuilder.deleteSelectedPhotos()">
        <div class="ctx-item-left" style="color:#f87171;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>Hapus Seleksi (${selCount} Foto)</span>
        </div>
      </div>
    `;

    menu.style.display = 'flex';
    menu.classList.add('active');

    const mWidth = menu.offsetWidth || 230;
    const mHeight = menu.offsetHeight || 290;
    let posX = clientX;
    let posY = clientY;

    if (posX + mWidth > window.innerWidth - 10) {
      posX = window.innerWidth - mWidth - 10;
    }
    if (posY + mHeight > window.innerHeight - 10) {
      posY = window.innerHeight - mHeight - 10;
    }
    if (posX < 10) posX = 10;
    if (posY < 10) posY = 10;

    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
  }

  toggleBatchTimeDropdown(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('reportBatchTimeDropdown');
    if (!dropdown) return;
    const isShowing = dropdown.style.display === 'flex';
    if (isShowing) {
      dropdown.style.display = 'none';
      return;
    }

    const selCount = this.selectedPhotoIds.size;
    const countBadge = document.getElementById('batchDropdownCountBadge');
    if (countBadge) countBadge.textContent = `${selCount} Foto`;

    const tStartRaw = (document.getElementById('reportTripStartTime')?.value || this.tripStartTime || '08:30').slice(0, 5);
    const pagiRange = document.getElementById('batchRangePagi');
    if (pagiRange) pagiRange.textContent = `${tStartRaw} – 11:00`;

    dropdown.style.display = 'flex';
  }

  applyTimeCategoryToSelected(category) {
    this.closeContextMenu();
    const batchDropdown = document.getElementById('reportBatchTimeDropdown');
    if (batchDropdown) batchDropdown.style.display = 'none';

    if (this.selectedPhotoIds.size === 0) {
      this.showToast('Pilih minimal satu foto terlebih dahulu untuk menerapkan waktu.', 'warning');
      return;
    }

    const targetPhotos = this.photos.filter(p => this.selectedPhotoIds.has(p.id));
    if (targetPhotos.length === 0) return;

    const N = targetPhotos.length;

    let startSec, endSec, categoryName;

    let tStartInput = (document.getElementById('reportTripStartTime')?.value || this.tripStartTime || '08:30:00').trim();
    let userStartSec = 8 * 3600 + 30 * 60; // 08:30:00
    if (tStartInput) {
      const parts = tStartInput.split(':').map(Number);
      if (!isNaN(parts[0])) {
        userStartSec = parts[0] * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
      }
    }

    const SEC_11_AM = 11 * 3600; // 39600
    const SEC_14_PM = 14 * 3600; // 50400
    const SEC_18_PM = 18 * 3600; // 64800 (jam 18:00 saat langit mulai gelap)
    const SEC_19_PM = 19 * 3600; // 68400

    switch (category) {
      case 'pagi': {
        categoryName = 'Pagi';
        if (userStartSec >= SEC_11_AM - 120) {
          startSec = 8 * 3600 + 30 * 60;
        } else {
          startSec = Math.max(6 * 3600, userStartSec);
        }
        endSec = SEC_11_AM - 15; // 10:59:45 (strictly before 11:00)
        break;
      }
      case 'siang': {
        categoryName = 'Siang';
        startSec = SEC_11_AM + 15; // 11:00:15 (strictly >= 11:00)
        endSec = SEC_14_PM - 15;   // 13:59:45 (strictly before 14:00)
        break;
      }
      case 'sore': {
        categoryName = 'Sore';
        startSec = SEC_14_PM + 15; // 14:00:15 (strictly >= 14:00)
        endSec = SEC_18_PM - 15;   // 17:59:45 (strictly before 18:00)
        break;
      }
      case 'malam': {
        categoryName = 'Malam';
        startSec = SEC_18_PM + 15; // 18:00:15 (ketika langit sudah gelap)
        endSec = SEC_19_PM;        // 19:00:00 (strictly <= 19:00)
        break;
      }
      default:
        return;
    }

    const assignedTimes = this.generateNonCollidingTimes(startSec, endSec, N);

    targetPhotos.forEach((photo, idx) => {
      const time24 = assignedTimes[idx];
      const currentTs = photo.timeStr || photo.time_str || '';
      const parsed = parseIndonesianTimestamp(currentTs);
      const isoDate = parsed.isoDate || this.getSurveyIsoDate() || new Date().toISOString().slice(0, 10);
      const tz = parsed.timezone || 'WIB';

      const formatted = formatIndonesianTimestamp(isoDate, time24, tz);
      photo.timeStr = formatted;
      photo.time_str = formatted;
    });

    this.renderPhotos();
    if (typeof this.evaluateRealtimeAudit === 'function') {
      this.evaluateRealtimeAudit();
    }

    const firstTimeHms = assignedTimes[0].slice(0, 5);
    const lastTimeHms = assignedTimes[N - 1].slice(0, 5);
    const rangeSummary = N > 1 ? ` (${firstTimeHms} – ${lastTimeHms} WIB)` : ` (${firstTimeHms} WIB)`;
    this.showToast(`Berhasil menerapkan waktu ${categoryName}${rangeSummary} untuk ${N} foto terpilih.`, 'success');
  }

  generateNonCollidingTimes(startSec, endSec, N) {
    if (N <= 0) return [];
    const span = Math.max(30, endSec - startSec);

    if (N === 1) {
      // Natural mid-window placement with realistic minute & second jitter
      const midSec = startSec + Math.round(span * (0.28 + Math.random() * 0.44));
      return [this.secondsToHms(midSec)];
    }

    // Generate random weights to model natural surveyor inspection pacing
    const weights = [];
    for (let i = 0; i < N; i++) {
      weights.push(0.6 + Math.random() * 1.4);
    }
    const sumWeights = weights.reduce((a, b) => a + b, 0);

    const marginStart = Math.min(60, Math.floor(span * 0.04));
    const marginEnd = Math.min(60, Math.floor(span * 0.04));
    const usableSpan = span - marginStart - marginEnd;

    let currentSec = startSec + marginStart;
    const times = [];

    for (let i = 0; i < N; i++) {
      const step = Math.max(15, Math.round((weights[i] / sumWeights) * usableSpan));
      currentSec += step;
      if (i > 0 && currentSec <= times[i - 1].rawSec) {
        currentSec = times[i - 1].rawSec + Math.floor(15 + Math.random() * 25);
      }
      const maxAllowed = endSec - (N - 1 - i) * 10;
      const finalSec = Math.min(maxAllowed, currentSec);
      times.push({ rawSec: finalSec, hms: this.secondsToHms(finalSec) });
    }

    return times.map(t => t.hms);
  }

  secondsToHms(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  renderPhotosSelectionState() {
    this.photos.forEach(p => {
      const card = document.getElementById(`reportPhotoCard_${p.id}`);
      const chk = document.getElementById(`reportChk_${p.id}`);
      const isSel = this.selectedPhotoIds.has(p.id);
      if (card) card.classList.toggle('selected', isSel);
      if (chk) chk.checked = isSel;
    });
  }

  updateBatchBar() {
    const selCount = this.selectedPhotoIds.size;
    const totalCount = this.photos.length;

    const badge = document.getElementById('reportSelectedCountBadge');
    if (badge) badge.textContent = `${selCount} Dipilih`;

    const allChk = document.getElementById('reportSelectAllCheckbox');
    if (allChk) {
      allChk.checked = (totalCount > 0 && selCount === totalCount);
      allChk.indeterminate = (selCount > 0 && selCount < totalCount);
    }

    const delBtn = document.getElementById('btnReportDeleteSelected');
    const delCount = document.getElementById('reportDeleteSelectedCount');
    if (delBtn) delBtn.style.display = selCount > 0 ? 'inline-flex' : 'none';
    if (delCount) delCount.textContent = selCount;

    const applyAllCount = document.getElementById('reportQuickApplyAllCount');
    if (applyAllCount) applyAllCount.textContent = totalCount;

    const applySelCount = document.getElementById('reportQuickSelectedCount');
    if (applySelCount) applySelCount.textContent = selCount;
  }

  deleteSelectedPhotos() {
    if (this.selectedPhotoIds.size === 0) return;
    const count = this.selectedPhotoIds.size;
    if (!confirm(`Hapus ${count} foto yang dipilih dari laporan?`)) return;

    this.photos = this.photos.filter(p => !this.selectedPhotoIds.has(p.id));
    this.selectedPhotoIds.clear();
    this.lastSelectedPhotoIndex = null;
    this.renderPhotos();
    this.updateSummaryBadge();
    this.showToast(`${count} foto berhasil dihapus.`, 'info');
  }

  batchSetKeepOriginal(keep) {
    const targets = this.selectedPhotoIds.size > 0
      ? this.photos.filter(p => this.selectedPhotoIds.has(p.id))
      : this.photos;

    if (targets.length === 0) return;
    targets.forEach(p => {
      p.alreadyStamped = keep;
      p.is_original = keep;
      p.keep_original = keep;
      if (keep && p.originalDataUrl) {
        // Pulihkan unedited jika diset original
        p.dataUrl = p.originalDataUrl;
        p.is_cropped = false;
        this.imageCache.delete(p.id);
      }
    });
    this.renderPhotos();
    this.updateSummaryBadge();
  }

  toggleSingleKeepOriginal(photoId) {
    const p = this.photos.find(item => item.id === photoId);
    if (!p) return;
    const newState = !p.is_original;
    p.alreadyStamped = newState;
    p.is_original = newState;
    p.keep_original = newState;
    if (newState && p.originalDataUrl) {
      p.dataUrl = p.originalDataUrl;
      p.is_cropped = false;
      this.imageCache.delete(p.id);
    }
    this.renderPhotos();
    this.updateSummaryBadge();
  }

  jitterPhotosTime() {
    if (this.photos.length === 0) return;
    const targets = this.selectedPhotoIds.size > 0
      ? this.photos.filter(p => this.selectedPhotoIds.has(p.id))
      : this.photos;

    targets.forEach((p) => {
      if (p.timeStr) {
        p.timeStr = applyTimeJitter(p.timeStr, -35, 45);
      }
    });
    this.renderPhotos();
    this.updateSummaryBadge();
  }

  jitterPhotosGps() {
    if (this.photos.length === 0) return;
    const targets = this.selectedPhotoIds.size > 0
      ? this.photos.filter(p => this.selectedPhotoIds.has(p.id))
      : this.photos;

    targets.forEach((p) => {
      const baseCoords = this.getVillageCoordinates(p.desa, p.kabupaten);
      const jittered = applyGpsJitter(baseCoords.lat, baseCoords.lon, 5, 2000);
      p.lat = jittered.lat;
      p.lon = jittered.lon;
    });
    this.renderPhotos();
    this.updateSummaryBadge();
  }

  removePhoto(photoId) {
    this.photos = this.photos.filter(p => p.id !== photoId);
    this.selectedPhotoIds.delete(photoId);
    this.renderPhotos();
    this.updateSummaryBadge();
  }

  clearPhotos() {
    if (this.photos.length === 0) return;
    if (!confirm('Hapus seluruh foto dari tab pembuat laporan?')) return;
    this.photos = [];
    this.selectedPhotoIds.clear();
    this.renderPhotos();
    this.updateSummaryBadge();
  }

  setPhotoViewMode(mode) {
    this.photoViewMode = (mode === 'grid') ? 'grid' : 'table';
    const btnTable = document.getElementById('btnViewModeTable');
    const btnGrid = document.getElementById('btnViewModeGrid');
    const tableWrap = document.getElementById('reportPhotosTableView');
    const gridWrap = document.getElementById('reportPhotosGrid');

    if (btnTable) {
      btnTable.className = (this.photoViewMode === 'table') ? 'btn btn-xs btn-active' : 'btn btn-xs btn-ghost';
    }
    if (btnGrid) {
      btnGrid.className = (this.photoViewMode === 'grid') ? 'btn btn-xs btn-active' : 'btn btn-xs btn-ghost';
    }
    if (tableWrap) {
      tableWrap.style.display = (this.photoViewMode === 'table') ? 'block' : 'none';
    }
    if (gridWrap) {
      gridWrap.style.display = (this.photoViewMode === 'grid') ? 'grid' : 'none';
    }
    this.renderPhotos();
  }

  handlePhotoDragStart(event, photoId, index) {
    this.draggedPhotoIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
    const target = event.currentTarget;
    if (target) {
      setTimeout(() => target.classList.add('dragging-photo'), 0);
    }
  }

  handlePhotoDragOver(event, index) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  handlePhotoDragEnter(event, index) {
    event.preventDefault();
    const cell = event.currentTarget;
    if (cell && this.draggedPhotoIndex !== null && this.draggedPhotoIndex !== index) {
      cell.classList.add('drag-target-over');
    }
  }

  handlePhotoDragLeave(event, index) {
    const cell = event.currentTarget;
    if (cell) {
      cell.classList.remove('drag-target-over');
    }
  }

  handlePhotoDrop(event, targetIndex) {
    event.preventDefault();
    const fromIndex = (this.draggedPhotoIndex !== null)
      ? this.draggedPhotoIndex
      : parseInt(event.dataTransfer.getData('text/plain'), 10);

    this.cleanupDragClasses();

    if (!isNaN(fromIndex) && fromIndex !== null && fromIndex !== targetIndex) {
      this.reorderPhotos(fromIndex, targetIndex);
    }
    this.draggedPhotoIndex = null;
  }

  handlePhotoDragEnd(event) {
    this.cleanupDragClasses();
    this.draggedPhotoIndex = null;
  }

  cleanupDragClasses() {
    document.querySelectorAll('.dragging-photo').forEach(el => el.classList.remove('dragging-photo'));
    document.querySelectorAll('.drag-target-over').forEach(el => el.classList.remove('drag-target-over'));
  }

  reorderPhotos(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.photos.length || toIndex < 0 || toIndex >= this.photos.length) return;
    const [movedItem] = this.photos.splice(fromIndex, 1);
    this.photos.splice(toIndex, 0, movedItem);

    // Jika seluruh tanggal dinas telah terisi dan segmen foto tidak dikunci,
    // sinkronkan urutan jadwal dan geotag secara merata sesuai urutan baru di dokumen
    const validVillages = this.villages.filter(v => v.desa && v.desa.trim());
    if (this.areAllDatesFilled() && validVillages.length > 0 && !this.lockedSegments.photos) {
      this.autoGenerateAllTimestamps(true);
    } else {
      this.renderPhotos();
    }
    this.showToast(`Foto #${fromIndex + 1} berhasil dipindahkan ke posisi #${toIndex + 1} tabel dokumen.`, 'info');
  }

  movePhotoStep(index, direction) {
    const target = index + direction;
    if (target >= 0 && target < this.photos.length) {
      this.reorderPhotos(index, target);
    }
  }

  renderTableCellHtml(p, idx, colLabel) {
    const isSelected = this.selectedPhotoIds.has(p.id);
    const isOriginal = !!(p.is_original || p.alreadyStamped);
    const isCropped = !!p.is_cropped;
    const latFormatted = String(p.lat || '').replace('.', ',');
    const lonFormatted = String(p.lon || '').replace('.', ',');

    return `
      <div class="doc-table-cell photo-draggable ${isSelected ? 'selected' : ''}" 
           id="reportTableCell_${p.id}" 
           data-photo-id="${p.id}" 
           data-photo-index="${idx}"
           draggable="true"
           ondragstart="window.reportBuilder.handlePhotoDragStart(event, '${p.id}', ${idx})"
           ondragover="window.reportBuilder.handlePhotoDragOver(event, ${idx})"
           ondragenter="window.reportBuilder.handlePhotoDragEnter(event, ${idx})"
           ondragleave="window.reportBuilder.handlePhotoDragLeave(event, ${idx})"
           ondrop="window.reportBuilder.handlePhotoDrop(event, ${idx})"
           ondragend="window.reportBuilder.handlePhotoDragEnd(event)">
        
        <!-- Grip & Position Header -->
        <div class="doc-cell-grip-bar" title="Tarik & seret untuk memindahkan urutan foto di dokumen">
          <div class="doc-cell-grip-left">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="cursor:grab;"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
            <span>Foto #${idx + 1}</span>
            <span class="badge" style="font-size:0.62rem; padding:1px 5px; background:rgba(255,255,255,0.06); color:var(--text-muted);">${colLabel}</span>
          </div>
          <div class="doc-cell-grip-right">
            <button type="button" class="btn btn-ghost btn-xs btn-move-step" onclick="event.stopPropagation(); window.reportBuilder.movePhotoStep(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="Geser Maju (posisi #${idx})">
              ▲
            </button>
            <button type="button" class="btn btn-ghost btn-xs btn-move-step" onclick="event.stopPropagation(); window.reportBuilder.movePhotoStep(${idx}, 1)" ${idx === this.photos.length - 1 ? 'disabled' : ''} title="Geser Mundur (posisi #${idx + 2})">
              ▼
            </button>
            <label class="doc-card-checkbox" onclick="event.stopPropagation();" style="display:inline-flex; align-items:center; margin:0 0 0 4px; cursor:pointer;">
              <input type="checkbox" id="tableChk_${p.id}" ${isSelected ? 'checked' : ''} onclick="window.reportBuilder.handleCheckboxClick(event, '${p.id}', ${idx})">
            </label>
          </div>
        </div>

        <!-- Canvas Media Preview (Word Aspect 4:3) -->
        <div class="doc-cell-media" onclick="window.reportBuilder.handleCardMediaClick(event, '${p.id}', ${idx})">
          <canvas id="reportTableCanvas_${p.id}"></canvas>
          ${isOriginal ? `
            <span class="doc-live-badge badge-raw" style="display:inline-flex; align-items:center; gap:3px; position:absolute; top:6px; right:6px; font-size:0.62rem;">
              Foto Asli
            </span>
          ` : ''}
        </div>

        <!-- Caption (mirip tabel dokumen Word) -->
        <div class="doc-cell-caption">
          <div class="doc-cell-caption-title" title="Desa ${this.escapeHtml(p.desa || '-')}, Kec. ${this.escapeHtml(p.kecamatan || '-')}, Kab. ${this.escapeHtml(p.kabupaten || '-')}">
            <span>Desa ${this.escapeHtml(p.desa || 'Belum Diatur')}</span> 
            ${p.kecamatan ? `<span style="color:var(--text-muted); font-size:0.68rem;">(Kec. ${this.escapeHtml(p.kecamatan)})</span>` : ''}
            ${p.kabupaten ? `<span class="badge" style="font-size:0.6rem; padding:1px 4px; margin-left:4px;">Kab. ${this.escapeHtml(p.kabupaten)}</span>` : ''}
          </div>
          <div class="doc-cell-caption-sub" title="${this.escapeHtml(p.timeStr || '-')} • Lat: ${latFormatted}, Lon: ${lonFormatted}">
            <span class="font-mono">${this.escapeHtml(p.timeStr || 'Belum di-generate')}</span>
            ${p.lat ? ` • <span class="font-mono">${latFormatted}, ${lonFormatted}</span>` : ''}
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-top:6px; padding-top:5px; border-top:1px solid rgba(255,255,255,0.06);">
            <div style="display:flex; gap:3px;">
              <button type="button" class="btn btn-secondary btn-xs" onclick="event.stopPropagation(); window.openPhotoLightbox('${p.id}', 'report')" title="Perbesar Layar Penuh (Lightbox)">
                Preview
              </button>
              <button type="button" class="btn btn-secondary btn-xs" onclick="event.stopPropagation(); window.reportBuilder.openModal('${p.id}')" title="Edit Stempel & Waktu">
                Edit
              </button>
              <button type="button" class="btn ${isOriginal ? 'btn-active' : 'btn-secondary'} btn-xs" onclick="event.stopPropagation(); window.reportBuilder.toggleSingleKeepOriginal('${p.id}')" title="Ganti Watermark / Asli">
                ${isOriginal ? 'Asli' : 'Stempel'}
              </button>
            </div>
            <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="event.stopPropagation(); window.reportBuilder.removePhoto('${p.id}')" title="Hapus foto ini">
              &times;
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderPhotos() {
    const gridEl = document.getElementById('reportPhotosGrid');
    const tableWrap = document.getElementById('reportPhotosTableView');
    const tableContainer = document.getElementById('reportPhotosTableContainer');
    const badgeEl = document.getElementById('reportPhotosCountBadge');
    if (badgeEl) badgeEl.textContent = `${this.photos.length} Foto`;

    const docTitleEl = document.getElementById('simulatedDocPhotoTitle');
    if (docTitleEl) {
      docTitleEl.textContent = `Monitoring Kegiatan Pamsimas TA ${this.tahun || '2026'}`;
    }

    if (!gridEl && !tableWrap) return;

    if (this.photos.length === 0) {
      if (gridEl) {
        gridEl.innerHTML = '';
        gridEl.style.display = 'none';
      }
      if (tableWrap) {
        tableWrap.style.display = 'none';
      }
      if (tableContainer) {
        tableContainer.innerHTML = '';
      }
      const batchBar = document.getElementById('reportBatchBar');
      if (batchBar) batchBar.style.display = 'none';
      this.updateBatchBar();
      return;
    }

    const batchBar = document.getElementById('reportBatchBar');
    if (batchBar) batchBar.style.display = 'flex';

    const isTable = (this.photoViewMode === 'table');
    if (tableWrap) tableWrap.style.display = isTable ? 'block' : 'none';
    if (gridEl) gridEl.style.display = isTable ? 'none' : 'grid';

    // 1. Render Tampilan Simulasi Tabel Dokumen Word (2 Kolom Baris per Baris)
    if (tableContainer) {
      const numRows = Math.ceil(this.photos.length / 2);
      let tableHtml = '';

      for (let r = 0; r < numRows; r++) {
        const p1 = this.photos[r * 2];
        const p2 = this.photos[r * 2 + 1];

        tableHtml += `
          <div class="doc-table-row">
            ${this.renderTableCellHtml(p1, r * 2, 'Kolom Kiri')}
            ${p2 ? this.renderTableCellHtml(p2, r * 2 + 1, 'Kolom Kanan') : `
              <div class="doc-table-cell-empty">
                <span>(Akhir Baris Tabel Dokumen)</span>
              </div>
            `}
          </div>
        `;
      }
      tableContainer.innerHTML = tableHtml;
    }

    // 2. Render Tampilan Kartu Grid
    if (gridEl) {
      gridEl.innerHTML = this.photos.map((p, idx) => {
        const isSelected = this.selectedPhotoIds.has(p.id);
        const isOriginal = !!(p.is_original || p.alreadyStamped);
        const isCropped = !!p.is_cropped;
        const latFormatted = String(p.lat || '').replace('.', ',');
        const lonFormatted = String(p.lon || '').replace('.', ',');

        return `
          <div class="report-photo-card photo-draggable ${isSelected ? 'selected' : ''} ${isOriginal ? 'keep-original' : ''}" 
               id="reportPhotoCard_${p.id}" 
               data-photo-id="${p.id}" 
               data-photo-index="${idx}" 
               draggable="true"
               ondragstart="window.reportBuilder.handlePhotoDragStart(event, '${p.id}', ${idx})"
               ondragover="window.reportBuilder.handlePhotoDragOver(event, ${idx})"
               ondragenter="window.reportBuilder.handlePhotoDragEnter(event, ${idx})"
               ondragleave="window.reportBuilder.handlePhotoDragLeave(event, ${idx})"
               ondrop="window.reportBuilder.handlePhotoDrop(event, ${idx})"
               ondragend="window.reportBuilder.handlePhotoDragEnd(event)"
               onclick="window.reportBuilder.handleCardClick(event, '${p.id}', ${idx})" 
               oncontextmenu="window.reportBuilder.handleCardContextMenu(event, '${p.id}', ${idx})">
            <!-- Media Preview (Canvas Live Stamp) -->
            <div class="report-card-media" onclick="window.reportBuilder.handleCardMediaClick(event, '${p.id}', ${idx})">
              <!-- Selection Checkbox & Grip Badge -->
              <label class="doc-card-checkbox" onclick="window.reportBuilder.handleCheckboxLabelClick(event, '${p.id}', ${idx})" style="position:absolute; top:8px; left:8px; z-index:5; background:rgba(15,23,42,0.85); backdrop-filter:blur(4px); padding:2px 7px; border-radius:4px; display:flex; align-items:center; gap:5px; cursor:pointer;">
                <input type="checkbox" id="reportChk_${p.id}" ${isSelected ? 'checked' : ''} onclick="window.reportBuilder.handleCheckboxClick(event, '${p.id}', ${idx})">
                <span class="font-mono" style="font-size:0.68rem; color:#38bdf8; font-weight:700;">#${idx + 1}</span>
              </label>

              <!-- Zoom Lightbox Button -->
              <button type="button" class="report-card-zoom-btn" onclick="event.stopPropagation(); window.openPhotoLightbox('${p.id}', 'report')" title="Perbesar Layar Penuh (Lightbox)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>

              <!-- Canvas Live Preview -->
              <canvas id="reportCardCanvas_${p.id}" style="width:100%; height:100%; object-fit:cover;"></canvas>

              <!-- Status Badge -->
              <span class="doc-live-badge ${isOriginal ? 'badge-raw' : ''}" style="display:inline-flex; align-items:center; gap:4px;">
                ${isOriginal ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Foto Asli' : (isCropped ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> Disesuaikan' : 'Watermark')}
              </span>
            </div>

            <!-- Metadata & Actions -->
            <div class="report-card-body">
              <div class="report-card-meta">
                <div class="text-truncate report-card-filename" title="${this.escapeHtml(p.filename)}">
                  ${this.escapeHtml(p.filename)}
                </div>
                <div class="text-truncate report-card-location" title="${p.desa || 'Desa'}, ${p.kecamatan || 'Kecamatan'}">
                  <span>${p.desa ? 'Desa ' + this.escapeHtml(p.desa) : 'Desa Belum Diatur'} ${p.kecamatan ? '(' + this.escapeHtml(p.kecamatan) + ')' : ''}</span>
                </div>
                <div class="font-mono text-truncate report-card-time" title="${this.escapeHtml(p.timeStr || '-')}">
                  <span>${this.escapeHtml(p.timeStr || 'Belum di-generate')}</span>
                </div>
                <div class="font-mono text-truncate report-card-coords" title="Lat: ${latFormatted}, Lon: ${lonFormatted}">
                  <span>${p.lat ? latFormatted + ', ' + lonFormatted : 'Koordinat menyusul'}</span>
                </div>
              </div>

              <!-- Footer Buttons -->
              <div class="report-card-footer">
                <div style="display:flex; gap:3px;">
                  <button type="button" class="btn btn-secondary btn-xs" onclick="window.openPhotoLightbox('${p.id}', 'report')" title="Pratinjau Foto Layar Penuh">
                    Preview
                  </button>
                  <button type="button" class="btn btn-secondary btn-xs" onclick="window.reportBuilder.openModal('${p.id}')" title="Edit Stempel & Potong Manual">
                    Edit
                  </button>
                  <button type="button" class="btn btn-ghost btn-xs btn-move-step" onclick="window.reportBuilder.movePhotoStep(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="Geser Maju">
                    ◀
                  </button>
                  <button type="button" class="btn btn-ghost btn-xs btn-move-step" onclick="window.reportBuilder.movePhotoStep(${idx}, 1)" ${idx === this.photos.length - 1 ? 'disabled' : ''} title="Geser Mundur">
                    ▶
                  </button>
                </div>
                <div style="display:flex; gap:3px;">
                  <button type="button" class="btn ${isOriginal ? 'btn-active' : 'btn-secondary'} btn-xs" onclick="window.reportBuilder.toggleSingleKeepOriginal('${p.id}')" title="${isOriginal ? 'Klik untuk memasang stempel' : 'Gunakan foto asli unedited'}">
                    ${isOriginal ? 'Asli' : 'Stempel'}
                  </button>
                  <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="window.reportBuilder.removePhoto('${p.id}')" title="Hapus foto ini" style="padding:2px 6px;">
                    &times;
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Render live stamp on both card canvases and table canvases asynchronously
    this.photos.forEach(p => {
      this.renderCardStamp(p.id);
    });

    this.updateBatchBar();
  }

  async renderCardStamp(photoId) {
    const p = this.photos.find(item => item.id === photoId);
    if (!p) return;
    const canvas = document.getElementById(`reportCardCanvas_${photoId}`);
    const tableCanvas = document.getElementById(`reportTableCanvas_${photoId}`);
    if (!canvas && !tableCanvas) return;

    try {
      const imgObj = await this.getImage(p);
      const isOriginal = !!(p.is_original || p.alreadyStamped);
      const meta = {
        time_str: p.timeStr,
        lat: p.lat,
        lon: p.lon,
        desa: p.desa,
        kecamatan: p.kecamatan,
        kabupaten: p.kabupaten || (this.kabupatens.length > 0 ? this.kabupatens[0] : (this.kabupaten ? this.kabupaten.split(',')[0].trim() : 'Magelang')),
        provinsi: p.provinsi || 'Jawa Tengah',
        dusun: p.dusun || '',
        custom_address: p.customAddress || '',
        address_mode: p.address_mode || 'natural',
        font_scale: p.font_scale || 1.0
      };
      if (canvas) renderStampedPhoto(canvas, imgObj, meta, this.showRawGrid || isOriginal);
      if (tableCanvas) renderStampedPhoto(tableCanvas, imgObj, meta, this.showRawGrid || isOriginal);
    } catch (e) {
      console.warn('Gagal merender stempel card laporan:', photoId, e);
    }
  }

  // =========================================================
  // SINGLE PHOTO EDIT MODAL (docEditModal REUSE & MANUAL CROP)
  // =========================================================
  async openModal(photoId) {
    const p = this.photos.find(item => item.id === photoId);
    if (!p) return;
    this.activePhotoId = photoId;
    this.modalShowRaw = false;

    window.activePhotoContext = 'report';
    this.toggleCropDrawMode(false);

    if (this.modalTitle) {
      const pIdx = this.photos.findIndex(item => item.id === photoId);
      const totalPhotos = this.photos.length;
      const countLabel = totalPhotos > 1 ? ` (${pIdx + 1}/${totalPhotos})` : '';
      this.modalTitle.innerText = `Edit Stempel Foto — ${p.filename}${countLabel}`;
    }

    const rawTime = p.timeStr || p.time_str || '';
    let parsed;
    if (rawTime) {
      parsed = parseIndonesianTimestamp(rawTime);
    } else {
      const defDate = this.getSurveyIsoDate() || new Date().toISOString().slice(0, 10);
      parsed = parseIndonesianTimestamp(defDate);
    }
    const isoDate = parsed.isoDate || this.getSurveyIsoDate() || new Date().toISOString().slice(0, 10);
    const time24 = parsed.timeStr24 || '09:14:23';

    if (this.modalDatePicker) {
      this.modalDatePicker.value = isoDate;
      this.syncDateInputColor(this.modalDatePicker);
    }
    if (this.modalTimePicker) {
      this.modalTimePicker.value = time24;
      this.syncDateInputColor(this.modalTimePicker);
    }
    if (this.modalTimeStr) {
      this.modalTimeStr.value = rawTime || formatIndonesianTimestamp(isoDate, time24, parsed.timezone || 'WIB');
    }

    if (this.modalKeepOriginal) this.modalKeepOriginal.checked = !!(p.is_original || p.alreadyStamped);

    if (this.modalLat) this.modalLat.value = p.lat || '';
    if (this.modalLon) this.modalLon.value = p.lon || '';
    if (this.modalDusun) this.modalDusun.value = p.dusun || '';
    if (this.modalDesa) this.modalDesa.value = p.desa || '';
    if (this.modalKecamatan) this.modalKecamatan.value = p.kecamatan || '';
    if (this.modalKabupaten) this.modalKabupaten.value = p.kabupaten || this.kabupaten || '';
    if (this.modalProvinsi) this.modalProvinsi.value = p.provinsi || 'Jawa Tengah';
    if (this.modalFontScale) this.modalFontScale.value = String(p.font_scale || 1.0);
    if (this.modalAddressMode) this.modalAddressMode.value = p.address_mode || 'natural';
    if (this.modalCustomAddress) this.modalCustomAddress.value = p.customAddress || '';

    if (this.btnToggleModalRaw) {
      this.btnToggleModalRaw.innerText = 'Foto Asli';
    }

    // Tampilkan kontrol crop manual
    const cropBar = document.getElementById('modalCropBar');
    if (cropBar) cropBar.style.display = 'flex';
    const btnResetCrop = document.getElementById('btnModalResetCrop');
    if (btnResetCrop) btnResetCrop.style.display = p.is_cropped ? 'inline-flex' : 'none';

    if (this.modal) {
      this.modal.classList.add('active');
    }

    await this.updateModalLivePreview();
  }

  closeModal() {
    this.toggleCropDrawMode(false);
    if (this.modal) {
      this.modal.classList.remove('active');
    }
    this.activePhotoId = null;
  }

  async navigateModalPhoto(direction, autoSave = true) {
    if (!this.activePhotoId || !this.photos || this.photos.length <= 1) return;
    const curIdx = this.photos.findIndex(p => p.id === this.activePhotoId);
    if (curIdx === -1) return;

    if (autoSave) {
      const curPhoto = this.photos[curIdx];
      if (curPhoto) {
        this.onModalDateTimeChange();
        const finalTime = this.modalTimeStr ? this.modalTimeStr.value : (curPhoto.timeStr || curPhoto.time_str || '');
        curPhoto.timeStr = finalTime;
        curPhoto.time_str = finalTime;
        if (this.modalLat) curPhoto.lat = this.modalLat.value;
        if (this.modalLon) curPhoto.lon = this.modalLon.value;
        if (this.modalDusun) curPhoto.dusun = this.modalDusun.value;
        if (this.modalDesa) curPhoto.desa = this.modalDesa.value;
        if (this.modalKecamatan) curPhoto.kecamatan = this.modalKecamatan.value;
        if (this.modalKabupaten) curPhoto.kabupaten = this.modalKabupaten.value;
        if (this.modalProvinsi) curPhoto.provinsi = this.modalProvinsi.value;
        if (this.modalCustomAddress) curPhoto.customAddress = this.modalCustomAddress.value;
        if (this.modalAddressMode) curPhoto.address_mode = this.modalAddressMode.value;
        if (this.modalFontScale) curPhoto.font_scale = parseFloat(this.modalFontScale.value) || 1.0;
        const isOrig = this.modalKeepOriginal ? this.modalKeepOriginal.checked : false;
        curPhoto.alreadyStamped = isOrig;
        curPhoto.is_original = isOrig;
        curPhoto.keep_original = isOrig;
        this.renderPhotos();
      }
    }

    const newIdx = (curIdx + direction + this.photos.length) % this.photos.length;
    await this.openModal(this.photos[newIdx].id);
  }

  onModalDateTimeChange() {
    if (!this.activePhotoId) return;
    const p = this.photos.find(item => item.id === this.activePhotoId);

    let dateVal = this.modalDatePicker ? this.modalDatePicker.value : '';
    if (!dateVal) {
      dateVal = this.getSurveyIsoDate() || new Date().toISOString().slice(0, 10);
      if (this.modalDatePicker) this.modalDatePicker.value = dateVal;
    }

    let timeVal = this.modalTimePicker ? this.modalTimePicker.value : '';
    const currentStr = this.modalTimeStr ? this.modalTimeStr.value : '';
    const parsed = parseIndonesianTimestamp(currentStr || (p ? (p.timeStr || p.time_str) : ''));

    if (timeVal) {
      const parts = timeVal.split(':');
      if (parts.length === 2) {
        const sec = (parsed && parsed.seconds !== undefined) ? String(parsed.seconds).padStart(2, '0') : '23';
        timeVal = `${parts[0]}:${parts[1]}:${sec}`;
      }
    } else {
      timeVal = parsed.timeStr24 || '09:14:23';
    }

    const tz = parsed.timezone || 'WIB';
    const formatted = formatIndonesianTimestamp(dateVal, timeVal, tz);
    if (this.modalTimeStr) {
      this.modalTimeStr.value = formatted;
    }

    if (this.modalDatePicker) this.syncDateInputColor(this.modalDatePicker);
    if (this.modalTimePicker) this.syncDateInputColor(this.modalTimePicker);

    this.updateModalLivePreview();
  }

  onModalTimeStrInput() {
    if (!this.activePhotoId || !this.modalTimeStr) return;
    const str = this.modalTimeStr.value;
    const parsed = parseIndonesianTimestamp(str);
    if (parsed) {
      if (parsed.isoDate && this.modalDatePicker) {
        this.modalDatePicker.value = parsed.isoDate;
        this.syncDateInputColor(this.modalDatePicker);
      }
      if (parsed.timeStr24 && this.modalTimePicker) {
        this.modalTimePicker.value = parsed.timeStr24;
        this.syncDateInputColor(this.modalTimePicker);
      }
    }
    this.updateModalLivePreview();
  }

  async saveModalChanges() {
    if (!this.activePhotoId) return;
    const p = this.photos.find(item => item.id === this.activePhotoId);
    if (!p) return;

    this.onModalDateTimeChange();

    const finalTime = this.modalTimeStr ? this.modalTimeStr.value : (p.timeStr || p.time_str || '');
    p.timeStr = finalTime;
    p.time_str = finalTime;
    p.lat = this.modalLat ? this.modalLat.value : p.lat;
    p.lon = this.modalLon ? this.modalLon.value : p.lon;
    p.dusun = this.modalDusun ? this.modalDusun.value : '';
    p.desa = this.modalDesa ? this.modalDesa.value : p.desa;
    p.kecamatan = this.modalKecamatan ? this.modalKecamatan.value : p.kecamatan;
    p.kabupaten = this.modalKabupaten ? this.modalKabupaten.value : p.kabupaten;
    p.provinsi = this.modalProvinsi ? this.modalProvinsi.value : p.provinsi;
    p.customAddress = this.modalCustomAddress ? this.modalCustomAddress.value : '';
    p.address_mode = this.modalAddressMode ? this.modalAddressMode.value : 'natural';
    p.font_scale = this.modalFontScale ? parseFloat(this.modalFontScale.value) || 1.0 : 1.0;

    const isOrig = this.modalKeepOriginal ? this.modalKeepOriginal.checked : false;
    p.alreadyStamped = isOrig;
    p.is_original = isOrig;
    p.keep_original = isOrig;

    this.closeModal();
    this.renderPhotos();
    if (typeof this.evaluateRealtimeAudit === 'function') {
      this.evaluateRealtimeAudit();
    }
    this.showToast('Perubahan foto & stempel waktu berhasil disimpan.', 'success');
  }

  async updateModalLivePreview() {
    if (!this.activePhotoId || !this.modalPreviewCanvas) return;
    const p = this.photos.find(item => item.id === this.activePhotoId);
    if (!p) return;

    const meta = {
      time_str: this.modalTimeStr ? this.modalTimeStr.value : (p.timeStr || p.time_str || ''),
      lat: this.modalLat ? this.modalLat.value : p.lat,
      lon: this.modalLon ? this.modalLon.value : p.lon,
      dusun: this.modalDusun ? this.modalDusun.value : '',
      desa: this.modalDesa ? this.modalDesa.value : p.desa,
      kecamatan: this.modalKecamatan ? this.modalKecamatan.value : p.kecamatan,
      kabupaten: this.modalKabupaten ? this.modalKabupaten.value : p.kabupaten,
      provinsi: this.modalProvinsi ? this.modalProvinsi.value : p.provinsi,
      custom_address: this.modalCustomAddress ? this.modalCustomAddress.value : '',
      address_mode: this.modalAddressMode ? this.modalAddressMode.value : 'natural',
      font_scale: this.modalFontScale ? parseFloat(this.modalFontScale.value) || 1.0 : 1.0
    };

    const isOrig = this.modalKeepOriginal ? this.modalKeepOriginal.checked : false;

    try {
      const imgObj = await this.getImage(p);
      renderStampedPhoto(this.modalPreviewCanvas, imgObj, meta, this.modalShowRaw || isOrig);
    } catch (e) {
      console.warn('Gagal merender preview modal report:', e);
    }
  }

  toggleModalRaw() {
    this.modalShowRaw = !this.modalShowRaw;
    if (this.btnToggleModalRaw) {
      this.btnToggleModalRaw.innerText = this.modalShowRaw ? 'Lihat Stempel' : 'Foto Asli';
    }
    this.updateModalLivePreview();
  }

  // =========================================================
  // INTERACTIVE MANUAL DRAW BOUNDING BOX CROP & LIVE STAMP
  // =========================================================
  initCropDrawEvents() {
    if (this._cropEventsInitialized) return;
    this._cropEventsInitialized = true;

    const wrap = document.getElementById('modalPreviewCanvasWrap');
    if (!wrap) return;

    wrap.addEventListener('mousedown', (e) => {
      if (!this.isCropDrawMode) return;
      e.preventDefault();
      e.stopPropagation();

      const canvas = document.getElementById('modalPreviewCanvas');
      if (!canvas) return;
      const cRect = canvas.getBoundingClientRect();
      const wRect = wrap.getBoundingClientRect();

      // Cek apakah klik berada di dalam bidang gambar canvas
      if (e.clientX < cRect.left || e.clientX > cRect.right || e.clientY < cRect.top || e.clientY > cRect.bottom) {
        return;
      }

      this.isDrawingCrop = true;
      this.cropStart = {
        clientX: e.clientX,
        clientY: e.clientY,
        canvasLeft: cRect.left,
        canvasTop: cRect.top,
        canvasWidth: cRect.width,
        canvasHeight: cRect.height,
        wrapLeft: wRect.left,
        wrapTop: wRect.top
      };

      const box = document.getElementById('cropBoundingBox');
      if (box) {
        box.style.display = 'block';
        box.style.left = (cRect.left - wRect.left + (e.clientX - cRect.left)) + 'px';
        box.style.top = (cRect.top - wRect.top + (e.clientY - cRect.top)) + 'px';
        box.style.width = '0px';
        box.style.height = '0px';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDrawingCrop || !this.cropStart) return;
      const s = this.cropStart;
      const curX = Math.max(s.canvasLeft, Math.min(e.clientX, s.canvasLeft + s.canvasWidth));
      const curY = Math.max(s.canvasTop, Math.min(e.clientY, s.canvasTop + s.canvasHeight));

      const x1 = Math.min(s.clientX, curX) - s.wrapLeft;
      const y1 = Math.min(s.clientY, curY) - s.wrapTop;
      const w = Math.abs(curX - s.clientX);
      const h = Math.abs(curY - s.clientY);

      const box = document.getElementById('cropBoundingBox');
      if (box) {
        box.style.left = x1 + 'px';
        box.style.top = y1 + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';
      }

      const canvas = document.getElementById('modalPreviewCanvas');
      if (canvas && s.canvasWidth > 0 && s.canvasHeight > 0) {
        const scaleX = canvas.width / s.canvasWidth;
        const scaleY = canvas.height / s.canvasHeight;
        const realW = Math.round(w * scaleX);
        const realH = Math.round(h * scaleY);
        const dimBadge = document.getElementById('cropDimBadge');
        if (dimBadge) dimBadge.textContent = `${realW} × ${realH} px`;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isDrawingCrop || !this.cropStart) return;
      this.isDrawingCrop = false;
      const s = this.cropStart;
      const canvas = document.getElementById('modalPreviewCanvas');
      if (!canvas) return;

      const curX = Math.max(s.canvasLeft, Math.min(e.clientX, s.canvasLeft + s.canvasWidth));
      const curY = Math.max(s.canvasTop, Math.min(e.clientY, s.canvasTop + s.canvasHeight));
      const boxLeftCanvas = Math.min(s.clientX, curX) - s.canvasLeft;
      const boxTopCanvas = Math.min(s.clientY, curY) - s.canvasTop;
      const w = Math.abs(curX - s.clientX);
      const h = Math.abs(curY - s.clientY);

      if (w >= 15 && h >= 15) {
        const scaleX = canvas.width / s.canvasWidth;
        const scaleY = canvas.height / s.canvasHeight;
        this.activeCropPixels = {
          x: Math.max(0, Math.round(boxLeftCanvas * scaleX)),
          y: Math.max(0, Math.round(boxTopCanvas * scaleY)),
          w: Math.min(canvas.width, Math.round(w * scaleX)),
          h: Math.min(canvas.height, Math.round(h * scaleY))
        };
        const btnApply = document.getElementById('btnModalApplyCrop');
        if (btnApply) btnApply.style.display = 'inline-flex';
        const btnCancel = document.getElementById('btnModalCancelCropBox');
        if (btnCancel) btnCancel.style.display = 'inline-flex';
        const statusBadge = document.getElementById('modalCropStatusBadge');
        if (statusBadge) statusBadge.textContent = `Kotak Seleksi: ${this.activeCropPixels.w} × ${this.activeCropPixels.h} px`;
      } else {
        const box = document.getElementById('cropBoundingBox');
        if (box) box.style.display = 'none';
        this.activeCropPixels = null;
      }
    });
  }

  toggleCropDrawMode(force) {
    if (typeof force === 'boolean') {
      this.isCropDrawMode = force;
    } else {
      this.isCropDrawMode = !this.isCropDrawMode;
    }
    window.isCropDrawModeActive = this.isCropDrawMode;

    const wrap = document.getElementById('modalPreviewCanvasWrap');
    const btn = document.getElementById('btnToggleCropDraw');
    const statusBadge = document.getElementById('modalCropStatusBadge');
    const box = document.getElementById('cropBoundingBox');

    if (this.isCropDrawMode) {
      if (wrap) wrap.classList.add('crop-active');
      if (btn) {
        btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle; margin-right:3px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Batalkan Mode Tarik Kotak';
        btn.className = 'btn btn-danger btn-xs';
      }
      if (statusBadge) statusBadge.textContent = 'Tarik mouse di atas foto...';
    } else {
      if (wrap) wrap.classList.remove('crop-active');
      if (btn) {
        btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle; margin-right:3px;"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> Tarik Kotak Seleksi (Bounding Box)';
        btn.className = 'btn btn-warning btn-xs';
      }
      if (statusBadge) statusBadge.textContent = 'Siap';
      if (box) box.style.display = 'none';
      const btnApply = document.getElementById('btnModalApplyCrop');
      if (btnApply) btnApply.style.display = 'none';
      const btnCancel = document.getElementById('btnModalCancelCropBox');
      if (btnCancel) btnCancel.style.display = 'none';
      this.activeCropPixels = null;
    }
  }

  modalCancelCropBox() {
    const box = document.getElementById('cropBoundingBox');
    if (box) box.style.display = 'none';
    const btnApply = document.getElementById('btnModalApplyCrop');
    if (btnApply) btnApply.style.display = 'none';
    const btnCancel = document.getElementById('btnModalCancelCropBox');
    if (btnCancel) btnCancel.style.display = 'none';
    this.activeCropPixels = null;
    const statusBadge = document.getElementById('modalCropStatusBadge');
    if (statusBadge) statusBadge.textContent = 'Siap';
  }

  async modalApplyCrop() {
    if (!this.activePhotoId || !this.activeCropPixels) {
      this.showToast('Tentukan area potong pada foto terlebih dahulu.', 'warning');
      return;
    }
    const p = this.photos.find(item => item.id === this.activePhotoId);
    if (!p) return;

    try {
      if (!p.originalDataUrl) {
        p.originalDataUrl = p.dataUrl;
      }

      const baseImg = new Image();
      baseImg.src = p.originalDataUrl;
      await new Promise((res, rej) => {
        baseImg.onload = res;
        baseImg.onerror = rej;
      });

      const { x, y, w, h } = this.activeCropPixels;
      if (w < 10 || h < 10) return;

      const cCanvas = document.createElement('canvas');
      cCanvas.width = w;
      cCanvas.height = h;
      const ctx = cCanvas.getContext('2d');
      ctx.drawImage(baseImg, x, y, w, h, 0, 0, w, h);

      p.dataUrl = cCanvas.toDataURL('image/jpeg', 0.95);
      p.is_cropped = true;
      p.is_original = false;
      p.alreadyStamped = false;

      this.imageCache.delete(p.id);
      this.toggleCropDrawMode(false);

      const btnResetCrop = document.getElementById('btnModalResetCrop');
      if (btnResetCrop) btnResetCrop.style.display = 'inline-flex';

      await this.updateModalLivePreview();
      await this.renderCardStamp(p.id);
      this.showToast('Foto berhasil dipotong.', 'success');
    } catch (err) {
      this.showToast('Gagal memotong foto: ' + err.message, 'error');
    }
  }

  async modalResetCrop() {
    if (!this.activePhotoId) return;
    const p = this.photos.find(item => item.id === this.activePhotoId);
    if (!p) return;

    if (p.originalDataUrl) {
      p.dataUrl = p.originalDataUrl;
      p.is_cropped = false;
      this.imageCache.delete(p.id);

      this.modalCancelCropBox();
      this.toggleCropDrawMode(false);

      const btnResetCrop = document.getElementById('btnModalResetCrop');
      if (btnResetCrop) btnResetCrop.style.display = 'none';

      await this.updateModalLivePreview();
      await this.renderCardStamp(p.id);
    }
  }

  async modalQuickCropAspect43() {
    if (!this.activePhotoId) return;
    const p = this.photos.find(item => item.id === this.activePhotoId);
    if (!p) return;
    await this.normalizePhotoAspect(p, 4 / 3);
    const btnResetCrop = document.getElementById('btnModalResetCrop');
    if (btnResetCrop) btnResetCrop.style.display = 'inline-flex';
    await this.updateModalLivePreview();
    await this.renderCardStamp(p.id);
  }

  // =========================================================
  // ROTATE & FLIP OPERATIONS FOR ACTIVE MODAL PHOTO
  // =========================================================
  async rotateActivePhoto(deg) {
    if (!this.activePhotoId) return;
    const p = this.photos.find(item => item.id === this.activePhotoId);
    if (!p) return;

    try {
      if (!p.originalDataUrl) {
        p.originalDataUrl = p.dataUrl;
      }
      const baseImg = new Image();
      baseImg.src = p.dataUrl;
      await new Promise((res, rej) => {
        baseImg.onload = res;
        baseImg.onerror = rej;
      });

      const w = baseImg.naturalWidth;
      const h = baseImg.naturalHeight;
      const rad = (deg * Math.PI) / 180;
      const is90 = Math.abs(deg % 180) === 90;

      const c = document.createElement('canvas');
      c.width = is90 ? h : w;
      c.height = is90 ? w : h;
      const ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(baseImg, -w / 2, -h / 2);

      p.dataUrl = c.toDataURL('image/jpeg', 0.95);
      p.is_cropped = true;
      p.naturalWidth = c.width;
      p.naturalHeight = c.height;
      p.is_portrait = c.height > c.width * 1.05;

      this.imageCache.delete(p.id);
      const btnResetCrop = document.getElementById('btnModalResetCrop');
      if (btnResetCrop) btnResetCrop.style.display = 'inline-flex';

      await this.updateModalLivePreview();
      await this.renderCardStamp(p.id);
    } catch (e) {
      console.error('Gagal merotasi foto:', e);
    }
  }

  async flipActivePhoto(dir = 'h') {
    if (!this.activePhotoId) return;
    const p = this.photos.find(item => item.id === this.activePhotoId);
    if (!p) return;

    try {
      if (!p.originalDataUrl) {
        p.originalDataUrl = p.dataUrl;
      }
      const baseImg = new Image();
      baseImg.src = p.dataUrl;
      await new Promise((res, rej) => {
        baseImg.onload = res;
        baseImg.onerror = rej;
      });

      const w = baseImg.naturalWidth;
      const h = baseImg.naturalHeight;

      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.translate(dir === 'h' ? w : 0, dir === 'v' ? h : 0);
      ctx.scale(dir === 'h' ? -1 : 1, dir === 'v' ? -1 : 1);
      ctx.drawImage(baseImg, 0, 0);

      p.dataUrl = c.toDataURL('image/jpeg', 0.95);
      p.is_cropped = true;
      this.imageCache.delete(p.id);

      const btnResetCrop = document.getElementById('btnModalResetCrop');
      if (btnResetCrop) btnResetCrop.style.display = 'inline-flex';

      await this.updateModalLivePreview();
      await this.renderCardStamp(p.id);
    } catch (e) {
      console.error('Gagal membalik (flip) foto:', e);
    }
  }

  // =========================================================
  // SEGMENT LOCK MANAGEMENT
  // =========================================================
  toggleSegmentLock(segmentKey) {
    if (this.lockedSegments[segmentKey] === undefined) return;
    this.lockedSegments[segmentKey] = !this.lockedSegments[segmentKey];
    this.applySegmentLockUI(segmentKey);
  }

  setSegmentLock(segmentKey, isLocked) {
    this.lockedSegments[segmentKey] = !!isLocked;
    this.applySegmentLockUI(segmentKey);
  }

  applySegmentLockUI(segmentKey) {
    const isLocked = !!this.lockedSegments[segmentKey];
    let panelId = '';
    let btnId = '';

    if (segmentKey === 'administrasi') {
      panelId = 'panelAdministrasi';
      btnId = 'btnLockAdministrasi';
    } else if (segmentKey === 'pelaksana') {
      panelId = 'panelPelaksana';
      btnId = 'btnLockPelaksana';
    } else if (segmentKey === 'villages') {
      panelId = 'panelVillages';
      btnId = 'btnLockVillages';
    } else if (segmentKey === 'photos') {
      panelId = 'panelPhotos';
      btnId = 'btnLockPhotos';
    }

    const panel = document.getElementById(panelId);
    const btn = document.getElementById(btnId);

    if (btn) {
      if (isLocked) {
        btn.classList.add('is-locked');
        const lbl = btn.querySelector('.lock-label');
        if (lbl) lbl.textContent = 'Terkunci';
        btn.title = 'Segmen ini terkunci (klik untuk membuka)';
      } else {
        btn.classList.remove('is-locked');
        const lbl = btn.querySelector('.lock-label');
        if (lbl) lbl.textContent = 'Buka';
        btn.title = 'Kunci segmen ini agar tidak berubah';
      }
    }

    if (panel) {
      if (isLocked) {
        panel.classList.add('is-locked');
      } else {
        panel.classList.remove('is-locked');
      }

      // Disabled / Readonly state for inputs inside panel
      const inputs = panel.querySelectorAll('input, select, textarea');
      inputs.forEach(el => {
        // Jangan disable tombol lock itu sendiri
        if (el.closest('.btn-segment-lock')) return;
        el.disabled = isLocked;
      });

      // Disabled state for buttons inside panel (except lock button)
      const buttons = panel.querySelectorAll('button');
      buttons.forEach(b => {
        if (b.classList.contains('btn-segment-lock')) return;
        b.disabled = isLocked;
      });
    }

    // Refresh audit card if open to sync status
    const card = document.getElementById('reportAuditCard');
    if (card && card.style.display !== 'none') {
      this.evaluateRealtimeAudit();
    }
  }

  lockAllCompleteSegments() {
    // Kunci otomatis setiap segmen yang statusnya sudah terisi lengkap
    if ((this.kabupatens.length > 0 || this.kabupaten) && this.nomorSpt && this.tanggalSpt) {
      this.setSegmentLock('administrasi', true);
    }
    if (this.pelaksanaList && this.pelaksanaList.filter(Boolean).length > 0) {
      this.setSegmentLock('pelaksana', true);
    }
    const validV = this.villages.filter(v => v.desa && (v.notes || v.narrative));
    if (validV.length > 0) {
      this.setSegmentLock('villages', true);
    }
    if (this.photos && this.photos.length > 0) {
      this.setSegmentLock('photos', true);
    }
  }

  unlockAllSegments() {
    this.setSegmentLock('administrasi', false);
    this.setSegmentLock('pelaksana', false);
    this.setSegmentLock('villages', false);
    this.setSegmentLock('photos', false);
  }

  jitterModalTime() {
    if (!this.modalTimeStr) return;
    const current = this.modalTimeStr.value;
    const jittered = applyTimeJitter(current, -35, 45);
    this.modalTimeStr.value = jittered;

    const parsed = parseIndonesianTimestamp(jittered);
    if (this.modalDatePicker) {
      this.modalDatePicker.value = parsed.isoDate;
      this.syncDateInputColor(this.modalDatePicker);
    }
    if (this.modalTimePicker) {
      this.modalTimePicker.value = parsed.timeStr24;
      this.syncDateInputColor(this.modalTimePicker);
    }
    this.updateModalLivePreview();
  }

  jitterModalCoords() {
    if (!this.modalLat || !this.modalLon) return;
    const p = this.photos.find(item => item.id === this.activePhotoId);
    const baseCoords = this.getVillageCoordinates(
      this.modalDesa?.value || p?.desa,
      this.modalKabupaten?.value || p?.kabupaten
    );
    const jittered = applyGpsJitter(baseCoords.lat, baseCoords.lon, 5, 2000);
    this.modalLat.value = jittered.lat;
    this.modalLon.value = jittered.lon;
    this.updateModalLivePreview();
  }

  // =========================================================
  // EXISTING / IN-PROGRESS DOCX IMPORT & AUDIT DETECTOR
  // =========================================================
  async handleExistingDocxUpload(event) {
    const rawFiles = event.target.files ? Array.from(event.target.files) : [];
    if (rawFiles.length === 0) return;

    if (rawFiles.length > 3) {
      this.showToast('Maksimal 3 dokumen yang dapat digabungkan sekaligus.', 'warning');
      event.target.value = '';
      return;
    }

    for (const f of rawFiles) {
      if (!f.name.toLowerCase().endsWith('.docx')) {
        this.showToast(`Berkas "${f.name}" bukan berkas Word (.docx).`, 'warning');
        event.target.value = '';
        return;
      }
    }

    const isMultiple = rawFiles.length > 1;
    const btn = document.getElementById('btnUploadExistingDocx');
    const origBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `
        <span class="spinner-border spinner-border-sm" role="status" style="width:13px; height:13px; border-width:2px; display:inline-block; border-radius:50%; border:2px solid #38bdf8; border-top-color:transparent; animation:spin 0.6s linear infinite; margin-right:4px;"></span>
        <span>${isMultiple ? `Menggabungkan ${rawFiles.length} Dokumen...` : 'Membaca Dokumen...'}</span>
      `;
    }

    try {
      const formData = new FormData();
      for (const f of rawFiles) {
        formData.append('files', f);
      }
      formData.append('file', rawFiles[0]);

      const res = await fetch('/api/report/import_existing_docx', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error((errJson && errJson.error) || `Server status ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Gagal memproses dokumen eksisting');
      }

      const rep = data.report_data || {};

      // 1. Administrasi & SPT
      if (!this.lockedSegments.administrasi) {
        if (Array.isArray(rep.kabupatens) && rep.kabupatens.length > 0) {
          this.setKabupatens(rep.kabupatens);
        } else if (rep.kabupaten) {
          this.setKabupatens(rep.kabupaten);
        } else {
          this.setKabupatens([]);
        }
        this.tahun = rep.tahun || '2026';
        this.tanggalSpt = rep.tanggal_spt || '';
        this.tanggalLaporan = rep.tanggal_laporan || '';
        this.tempatPembuatan = rep.tempat_pembuatan || 'Semarang';

        const thnInp = document.getElementById('reportTahun');
        if (thnInp) thnInp.value = this.tahun;
        this.setReportNomorSpt(rep.nomor_spt || '');
        this.setReportTanggalSpt(this.tanggalSpt);

        // 2. Jadwal Dinas & Tanggal Laporan
        this.tripStartDate = rep.trip_start_date || '';
        this.tripEndDate = rep.trip_end_date || '';
        const sTrip = document.getElementById('reportTripStartDate');
        if (sTrip) sTrip.value = this.tripStartDate;
        const eTrip = document.getElementById('reportTripEndDate');
        if (eTrip) eTrip.value = this.tripEndDate;

        // Tentukan mode durasi dinas: multiple jika ada tgl selesai berbeda, single jika sama/1 hari
        if (this.tripEndDate && this.tripStartDate && this.tripEndDate !== this.tripStartDate) {
          this.setTripMode('multiple', false);
        } else {
          this.setTripMode('single', false);
        }

        if (this.tanggalLaporan) {
          this.setReportTanggalLaporan(this.tanggalLaporan, false);
        } else {
          this.onTripDatesChange();
        }
      }

      // 3. Pelaksana Kedinasan
      if (!this.lockedSegments.pelaksana) {
        this.includePelaksana = rep.include_pelaksana !== false;
        this.pelaksanaList = Array.isArray(rep.pelaksana) ? [...rep.pelaksana] : [];
        const chkPelaksana = document.getElementById('reportIncludePelaksana');
        if (chkPelaksana) chkPelaksana.checked = this.includePelaksana;
        const pContainer = document.getElementById('reportPelaksanaContainer');
        if (pContainer) pContainer.style.display = this.includePelaksana ? 'block' : 'none';
        this.renderPelaksanaList();
      }

      // 4. Data Desa & Narasi / Catatan Lapangan
      if (!this.lockedSegments.villages) {
        if (rep.villages && rep.villages.length > 0) {
          const merged = [];
          const seen = new Map();
          for (const v of rep.villages) {
            const dName = (v.desa || '').trim();
            if (!dName) continue;
            const key = dName.toLowerCase();
            if (seen.has(key)) {
              const existing = seen.get(key);
              const mergeText = (oldT, newT) => {
                const s1 = (oldT || '').trim();
                const s2 = (newT || '').trim();
                if (!s1) return s2;
                if (!s2) return s1;
                if (s1 === s2 || s1.includes(s2)) return s1;
                if (s2.includes(s1)) return s2;
                return s1 + '\n\n' + s2;
              };
              existing.notes = mergeText(existing.notes, v.notes);
              existing.narrative = mergeText(existing.narrative, v.narrative);
              if (!existing.kecamatan && v.kecamatan) existing.kecamatan = v.kecamatan;
              if (!existing.kabupaten && v.kabupaten) existing.kabupaten = v.kabupaten;
            } else {
              const item = {
                id: 'v_' + Math.random().toString(36).substr(2, 9),
                desa: dName,
                kecamatan: v.kecamatan || '',
                kabupaten: v.kabupaten || '',
                notes: v.notes || '',
                narrative: v.narrative || ''
              };
              seen.set(key, item);
              merged.push(item);
              if (item.kabupaten && !this.kabupatens.some(k => k.toLowerCase() === item.kabupaten.toLowerCase())) {
                this.addKabupaten(item.kabupaten);
              }
            }
          }
          this.villages = merged.length > 0 ? merged : [
            {
              id: 'v_init',
              desa: '',
              kecamatan: '',
              kabupaten: this.kabupatens[0] || '',
              notes: '',
              narrative: ''
            }
          ];
        } else {
          this.villages = [
            {
              id: 'v_init',
              desa: '',
              kecamatan: '',
              notes: '',
              narrative: ''
            }
          ];
        }
        this.renderVillages();
        this.updateQuickVillageTargetOptions();
      }

      // 5. Galeri Foto & Timestamp Status
      if (!this.lockedSegments.photos) {
        this.photos = [];
        this.selectedPhotoIds.clear();
        this.imageCache.clear();

        const datesComplete = this.areAllDatesFilled();
        if (data.photos && data.photos.length > 0) {
          for (const p of data.photos) {
            const pId = 'p_' + Math.random().toString(36).substr(2, 9);
            const hasTs = !!p.has_timestamp;
            // Jika tanggal-tanggal belum terisi (laporan eksisting bolong-bolong),
            // jangan langsung mentimestamp foto jika foto tersebut belum bertimestamp fisik!
            const assignedTimeStr = (hasTs || datesComplete) ? (p.time_str || p.timeStr || '') : '';
            const pWidth = p.width || 0;
            const pHeight = p.height || 0;
            const curRatio = (pWidth && pHeight) ? (pWidth / pHeight) : (4 / 3);
            const isMismatched = Math.abs(curRatio - (4 / 3)) > 0.035;
            this.photos.push({
              id: pId,
              filename: p.filename || 'foto.jpg',
              dataUrl: p.dataUrl || p.url || '',
              originalDataUrl: p.dataUrl || p.url || '',
              naturalWidth: pWidth,
              naturalHeight: pHeight,
              is_portrait: !!(pHeight && pWidth && pHeight > pWidth * 1.05),
              is_mismatched: isMismatched,
              timeStr: assignedTimeStr,
              lat: p.lat || '',
              lon: p.lon || '',
              desa: p.desa || (this.villages[0]?.desa || ''),
              kecamatan: p.kecamatan || (this.villages[0]?.kecamatan || ''),
              kabupaten: p.kabupaten || this.getVillageKabupaten(this.villages[0]),
              provinsi: p.provinsi || 'Jawa Tengah',
              dusun: p.dusun || '',
              customAddress: p.custom_address || '',
              address_mode: p.address_mode || 'natural',
              font_scale: p.font_scale || 1.0,
              alreadyStamped: hasTs,
              has_timestamp: hasTs,
              is_original: hasTs,
              is_cropped: false
            });
          }
          this.renderPhotos();

          // Deteksi otomatis rasio foto yang tidak selaras (portrait / wide) dan sesuaikan ke 4:3
          const mismatchedPhotos = this.photos.filter(p => p.is_mismatched);
          if (mismatchedPhotos.length > 0) {
            setTimeout(async () => {
              for (const p of mismatchedPhotos) {
                await this.normalizePhotoAspect(p, 4 / 3);
              }
              this.renderPhotos();
            }, 100);
          }
        } else {
          this.renderPhotos();
        }
      }

      // Update Preview UI
      this.updateDocumentTitlePreview();
      this.updateSummaryBadge();

      // 6. Render Panel Audit Kelengkapan Dokumen
      if (data.audit_report) {
        this.currentLoadedDocxName = data.filename || (rawFiles.length === 1 ? rawFiles[0].name : 'Dokumen-Gabungan.docx');
        this.renderAuditCard(data.audit_report, this.currentLoadedDocxName, true);
      }

      this.updatePhotoUploadState();
      if (data.is_merged || rawFiles.length > 1) {
        const vCount = (this.villages || []).filter(v => v.desa).length;
        const pCount = (this.photos || []).length;
        this.showToast(`Berhasil menggabungkan ${data.merged_count || rawFiles.length} dokumen (${vCount} Desa, ${pCount} Foto). Nomor & Tanggal SPT dikosongkan untuk diisi manual.`, 'success', 6000);
      } else {
        this.showToast(`Dokumen "${rawFiles[0].name}" berhasil dibuka dan dianalisis.`, 'success');
      }

    } catch (err) {
      this.showToast('Gagal membaca dokumen: ' + (err.message || 'Terjadi kesalahan'), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origBtnHtml;
      }
      event.target.value = '';
    }
  }

  renderAuditCard(auditReport, filename, shouldScroll = false) {
    const card = document.getElementById('reportAuditCard');
    if (!card) return;

    card.style.display = 'block';
    if (shouldScroll) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const fnEl = document.getElementById('reportAuditFileName');
    if (fnEl && filename) fnEl.textContent = filename;

    const badge = document.getElementById('reportAuditBadge');
    const score = auditReport.score_percent || 0;
    if (badge) {
      badge.textContent = `${score}% Terisi (${auditReport.completed_count} Lengkap, ${auditReport.incomplete_count} Belum Lengkap)`;
      if (score >= 80) {
        badge.style.background = 'rgba(16, 185, 129, 0.2)';
        badge.style.color = '#34d399';
        badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      } else if (score >= 50) {
        badge.style.background = 'rgba(245, 158, 11, 0.2)';
        badge.style.color = '#fbbf24';
        badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      } else {
        badge.style.background = 'rgba(239, 68, 68, 0.2)';
        badge.style.color = '#f87171';
        badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      }
    }

    // Quick Audit Actions Bar (Kunci Segmen Lengkap & Buka Kunci)
    const actionsBarHtml = `
      <div class="report-audit-actions-bar">
        <div style="font-size:0.75rem; color:var(--text-dim); display:flex; align-items:center; gap:6px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>Perlindungan Data: Kunci segmen yang sudah lengkap agar tidak terubah saat pengolahan lanjutan.</span>
        </div>
        <div class="report-audit-actions-group">
          <button type="button" class="btn btn-secondary btn-xs" onclick="window.reportBuilder.lockAllCompleteSegments()" title="Kunci semua segmen data yang sudah lengkap">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Kunci Segmen Lengkap
          </button>
          <button type="button" class="btn btn-ghost btn-xs text-dim" onclick="window.reportBuilder.unlockAllSegments()" title="Buka seluruh kunci segmen">
            Buka Semua Kunci
          </button>
        </div>
      </div>
    `;

    const summaryEl = document.getElementById('reportAuditSummary');
    if (summaryEl) {
      summaryEl.textContent = auditReport.summary || '';
    }

    let existingBar = card.querySelector('.report-audit-actions-bar');
    if (!existingBar) {
      const summaryNode = document.getElementById('reportAuditSummary');
      if (summaryNode && summaryNode.parentNode) {
        summaryNode.insertAdjacentHTML('afterend', actionsBarHtml);
      }
    }

    const grid = document.getElementById('reportAuditGrid');
    if (grid && Array.isArray(auditReport.items)) {
      grid.innerHTML = auditReport.items.map((it, idx) => {
        const isComplete = it.status === 'complete';
        const cardBg = isComplete ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)';
        const cardBorder = isComplete ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)';
        const statusBadge = isComplete
          ? `<span style="color:#34d399; display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; background:rgba(16, 185, 129, 0.15); border:1px solid rgba(16, 185, 129, 0.35); border-radius:4px;" title="Lengkap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>`
          : `<span style="color:#fca5a5; display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; background:rgba(239, 68, 68, 0.15); border:1px solid rgba(239, 68, 68, 0.35); border-radius:4px;" title="Belum Lengkap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>`;

        let targetSegKey = '';
        if (['kabupaten', 'tahun', 'nomor_spt', 'tanggal_spt', 'tanggal_laporan', 'trip_dates'].includes(it.field)) {
          targetSegKey = 'administrasi';
        } else if (it.field === 'pelaksana') {
          targetSegKey = 'pelaksana';
        } else if (['villages', 'notes'].includes(it.field)) {
          targetSegKey = 'villages';
        } else if (it.field === 'photos') {
          targetSegKey = 'photos';
        }

        const isSegLocked = targetSegKey ? !!this.lockedSegments[targetSegKey] : false;
        const lockActionBtn = (isComplete && targetSegKey) ? `
          <button type="button" class="btn btn-ghost btn-xs" onclick="window.reportBuilder.toggleSegmentLock('${targetSegKey}')" style="padding:2px 6px; font-size:0.65rem; color:${isSegLocked ? '#facc15' : 'var(--text-dim)'}; display:inline-flex; align-items:center; gap:3px;" title="${isSegLocked ? 'Buka kunci segmen ini' : 'Kunci segmen ini'}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${isSegLocked ? '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' : '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'}</svg>
            <span>${isSegLocked ? 'Terkunci' : 'Kunci'}</span>
          </button>
        ` : '';

        return `
          <div style="background:${cardBg}; border:1px solid ${cardBorder}; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:4px; transition:all 0.2s ease;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="font-size:0.8rem; color:var(--text-main);">${idx + 1}. ${this.escapeHtml(it.label)}</strong>
              <div style="display:flex; align-items:center; gap:6px;">
                ${lockActionBtn}
                ${statusBadge}
              </div>
            </div>
            <div style="font-size:0.75rem; color:#cbd5e1; line-height:1.35; margin-top:2px;">
              ${this.escapeHtml(it.message)}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // =========================================================
  // DETEKSI OTOMATIS REAL-TIME PROGRES KELENGKAPAN DOKUMEN
  // =========================================================
  evaluateRealtimeAudit() {
    const items = [];

    // 1. Kabupaten
    if (this.kabupatens.length > 1) {
      items.push({
        field: 'kabupaten',
        status: 'complete',
        label: 'Kabupaten',
        message: `Terisi: Multi-Kabupaten (${this.kabupatens.map(k => 'Kab. ' + k).join(', ')})`
      });
    } else if (this.kabupatens.length === 1 || (this.kabupaten && this.kabupaten.trim())) {
      const kabDisp = this.kabupatens[0] || this.kabupaten.trim();
      items.push({
        field: 'kabupaten',
        status: 'complete',
        label: 'Kabupaten',
        message: `Terisi: Kabupaten ${kabDisp}`
      });
    } else {
      items.push({
        field: 'kabupaten',
        status: 'incomplete',
        label: 'Kabupaten',
        message: 'Nama kabupaten belum diisi'
      });
    }

    // 2. Nomor SPT
    const sptClean = (this.nomorSpt || '').trim();
    if (sptClean && this.sptSuffix) {
      items.push({
        field: 'nomor_spt',
        status: 'complete',
        label: 'Nomor SPT',
        message: `Terisi: ${sptClean}`
      });
    } else if (this.sptPrefix && !this.sptSuffix) {
      items.push({
        field: 'nomor_spt',
        status: 'incomplete',
        label: 'Nomor SPT',
        message: 'Nomor urut SPT (angka belakang) belum diisi'
      });
    } else {
      items.push({
        field: 'nomor_spt',
        status: 'incomplete',
        label: 'Nomor SPT',
        message: 'Nomor Surat Perintah Tugas (SPT) belum diisi'
      });
    }

    // 3. Tanggal SPT
    const tglSpt = (this.tanggalSpt || '').trim();
    if (tglSpt) {
      items.push({
        field: 'tanggal_spt',
        status: 'complete',
        label: 'Tanggal SPT',
        message: `Terisi: ${formatIndonesianDateOnly(tglSpt)}`
      });
    } else {
      items.push({
        field: 'tanggal_spt',
        status: 'incomplete',
        label: 'Tanggal SPT',
        message: 'Tanggal SPT kedinasan belum ditentukan'
      });
    }

    // 4. Jadwal Perjalanan Dinas
    const sDate = (this.tripStartDate || '').trim();
    const eDate = (this.tripEndDate || '').trim();
    const isMultiDayMode = (this.tripMode === 'multiple');
    if (sDate) {
      if (isMultiDayMode) {
        if (eDate && eDate >= sDate) {
          const durText = `${formatIndonesianDateOnly(sDate)} s/d ${formatIndonesianDateOnly(eDate)}`;
          items.push({
            field: 'trip_dates',
            status: 'complete',
            label: 'Jadwal Perjalanan Dinas',
            message: `Terisi: ${durText}`
          });
        } else if (eDate && eDate < sDate) {
          items.push({
            field: 'trip_dates',
            status: 'incomplete',
            label: 'Jadwal Perjalanan Dinas',
            message: 'Tanggal selesai dinas tidak boleh sebelum tanggal mulai'
          });
        } else {
          items.push({
            field: 'trip_dates',
            status: 'incomplete',
            label: 'Jadwal Perjalanan Dinas',
            message: 'Tanggal selesai dinas belum diisi (pilihan multiple hari)'
          });
        }
      } else {
        items.push({
          field: 'trip_dates',
          status: 'complete',
          label: 'Jadwal Perjalanan Dinas',
          message: `Terisi: ${formatIndonesianDateOnly(sDate)} (1 hari dinas)`
        });
      }
    } else {
      items.push({
        field: 'trip_dates',
        status: 'incomplete',
        label: 'Jadwal Perjalanan Dinas',
        message: 'Tanggal kegiatan perjalanan dinas belum ditentukan'
      });
    }

    // 5. Tanggal Laporan
    const tglLap = (this.tanggalLaporan || '').trim();
    const tglSptVal = (this.tanggalSpt || '').trim();
    const isMultiDay = isMultiDayMode && !!(sDate && eDate && sDate !== eDate);
    const lastTripDate = (isMultiDayMode ? eDate : sDate) || sDate || '';
    const hPlus1End = lastTripDate ? getNextDayIso(lastTripDate) : '';
    const hPlus1Spt = tglSptVal ? getNextDayIso(tglSptVal) : '';
    const expectedTglLap = isMultiDay ? hPlus1End : (hPlus1Spt || hPlus1End);

    if (!tglLap) {
      items.push({
        field: 'tanggal_laporan',
        status: 'incomplete',
        label: 'Tanggal Laporan',
        message: 'Tanggal laporan belum ditentukan'
      });
    } else {
      // Validasi ketentuan: H+1 hari kerja berikutnya dari hari akhir dinas / SPT (bukan weekend & bukan hari libur nasional)
      if (isMultiDay && tglLap === hPlus1End) {
        items.push({
          field: 'tanggal_laporan',
          status: 'complete',
          label: 'Tanggal Laporan',
          message: `Sesuai aturan: H+1 hari kerja akhir dinas (${formatIndonesianDateOnly(tglLap)})`
        });
      } else if (!isMultiDay && (tglLap === hPlus1Spt || tglLap === hPlus1End)) {
        items.push({
          field: 'tanggal_laporan',
          status: 'complete',
          label: 'Tanggal Laporan',
          message: `Sesuai aturan: H+1 hari kerja Tanggal SPT (${formatIndonesianDateOnly(tglLap)})`
        });
      } else if (!tglSptVal && !lastTripDate) {
        items.push({
          field: 'tanggal_laporan',
          status: 'complete',
          label: 'Tanggal Laporan',
          message: `Terisi: ${formatIndonesianDateOnly(tglLap)}`
        });
      } else {
        const saran = isMultiDay
          ? `H+1 hari kerja akhir dinas: ${formatIndonesianDateOnly(hPlus1End)}`
          : `H+1 hari kerja Tanggal SPT: ${formatIndonesianDateOnly(hPlus1Spt || hPlus1End)}`;

        items.push({
          field: 'tanggal_laporan',
          status: 'incomplete',
          label: 'Tanggal Laporan',
          message: `Perhatian: Tanggal laporan (${formatIndonesianDateOnly(tglLap)}) tidak sesuai ketentuan. Harusnya ${saran} (bukan akhir pekan/hari libur nasional).`
        });
      }
    }

    // 6. Tabel Pelaksana Kedinasan
    const validPelaksana = this.pelaksanaList.filter(p => p && p.trim());
    if (this.includePelaksana) {
      if (validPelaksana.length > 0) {
        items.push({
          field: 'pelaksana',
          status: 'complete',
          label: 'Tabel Pelaksana',
          message: `${validPelaksana.length} personel pelaksana terdaftar (tabel tanda tangan aktif)`
        });
      } else {
        items.push({
          field: 'pelaksana',
          status: 'incomplete',
          label: 'Tabel Pelaksana',
          message: 'Tabel tanda tangan aktif namun belum ada personel yang ditambahkan'
        });
      }
    } else {
      items.push({
        field: 'pelaksana',
        status: 'complete',
        label: 'Tabel Pelaksana',
        message: 'Format tanpa tabel tanda tangan pelaksana dipilih'
      });
    }

    // 7. Desa & Catatan Lapangan
    const validVillages = this.villages.filter(v => v.desa && v.desa.trim());
    const withNotes = validVillages.filter(v => (v.notes && v.notes.trim()) || (v.narrative && v.narrative.trim()));
    if (validVillages.length > 0 && withNotes.length === validVillages.length) {
      const vNames = validVillages.map(v => v.desa.trim()).join(', ');
      items.push({
        field: 'villages',
        status: 'complete',
        label: 'Desa & Narasi Capaian',
        message: `Lengkap: ${validVillages.length} desa (${vNames}) memiliki catatan/narasi lapangan`
      });
    } else if (validVillages.length > 0) {
      const missingCount = validVillages.length - withNotes.length;
      items.push({
        field: 'villages',
        status: 'incomplete',
        label: 'Desa & Narasi Capaian',
        message: `${validVillages.length} desa terdaftar, namun ${missingCount} desa belum memiliki catatan lapangan`
      });
    } else {
      items.push({
        field: 'villages',
        status: 'incomplete',
        label: 'Desa & Narasi Capaian',
        message: 'Belum ada nama desa dan catatan lapangan yang diisi'
      });
    }

    // 8. Foto Dokumentasi Lapangan
    if (this.photos.length > 0) {
      const stampedCount = this.photos.filter(p => p.has_timestamp || p.alreadyStamped || p.timeStr).length;
      if (stampedCount === this.photos.length) {
        items.push({
          field: 'photos',
          status: 'complete',
          label: 'Foto Dokumentasi',
          message: `Lengkap: ${this.photos.length} foto tersedia (seluruh foto telah memiliki timestamp GPS)`
        });
      } else if (stampedCount > 0) {
        items.push({
          field: 'photos',
          status: 'incomplete',
          label: 'Foto Dokumentasi',
          message: `${this.photos.length} foto tersedia (${stampedCount} bertimestamp, ${this.photos.length - stampedCount} belum). Klik 'Generate Timestamp Otomatis'`
        });
      } else {
        items.push({
          field: 'photos',
          status: 'incomplete',
          label: 'Foto Dokumentasi',
          message: `${this.photos.length} foto tersedia (BELUM bertimestamp GPS). Klik 'Generate Timestamp Otomatis'`
        });
      }
    } else {
      items.push({
        field: 'photos',
        status: 'incomplete',
        label: 'Foto Dokumentasi',
        message: 'Belum ada foto dokumentasi lapangan yang diunggah'
      });
    }

    const completedCount = items.filter(it => it.status === 'complete').length;
    const totalCount = items.length;
    const scorePct = Math.round((completedCount / totalCount) * 100);

    const auditReport = {
      score_percent: scorePct,
      completed_count: completedCount,
      incomplete_count: totalCount - completedCount,
      summary: `Progres kelengkapan dokumen terpantau ${scorePct}% secara real-time. ${completedCount} komponen lengkap, ${totalCount - completedCount} komponen siap dilengkapi sebelum unduh .docx.`,
      items: items
    };

    // Update Toolbar Score Badge
    const toolbarScore = document.getElementById('reportAuditToolbarScore');
    if (toolbarScore) {
      toolbarScore.textContent = `${scorePct}%`;
      toolbarScore.style.color = scorePct >= 80 ? '#34d399' : (scorePct >= 50 ? '#fbbf24' : '#cbd5e1');
    }

    // Update Status Toolbar
    const statusText = document.getElementById('reportStatusSummary');
    if (statusText) {
      statusText.textContent = `${validVillages.length} Desa • ${this.photos.length} Foto Dokumentasi`;
    }

    // Update State Tombol Download & Peringatan Kelengkapan (< 100%)
    const isComplete = (scorePct === 100);
    const btnDocx = document.getElementById('btnGenerateReportDocx');
    const warningContainer = document.getElementById('reportIncompleteWarning');
    const pctEl = document.getElementById('reportIncompletePercent');
    const itemsListEl = document.getElementById('reportIncompleteItemsList');

    if (btnDocx) {
      if (!isComplete) {
        btnDocx.disabled = true;
        btnDocx.classList.add('disabled');
        btnDocx.setAttribute('aria-disabled', 'true');
        btnDocx.title = `Kelengkapan dokumen belum 100% (${scorePct}%). Lengkapi seluruh data untuk mengunduh laporan.`;
      } else {
        btnDocx.disabled = false;
        btnDocx.classList.remove('disabled');
        btnDocx.removeAttribute('aria-disabled');
        btnDocx.title = 'Download & Susun Laporan Word (.docx) (Ctrl+S)';
      }
    }

    if (warningContainer) {
      if (!isComplete) {
        warningContainer.style.display = 'block';
        if (pctEl) pctEl.textContent = `${scorePct}%`;
        if (itemsListEl) {
          const incompleteItems = items.filter(it => it.status !== 'complete');
          const labels = incompleteItems.map(it => it.label).join(', ');
          itemsListEl.textContent = `Komponen belum lengkap: ${labels || 'Data belum terisi'}. Lengkapi seluruh data dan foto bertimestamp sebelum mengunduh.`;
        }
      } else {
        warningContainer.style.display = 'none';
      }
    }

    // Update Card jika card sedang terbuka
    const card = document.getElementById('reportAuditCard');
    if (card && card.style.display !== 'none') {
      const currentFileName = document.getElementById('reportAuditFileName')?.textContent || (this.currentLoadedDocxName || 'Dokumen Monev Pamsimas');
      this.renderAuditCard(auditReport, currentFileName, false);
    }

    return auditReport;
  }

  toggleAuditCard() {
    const card = document.getElementById('reportAuditCard');
    if (!card) return;
    if (card.style.display === 'none' || !card.style.display) {
      card.style.display = 'block';
      const curAudit = this.evaluateRealtimeAudit();
      const fn = document.getElementById('reportAuditFileName')?.textContent || (this.currentLoadedDocxName || 'Dokumen Monev Pamsimas');
      this.renderAuditCard(curAudit, fn, true);
    } else {
      card.style.display = 'none';
    }
  }

  updateSummaryBadge() {
    const badgeVillage = document.getElementById('reportVillagesBadge');
    if (badgeVillage) {
      badgeVillage.textContent = `${this.villages.length} Desa`;
    }
    const statusText = document.getElementById('reportStatusSummary');
    if (statusText) {
      const pelaksanaCount = this.includePelaksana ? this.pelaksanaList.filter(Boolean).length : 0;
      statusText.textContent = `${this.villages.length} Desa • ${pelaksanaCount > 0 ? pelaksanaCount + ' Pelaksana' : 'Tanpa Tabel Pelaksana'} • ${this.photos.length} Foto`;
    }
    this.evaluateRealtimeAudit();
  }

  // =========================================================
  // GENERATE AND DOWNLOAD WORD (.DOCX)
  // =========================================================
  async generateDocx() {
    if (this.isGenerating) return;

    // Validasi & Deny proses generate jika kelengkapan belum 100%
    const currentAudit = this.evaluateRealtimeAudit();
    if (currentAudit.score_percent < 100) {
      const incomplete = currentAudit.items
        .filter(it => it.status !== 'complete')
        .map(it => it.label)
        .join(', ');
      this.showWarningNotice(`Kelengkapan belum 100% (saat ini ${currentAudit.score_percent}%). Komponen belum lengkap: ${incomplete}. Lengkapi seluruh data sebelum mengunduh laporan.`);
      const warningContainer = document.getElementById('reportIncompleteWarning');
      if (warningContainer) {
        warningContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }

    if (this.villages.length === 0) {
      this.showToast('Tambahkan minimal satu desa.', 'warning');
      return;
    }

    const genButtons = Array.from(document.querySelectorAll('#btnGenerateReportDocx, #btnGenerateReportDocxBottom'));
    const originalTexts = genButtons.map(b => b.innerHTML);
    genButtons.forEach(b => {
      b.disabled = true;
      b.innerHTML = `
        <span class="spinner-border spinner-border-sm" role="status" style="width:14px; height:14px; border-width:2px; display:inline-block; border-radius:50%; border-top-color:#fff; animation:spin 0.6s linear infinite; margin-right:6px;"></span>
        Membuat Dokumen Word...
      `;
    });

    this.isGenerating = true;

    try {
      const reportData = {
        kabupaten: this.kabupaten,
        kabupatens: this.kabupatens,
        tahun: this.tahun,
        nomor_spt: this.nomorSpt,
        tanggal_spt: toIndonesianDateText(this.tanggalSpt),
        tanggal_laporan: toIndonesianDateText(this.tanggalLaporan),
        tempat_pembuatan: this.tempatPembuatan,
        trip_start_date: this.tripStartDate,
        trip_end_date: (this.tripMode === 'multiple') ? this.tripEndDate : '',
        pelaksana: this.includePelaksana ? this.pelaksanaList.filter(Boolean) : [],
        villages: this.villages.map(v => ({
          desa: v.desa,
          kecamatan: v.kecamatan,
          kabupaten: v.kabupaten || this.kabupatens[0] || this.kabupaten,
          notes: v.notes,
          narrative: v.narrative || ''
        }))
      };

      const payload = {
        report_data: reportData,
        photos: this.photos.map(p => {
          let pKab = p.kabupaten;
          if (!pKab && p.desa) {
            const vMatch = this.villages.find(v => (v.desa || '').trim().toLowerCase() === (p.desa || '').trim().toLowerCase());
            if (vMatch && vMatch.kabupaten) {
              pKab = vMatch.kabupaten;
            }
          }
          if (!pKab) {
            pKab = this.kabupatens[0] || this.kabupaten || 'Magelang';
          }
          return {
            dataUrl: p.dataUrl,
            filename: p.filename,
            time_str: p.timeStr,
            lat: p.lat,
            lon: p.lon,
            desa: p.desa,
            kecamatan: p.kecamatan,
            kabupaten: pKab,
            provinsi: p.provinsi || 'Jawa Tengah',
            custom_address: p.customAddress || '',
            address_mode: p.address_mode || 'natural',
            font_scale: p.font_scale || 1.0,
            already_stamped: !!(p.is_original || p.alreadyStamped),
            is_original: !!(p.is_original || p.alreadyStamped),
            keep_original: !!(p.is_original || p.alreadyStamped)
          };
        })
      };

      const res = await fetch('/api/report/generate_docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.success) {
        const errText = data?.error || (res.status === 503
          ? 'Koneksi internet tidak terhubung atau layanan AI sedang tidak dapat dijangkau. Pembuatan laporan dihentikan agar catatan lapangan dapat diolah secara lengkap.'
          : `Gagal membuat dokumen (Status ${res.status}).`);
        this.showWarningNotice(errText);
        return;
      }

      if (data.download_url) {
        if (data.villages && Array.isArray(data.villages)) {
          data.villages.forEach((retV, i) => {
            if (this.villages[i] && retV.narrative) {
              this.villages[i].narrative = retV.narrative;
            }
          });
        }

        const a = document.createElement('a');
        a.href = data.download_url;
        a.download = data.filename || 'Laporan_Monev_Pamsimas.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        const warningEl = document.getElementById('reportWarningNotice');
        if (warningEl) warningEl.style.display = 'none';

        const noticeEl = document.getElementById('reportSuccessNotice');
        if (noticeEl) {
          noticeEl.style.display = 'flex';
          noticeEl.scrollIntoView({ behavior: 'smooth' });
          setTimeout(() => {
            noticeEl.style.display = 'none';
          }, 6000);
        }
        this.showToast('Dokumen Word (.docx) berhasil dibuat dan diunduh.', 'success');
      }
    } catch (e) {
      this.showWarningNotice('Gagal menghubungi server: ' + (e.message || 'Periksa koneksi internet Anda.'));
    } finally {
      this.isGenerating = false;
      genButtons.forEach((b, idx) => {
        b.disabled = false;
        b.innerHTML = originalTexts[idx];
      });
    }
  }

  showWarningNotice(msg) {
    const successNotice = document.getElementById('reportSuccessNotice');
    if (successNotice) successNotice.style.display = 'none';

    const warningEl = document.getElementById('reportWarningNotice');
    const warningText = document.getElementById('reportWarningText');
    const defaultMsg = 'Koneksi internet tidak terhubung atau layanan AI sedang tidak dapat dijangkau. Pembuatan laporan dihentikan agar catatan lapangan dapat diolah secara lengkap.';
    const finalMsg = msg || defaultMsg;

    if (warningText) {
      warningText.textContent = finalMsg;
    }
    if (warningEl) {
      warningEl.style.display = 'flex';
      warningEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (window.errorCatcher && typeof window.errorCatcher.showToast === 'function') {
      window.errorCatcher.showToast(finalMsg, 'warning');
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
