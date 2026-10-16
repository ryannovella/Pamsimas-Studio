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
import { KNOWN_COORDS_FRONTEND } from './config.js';
import { renderStampedPhoto } from './canvasRenderer.js';

export class ReportBuilder {
  constructor() {
    this.kabupaten = '';
    this.tahun = '2026';
    this.nomorSpt = '';
    this.tanggalSpt = '';
    this.tanggalLaporan = '';
    this.tempatPembuatan = 'Semarang';
    this.includePelaksana = true;
    this.pelaksanaList = [];
    this.personelMaster = [];
    this.villages = [
      {
        id: 'v_init',
        desa: '',
        kecamatan: '',
        notes: '',
        narrative: ''
      }
    ];
    this.photos = [];
    this.selectedPhotoIds = new Set();
    this.activePhotoId = null;
    this.showRawGrid = false;
    this.modalShowRaw = false;
    this.imageCache = new Map();
    this.locations = [];
    this.isGenerating = false;

    // Perjalanan Dinas & Jam Kerja
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
    await this.fetchLocations();
    await this.fetchPersonel();
    this.renderPelaksanaList();
    this.renderVillages();
    this.renderPhotos();
    this.updateDocumentTitlePreview();
    this.updateSummaryBadge();
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

    if (this.quickDate && !this.quickDate.value) {
      this.quickDate.value = this.getSurveyIsoDate();
    }

    // Modal elements
    this.modal = document.getElementById('docEditModal');
    this.modalTitle = document.getElementById('modalTitle');
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

  initTripPanel() {
    const sInput = document.getElementById('reportTripStartDate');
    const eInput = document.getElementById('reportTripEndDate');
    const tStart = document.getElementById('reportTripStartTime');
    const tEnd = document.getElementById('reportTripEndTime');

    const defaultIso = this.getSurveyIsoDate();
    if (sInput && !sInput.value) {
      sInput.value = defaultIso;
      this.tripStartDate = defaultIso;
    }
    if (eInput && !eInput.value) {
      this.tripEndDate = '';
    }
    if (tStart) this.tripStartTime = tStart.value || '09:14:23';
    if (tEnd) this.tripEndTime = tEnd.value || '15:47:38';

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

    this.onTripDatesChange();
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
    const dlKab = document.getElementById('reportKabupatenList');
    if (dlKab && this.locations.length > 0) {
      const uniqueKabs = [...new Set(this.locations.map(l => l.kabupaten.replace(/^(?:Kabupaten|Kota)\s*/i, '').trim()))].sort();
      dlKab.innerHTML = uniqueKabs.map(k => `<option value="${k}">`).join('');
    }

    const dlDesa = document.getElementById('reportDesaDatalist');
    if (dlDesa && this.locations.length > 0) {
      dlDesa.innerHTML = this.locations.map(l => {
        const kabClean = (l.kabupaten || '').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
        return `<option value="${this.escapeHtml(l.desa)}">Kec. ${this.escapeHtml(l.kecamatan)} (Kab. ${this.escapeHtml(kabClean)})</option>`;
      }).join('');
    }

    // Refresh rendering desa setelah master lokasi termuat agar dropdown autofill terisi lengkap
    if (this.villages && this.villages.length > 0) {
      this.renderVillages();
    }
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

    const datalist = document.getElementById('reportPersonelDatalist');
    if (datalist) {
      datalist.innerHTML = this.personelMaster.map(n => `<option value="${this.escapeHtml(n)}">${this.escapeHtml(n)}</option>`).join('');
    }
  }

  onPersonelInput(event) {
    const val = (event.target.value || '').trim();
    if (!val) return;

    // Cek apakah nilai cocok persis dengan salah satu nama di master personel (indikasi user klik salah satu opsi dari datalist/auto-suggest)
    const exactMatch = this.personelMaster.find(n => n.toLowerCase() === val.toLowerCase());
    if (exactMatch) {
      this.addPelaksana(exactMatch);
      event.target.value = '';
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
      event.preventDefault();
      this.addPelaksanaFromInput();
    }
  }

  addPelaksanaFromInput() {
    const inp = document.getElementById('reportPersonelInput');
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) {
      alert('Silakan ketik atau pilih nama personel terlebih dahulu.');
      return;
    }
    // Jika cocok dengan master personel (menggunakan pencarian cerdas prefix/nama), gunakan format master agar gelar rapi
    const matched = this.findBestMatch(val, this.personelMaster || []);
    this.addPelaksana(matched || val);
    inp.value = '';
  }

