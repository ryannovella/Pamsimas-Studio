// =========================================================
// PAMSIMAS STUDIO - SMART TIMELINE & LOCATION GROUPER
// =========================================================
import { formatIndonesianDateOnly, getIndonesianDayName } from './dateUtils.js';

export class SmartTimeline {
  constructor() {
    this.targetContext = 'doc'; // 'doc' or 'photo'
    this.analysisData = null;
    this.selectedPhotoIds = new Set();

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.modal = document.getElementById('smartTimelineModal');
    this.startTimeInput = document.getElementById('stStartTime');
    this.endTimeInput = document.getElementById('stEndTime');
    this.datePicker = document.getElementById('stDatePicker');
    this.endDatePicker = document.getElementById('stEndDatePicker');
    this.dateBadge = document.getElementById('stDateBadge');
    this.dateInput = document.getElementById('stDateStr');
    this.dayInput = document.getElementById('stDayName');
    this.transitMinInput = document.getElementById('stTransitMin');
    this.transitMaxInput = document.getElementById('stTransitMax');
    this.intraMinInput = document.getElementById('stIntraMin');
    this.intraMaxInput = document.getElementById('stIntraMax');
    this.gpsJitterToggle = document.getElementById('stGpsJitterToggle');

    this.resultsContainer = document.getElementById('stResultsContainer');
    this.btnApply = document.getElementById('stBtnApply');
    this.btnRecalculate = document.getElementById('stBtnRecalculate');
    this.btnClose = document.getElementById('stBtnClose');
    this.btnSelectAll = document.getElementById('stBtnSelectAll');
    this.btnDeselectAll = document.getElementById('stBtnDeselectAll');
    this.selectedBadge = document.getElementById('stSelectedBadge');
  }

  bindEvents() {
    if (this.datePicker) {
      this.datePicker.addEventListener('change', () => this.onDatePickerChange());
    }
    if (this.endDatePicker) {
      this.endDatePicker.addEventListener('change', () => this.onDatePickerChange());
    }
    if (this.btnRecalculate) {
      this.btnRecalculate.addEventListener('click', () => this.runAnalysis());
    }
    if (this.gpsJitterToggle) {
      this.gpsJitterToggle.addEventListener('change', () => this.runAnalysis());
    }
    if (this.btnClose) {
      this.btnClose.addEventListener('click', () => this.closeModal());
    }
    if (this.btnApply) {
      this.btnApply.addEventListener('click', () => this.applyTimeline());
    }
    if (this.btnSelectAll) {
      this.btnSelectAll.addEventListener('click', () => this.selectAllPhotos(true));
    }
    if (this.btnDeselectAll) {
      this.btnDeselectAll.addEventListener('click', () => this.selectAllPhotos(false));
    }

    [this.startTimeInput, this.endTimeInput, this.transitMinInput, this.transitMaxInput, this.intraMinInput, this.intraMaxInput].forEach(el => {
      if (el) el.addEventListener('change', () => this.runAnalysis());
    });
  }

  onDatePickerChange() {
    if (!this.datePicker) return;
    const startIso = this.datePicker.value;
    if (!startIso) return;

    if (this.endDatePicker && (!this.endDatePicker.value || this.endDatePicker.value < startIso)) {
      this.endDatePicker.value = startIso;
    }
    const endIso = this.endDatePicker ? this.endDatePicker.value : startIso;

    const startDay = getIndonesianDayName(startIso);
    const startDateFormatted = formatIndonesianDateOnly(startIso);

    if (startIso === endIso) {
      if (this.dayInput) this.dayInput.value = startDay;
      if (this.dateInput) this.dateInput.value = startDateFormatted;
      if (this.dateBadge) this.dateBadge.innerText = `${startDay}, ${startDateFormatted}`;
    } else {
      const endDay = getIndonesianDayName(endIso);
      const endDateFormatted = formatIndonesianDateOnly(endIso);
      const startD = new Date(startIso);
      const endD = new Date(endIso);
      const totalDays = Math.max(1, Math.round((endD - startD) / 86400000) + 1);

      if (this.dayInput) this.dayInput.value = startDay;
      if (this.dateInput) this.dateInput.value = `${startDateFormatted} - ${endDateFormatted}`;
      if (this.dateBadge) this.dateBadge.innerText = `${startDay}, ${startDateFormatted} s/d ${endDay}, ${endDateFormatted} (${totalDays} Hari Survei)`;
    }

    this.runAnalysis();
  }

