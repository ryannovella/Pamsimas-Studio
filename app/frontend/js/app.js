// =========================================================
// PAMSIMAS STUDIO - STANDALONE REPORT BUILDER COORDINATOR
// =========================================================
import { SmartTimeline } from './smartTimeline.js';
import { PhotoLightbox } from './lightbox.js';
import { initErrorCatcher } from './errorCatcher.js';
import { ReportBuilder } from './reportBuilder.js';

class App {
  constructor() {
    this.reportBuilder = null;
    this.smartTimeline = null;
    this.lightbox = null;
  }

  init() {
    initErrorCatcher();

    // Prevent default browser drag & drop file opening
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    // Initialize module controllers
    this.reportBuilder = new ReportBuilder();
    this.smartTimeline = new SmartTimeline();
    this.lightbox = new PhotoLightbox();

    // Expose instances for HTML bindings
    window.reportBuilder = this.reportBuilder;
    window.smartTimeline = this.smartTimeline;
    window.photoLightbox = this.lightbox;
    window.app = this;

    // Active context is always 'report' in this standalone app
    window.activePhotoContext = 'report';
    window.activeBatchTarget = 'report';

    // Lightbox Global Handlers
    window.openPhotoLightbox = (id, ctx = 'report') => this.lightbox.open(id, ctx);
    window.closePhotoLightbox = () => this.lightbox.close();
    window.navigateLightbox = (dir) => this.lightbox.navigate(dir);
    window.toggleLightboxRaw = () => this.lightbox.toggleRaw();
    window.openEditorFromLightbox = () => this.lightbox.openEditor();
    window.downloadLightboxPhoto = () => this.lightbox.downloadPhoto();
    window.openLightboxFromModal = () => {
      if (window.isCropDrawModeActive) return;
      const curId = this.reportBuilder.activePhotoId;
      if (curId) this.lightbox.open(curId, 'report');
    };

    // Modal Handlers
    window.showHelpModal = () => {
      document.getElementById('helpModal')?.classList.add('active');
    };
    window.closeHelpModal = () => {
      document.getElementById('helpModal')?.classList.remove('active');
    };
    window.openSmartTimeline = (ctx = 'report') => this.smartTimeline.openModal(ctx);
    window.closeSmartTimeline = () => this.smartTimeline.closeModal();

    window.closeActivePhotoModal = () => {
      this.reportBuilder.closeModal();
    };
    window.saveActivePhotoChanges = () => {
      this.reportBuilder.saveModalChanges();
    };
    window.toggleCropDrawMode = () => {
      this.reportBuilder.toggleCropDrawMode();
    };
    window.modalCancelCropBox = () => {
      this.reportBuilder.modalCancelCropBox();
    };
    window.modalApplyCrop = () => {
      this.reportBuilder.modalApplyCrop();
    };
    window.modalResetCrop = () => {
      this.reportBuilder.modalResetCrop();
    };
    window.modalQuickCropAspect43 = () => {
      this.reportBuilder.modalQuickCropAspect43();
    };
    window.onActiveModalKeepOriginalChange = (checked) => {
      this.reportBuilder.updateModalLivePreview();
    };
    window.jitterModalTime = () => {
      this.reportBuilder.jitterModalTime();
    };
    window.jitterModalCoords = () => {
      this.reportBuilder.jitterModalCoords();
    };
    window.toggleActiveModalRaw = () => {
      this.reportBuilder.toggleModalRaw();
    };
    window.onModalFontScaleChange = (val) => {
      this.reportBuilder.updateModalLivePreview();
    };
    window.onModalCustomAddressInput = (val) => {
      this.reportBuilder.updateModalLivePreview();
    };
    window.onModalAddressModeChange = (mode) => {
      this.reportBuilder.updateModalLivePreview();
    };

    // Map Picker Global Bindings
    window.openMapPicker = (latId, lonId, cb, ctx) => mapPicker.open(latId, lonId, cb, ctx);
    window.openReportQuickMapPicker = () => mapPicker.open('reportQuickLat', 'reportQuickLon', (lat, lon, addr) => {
      if (window.reportBuilder) {
        if (addr.desa && document.getElementById('reportQuickDesa')) document.getElementById('reportQuickDesa').value = addr.desa;
        if (addr.kec && document.getElementById('reportQuickKec')) document.getElementById('reportQuickKec').value = addr.kec;
        if (addr.dusun && document.getElementById('reportQuickDusun')) document.getElementById('reportQuickDusun').value = addr.dusun;
        if (addr.kab && document.getElementById('reportQuickKab')) document.getElementById('reportQuickKab').value = addr.kab;
        if (addr.prov && document.getElementById('reportQuickProv')) document.getElementById('reportQuickProv').value = addr.prov;
      }
    }, 'reportQuick');
    window.openModalMapPicker = () => mapPicker.open('modalLat', 'modalLon', (lat, lon, addr) => {
      if (window.reportBuilder) {
        window.reportBuilder.updateModalLivePreview();
      }
    }, 'modalPhoto');

    window.mapPickerApply = (scope) => mapPicker.apply(scope);
    window.closeMapPicker = () => mapPicker.close();
    window.confirmMapCoords = () => mapPicker.confirm();
    window.searchMapLocation = () => mapPicker.search();
    window.setMapLayer = (layerKey) => mapPicker.switchLayer(layerKey);

    window.closeErrorLogsModal = () => {
      document.getElementById('errorLogsModal')?.classList.remove('active');
    };

    // Initialize ReportBuilder
    this.reportBuilder.init();
  }
}