  bindStaticEvents() {
    // Kabupaten change & Enter Autocomplete
    const kabInput = document.getElementById('reportKabupaten');
    if (kabInput) {
      kabInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = kabInput.value.trim();
          if (val && this.locations && this.locations.length > 0) {
            const uniqueKabs = [...new Set(this.locations.map(l => l.kabupaten.replace(/^(?:Kabupaten|Kota)\s*/i, '').trim()))];
            const matchedKab = this.findBestMatch(val, uniqueKabs);
            if (matchedKab) {
              kabInput.value = matchedKab;
              this.kabupaten = matchedKab;
              if (this.quickKab) this.quickKab.value = this.kabupaten;
              this.updateDocumentTitlePreview();
              this.evaluateRealtimeAudit();
              kabInput.blur();
            }
          }
        }
      });
      kabInput.addEventListener('input', (e) => {
        this.kabupaten = e.target.value.trim();
        if (this.quickKab && !this.quickKab.value) {
          this.quickKab.value = this.kabupaten;
        }
        this.updateDocumentTitlePreview();
        this.evaluateRealtimeAudit();
      });
    }

    // Tahun change
    const tahunInput = document.getElementById('reportTahun');
    if (tahunInput) {
      tahunInput.addEventListener('input', (e) => {
        this.tahun = e.target.value.trim() || '2026';
        this.updateDocumentTitlePreview();
        this.evaluateRealtimeAudit();
      });
    }

    // Nomor SPT change
    const sptInput = document.getElementById('reportNomorSpt');
    if (sptInput) {
      sptInput.addEventListener('input', (e) => {
        this.nomorSpt = e.target.value.trim();
        this.evaluateRealtimeAudit();
      });
    }

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
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-active');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this.handlePhotoFiles(Array.from(e.dataTransfer.files));
        }
      });
    }
  }

  // =========================================================
  // TANGGAL SPT & TANGGAL LAPORAN (DATE PICKER & AUTO H+1)
  // =========================================================
  setReportTanggalLaporan(isoDate, isManual = false) {
    this.tanggalLaporan = isoDate || '';
    const el = document.getElementById('reportTanggalLaporan');
    if (el && el.value !== this.tanggalLaporan) {
      el.value = this.tanggalLaporan;
    }
    const tag = document.getElementById('reportTanggalLaporanTag');
    if (tag) {
      tag.textContent = isManual ? '(Manual)' : '(H+1 SPT)';
      tag.style.color = isManual ? '#f59e0b' : '#38bdf8';
      tag.title = isManual ? 'Tanggal laporan diubah manual' : 'Otomatis dihitung H+1 dari Tanggal SPT';
    }
    this.updateTanggalLaporanPreview();
    this.evaluateRealtimeAudit();
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

  setReportTanggalSpt(isoDate) {
    this.tanggalSpt = isoDate || '';
    const el = document.getElementById('reportTanggalSpt');
    if (el && el.value !== this.tanggalSpt) {
      el.value = this.tanggalSpt;
    }
    this.updateTanggalSptPreview();
    this.evaluateRealtimeAudit();
  }

  updateTanggalSptPreview() {
    const previewEl = document.getElementById('reportTanggalSptPreview');
    if (previewEl) {
      previewEl.textContent = this.tanggalSpt ? formatIndonesianDateOnly(this.tanggalSpt) : '';
    }
  }

  onTanggalSptChange(val) {
    this.setReportTanggalSpt(val);
    if (val) {
      const hPlus1 = getNextDayIso(val);
      if (hPlus1) {
        this.setReportTanggalLaporan(hPlus1, false);
      }
    } else {
      this.setReportTanggalLaporan('', false);
    }
  }

  updateDocumentTitlePreview() {
    const el = document.getElementById('reportTitlePreview');
    if (el) {
      const kabClean = (this.kabupaten || '').replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
      if (kabClean) {
        el.textContent = `Monitoring dan Evaluasi Kegiatan Pamsimas Kabupaten ${kabClean} TA ${this.tahun}`;
      } else {
        el.textContent = `Monitoring dan Evaluasi Kegiatan Pamsimas TA ${this.tahun}`;
      }
    }
  }

  // =========================================================
  // PERJALANAN DINAS & RENTANG JAM MANAGEMENT
  // =========================================================
  onTripDatesChange() {
    const sInput = document.getElementById('reportTripStartDate');
    const eInput = document.getElementById('reportTripEndDate');
    const badge = document.getElementById('reportTripDurationBadge');

    const sVal = sInput?.value || this.getSurveyIsoDate();
    const eVal = eInput?.value || '';

    this.tripStartDate = sVal;
    this.tripEndDate = eVal;

    if (!badge) return;

    if (!eVal || eVal === sVal) {
      badge.textContent = `1 Hari (${formatIndonesianDateOnly(sVal)})`;
      badge.style.background = 'rgba(56,189,248,0.15)';
      badge.style.color = '#38bdf8';
    } else {
      const sParts = sVal.split('-').map(Number);
      const eParts = eVal.split('-').map(Number);
      const sDate = new Date(sParts[0], sParts[1] - 1, sParts[2]);
      const eDate = new Date(eParts[0], eParts[1] - 1, eParts[2]);
      const diffDays = Math.max(1, Math.round((eDate - sDate) / (1000 * 60 * 60 * 24)) + 1);

      badge.textContent = `${diffDays} Hari (${formatIndonesianDateOnly(sVal)} s/d ${formatIndonesianDateOnly(eVal)})`;
      badge.style.background = 'rgba(16,185,129,0.18)';
      badge.style.color = '#34d399';
    }
  }

  randomizeWorkHours(showToast = true) {
    // Generate natural non-round start hour: 08:35 - 09:25 (avoid multiples of 5)
    const startHourPool = [8, 9];
    const sH = startHourPool[Math.floor(Math.random() * startHourPool.length)];
    const sMPool = sH === 8 ? [37, 41, 46, 48, 52, 56] : [7, 11, 14, 18, 22, 26];
    const sM = sMPool[Math.floor(Math.random() * sMPool.length)];
    const sSPool = [17, 21, 23, 27, 34, 38, 42, 47, 53];
    const sS = sSPool[Math.floor(Math.random() * sSPool.length)];

    // Generate natural non-round end hour: 15:15 - 16:20 (avoid multiples of 5)
    const endHourPool = [15, 16];
    const eH = endHourPool[Math.floor(Math.random() * endHourPool.length)];
    const eMPool = eH === 15 ? [33, 37, 42, 47, 52, 58] : [6, 12, 17, 23];
    const eM = eMPool[Math.floor(Math.random() * eMPool.length)];
    const eSPool = [19, 23, 28, 32, 38, 43, 49, 54];
    const eS = eSPool[Math.floor(Math.random() * eSPool.length)];

    const tStartStr = `${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}:${String(sS).padStart(2, '0')}`;
    const tEndStr = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}:${String(eS).padStart(2, '0')}`;

    const tStart = document.getElementById('reportTripStartTime');
    const tEnd = document.getElementById('reportTripEndTime');
    if (tStart) tStart.value = tStartStr;
    if (tEnd) tEnd.value = tEndStr;

    this.tripStartTime = tStartStr;
    this.tripEndTime = tEndStr;

    if (showToast) {
      alert(`Jam dinas lapangan berhasil divariasikan:\n- Mulai: ${tStartStr} WIB\n- Selesai: ${tEndStr} WIB\n(Semua menit & detik berupa angka non-mainstream alami)`);
    }
  }

  // =========================================================
  // ONE-CLICK AUTO GENERATE TIMESTAMPS FOR ALL PHOTOS
  // =========================================================
  autoGenerateAllTimestamps() {
    if (this.photos.length === 0) {
      alert('Silakan unggah foto dokumentasi terlebih dahulu.');
      return;
    }

    const validVillages = this.villages.filter(v => v.desa && v.desa.trim());
    if (validVillages.length === 0) {
      alert('Harap isi minimal 1 Nama Desa pada Section 3 (Data Desa & Catatan Lapangan) terlebih dahulu agar alokasi stempel tepat sasaran.');
      return;
    }

    const sInput = document.getElementById('reportTripStartDate');
    const eInput = document.getElementById('reportTripEndDate');
    const tStart = document.getElementById('reportTripStartTime');
    const tEnd = document.getElementById('reportTripEndTime');

    const startIso = sInput?.value || this.getSurveyIsoDate();
    const endIso = eInput?.value || startIso;
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
      tz: 'WIB'
    });

    if (!schedule || schedule.length === 0) {
      alert('Gagal menghasilkan jadwal foto.');
      return;
    }

    // 2. Terapkan jadwal, koordinat acak terarah, dan wilayah ke tiap foto
    this.photos.forEach((photo, idx) => {
      const item = schedule[idx] || schedule[0];
      const targetVillage = item.village || validVillages[0];

      photo.timeStr = item.timeStr;
      photo.desa = targetVillage.desa || photo.desa || '';
      photo.kecamatan = targetVillage.kecamatan || photo.kecamatan || '';
      photo.kabupaten = this.kabupaten || 'Magelang';
      photo.provinsi = 'Jawa Tengah';

      // Titik koordinat acak terarah di area desa terkait
      const baseCoords = this.getVillageCoordinates(photo.desa, photo.kabupaten);
      const jittered = applyGpsJitter(baseCoords.lat, baseCoords.lon, 8, 35);
      photo.lat = jittered.lat;
      photo.lon = jittered.lon;

      // Reset status original agar live stamp aktif
      photo.alreadyStamped = false;
      photo.is_original = false;
      photo.keep_original = false;
    });

    this.renderPhotos();
    this.updateBatchBar();

    const vNames = validVillages.map(v => v.desa).join(' & ');
    alert(`Sukses men-generate Timestamp Otomatis untuk ${this.photos.length} foto!\n- Desa: Dibagi merata untuk ${validVillages.length} desa (${vNames})\n- Tanggal: ${formatIndonesianDateOnly(startIso)}${endIso && endIso !== startIso ? ' s/d ' + formatIndonesianDateOnly(endIso) : ''}\n- Jam: Urut & merata (${startTimeStr.slice(0, 5)} - ${endTimeStr.slice(0, 5)} WIB)\n- Koordinat: GPS Jitter terarah unik per foto di wilayah desa masing-masing\n- Live Stamp seketika aktif pada seluruh kartu foto!`);
  }

  getVillageCoordinates(desaName, kabName) {
    const cleanDesa = (desaName || '').trim().toLowerCase().replace(/^desa\s+/, '');
    if (cleanDesa && KNOWN_COORDS_FRONTEND && KNOWN_COORDS_FRONTEND[cleanDesa]) {
      return {
        lat: KNOWN_COORDS_FRONTEND[cleanDesa].lat,
        lon: KNOWN_COORDS_FRONTEND[cleanDesa].lon
      };
    }

    const cleanKab = (kabName || this.kabupaten || '').trim().toLowerCase();
    if (cleanKab.includes('wonogiri')) {
      return { lat: '-7.813600', lon: '110.925400' };
    } else if (cleanKab.includes('magelang')) {
      return { lat: '-7.585500', lon: '110.297400' };
    } else if (cleanKab.includes('kebumen')) {
      return { lat: '-7.669800', lon: '109.652100' };
    } else if (cleanKab.includes('purbalingga')) {
      return { lat: '-7.388500', lon: '109.363800' };
    } else if (cleanKab.includes('banjarnegara')) {
      return { lat: '-7.398700', lon: '109.697400' };
    } else if (cleanKab.includes('boyolali')) {
      return { lat: '-7.536000', lon: '110.596000' };
    }
    return { lat: '-7.500000', lon: '110.500000' };
  }

  // =========================================================
  // PELAKSANA MONEV MANAGEMENT
  // =========================================================
  addPelaksana(name = '') {
    const cleanName = name.trim();
    if (cleanName && !this.pelaksanaList.includes(cleanName)) {
      this.pelaksanaList.push(cleanName);
    } else if (!cleanName) {
      this.pelaksanaList.push('');
    }
    this.renderPelaksanaList();
    this.updateSummaryBadge();
  }

  removePelaksana(index) {
    this.pelaksanaList.splice(index, 1);
    this.renderPelaksanaList();
    this.updateSummaryBadge();
  }

  clearPelaksana() {
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
      listEl.innerHTML = `
        <div class="empty-hint" style="padding:10px 12px; font-size:0.75rem; color:var(--text-muted); background:rgba(255,255,255,0.02); border-radius:6px; border:1px dashed var(--border-color);">
          Belum ada personel yang ditambahkan. Cari nama pegawai BPBPK atau ketik nama luar pada kolom di atas (klik saran untuk otomatis menambahkan).
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.pelaksanaList.map((nama, idx) => `
      <div class="pelaksana-row" style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <span class="font-mono" style="font-size:0.72rem; color:var(--text-dim); min-width:20px;">${idx + 1}.</span>
        <input type="text" class="form-input form-input-sm" value="${this.escapeHtml(nama)}" placeholder="Nama Lengkap & Gelar Pegawai BPBPK" style="flex:1;" oninput="window.reportBuilder.onPelaksanaChange(${idx}, this.value)">
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
    const vId = 'v_' + Math.random().toString(36).substr(2, 9);
    const v = data || {
      id: vId,
      desa: '',
      kecamatan: '',
      notes: '',
      narrative: ''
    };
    if (!v.id) v.id = vId;
    this.villages.push(v);
    this.renderVillages();
    this.updateQuickVillageTargetOptions();
    this.updateSummaryBadge();
  }

  removeVillage(id) {
    if (this.villages.length <= 1) {
      alert('Dokumen minimal harus memuat satu desa.');
      return;
    }
    this.villages = this.villages.filter(v => v.id !== id);
    this.renderVillages();
    this.updateQuickVillageTargetOptions();
    this.updateSummaryBadge();
  }

  renderVillages() {
    const container = document.getElementById('reportVillagesContainer');
    if (!container) return;

    container.innerHTML = this.villages.map((v, idx) => `
      <div class="village-card" id="card_${v.id}" style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:12px 14px; margin-bottom:12px; position:relative;">
        <div class="village-card-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid var(--border-color); padding-bottom:6px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="badge" style="background:#2563eb; color:#fff; font-size:0.7rem; font-weight:700;">Desa #${idx + 1}</span>
            <strong style="font-size:0.85rem; color:var(--text-main);" id="vTitle_${v.id}">
              ${v.desa ? 'Desa ' + this.escapeHtml(v.desa) : 'Desa Baru'}
              ${v.kecamatan ? ' (' + this.escapeHtml(v.kecamatan) + ')' : ''}
            </strong>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${this.villages.length > 1 ? `
              <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="window.reportBuilder.removeVillage('${v.id}')" title="Hapus desa ini">
                Hapus
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Baris 1: Dropdown Autofill Desa (Kecamatan Otomatis) -->
        <div style="margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
            <label class="form-label" style="font-size:0.7rem; color:var(--text-muted); margin:0; display:inline-flex; align-items:center; gap:4px;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              Pilih dari database:
            </label>
            <span id="autofillNotice_${v.id}" style="font-size:0.67rem; color:#10b981; font-weight:600; display:none;">
              Kecamatan otomatis disesuaikan
            </span>
          </div>
          <select class="form-select form-input-sm" style="width:100%; font-size:0.75rem; border-color:rgba(56,189,248,0.35); background:rgba(56,189,248,0.04); color:#38bdf8;" onchange="window.reportBuilder.onSelectDesaPreset('${v.id}', this.value)">
            ${this.renderDesaSelectOptions(v)}
          </select>
        </div>

        <!-- Baris 2: Nama Desa (dengan Datalist) & Kecamatan (Autofill) -->
        <div class="form-row" style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:8px;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" style="font-size:0.7rem; color:var(--text-muted);">Nama Desa</label>
            <input type="text" id="desa_${v.id}" list="reportDesaDatalist" class="form-input form-input-sm" value="${this.escapeHtml(v.desa)}" placeholder="Contoh: Mojosari (Enter untuk cari)" oninput="window.reportBuilder.onVillageFieldChange('${v.id}', 'desa', this.value)" onkeydown="window.reportBuilder.onVillageFieldKeydown(event, '${v.id}', 'desa')">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" style="font-size:0.7rem; color:var(--text-muted);">Kecamatan (Otomatis)</label>
            <input type="text" id="kec_${v.id}" class="form-input form-input-sm" value="${this.escapeHtml(v.kecamatan)}" placeholder="Contoh: Karanggede (Enter untuk cari)" oninput="window.reportBuilder.onVillageFieldChange('${v.id}', 'kecamatan', this.value)" onkeydown="window.reportBuilder.onVillageFieldKeydown(event, '${v.id}', 'kecamatan')">
          </div>
        </div>

        <!-- Baris 3: Catatan Lapangan -->
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" style="font-size:0.7rem; font-weight:600; color:var(--text-main); margin-bottom:4px; display:block;">
            Catatan Lapangan
          </label>
          <textarea class="form-textarea" rows="3" placeholder="Tulis catatan lapangan di sini..." style="font-size:0.75rem; font-family:var(--font-sans); line-height:1.45;" oninput="window.reportBuilder.onVillageFieldChange('${v.id}', 'notes', this.value)">${this.escapeHtml(v.notes)}</textarea>
        </div>
      </div>
    `).join('');
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

    // Otomatis update form kabupaten jika belum diisi atau masih kosong
    if (kabName && (!this.kabupaten || this.kabupaten.trim() === '')) {
      const kabClean = kabName.replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
      this.kabupaten = kabClean;
      const kabInput = document.getElementById('reportKabupaten');
      if (kabInput) kabInput.value = kabClean;
      this.updateDocumentTitlePreview();
    }

    // Update DOM inputs langsung tanpa merusak fokus atau form lain
    const inpDesa = document.getElementById(`desa_${v.id}`);
    const inpKec = document.getElementById(`kec_${v.id}`);
    const vTitle = document.getElementById(`vTitle_${v.id}`);
    const notice = document.getElementById(`autofillNotice_${v.id}`);

    if (inpDesa) inpDesa.value = desaName;
    if (inpKec) inpKec.value = kecName;
    if (vTitle) {
      vTitle.textContent = `Desa ${desaName}${kecName ? ' (' + kecName + ')' : ''}`;
    }
    if (notice) {
      notice.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" style="vertical-align:middle; margin-right:3px;"><polyline points="20 6 9 17 4 12"/></svg> Kecamatan ${kecName} otomatis disesuaikan`;
      notice.style.display = 'inline';
      setTimeout(() => {
        const el = document.getElementById(`autofillNotice_${villageId}`);
        if (el) el.style.display = 'none';
      }, 4000);
    }

    this.updateQuickVillageTargetOptions();
    this.updateSummaryBadge();
  }

  onVillageFieldChange(id, field, value) {
    const v = this.villages.find(item => item.id === id);
    if (v) {
      v[field] = value;
      if (field === 'notes') {
        // Reset narrative agar backend selalu menyusun narasi profesional baru dari catatan lapangan ini
        v.narrative = '';
      }

      // AUTOFILL KECAMATAN OTOMATIS KETIKA DESA DIKETIK
      if (field === 'desa') {
        const match = this.getLocationMatch(value);
        if (match && match.kecamatan) {
          v.kecamatan = match.kecamatan;
          const inpKec = document.getElementById(`kec_${id}`);
          if (inpKec) inpKec.value = match.kecamatan;

          const notice = document.getElementById(`autofillNotice_${id}`);
          if (notice) {
            notice.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" style="vertical-align:middle; margin-right:3px;"><polyline points="20 6 9 17 4 12"/></svg> Kecamatan ${match.kecamatan} otomatis disesuaikan`;
            notice.style.display = 'inline';
            setTimeout(() => {
              const el = document.getElementById(`autofillNotice_${id}`);
              if (el) el.style.display = 'none';
            }, 4000);
          }

          // Otomatis isi kabupaten jika belum diisi
          if (match.kabupaten && (!this.kabupaten || this.kabupaten.trim() === '')) {
            const kabClean = match.kabupaten.replace(/^(?:Kabupaten|Kota)\s*/i, '').trim();
            this.kabupaten = kabClean;
            const kabInput = document.getElementById('reportKabupaten');
            if (kabInput) kabInput.value = kabClean;
            this.updateDocumentTitlePreview();
          }
        }
      }

      if (field === 'desa' || field === 'kecamatan') {
        const titleEl = document.getElementById(`vTitle_${id}`);
        if (titleEl) {
          titleEl.textContent = `${v.desa ? 'Desa ' + v.desa : 'Desa Baru'}${v.kecamatan ? ' (' + v.kecamatan + ')' : ''}`;
        }
        this.updateQuickVillageTargetOptions();
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
      const label = `Desa ${dName}${kName ? ' (' + kName + ')' : ''}`;
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
      if (this.quickKab) this.quickKab.value = this.kabupaten || '';
      this.onQuickDesaInput(matched.desa);
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
      alert('Belum ada foto dokumentasi yang diunggah. Silakan unggah foto terlebih dahulu.');
      return;
    }

    let targetPhotos = [];
    if (target === 'selected') {
      if (this.selectedPhotoIds.size === 0) {
        alert('Pilih minimal satu foto dengan mencentang kotak pada foto terlebih dahulu!');
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
      if (kab) p.kabupaten = kab;
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
          const jittered = applyGpsJitter(lat, lon, 6, 22);
          p.lat = jittered.lat;
          p.lon = jittered.lon;
        } else {
          p.lat = lat;
          p.lon = lon;
        }
      }
    });

    this.renderPhotos();
    this.updateBatchBar();
    alert(`Berhasil menerapkan pengaturan lanjutan ke ${targetPhotos.length} foto!`);
  }

  // =========================================================
  // FIELD PHOTOS MANAGEMENT & CANVAS RENDERING
  // =========================================================
  getSurveyIsoDate() {
    if (this.tripStartDate) return this.tripStartDate;
    if (this.tanggalLaporan) {
      const parsed = parseIndonesianTimestamp(this.tanggalLaporan);
      if (parsed && parsed.isoDate) return parsed.isoDate;
    }
    return new Date().toISOString().slice(0, 10);
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

    const validFiles = fileList.filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) return;

    const newlyLoadedPhotos = [];

    for (const file of validFiles) {
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
      });

      const imgInfo = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = dataUrl;
      });

      const isPortrait = imgInfo.height > imgInfo.width;
      const photoId = 'p_' + Math.random().toString(36).substr(2, 9);

      const photoItem = {
        id: photoId,
        filename: file.name,
        dataUrl: dataUrl,
        originalDataUrl: dataUrl,
        naturalWidth: imgInfo.width,
        naturalHeight: imgInfo.height,
        is_portrait: isPortrait,
        timeStr: '',
        lat: '',
        lon: '',
        desa: this.villages[0]?.desa || '',
        kecamatan: this.villages[0]?.kecamatan || '',
        kabupaten: this.kabupaten,
        provinsi: 'Jawa Tengah',
        dusun: '',
        customAddress: '',
        address_mode: 'natural',
        font_scale: 1.0,
        alreadyStamped: false,
        is_original: false,
        is_cropped: false
      };
      this.photos.push(photoItem);
      newlyLoadedPhotos.push(photoItem);
    }

    // Periksa apakah ada foto berorientasi Portrait (Tegak)
    const portraitPhotos = newlyLoadedPhotos.filter(p => p.is_portrait);
    if (portraitPhotos.length > 0) {
      const confirmCrop = confirm(
        `Terdeteksi ${portraitPhotos.length} foto berorientasi Portrait (Tegak).\n\n` +
        `Format tabel foto laporan resmi Kementerian PU menggunakan rasio Landscape (4:3) agar tampilan serasi, sejajar, dan proporsional.\n\n` +
        `Klik 'OK' untuk menyesuaikan otomatis (Center-Crop ke 4:3) pada foto-foto tersebut.\n` +
        `Klik 'Cancel' untuk tetap mempertahankan foto asli apa adanya.`
      );
      if (confirmCrop) {
        for (const p of portraitPhotos) {
          await this.normalizePhotoAspect(p, 4 / 3);
        }
      }
    }

    // Otomatis jalankan generate timestamp merata jika desa sudah terisi
    const validVillages = this.villages.filter(v => v.desa && v.desa.trim());
    if (validVillages.length > 0) {
      this.autoGenerateAllTimestamps();
    } else {
      this.renderPhotos();
      this.updateSummaryBadge();
      this.updateBatchBar();
    }
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
        // Foto lebih lebar: potong kiri dan kanan secara simetris
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
      photoItem.is_cropped = true;
      photoItem.is_portrait = false;
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
      p.is_portrait = img.naturalHeight > img.naturalWidth;
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
    }
    this.renderPhotosSelectionState();
    this.updateBatchBar();
  }

  handleCheckboxClick(e, photoId) {
    e.stopPropagation();
    if (this.selectedPhotoIds.has(photoId)) {
      this.selectedPhotoIds.delete(photoId);
    } else {
      this.selectedPhotoIds.add(photoId);
    }
    this.renderPhotosSelectionState();
    this.updateBatchBar();
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
    if (!confirm(`Hapus ${this.selectedPhotoIds.size} foto terpilih dari laporan?`)) return;

    this.photos = this.photos.filter(p => !this.selectedPhotoIds.has(p.id));
    this.selectedPhotoIds.clear();
    this.renderPhotos();
    this.updateSummaryBadge();
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
  }

  jitterPhotosGps() {
    if (this.photos.length === 0) return;
    const targets = this.selectedPhotoIds.size > 0
      ? this.photos.filter(p => this.selectedPhotoIds.has(p.id))
      : this.photos;

    targets.forEach((p) => {
      const baseCoords = this.getVillageCoordinates(p.desa, p.kabupaten);
      const jittered = applyGpsJitter(p.lat || baseCoords.lat, p.lon || baseCoords.lon, 8, 35);
      p.lat = jittered.lat;
      p.lon = jittered.lon;
    });
    this.renderPhotos();
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

  renderPhotos() {
    const gridEl = document.getElementById('reportPhotosGrid');
    const badgeEl = document.getElementById('reportPhotosCountBadge');
    if (badgeEl) badgeEl.textContent = `${this.photos.length} Foto`;

    if (!gridEl) return;

    if (this.photos.length === 0) {
      gridEl.innerHTML = `
        <div class="empty-hint" style="grid-column: 1 / -1; padding:20px; text-align:center; color:var(--text-muted); border:1px dashed var(--border-color); border-radius:8px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:6px; opacity:0.6;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <p style="margin:0; font-size:0.8rem;">Belum ada foto dokumentasi lapangan. Seret foto ke kotak di atas atau klik tombol <strong>Pilih Berkas Foto</strong>.</p>
        </div>
      `;
      this.updateBatchBar();
      return;
    }

    gridEl.innerHTML = this.photos.map((p, idx) => {
      const isSelected = this.selectedPhotoIds.has(p.id);
      const isOriginal = !!(p.is_original || p.alreadyStamped);
      const isCropped = !!p.is_cropped;
      const latFormatted = String(p.lat || '').replace('.', ',');
      const lonFormatted = String(p.lon || '').replace('.', ',');

      return `
        <div class="report-photo-card ${isSelected ? 'selected' : ''} ${isOriginal ? 'keep-original' : ''}" id="reportPhotoCard_${p.id}">
          <!-- Media Preview (Canvas Live Stamp) -->
          <div class="report-card-media" onclick="window.reportBuilder.openModal('${p.id}')">
            <!-- Selection Checkbox -->
            <label class="doc-card-checkbox" onclick="event.stopPropagation();" style="position:absolute; top:8px; left:8px; z-index:5; background:rgba(15,23,42,0.82); backdrop-filter:blur(4px); padding:2px 6px; border-radius:4px; display:flex; align-items:center; gap:5px; cursor:pointer;">
              <input type="checkbox" id="reportChk_${p.id}" ${isSelected ? 'checked' : ''} onchange="window.reportBuilder.handleCheckboxClick(event, '${p.id}')">
              <span class="font-mono" style="font-size:0.68rem; color:#fff; font-weight:700;">#${idx + 1}</span>
            </label>

            <!-- Zoom Lightbox Button -->
            <button type="button" class="report-card-zoom-btn" onclick="event.stopPropagation(); window.openPhotoLightbox('${p.id}', 'report')" title="Perbesar Layar Penuh (Lightbox)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </button>

            <!-- Canvas Live Preview -->
            <canvas id="reportCardCanvas_${p.id}" style="width:100%; height:100%; object-fit:cover;"></canvas>

            <!-- Status Badge -->
            <span class="doc-live-badge ${isOriginal ? 'badge-raw' : ''}" style="display:inline-flex; align-items:center; gap:4px;">
              ${isOriginal ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Original' : (isCropped ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> Dicrop' : '● Live Stamp')}
            </span>
          </div>

          <!-- Metadata & Actions -->
          <div style="padding:6px 8px; font-size:0.68rem; color:var(--text-muted); line-height:1.35; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div class="text-truncate" style="font-weight:600; color:var(--text-main); margin-bottom:2px;" title="${this.escapeHtml(p.filename)}">
                ${this.escapeHtml(p.filename)}
              </div>
              <div class="text-truncate" style="color:#38bdf8; font-weight:600; display:flex; align-items:center; gap:4px;" title="${p.desa || 'Desa'}, ${p.kecamatan || 'Kecamatan'}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span>${p.desa ? 'Desa ' + this.escapeHtml(p.desa) : 'Desa Belum Diatur'} ${p.kecamatan ? '(' + this.escapeHtml(p.kecamatan) + ')' : ''}</span>
              </div>
              <div class="font-mono text-truncate" style="color:#f59e0b; display:flex; align-items:center; gap:4px;" title="${this.escapeHtml(p.timeStr || '-')}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>${this.escapeHtml(p.timeStr || 'Belum di-generate')}</span>
              </div>
              <div class="font-mono text-truncate" style="color:var(--text-dim); display:flex; align-items:center; gap:4px;" title="Lat: ${latFormatted}, Lon: ${lonFormatted}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span>${p.lat ? latFormatted + ', ' + lonFormatted : 'Koordinat menyusul'}</span>
              </div>
            </div>

            <!-- Footer Buttons -->
            <div style="display:flex; justify-content:space-between; align-items:center; gap:4px; margin-top:6px; border-top:1px solid rgba(255,255,255,0.06); padding-top:4px; flex-wrap:wrap;">
              <div style="display:flex; gap:3px;">
                <button type="button" class="btn btn-secondary btn-xs" onclick="window.openPhotoLightbox('${p.id}', 'report')" title="Pratinjau Foto Layar Penuh" style="display:inline-flex; align-items:center; gap:3px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Pratinjau
                </button>
                <button type="button" class="btn btn-primary btn-xs" onclick="window.reportBuilder.openModal('${p.id}')" title="Edit Stempel & Potong Manual" style="display:inline-flex; align-items:center; gap:3px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit
                </button>
                ${p.is_portrait ? `
                  <button type="button" class="btn btn-warning btn-xs" onclick="window.reportBuilder.normalizeSinglePhotoAspect('${p.id}')" title="Sesuaikan foto portrait ke rasio 4:3 rapi" style="display:inline-flex; align-items:center; gap:3px;">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg> 4:3
                  </button>
                ` : ''}
                ${p.is_cropped ? `
                  <button type="button" class="btn btn-outline-info btn-xs" onclick="window.reportBuilder.resetSinglePhotoAspect('${p.id}')" title="Kembalikan foto asli sebelum dicrop" style="display:inline-flex; align-items:center; gap:3px;">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Reset
                  </button>
                ` : ''}
              </div>
              <div style="display:flex; gap:3px;">
                <button type="button" class="btn ${isOriginal ? 'btn-warning' : 'btn-outline-secondary'} btn-xs" onclick="window.reportBuilder.toggleSingleKeepOriginal('${p.id}')" title="${isOriginal ? 'Klik untuk memasang stempel' : 'Gunakan foto asli unedited'}" style="display:inline-flex; align-items:center; gap:3px;">
                  ${isOriginal ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Asli' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Stempel'}
                </button>
                <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="window.reportBuilder.removePhoto('${p.id}')" title="Hapus foto ini" style="padding:2px 5px;">
                  &times;
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Render live stamp on card canvases asynchronously
    this.photos.forEach(p => {
      this.renderCardStamp(p.id);
    });

    this.updateBatchBar();
  }

  async renderCardStamp(photoId) {
    const p = this.photos.find(item => item.id === photoId);
    if (!p) return;
    const canvas = document.getElementById(`reportCardCanvas_${photoId}`);
    if (!canvas) return;

    try {
      const imgObj = await this.getImage(p);
      const isOriginal = !!(p.is_original || p.alreadyStamped);
      const meta = {
        time_str: p.timeStr,
        lat: p.lat,
        lon: p.lon,
        desa: p.desa,
        kecamatan: p.kecamatan,
        kabupaten: p.kabupaten || this.kabupaten,
        provinsi: p.provinsi || 'Jawa Tengah',
        dusun: p.dusun || '',
        custom_address: p.customAddress || '',
        address_mode: p.address_mode || 'natural',
        font_scale: p.font_scale || 1.0
      };
      renderStampedPhoto(canvas, imgObj, meta, this.showRawGrid || isOriginal);
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
      this.modalTitle.innerText = `Edit Stempel Foto — ${p.filename}`;
    }

    const parsed = parseIndonesianTimestamp(p.timeStr);
    if (this.modalDatePicker) this.modalDatePicker.value = parsed.isoDate || this.getSurveyIsoDate();
    if (this.modalTimePicker) this.modalTimePicker.value = parsed.timeStr24 || '09:14:23';
    if (this.modalTimeStr) this.modalTimeStr.value = p.timeStr;

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

  async saveModalChanges() {
    if (!this.activePhotoId) return;
    const p = this.photos.find(item => item.id === this.activePhotoId);
    if (!p) return;

    p.timeStr = this.modalTimeStr ? this.modalTimeStr.value : p.timeStr;
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
  }

  async updateModalLivePreview() {
    if (!this.activePhotoId || !this.modalPreviewCanvas) return;
    const p = this.photos.find(item => item.id === this.activePhotoId);
    if (!p) return;

    const meta = {
      time_str: this.modalTimeStr ? this.modalTimeStr.value : p.timeStr,
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
      alert('Silakan tarik kotak seleksi pada foto terlebih dahulu.');
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
    } catch (err) {
      alert('Gagal memotong foto: ' + err.message);
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

  jitterModalTime() {
    if (!this.modalTimeStr) return;
    const current = this.modalTimeStr.value;
    const jittered = applyTimeJitter(current, -35, 45);
    this.modalTimeStr.value = jittered;

    const parsed = parseIndonesianTimestamp(jittered);
    if (this.modalDatePicker) this.modalDatePicker.value = parsed.isoDate;
    if (this.modalTimePicker) this.modalTimePicker.value = parsed.timeStr24;
    this.updateModalLivePreview();
  }

  jitterModalCoords() {
    if (!this.modalLat || !this.modalLon) return;
    const jittered = applyGpsJitter(this.modalLat.value, this.modalLon.value, 6, 20);
    this.modalLat.value = jittered.lat;
    this.modalLon.value = jittered.lon;
    this.updateModalLivePreview();
  }

  // =========================================================
  // EXISTING / IN-PROGRESS DOCX IMPORT & AUDIT DETECTOR
  // =========================================================
  async handleExistingDocxUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.docx')) {
      alert('Harap pilih berkas dokumen Microsoft Word (.docx).');
      event.target.value = '';
      return;
    }

    const btn = document.getElementById('btnUploadExistingDocx');
    const origBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `
        <span class="spinner-border spinner-border-sm" role="status" style="width:13px; height:13px; border-width:2px; display:inline-block; border-radius:50%; border:2px solid #38bdf8; border-top-color:transparent; animation:spin 0.6s linear infinite; margin-right:4px;"></span>
        <span>Membaca Dokumen...</span>
      `;
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/report/import_existing_docx', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        throw new Error(`Server status ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Gagal memproses dokumen eksisting');
      }

      const rep = data.report_data || {};

      // 1. Administrasi & SPT
      this.kabupaten = rep.kabupaten || '';
      this.tahun = rep.tahun || '2026';
      this.nomorSpt = rep.nomor_spt || '';
      this.tanggalSpt = rep.tanggal_spt || '';
      this.tanggalLaporan = rep.tanggal_laporan || '';
      this.tempatPembuatan = rep.tempat_pembuatan || 'Semarang';

      const kabInp = document.getElementById('reportKabupaten');
      if (kabInp) kabInp.value = this.kabupaten;
      const thnInp = document.getElementById('reportTahun');
      if (thnInp) thnInp.value = this.tahun;
      const sptInp = document.getElementById('reportNomorSpt');
      if (sptInp) sptInp.value = this.nomorSpt;
      this.setReportTanggalSpt(this.tanggalSpt);

      // 2. Jadwal Dinas & Tanggal Laporan
      this.tripStartDate = rep.trip_start_date || '';
      this.tripEndDate = rep.trip_end_date || '';
      const sTrip = document.getElementById('reportTripStartDate');
      if (sTrip) sTrip.value = this.tripStartDate;
      const eTrip = document.getElementById('reportTripEndDate');
      if (eTrip) eTrip.value = this.tripEndDate;

      if (this.tanggalLaporan) {
        this.setReportTanggalLaporan(this.tanggalLaporan, false);
      } else {
        this.onTripDatesChange();
      }

      // 3. Pelaksana Kedinasan
      this.includePelaksana = rep.include_pelaksana !== false;
      this.pelaksanaList = Array.isArray(rep.pelaksana) ? [...rep.pelaksana] : [];
      const chkPelaksana = document.getElementById('reportIncludePelaksana');
      if (chkPelaksana) chkPelaksana.checked = this.includePelaksana;
      const pContainer = document.getElementById('reportPelaksanaContainer');
      if (pContainer) pContainer.style.display = this.includePelaksana ? 'block' : 'none';
      this.renderPelaksanaList();

      // 4. Data Desa & Narasi / Catatan Lapangan
      if (rep.villages && rep.villages.length > 0) {
        this.villages = rep.villages.map(v => ({
          id: 'v_' + Math.random().toString(36).substr(2, 9),
          desa: v.desa || '',
          kecamatan: v.kecamatan || '',
          notes: v.notes || '',
          narrative: v.narrative || ''
        }));
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

      // 5. Galeri Foto & Timestamp Status
      this.photos = [];
      this.selectedPhotoIds.clear();
      this.imageCache.clear();

      if (data.photos && data.photos.length > 0) {
        for (const p of data.photos) {
          const pId = 'p_' + Math.random().toString(36).substr(2, 9);
          const hasTs = !!p.has_timestamp;
          this.photos.push({
            id: pId,
            filename: p.filename || 'foto.jpg',
            dataUrl: p.dataUrl || p.url || '',
            originalDataUrl: p.dataUrl || p.url || '',
            naturalWidth: p.width || 0,
            naturalHeight: p.height || 0,
            is_portrait: !!(p.height && p.width && p.height > p.width),
            timeStr: p.time_str || p.timeStr || '',
            lat: p.lat || '',
            lon: p.lon || '',
            desa: p.desa || (this.villages[0]?.desa || ''),
            kecamatan: p.kecamatan || (this.villages[0]?.kecamatan || ''),
            kabupaten: p.kabupaten || this.kabupaten,
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

        // Cek foto portrait
        const portraitPhotos = this.photos.filter(p => p.is_portrait);
        if (portraitPhotos.length > 0) {
          setTimeout(async () => {
            const confirmCrop = confirm(
              `Terdeteksi ${portraitPhotos.length} foto berorientasi Portrait (Tegak) pada dokumen ini.\n\n` +
              `Format tabel foto resmi Kementerian PU menggunakan rasio Landscape (4:3) agar tampilan seragam dan sejajar.\n\n` +
              `Klik 'OK' untuk menyesuaikan otomatis (Center-Crop ke 4:3) pada foto-foto tersebut.\n` +
              `Klik 'Cancel' untuk mempertahankan rasio asli.`
            );
            if (confirmCrop) {
              for (const p of portraitPhotos) {
                await this.normalizePhotoAspect(p, 4 / 3);
              }
              this.renderPhotos();
            }
          }, 400);
        }
      } else {
        this.renderPhotos();
      }

      // Update Preview UI
      this.updateDocumentTitlePreview();
      this.updateSummaryBadge();

      // 6. Render Panel Audit Kelengkapan Dokumen
      if (data.audit_report) {
        this.currentLoadedDocxName = data.filename || file.name;
        this.renderAuditCard(data.audit_report, this.currentLoadedDocxName, true);
      }

    } catch (err) {
      alert('Gagal membaca dokumen: ' + (err.message || 'Terjadi kesalahan'));
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

    const summaryEl = document.getElementById('reportAuditSummary');
    if (summaryEl) {
      summaryEl.textContent = auditReport.summary || '';
    }

    const grid = document.getElementById('reportAuditGrid');
    if (grid && Array.isArray(auditReport.items)) {
      grid.innerHTML = auditReport.items.map((it, idx) => {
        const isComplete = it.status === 'complete';
        const cardBg = isComplete ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)';
        const cardBorder = isComplete ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)';
        const statusBadge = isComplete
          ? `<span style="color:#34d399; font-weight:700; font-size:0.68rem; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> SUDAH ADA</span>`
          : `<span style="color:#fbbf24; font-weight:700; font-size:0.68rem; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> BELUM ADA / PERLU DILENGKAPI</span>`;

        return `
          <div style="background:${cardBg}; border:1px solid ${cardBorder}; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:4px; transition:all 0.2s ease;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="font-size:0.8rem; color:var(--text-main);">${idx + 1}. ${this.escapeHtml(it.label)}</strong>
              ${statusBadge}
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
    const kabClean = (this.kabupaten || '').trim();
    if (kabClean) {
      items.push({
        field: 'kabupaten',
        status: 'complete',
        label: 'Kabupaten',
        message: `Terisi: Kabupaten ${kabClean}`
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
    if (sptClean) {
      items.push({
        field: 'nomor_spt',
        status: 'complete',
        label: 'Nomor SPT',
        message: `Terisi: ${sptClean}`
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
    if (sDate) {
      const durText = (eDate && eDate !== sDate) ? `${formatIndonesianDateOnly(sDate)} s/d ${formatIndonesianDateOnly(eDate)}` : `${formatIndonesianDateOnly(sDate)} (1 hari dinas)`;
      items.push({
        field: 'trip_dates',
        status: 'complete',
        label: 'Jadwal Perjalanan Dinas',
        message: `Terisi: ${durText}`
      });
    } else {
      items.push({
        field: 'trip_dates',
        status: 'incomplete',
        label: 'Jadwal Perjalanan Dinas',
        message: 'Tanggal mulai/selesai perjalanan dinas belum ditentukan'
      });
    }

    // 5. Tanggal Laporan
    const tglLap = (this.tanggalLaporan || '').trim();
    if (tglLap) {
      items.push({
        field: 'tanggal_laporan',
        status: 'complete',
        label: 'Tanggal Laporan',
        message: `Terisi: ${formatIndonesianDateOnly(tglLap)}`
      });
    } else {
      items.push({
        field: 'tanggal_laporan',
        status: 'incomplete',
        label: 'Tanggal Laporan',
        message: 'Tanggal laporan belum ditentukan'
      });
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
        status: 'incomplete',
        label: 'Tabel Pelaksana',
        message: 'Format tanpa tabel tanda tangan pelaksana. Centang jika diperlukan.'
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
      toolbarScore.style.color = scorePct >= 80 ? '#34d399' : (scorePct >= 50 ? '#fbbf24' : '#f87171');
    }

    // Update Status Toolbar
    const statusText = document.getElementById('reportStatusSummary');
    if (statusText) {
      const pelaksanaCount = this.includePelaksana ? this.pelaksanaList.filter(Boolean).length : 0;
      statusText.textContent = `${validVillages.length} Desa • ${pelaksanaCount > 0 ? pelaksanaCount + ' Pelaksana' : 'Tanpa Pelaksana'} • ${this.photos.length} Foto • Kelengkapan ${scorePct}%`;
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

  // =========================================================
  // PRESET SAMPLES (1 DESA & MULTI DESA)
  // =========================================================
  loadSample(type) {
    if (type === 'single') {
      this.kabupaten = 'Magelang';
      this.tahun = '2026';
      this.nomorSpt = 'CK07/T/Bpbpk11/2026/1883';
      this.tanggalSpt = '2026-09-18';
      this.tripStartDate = '2026-09-21';
      this.tripEndDate = '';
      this.tanggalLaporan = '2026-09-22';
      this.tripStartTime = '09:14:23';
      this.tripEndTime = '15:47:38';
      this.tempatPembuatan = 'Semarang';
      this.includePelaksana = false;
      this.pelaksanaList = [];

      this.villages = [
        {
          id: 'v_baleagung',
          desa: 'Baleagung',
          kecamatan: 'Grabag',
          notes: 'Panjang pipa 3282 m. Progres fisik 19,24% (persiapan lahan, bronkaptering, ground reservoir, galian pipa). Keuangan 19,18% (upah tukang, material lokal, pengadaan). Pipa dibeli 27 Agt, SR 26 Agt. Kendala: mata air utama mengecil khawatirnya debit kurang; warga nunggu kepastian debit baru mau tanam pipa; pekerja warga dusun sering ada hajatan/adat. Tindak lanjut: percepat pasang pipa & bronkaptering, koordinasi intensif sm PJ Kades buat gerakkan kerja bakti warga.',
          narrative: `Adapun data umum kegiatan SAM di Desa Baleagung adalah sebagai berikut :
- Sistem Terpilih: Mata Air dengan Sistem Pompanisasi (Mata Air Pompa)
- Rencana Penerima Manfaat: 146 Sambungan Rumah (SR)
- Panjang Jaringan Perpipaan 3282 m, sesuai dengan RAB dan hasil DED yang telah disetujui. Opsi Mata Air Pompa ini dipilih berdasarkan hasil kajian teknis lapangan, di mana sumber mata air yang tersedia memiliki potensi debit yang cukup, namun secara topografi memerlukan bantuan pompa untuk dapat mengalirkan air menuju reservoir dan selanjutnya didistribusikan secara gravitasi kepada 146 SR target.
- Progres Fisik telah mencapai 19,24%. Capaian ini meliputi pekerjaan persiapan lahan, pekerjaan konstruksi awal pada bangunan penangkap mata air (bronkaptering), sebagian pekerjaan ground reservoir, serta pekerjaan galian untuk jaringan perpipaan yang telah mulai dilaksanakan oleh tenaga kerja lokal dari Pokmas.
- Progres Keuangan telah mencapai 19,18%. Angka ini selaras dengan progres fisik yang ada, di mana penyerapan anggaran digunakan untuk pembayaran upah tukang dan pekerja, pembelian material lokal, serta proses pengadaan barang. Administrasi keuangan dikelola secara tertib oleh Bendahara Pokmas dengan pendampingan dari FM dan AAK.
- Pengadaan Pipa dan aksesoris jaringan telah dilaksanakan pada tanggal 27 Agustus 2026. Pengadaan Sambungan Rumah (SR) telah dilaksanakan pada tanggal 26 Agustus 2026.
- Kegiatan non fisik yang sedang dilakukan koordinasi/persiapan promosi kesehatan, yang direncanakan dilakukan di dusun Baleagung.
- Kendala yang dialami di lapangan :
  1. Opsi sumber air utama yang akan digunakan mengecil dan dikhawatirkan tidak bisa memenuhi debit yang diinginkan;
  2. Meskipun pipa dan SR sudah datang, sebagian warga belum berkehendak untuk melakukan penanaman pipa, dikarenakan masih menunggu kepastian sumber air yang akan digunakan dapat mengalir;
  3. Sebagian besar tukang dan pekerja yang dilibatkan merupakan warga asli setempat sehingga terpengaruh bila ada kegiatan adat atau hajatan masyarakat.
- Rencana tindak lanjut :
  1. Pokmas berupaya mempercepat pekerjaan instalasi pipa dan SR yang materialnya sudah tersedia, sembari tetap menyelesaikan pekerjaan pada bangunan penangkap mata air;
  2. Melakukan koordinasi dan komunikasi intensif dengan PJ Kepala Desa untuk dapat menggerakkan masyarakat kerja bakti penanaman pipa.`
        }
      ];
    } else {
      this.kabupaten = 'Wonogiri';
      this.tahun = '2026';
      this.nomorSpt = 'CK07/T/Bpbpk11/2026/1766';
      this.tanggalSpt = '2026-09-18';
      this.tripStartDate = '2026-09-21';
      this.tripEndDate = '2026-09-22';
      this.tanggalLaporan = '2026-09-23';
      this.tripStartTime = '08:47:19';
      this.tripEndTime = '15:37:42';
      this.tempatPembuatan = 'Semarang';
      this.includePelaksana = true;
      this.pelaksanaList = [
        'Ika Woro Susanti, ST',
        'Wisnu Adi Prasetya, S.T., M.T.',
        'Luthfia Syahnaz Permatasari',
        'Jasmadi',
        'Fachrul Deanca, S.Ars',
        'Indah Retnaningtyas Setya Putri, SE'
      ];

      this.villages = [
        {
          id: 'v_sugihan',
          desa: 'Sugihan',
          kecamatan: 'Jatiroto',
          notes: 'Progres fisik 22,74%, galian pipa blm mulai jd agak lambat. Progres keuangan 33,08%, belanja pipa sm SR sdh dibeli makanya keuangan lbh tinggi dr fisik. Sistem SBD. Pipa dibeli 31 agt 2026, SR 7 sept 2026. Target 116 SR. Kendala swadaya tenaga kerja blm jalan jd galian pipa kepending. Tindak lanjut musyawarah sm warga buat kerja bakti.',
          narrative: ''
        },
        {
          id: 'v_gebangharjo',
          desa: 'Gebangharjo',
          kecamatan: 'Pracimantoro',
          notes: 'Fisik 23,12% utama pengeboran sumur. Keuangan 20,65% cair bertahap. Sistem SBD. Pengadaan pipa dan SR proses. Target 124 SR. Kendala: ada water loss pas pengeboran di kedalaman 16 m, rongga dinding sumur bikin cutting tdk terangkat. Pengeboran lambat. Tindak lanjut koordinasi sm fasilitator & tenaga ahli buat lumpur bor/penutup rongga/casing sementara atau titik baru bila perlu.',
          narrative: ''
        }
      ];
    }

    // Update Form Inputs
    const kabInput = document.getElementById('reportKabupaten');
    if (kabInput) kabInput.value = this.kabupaten;
    const thnInput = document.getElementById('reportTahun');
    if (thnInput) thnInput.value = this.tahun;
    const sptInput = document.getElementById('reportNomorSpt');
    if (sptInput) sptInput.value = this.nomorSpt;
    this.setReportTanggalSpt(this.tanggalSpt);
    this.setReportTanggalLaporan(this.tanggalLaporan, false);
    const tempatInput = document.getElementById('reportTempat');
    if (tempatInput) tempatInput.value = this.tempatPembuatan;

    const sTrip = document.getElementById('reportTripStartDate');
    if (sTrip) sTrip.value = this.tripStartDate;
    const eTrip = document.getElementById('reportTripEndDate');
    if (eTrip) eTrip.value = this.tripEndDate;
    const tStart = document.getElementById('reportTripStartTime');
    if (tStart) tStart.value = this.tripStartTime;
    const tEnd = document.getElementById('reportTripEndTime');
    if (tEnd) tEnd.value = this.tripEndTime;
    this.onTripDatesChange();

    if (this.quickKab) this.quickKab.value = this.kabupaten;
    if (this.quickDate) this.quickDate.value = this.tripStartDate;

    const chkPelaksana = document.getElementById('reportIncludePelaksana');
    if (chkPelaksana) chkPelaksana.checked = this.includePelaksana;
    const pContainer = document.getElementById('reportPelaksanaContainer');
    if (pContainer) pContainer.style.display = this.includePelaksana ? 'block' : 'none';

    this.renderPelaksanaList();
    this.renderVillages();
    this.updateQuickVillageTargetOptions();
    this.updateDocumentTitlePreview();
    this.updateSummaryBadge();

    // Jika sudah ada foto, jalankan alokasi otomatis
    if (this.photos.length > 0) {
      this.autoGenerateAllTimestamps();
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

    if (this.villages.length === 0) {
      alert('Tambahkan minimal 1 desa.');
      return;
    }

    const genButtons = Array.from(document.querySelectorAll('#btnGenerateReportDocx, #btnGenerateReportDocxBottom'));
    const originalTexts = genButtons.map(b => b.innerHTML);
    genButtons.forEach(b => {
      b.disabled = true;
      b.innerHTML = `
        <span class="spinner-border spinner-border-sm" role="status" style="width:14px; height:14px; border-width:2px; display:inline-block; border-radius:50%; border-top-color:#fff; animation:spin 0.6s linear infinite; margin-right:6px;"></span>
        Menyusun Narasi & Menyiapkan Dokumen...
      `;
    });

    this.isGenerating = true;

    try {
      const reportData = {
        kabupaten: this.kabupaten,
        tahun: this.tahun,
        nomor_spt: this.nomorSpt,
        tanggal_spt: toIndonesianDateText(this.tanggalSpt),
        tanggal_laporan: toIndonesianDateText(this.tanggalLaporan),
        tempat_pembuatan: this.tempatPembuatan,
        trip_start_date: this.tripStartDate,
        trip_end_date: this.tripEndDate,
        pelaksana: this.includePelaksana ? this.pelaksanaList.filter(Boolean) : [],
        villages: this.villages.map(v => ({
          desa: v.desa,
          kecamatan: v.kecamatan,
          notes: v.notes,
          narrative: v.narrative || ''
        }))
      };

      const payload = {
        report_data: reportData,
        photos: this.photos.map(p => ({
          dataUrl: p.dataUrl,
          filename: p.filename,
          time_str: p.timeStr,
          lat: p.lat,
          lon: p.lon,
          desa: p.desa,
          kecamatan: p.kecamatan,
          kabupaten: p.kabupaten || this.kabupaten,
          provinsi: p.provinsi || 'Jawa Tengah',
          custom_address: p.customAddress || '',
          address_mode: p.address_mode || 'natural',
          font_scale: p.font_scale || 1.0,
          already_stamped: !!(p.is_original || p.alreadyStamped),
          is_original: !!(p.is_original || p.alreadyStamped),
          keep_original: !!(p.is_original || p.alreadyStamped)
        }))
      };

      const res = await fetch('/api/report/generate_docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Server returned error: ${res.status}`);
      }

      const data = await res.json();
      if (data.success && data.download_url) {
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

        const noticeEl = document.getElementById('reportSuccessNotice');
        if (noticeEl) {
          noticeEl.style.display = 'flex';
          noticeEl.scrollIntoView({ behavior: 'smooth' });
          setTimeout(() => {
            noticeEl.style.display = 'none';
          }, 6000);
        }
      } else {
        alert('Gagal menghasilkan dokumen: ' + (data.error || 'Terjadi kesalahan sistem'));
      }
    } catch (e) {
      alert('Error saat membuat berkas Word: ' + e.message);
    } finally {
      this.isGenerating = false;
      genButtons.forEach((b, idx) => {
        b.disabled = false;
        b.innerHTML = originalTexts[idx];
      });
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
