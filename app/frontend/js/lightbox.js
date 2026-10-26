// =========================================================
// PAMSIMAS STUDIO - PHOTO LIGHTBOX VIEWER MODULE
// =========================================================
import { renderStampedPhoto } from './canvasRenderer.js';

export class PhotoLightbox {
  constructor() {
    this.modal = null;
    this.canvas = null;
    this.titleEl = null;
    this.subtitleEl = null;
    this.stampBadgeEl = null;
    this.locationPillEl = null;
    this.timePillEl = null;
    this.btnToggleRaw = null;

    this.currentContext = 'doc'; // 'doc' or 'photo'
    this.currentIndex = 0;
    this.photosList = [];
    this.showRaw = false;

    this.keyHandler = this.handleKeyDown.bind(this);
    this.initElements();
  }

  initElements() {
    this.modal = document.getElementById('photoLightboxModal');
    this.canvas = document.getElementById('lightboxCanvas');
    this.titleEl = document.getElementById('lightboxTitle');
    this.subtitleEl = document.getElementById('lightboxSubtitle');
    this.stampBadgeEl = document.getElementById('lightboxStampBadge');
    this.locationPillEl = document.getElementById('lightboxLocationPill');
    this.timePillEl = document.getElementById('lightboxTimePill');
    this.btnToggleRaw = document.getElementById('btnLightboxToggleRaw');
  }

  getPhotosList(context) {
    if (context === 'photo') {
      return (window.photoStudio && window.photoStudio.photos) || [];
    } else if (context === 'report') {
      return (window.reportBuilder && window.reportBuilder.photos) || [];
    }
    return (window.docEditor && window.docEditor.docData && window.docEditor.docData.photos) || [];
  }

  async open(photoId, context = 'doc') {
    if (!this.modal) this.initElements();
    this.currentContext = context;
    this.photosList = this.getPhotosList(context);

    if (this.photosList.length === 0) return;

    const idx = this.photosList.findIndex(p => p.id === photoId);
    this.currentIndex = idx !== -1 ? idx : 0;
    this.showRaw = false;

    this.modal.classList.add('active');
    document.addEventListener('keydown', this.keyHandler);

    await this.renderCurrent();
  }

  close() {
    if (this.modal) {
      this.modal.classList.remove('active');
    }
    document.removeEventListener('keydown', this.keyHandler);
  }

  handleKeyDown(e) {
    if (!this.modal || !this.modal.classList.contains('active')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.navigate(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.navigate(1);
    } else if (!e.ctrlKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      this.openEditor();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      this.downloadPhoto();
    } else if (!e.ctrlKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      this.downloadPhoto();
    } else if (!e.ctrlKey && !e.altKey && (e.key === 'o' || e.key === 'O' || e.code === 'Space')) {
      e.preventDefault();
      this.toggleRaw();
    }
  }

  async navigate(direction) {
    if (this.photosList.length <= 1) return;
    this.currentIndex = (this.currentIndex + direction + this.photosList.length) % this.photosList.length;
    await this.renderCurrent();
  }

  getCurrentPhotoData() {
    if (!this.photosList || this.photosList.length === 0) return null;
    const base = this.photosList[this.currentIndex];
    if (!base) return null;

    if (this.currentContext === 'doc' && window.docEditor && window.docEditor.docUpdates) {
      return window.docEditor.docUpdates[base.id] || base;
    }
    return base;
  }

  async renderCurrent() {
    const p = this.getCurrentPhotoData();
    if (!p || !this.canvas) return;

    const totalCount = this.photosList.length;
    const currentNum = this.currentIndex + 1;

    // Update Titles & Info
    if (this.titleEl) {
      this.titleEl.innerText = `Foto #${p.id} (${currentNum} dari ${totalCount}) — ${p.desa || 'Pamsimas'}`;
    }
    if (this.subtitleEl) {
      this.subtitleEl.innerText = p.filename || p.name || '';
    }

    const isKeepOrig = !!(p.keep_original || p.skip_stamp);
    if (this.stampBadgeEl) {
      if (isKeepOrig) {
        this.stampBadgeEl.className = 'badge badge-warning';
        this.stampBadgeEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Foto Asli (Tanpa Stempel)';
      } else if (this.showRaw) {
        this.stampBadgeEl.className = 'badge';
        this.stampBadgeEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="12" cy="12" r="3"/><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/></svg>Pratinjau Foto Asli (Raw)';
      } else {
        this.stampBadgeEl.className = 'badge badge-accent';
        this.stampBadgeEl.innerText = '● Live Stamp Geotag';
      }
    }

    if (this.btnToggleRaw) {
      this.btnToggleRaw.innerText = this.showRaw ? 'Lihat Stempel' : 'Foto Asli';
    }

    const latFormatted = String(p.lat || '').replace('.', ',');
    const lonFormatted = String(p.lon || '').replace('.', ',');
    if (this.locationPillEl) {
      this.locationPillEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${p.desa || 'Desa'}, ${p.kecamatan || 'Kecamatan'}, ${p.kabupaten || 'Kabupaten'} (${latFormatted}, ${lonFormatted})`;
    }
    if (this.timePillEl) {
      this.timePillEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${p.time_str || '-'}`;
    }

    // Load image object
    let imgObj = null;
    try {
      if (this.currentContext === 'photo') {
        imgObj = p.imgObj;
      } else if (this.currentContext === 'report' && window.reportBuilder) {
        imgObj = await window.reportBuilder.getImage(p);
      } else if (window.docEditor) {
        imgObj = await window.docEditor.getImage(p);
      }
    } catch (e) {
      console.warn("Gagal memuat gambar untuk lightbox:", e);
    }

    if (!imgObj) return;

    renderStampedPhoto(this.canvas, imgObj, p, this.showRaw || isKeepOrig);
  }

  toggleRaw() {
    this.showRaw = !this.showRaw;
    this.renderCurrent();
  }

  openEditor() {
    const p = this.getCurrentPhotoData();
    if (!p) return;
    this.close();

    if (this.currentContext === 'photo' && window.photoStudio) {
      window.photoStudio.openModal(p.id);
    } else if (this.currentContext === 'report' && window.reportBuilder) {
      window.reportBuilder.openModal(p.id);
    } else if (window.docEditor) {
      window.docEditor.openModal(p.id);
    }
  }

  downloadPhoto() {
    const p = this.getCurrentPhotoData();
    if (!p || !this.canvas) return;

    const safeDesa = (p.desa || 'Pamsimas').replace(/\s+/g, '_');
    const a = document.createElement('a');
    a.download = `Pratinjau_Besar_${safeDesa}_Foto_${p.id}.jpg`;
    a.href = this.canvas.toDataURL('image/jpeg', 0.95);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