  openModal(context = 'doc') {
    this.targetContext = context;
    if (this.modal) this.modal.classList.add('active');

    // 1. Check if active document already has detected date_info
    const docData = window.docEditor?.docData;
    if (context === 'doc' && docData?.date_info) {
      const dInfo = docData.date_info;
      if (this.datePicker && dInfo.start_iso) this.datePicker.value = dInfo.start_iso;
      if (this.endDatePicker && dInfo.end_iso) this.endDatePicker.value = dInfo.end_iso;
      this.onDatePickerChange();
      return;
    }

    // 2. Otherwise extract start and end dates from photos in current context
    const photos = this.getPhotosForContext();
    if (photos.length > 0) {
      const monthMap = {
        'januari': '01', 'jan': '01', 'februari': '02', 'feb': '02', 'maret': '03', 'mar': '03',
        'april': '04', 'apr': '04', 'mei': '05', 'may': '05', 'juni': '06', 'jun': '06',
        'juli': '07', 'jul': '07', 'agustus': '08', 'agu': '08', 'ags': '08', 'agt': '08', 'aug': '08',
        'september': '09', 'sep': '09', 'sept': '09', 'oktober': '10', 'okt': '10', 'oct': '10',
        'november': '11', 'nov': '11', 'desember': '12', 'des': '12', 'dec': '12'
      };
      
      const allIsoDates = [];
      photos.forEach(p => {
        if (!p.time_str) return;
        const match = p.time_str.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
          allIsoDates.push(match[0]);
        } else {
          const dMatch = p.time_str.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
          if (dMatch) {
            const mNum = monthMap[dMatch[2].toLowerCase()] || '08';
            const dNum = String(dMatch[1]).padStart(2, '0');
            const yNum = dMatch[3];
            allIsoDates.push(`${yNum}-${mNum}-${dNum}`);
          }
        }
      });

      if (allIsoDates.length > 0) {
        allIsoDates.sort();
        const startIso = allIsoDates[0];
        const endIso = allIsoDates[allIsoDates.length - 1];
        if (this.datePicker) this.datePicker.value = startIso;
        if (this.endDatePicker) this.endDatePicker.value = endIso;
        this.onDatePickerChange();
        return;
      }
    }