// =========================================================
// PAMSIMAS VILLAGE & LOCATION KNOWLEDGE BASE
// =========================================================
const PAMSIMAS_VILLAGE_DB = {
  "baleagung": { kec: "Grabag", kab: "Kabupaten Magelang" },
  "ketawang": { kec: "Grabag", kab: "Kabupaten Magelang" },
  "jati": { kec: "Sawangan", kab: "Kabupaten Magelang" },
  "jambewangi": { kec: "Pakis", kab: "Kabupaten Magelang" },
  "genito": { kec: "Windusari", kab: "Kabupaten Magelang" },
  "tanjungsari": { kec: "Windusari", kab: "Kabupaten Magelang" },
  "masaran": { kec: "Bawang", kab: "Kabupaten Banjarnegara" },
  "pejawaran": { kec: "Pejawaran", kab: "Kabupaten Banjarnegara" },
  "bandingan": { kec: "Rakit", kab: "Kabupaten Banjarnegara" },
  "sawangan": { kec: "Ajibarang", kab: "Kabupaten Banyumas" },
  "kasegeran": { kec: "Cilongok", kab: "Kabupaten Banyumas" },
  "rempoah": { kec: "Baturraden", kab: "Kabupaten Banyumas" },
  "karangkedawung": { kec: "Sokaraja", kab: "Kabupaten Banyumas" },
  "gandatapa": { kec: "Sumbang", kab: "Kabupaten Banyumas" },
  "mojosari": { kec: "Karanggede", kab: "Kabupaten Boyolali" },
  "pegadingan": { kec: "Cipari", kab: "Kabupaten Cilacap" },
  "kertajaya": { kec: "Gandrungmangu", kab: "Kabupaten Cilacap" },
  "jeruklegi kulon": { kec: "Jeruklegi", kab: "Kabupaten Cilacap" },
  "sumingkir": { kec: "Jeruklegi", kab: "Kabupaten Cilacap" },
  "karangpucung": { kec: "Karangpucung", kab: "Kabupaten Cilacap" },
  "surusunda": { kec: "Karangpucung", kab: "Kabupaten Cilacap" },
  "bener": { kec: "Majenang", kab: "Kabupaten Cilacap" },
  "cibeunying": { kec: "Majenang", kab: "Kabupaten Cilacap" },
  "jenang": { kec: "Majenang", kab: "Kabupaten Cilacap" },
  "sidamukti": { kec: "Patimuan", kab: "Kabupaten Cilacap" },
  "kunci": { kec: "Sidareja", kab: "Kabupaten Cilacap" },
  "purwasari": { kec: "Wanareja", kab: "Kabupaten Cilacap" },
  "sidomukti": { kec: "Jenawi", kab: "Kabupaten Karanganyar" },
  "gempolan": { kec: "Kerjo", kab: "Kabupaten Karanganyar" },
  "kebak": { kec: "Jumantono", kab: "Kabupaten Karanganyar" },
  "pendem": { kec: "Mojogedang", kab: "Kabupaten Karanganyar" },
  "pojok": { kec: "Mojogedang", kab: "Kabupaten Karanganyar" },
  "tlogosari": { kec: "Ayah", kab: "Kabupaten Kebumen" },
  "karanggayam": { kec: "Karanggayam", kab: "Kabupaten Kebumen" },
  "aditirto": { kec: "Pejagoan", kab: "Kabupaten Kebumen" },
  "seboro": { kec: "Sadang", kab: "Kabupaten Kebumen" },
  "karangcengis": { kec: "Bukateja", kab: "Kabupaten Purbalingga" },
  "pelumutan": { kec: "Kemangkon", kab: "Kabupaten Purbalingga" },
  "tlahab kidul": { kec: "Karangreja", kab: "Kabupaten Purbalingga" },
  "limbangan": { kec: "Kutasari", kab: "Kabupaten Purbalingga" },
  "lambur": { kec: "Mrebet", kab: "Kabupaten Purbalingga" },
  "arenan": { kec: "Kaligondang", kab: "Kabupaten Purbalingga" },
  "pengadegan": { kec: "Pengadegan", kab: "Kabupaten Purbalingga" },
  "panusupan": { kec: "Rembang", kab: "Kabupaten Purbalingga" },
  "mayungsari": { kec: "Bener", kab: "Kabupaten Purworejo" },
  "rimun": { kec: "Loano", kab: "Kabupaten Purworejo" },
  "bukuran": { kec: "Kalijambe", kab: "Kabupaten Sragen" },
  "ngebung": { kec: "Kalijambe", kab: "Kabupaten Sragen" },
  "gabus": { kec: "Ngrampal", kab: "Kabupaten Sragen" },
  "sambi": { kec: "Sambirejo", kab: "Kabupaten Sragen" },
  "sigit": { kec: "Tangen", kab: "Kabupaten Sragen" },
  "kembangsari": { kec: "Kandangan", kab: "Kabupaten Temanggung" },
  "kemiri": { kec: "Kaloran", kab: "Kabupaten Temanggung" },
  "gentingsari": { kec: "Bansari", kab: "Kabupaten Temanggung" },
  "dlimoyo": { kec: "Ngadirejo", kab: "Kabupaten Temanggung" },
  "gondangwinangun": { kec: "Ngadirejo", kab: "Kabupaten Temanggung" },
  "pulutan wetan": { kec: "Wuryantoro", kab: "Kabupaten Wonogiri" },
  "gebangharjo": { kec: "Pracimantoro", kab: "Kabupaten Wonogiri" },
  "sembukan": { kec: "Sidoharjo", kab: "Kabupaten Wonogiri" },
  "gunan": { kec: "Slogohimo", kab: "Kabupaten Wonogiri" },
  "sugihan": { kec: "Jatiroto", kab: "Kabupaten Wonogiri" },
  "petompon": { kec: "Gajahmungkur", kab: "Kota Semarang" }
};