    this.runAnalysis();
  }

  closeModal() {
    if (this.modal) this.modal.classList.remove('active');
  }

  getPhotosForContext() {
    if (this.targetContext === 'doc') {
      const docData = window.docEditor?.docData;
      if (!docData || !docData.photos) return [];
      
      const filter = window.docEditor.docFilter || 'all';
      let list = docData.photos;
      if (filter !== 'all') {
        list = list.filter(p => p.desa.toLowerCase() === filter.toLowerCase());
      }
      
      return list.map(p => {
        const u = window.docEditor.docUpdates[p.id] || p;
        return {
          id: p.id,
          filename: p.filename,
          url: p.url,
          dusun: u.dusun,
          desa: u.desa,
          kecamatan: u.kecamatan,
          kabupaten: u.kabupaten,
          provinsi: u.provinsi,
          lat: u.lat,
          lon: u.lon,
          time_str: u.time_str
        };
      });
    } else {
      // Photo Studio
      const studioPhotos = window.photoStudio?.photos || [];
      return studioPhotos.map(p => ({
        id: p.id,
        filename: p.name,
        url: p.dataUrl,
        dusun: p.dusun,
        desa: p.desa,
        kecamatan: p.kecamatan,
        kabupaten: p.kabupaten,
        provinsi: p.provinsi,
        lat: p.lat,
        lon: p.lon,
        time_str: p.time_str
      }));
    }
  }

  async runAnalysis() {
    const photos = this.getPhotosForContext();
    if (!photos || photos.length === 0) {
      this.resultsContainer.innerHTML = `
        <div class="empty-state">
          <p style="color:#ef4444;">No photos available in current view to analyze.</p>
        </div>
      `;
      return;
    }

    this.resultsContainer.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Analyzing ${photos.length} photos with multi-stage clustering & calculating humanized non-round timeline...</p>
      </div>
    `;

    const payload = {
      photos: photos,
      start_time: this.startTimeInput?.value || "09:15:23",
      end_time: this.endTimeInput?.value || "15:00:00",
      start_date: this.datePicker?.value || "2026-08-14",
      end_date: this.endDatePicker?.value || this.datePicker?.value || "2026-08-14",
      date_str: this.dateInput?.value || "14 Agustus 2026",
      day_name: this.dayInput?.value || "Jumat",
      transit_min_min: parseInt(this.transitMinInput?.value) || 30,
      transit_max_min: parseInt(this.transitMaxInput?.value) || 50,
      intra_min_sec: parseInt(this.intraMinInput?.value) || 45,
      intra_max_sec: parseInt(this.intraMaxInput?.value) || 165,
      apply_gps_jitter: this.gpsJitterToggle ? this.gpsJitterToggle.checked : true,
      min_gps_jitter_m: 5.0,
      max_gps_jitter_m: 2000.0
    };

    try {
      const res = await fetch('/api/smart_timeline/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Analysis failed");

      this.analysisData = data;
      // Initially select all photos
      this.selectedPhotoIds = new Set(data.timeline.map(t => t.photo_id));
      this.renderResults();
    } catch (err) {
      this.resultsContainer.innerHTML = `
        <div class="empty-state">
          <p style="color:#ef4444;">Error running analysis: ${err.message}</p>
        </div>
      `;
    }
  }

  selectAllPhotos(selectAll) {
    if (!this.analysisData || !this.analysisData.timeline) return;
    if (selectAll) {
      this.selectedPhotoIds = new Set(this.analysisData.timeline.map(t => t.photo_id));
    } else {
      this.selectedPhotoIds.clear();
    }
    this.updateSelectionUI();
  }

  togglePhotoSelection(photoId, checked) {
    if (checked) {
      this.selectedPhotoIds.add(photoId);
    } else {
      this.selectedPhotoIds.delete(photoId);
    }
    this.updateSelectionUI();
  }

  updateSelectionUI() {
    const total = this.analysisData?.timeline?.length || 0;
    const selected = this.selectedPhotoIds.size;
    if (this.selectedBadge) {
      this.selectedBadge.innerText = `${selected} dari ${total} Foto Dipilih`;
    }
    if (this.btnApply) {
      this.btnApply.innerText = `Apply to ${selected} Photos`;
      this.btnApply.disabled = selected === 0;
    }

    // Sync item checkboxes
    const checkboxes = this.resultsContainer.querySelectorAll('.st-photo-check');
    checkboxes.forEach(cb => {
      const id = parseInt(cb.dataset.id);
      cb.checked = this.selectedPhotoIds.has(id);
      const card = cb.closest('.st-photo-item');
      if (card) card.classList.toggle('selected', cb.checked);
    });
  }

  renderResults() {
    if (!this.analysisData || !this.analysisData.timeline) return;

    const { clusters, timeline, total_clusters, total_photos } = this.analysisData;
    const hasGpsJitter = this.gpsJitterToggle ? this.gpsJitterToggle.checked : true;

    let html = `
      <div class="st-summary-badge">
        <span style="display:inline-flex; align-items:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg>Terdeteksi <strong>${total_clusters} Spot / Klaster Lokasi</strong> dari <strong>${total_photos} Foto</strong></span>
        <span class="badge badge-accent">Detik Manusiawi (Bukan :00/:05) & Transit 30–50 Menit</span>
        ${hasGpsJitter ? '<span class="badge" style="background:#065f46; color:#a7f3d0; display:inline-flex; align-items:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>GPS Jitter 5–25m Aktif (Unik)</span>' : ''}
      </div>
    `;

    // Group timeline items by spot_id
    const spotMap = {};
    timeline.forEach(item => {
      if (!spotMap[item.spot_id]) spotMap[item.spot_id] = [];
      spotMap[item.spot_id].push(item);
    });

    Object.keys(spotMap).forEach((spotId, idx) => {
      const items = spotMap[spotId];
      const spotTitle = items[0]?.spot_title || `Spot #${spotId}`;
      const firstItemTime = items[0]?.time_str || '';
      const spotDateLabel = firstItemTime ? (firstItemTime.split(/\d{2}:\d{2}/)[0]?.trim() || '') : '';

      // Show transit connector if not first spot
      if (idx > 0 && items[0]?.transit_note) {
        html += `
          <div class="st-transit-divider">
            <div class="st-transit-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="2" ry="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            </div>
            <div class="st-transit-info">
              <strong>${items[0].transit_note}</strong>
              <span class="text-muted">Jeda perjalanan antar spot yang masuk akal</span>
            </div>
          </div>
        `;
      }

      html += `
        <div class="st-spot-card">
          <div class="st-spot-header">
            <div class="st-spot-title" style="display:flex; align-items:center; flex-wrap:wrap; gap:6px;">
              <span class="st-spot-number">Spot ${idx + 1}</span>
              <strong>${spotTitle}</strong>
              ${spotDateLabel ? `<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.75rem; display:inline-flex; align-items:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${spotDateLabel}</span>` : ''}
            </div>
            <span class="st-spot-count">${items.length} Foto</span>
          </div>

          <div class="st-photos-row">
      `;

      items.forEach(item => {
        const isChecked = this.selectedPhotoIds.has(item.photo_id);
        const latStr = String(item.lat || '').replace('.', ',');
        const lonStr = String(item.lon || '').replace('.', ',');

        html += `
          <div class="st-photo-item ${isChecked ? 'selected' : ''}" onclick="window.smartTimeline.toggleItemClick(event, ${item.photo_id})" title="${item.time_str}">
            <input type="checkbox" class="st-photo-check" data-id="${item.photo_id}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); window.smartTimeline.togglePhotoSelection(${item.photo_id}, this.checked)">
            <div class="st-photo-thumb">
              <img src="${item.url}" alt="Photo" loading="lazy">
              <span class="st-photo-clock">${item.clock}</span>
            </div>
            <div class="st-photo-meta">
              <div class="st-delta-badge">${item.delta_label}</div>
              <span class="st-photo-name font-mono">#${item.photo_id}</span>
              <span class="st-photo-coords font-mono" title="Koordinat GPS hasil Jitter">${latStr.slice(0, 9)}, ${lonStr.slice(0, 10)}</span>
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    this.resultsContainer.innerHTML = html;
    this.updateSelectionUI();
  }

  toggleItemClick(e, photoId) {
    if (e.target.tagName === 'INPUT') return;
    const isSelected = this.selectedPhotoIds.has(photoId);
    this.togglePhotoSelection(photoId, !isSelected);
  }

  applyTimeline() {
    if (!this.analysisData || !this.analysisData.timeline) return;

    const timeline = this.analysisData.timeline.filter(item => this.selectedPhotoIds.has(item.photo_id));
    if (timeline.length === 0) {
      alert("Pilih minimal satu foto untuk menerapkan timeline!");
      return;
    }

    if (this.targetContext === 'doc') {
      // Apply to docEditor updates
      timeline.forEach(item => {
        const id = item.photo_id;
        if (!window.docEditor.docUpdates[id]) {
          const original = window.docEditor.docData.photos.find(p => p.id === id) || {};
          window.docEditor.docUpdates[id] = Object.assign({}, original);
        }
        window.docEditor.docUpdates[id].time_str = item.time_str;
        if (item.lat && item.lon) {
          window.docEditor.docUpdates[id].lat = item.lat;
          window.docEditor.docUpdates[id].lon = item.lon;
        }
      });

      window.docEditor.renderGrid();
      alert(`Berhasil menerapkan jam realistis & koordinat unik untuk ${timeline.length} foto dokumen!`);
    } else {
      // Apply to PhotoStudio
      timeline.forEach(item => {
        const photo = window.photoStudio.photos.find(p => p.id === item.photo_id);
        if (photo) {
          photo.time_str = item.time_str;
          if (item.lat && item.lon) {
            photo.lat = item.lat;
            photo.lon = item.lon;
          }
        }
      });

      window.photoStudio.renderGrid();
      alert(`Berhasil menerapkan jam realistis & koordinat unik untuk ${timeline.length} foto studio!`);
    }

    this.closeModal();
  }
}