// =========================================================
// GOOGLE MAPS / LEAFLET PICKER CONTROLLER
// =========================================================
const mapPicker = {
  _map: null,
  _marker: null,
  _pickedLat: null,
  _pickedLon: null,
  _pickedAddress: null,
  _targetLatId: 'modalLat',
  _targetLonId: 'modalLon',
  _onConfirm: null,
  _context: 'modalPhoto',
  _fetchPromise: null,

  open(targetLatId = 'modalLat', targetLonId = 'modalLon', onConfirm = null, context = null) {
    this._targetLatId = targetLatId || 'modalLat';
    this._targetLonId = targetLonId || 'modalLon';
    this._onConfirm = onConfirm;
    this._context = context || (this._targetLatId.includes('reportQuick') ? 'reportQuick' : 'modalPhoto');

    const modal = document.getElementById('mapPickerModal');
    if (!modal) return;
    modal.classList.add('active');

    const btnApplyAll = document.getElementById('btnMapApplyAll');
    const btnApplySel = document.getElementById('btnMapApplySelected');
    const btnConfirm = document.getElementById('btnConfirmMapCoords');
    const isQuickSetup = (this._context === 'reportQuick');

    if (btnApplyAll) btnApplyAll.style.display = isQuickSetup ? 'inline-flex' : 'none';
    if (btnApplySel) btnApplySel.style.display = isQuickSetup ? 'inline-flex' : 'none';
    if (btnConfirm) {
      btnConfirm.textContent = isQuickSetup ? 'Salin ke Form Saja' : 'Gunakan untuk Foto Ini';
    }

    const curLat = parseFloat(document.getElementById(this._targetLatId)?.value) || -7.391520;
    const curLon = parseFloat(document.getElementById(this._targetLonId)?.value) || 110.312050;

    setTimeout(() => {
      if (!this._map) {
        this._map = L.map('leafletMap', {
          zoomControl: true,
          maxZoom: 21
        }).setView([curLat, curLon], 16);

        this._layers = {
          googleHybrid: L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
            subdomains: ['0', '1', '2', '3'],
            maxZoom: 21,
            attribution: '© Google Maps'
          }),
          googleRoad: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            subdomains: ['0', '1', '2', '3'],
            maxZoom: 20,
            attribution: '© Google Maps'
          }),
          googleTerrain: L.tileLayer('https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
            subdomains: ['0', '1', '2', '3'],
            maxZoom: 20,
            attribution: '© Google Maps'
          }),
          osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
          })
        };

        this._currentLayerKey = 'googleHybrid';
        this._layers.googleHybrid.addTo(this._map);

        this._map.on('click', (e) => {
          this.selectLatLng(e.latlng.lat, e.latlng.lng);
        });
      } else {
        this._map.setView([curLat, curLon], 16);
        this._map.invalidateSize();
      }

      this._map.invalidateSize();
    }, 200);

    this._pickedLat = null;
    this._pickedLon = null;
    this._pickedAddress = null;
    this._fetchPromise = null;
    if (btnConfirm) btnConfirm.disabled = true;
    if (btnApplyAll) btnApplyAll.disabled = true;
    if (btnApplySel) btnApplySel.disabled = true;

    document.getElementById('mapPreviewLat').textContent = '–';
    document.getElementById('mapPreviewLon').textContent = '–';
    document.getElementById('mapPreviewAddr').textContent = 'Klik peta Google Maps untuk memilih titik lokasi';
    ['mapPreviewDesa', 'mapPreviewKec', 'mapPreviewKab', 'mapPreviewProv', 'mapPreviewDusun'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '–';
    });
  },

  switchLayer(layerKey) {
    if (!this._map || !this._layers || !this._layers[layerKey]) return;
    if (this._currentLayerKey && this._layers[this._currentLayerKey]) {
      this._map.removeLayer(this._layers[this._currentLayerKey]);
    }
    this._layers[layerKey].addTo(this._map);
    this._currentLayerKey = layerKey;

    ['btnLayerGoogleHybrid', 'btnLayerGoogleRoad', 'btnLayerGoogleTerrain', 'btnLayerOsm'].forEach(id => {
      document.getElementById(id)?.classList.remove('active');
    });
    const keyMap = {
      googleHybrid: 'btnLayerGoogleHybrid',
      googleRoad: 'btnLayerGoogleRoad',
      googleTerrain: 'btnLayerGoogleTerrain',
      osm: 'btnLayerOsm'
    };
    document.getElementById(keyMap[layerKey])?.classList.add('active');
  },

  selectLatLng(lat, lng) {
    this._pickedLat = lat.toFixed(6);
    this._pickedLon = lng.toFixed(6);

    const latlng = L.latLng(lat, lng);
    if (this._marker) {
      this._marker.setLatLng(latlng);
    } else {
      this._marker = L.marker(latlng).addTo(this._map);
    }

    document.getElementById('mapPreviewLat').textContent = this._pickedLat;
    document.getElementById('mapPreviewLon').textContent = this._pickedLon;

    const btnConfirm = document.getElementById('btnConfirmMapCoords');
    const btnApplyAll = document.getElementById('btnMapApplyAll');
    const btnApplySel = document.getElementById('btnMapApplySelected');
    if (btnConfirm) btnConfirm.disabled = false;
    if (btnApplyAll) btnApplyAll.disabled = false;
    if (btnApplySel) btnApplySel.disabled = false;

    const addrEl = document.getElementById('mapPreviewAddr');
    if (addrEl) addrEl.textContent = 'Mendeteksi alamat presisi dari GPS...';

    this._fetchPromise = fetch(`/api/geocoding/reverse?lat=${lat}&lon=${lng}`)
      .then(r => r.json())
      .then(res => {
        if (res && res.success) {
          return {
            dusun: res.dusun || '',
            desa: res.desa || '',
            kec: res.kecamatan || '',
            kab: res.kabupaten || 'Kabupaten Magelang',
            prov: res.provinsi || 'Jawa Tengah',
            lat: res.lat,
            lon: res.lon,
            full: res.full_address || res.display_name
          };
        }
        throw new Error(res.error || "Backend reverse failed");
      })
      .catch(async () => {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=id`);
          const data = await r.json();
          return this.parseAddress(data, lat, lng);
        } catch (err) {
          return {
            desa: '', kec: '', dusun: '',
            kab: 'Kabupaten Magelang', prov: 'Jawa Tengah',
            lat: this._pickedLat, lon: this._pickedLon,
            full: `${this._pickedLat}, ${this._pickedLon}`
          };
        }
      })
      .then(parsed => {
        this._pickedAddress = parsed;
        if (addrEl) addrEl.textContent = parsed.full;
        const elInput = document.getElementById('mapPreviewAddrInput');
        if (elInput) elInput.value = parsed.full;

        if (this._marker) {
          const popupTitle = parsed.desa ? `<b>Desa ${parsed.desa}</b>` : '<b>Titik Terpilih</b>';
          const popupDusun = parsed.dusun ? `<br><small style="color:#10b981; font-weight:600;">${parsed.dusun}</small>` : '';
          const popupSub = parsed.kec ? `<br>${parsed.kec}, ${parsed.kab}` : `<br>${parsed.kab}`;
          this._marker.bindPopup(`${popupTitle}${popupDusun}${popupSub}<br><small style="color:#64748b;">${this._pickedLat}, ${this._pickedLon}</small>`).openPopup();
        }

        const elDesa = document.getElementById('mapPreviewDesa');
        const elKec = document.getElementById('mapPreviewKec');
        const elKab = document.getElementById('mapPreviewKab');
        const elProv = document.getElementById('mapPreviewProv');
        const elDusun = document.getElementById('mapPreviewDusun');
        if (elDesa) elDesa.textContent = parsed.desa || '–';
        if (elKec) elKec.textContent = parsed.kec || '–';
        if (elKab) elKab.textContent = parsed.kab || '–';
        if (elProv) elProv.textContent = parsed.prov || '–';
        if (elDusun) elDusun.textContent = parsed.dusun || '–';
        return parsed;
      });
  },

  parseAddress(data, lat, lng) {
    const a = (data && data.address) || {};
    let dusun = '';
    if (a.hamlet && (a.village || a.suburb || a.town)) {
      dusun = a.hamlet;
    } else if (a.neighbourhood && (a.village || a.suburb)) {
      dusun = a.neighbourhood;
    } else if (a.quarter) {
      dusun = a.quarter;
    }
    if (dusun && !/^dusun\s+/i.test(dusun) && !/^kampung\s+/i.test(dusun)) {
      dusun = `Dusun ${dusun}`;
    }

    let desa = a.village || a.suburb || '';
    if (!desa) {
      desa = (a.hamlet && (a.town || a.subdistrict)) ? a.hamlet : (a.neighbourhood || a.residential || a.quarter || '');
    }
    desa = desa.replace(/^(desa|kelurahan)\s+/i, '').trim();

    let kec = a.subdistrict || a.district || a.city_district || a.municipality || '';
    if (!kec && a.town && (a.village || a.hamlet || a.suburb)) {
      kec = a.town;
    }
    kec = kec.replace(/^kecamatan\s+/i, '').trim();

    let kab = a.county || a.city || a.state_district || a.regency || '';
    kab = kab.replace(/^(kabupaten|kab\.?)\s+/i, '').trim();
    let prov = a.state || 'Jawa Tengah';

    const desaKey = desa.toLowerCase();
    if (PAMSIMAS_VILLAGE_DB[desaKey]) {
      const info = PAMSIMAS_VILLAGE_DB[desaKey];
      if (!kec && info.kec) kec = info.kec;
      if (!kab && info.kab) kab = info.kab;
    }

    if (kec && !/^kecamatan\s+/i.test(kec)) kec = `Kecamatan ${kec}`;
    if (kab && !/^kabupaten\s+/i.test(kab) && !/^kota\s+/i.test(kab)) kab = `Kabupaten ${kab}`;

    return {
      dusun,
      desa: desa ? (desa.charAt(0).toUpperCase() + desa.slice(1)) : '',
      kec,
      kab: kab || 'Kabupaten Magelang',
      prov: prov || 'Jawa Tengah',
      lat: lat.toFixed(6),
      lon: lng.toFixed(6),
      full: data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    };
  },

  close() {
    document.getElementById('mapPickerModal')?.classList.remove('active');
  },

  async confirm() {
    if (!this._pickedLat || !this._pickedLon) return;

    if (this._fetchPromise) {
      try { await this._fetchPromise; } catch (e) {}
    }

    const lat = this._pickedLat;
    const lon = this._pickedLon;
    const addr = this._pickedAddress || {};
    const { desa, kec, dusun, kab, prov } = addr;
    const customAddr = (document.getElementById('mapPreviewAddrInput')?.value || addr.full || '').trim();

    const latEl = document.getElementById(this._targetLatId);
    const lonEl = document.getElementById(this._targetLonId);
    if (latEl) latEl.value = lat;
    if (lonEl) lonEl.value = lon;

    if (this._context === 'reportQuick') {
      const rDesa = document.getElementById('reportQuickDesa');
      const rKec = document.getElementById('reportQuickKec');
      const rDusun = document.getElementById('reportQuickDusun');
      const rKab = document.getElementById('reportQuickKab');
      const rProv = document.getElementById('reportQuickProv');
      const rCustomAddr = document.getElementById('reportQuickCustomAddress');
      if (desa && rDesa) rDesa.value = desa;
      if (kec && rKec) rKec.value = kec;
      if (dusun && rDusun) rDusun.value = dusun;
      if (kab && rKab) rKab.value = kab;
      if (prov && rProv) rProv.value = prov;
      if (customAddr && rCustomAddr) rCustomAddr.value = customAddr;
    } else if (this._context === 'modalPhoto') {
      const mDesa = document.getElementById('modalDesa');
      const mKec = document.getElementById('modalKecamatan');
      const mDusun = document.getElementById('modalDusun');
      const mKab = document.getElementById('modalKabupaten');
      const mProv = document.getElementById('modalProvinsi');
      const mCustomAddr = document.getElementById('modalCustomAddress');
      if (desa && mDesa) mDesa.value = desa;
      if (kec && mKec) mKec.value = kec;
      if (dusun && mDusun) mDusun.value = dusun;
      if (kab && mKab) mKab.value = kab;
      if (prov && mProv) mProv.value = prov;
      if (customAddr && mCustomAddr) mCustomAddr.value = customAddr;

      if (window.reportBuilder) {
        window.reportBuilder.updateModalLivePreview();
      }
    }

    if (typeof this._onConfirm === 'function') {
      this._onConfirm(lat, lon, addr);
    }

    this.close();
  },

  async apply(scope = 'all') {
    if (!this._pickedLat || !this._pickedLon) return;
    await this.confirm();

    if (window.reportBuilder && typeof window.reportBuilder.applyQuickSetup === 'function') {
      window.reportBuilder.applyQuickSetup(scope);
    }
  },

  async search() {
    const query = document.getElementById('mapSearchInput')?.value?.trim();
    if (!query || !this._map) return;

    try {
      const res = await fetch(`/api/geocoding/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data && data.success && data.results && data.results.length > 0) {
        const item = data.results[0];
        const pLat = parseFloat(item.lat);
        const pLng = parseFloat(item.lon);
        this._map.setView([pLat, pLng], 17);
        this.selectLatLng(pLat, pLng);
        return;
      }

      const fbRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', Jawa Tengah')}&format=json&limit=1&accept-language=id`);
      const fbData = await fbRes.json();
      if (fbData && fbData.length > 0) {
        const { lat, lon } = fbData[0];
        const pLat = parseFloat(lat);
        const pLng = parseFloat(lon);
        this._map.setView([pLat, pLng], 17);
        this.selectLatLng(pLat, pLng);
      } else {
        alert('Lokasi tidak ditemukan. Coba gunakan nama desa atau kecamatan yang lebih spesifik.');
      }
    } catch (e) {
      alert('Gagal mencari lokasi. Periksa koneksi internet Anda.');
    }
  }
};

window.reverseGeocodeModalCoords = async () => {
  const lat = parseFloat(document.getElementById('modalLat')?.value);
  const lon = parseFloat(document.getElementById('modalLon')?.value);
  if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
    alert("Isi atau pilih koordinat Latitude & Longitude terlebih dahulu!");
    return;
  }

  const btn = document.getElementById('btnModalReverseGeocode');
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Mendeteksi...";
  }

  try {
    const res = await fetch(`/api/geocoding/reverse?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    if (data && data.success) {
      if (data.desa) document.getElementById('modalDesa').value = data.desa;
      if (data.kecamatan) document.getElementById('modalKecamatan').value = data.kecamatan;
      if (data.kabupaten) document.getElementById('modalKabupaten').value = data.kabupaten;
      if (data.provinsi) document.getElementById('modalProvinsi').value = data.provinsi;
      if (data.dusun) document.getElementById('modalDusun').value = data.dusun;
      
      const naturalAddr = data.natural_address || data.full_address || '';
      const mAddr = document.getElementById('modalCustomAddress');
      if (mAddr && naturalAddr) {
        mAddr.value = naturalAddr;
      }

      if (window.reportBuilder) {
        window.reportBuilder.updateModalLivePreview();
      }
      alert(`Alamat berhasil disinkronkan dari GPS!\n- Alamat Alami: ${naturalAddr || '–'}\n- Dusun: ${data.dusun || '–'}\n- Desa: ${data.desa}\n- Kecamatan: ${data.kecamatan}\n- Kabupaten: ${data.kabupaten}`);
    } else {
      alert("Gagal mendeteksi alamat dari koordinat ini.");
    }
  } catch (err) {
    alert("Gagal menghubungi server geocoding: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Deteksi Alamat GPS`;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('mapSearchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') mapPicker.search();
    });
  }
});

// Bootstrap standalone application on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
