// =========================================================
// PAMSIMAS STUDIO - REAL-TIME APP VERSION & GITHUB UPDATER
// =========================================================

export class AppUpdater {
  constructor() {
    this.currentVersion = null;
    this.latestRemote = null;
    this.isChecking = false;
    this.isUpdating = false;
  }

  init() {
    // Expose global methods
    window.openUpdateModal = () => this.openModal();
    window.closeUpdateModal = () => this.closeModal();
    window.checkForAppUpdate = () => this.checkForUpdate();
    window.applyAppUpdate = () => this.applyUpdate();

    // Listen to click on brand version header
    const brandVer = document.getElementById('appVersionHeader');
    if (brandVer) {
      brandVer.addEventListener('click', () => this.openModal());
    }

    // Load real local version on startup (zero data usage, 100% offline local call)
    this.fetchLocalVersion();
  }

  async fetchLocalVersion() {
    try {
      const res = await fetch('/api/system/version');
      const data = await res.json();
      if (data && data.success) {
        this.currentVersion = data;
        this.renderVersionInUI(data);
      }
    } catch (err) {
      console.warn('[Updater] Gagal memuat info versi lokal:', err);
    }
  }

  renderVersionInUI(data) {
    // Header brand version badge
    const headerVerEl = document.getElementById('appVersionHeader');
    if (headerVerEl) {
      headerVerEl.textContent = data.display || `v${data.version}`;
      headerVerEl.title = `Versi: ${data.full_display || data.display} (Klik untuk cek update)`;
    }

    // Header update button label
    const headerBtnText = document.getElementById('headerVersionText');
    if (headerBtnText) {
      headerBtnText.textContent = data.display_tag || `v${data.version}`;
    }

    // Modal current version details
    const tagEl = document.getElementById('modalCurrentVersionTag');
    if (tagEl) tagEl.textContent = data.display_tag || `v${data.version}`;

    const hashEl = document.getElementById('modalCurrentCommitHash');
    if (hashEl) hashEl.textContent = data.commit || '-';

    const dateEl = document.getElementById('modalCurrentCommitDate');
    if (dateEl) dateEl.textContent = data.commit_date || '-';

    const branchEl = document.getElementById('modalCurrentBranch');
    if (branchEl) branchEl.textContent = data.branch || 'main';

    const msgEl = document.getElementById('modalCurrentCommitMsg');
    if (msgEl) {
      msgEl.textContent = data.commit_message || 'Versi lokal aktif.';
      if (data.is_dirty) {
        msgEl.innerHTML = `${this.escapeHtml(data.commit_message)} <span class="dirty-badge" title="Terdapat berkas yang dimodifikasi di lokal">• modified</span>`;
      }
    }
  }

  openModal() {
    const modal = document.getElementById('updateModal');
    if (!modal) return;
    modal.classList.add('active');

    // Make sure current version info is up to date
    if (this.currentVersion) {
      this.renderVersionInUI(this.currentVersion);
    } else {
      this.fetchLocalVersion();
    }
  }

  closeModal() {
    const modal = document.getElementById('updateModal');
    if (modal) modal.classList.remove('active');
  }

  async checkForUpdate() {
    if (this.isChecking || this.isUpdating) return;
    this.isChecking = true;

    const btnCheck = document.getElementById('btnModalCheckUpdate');
    const btnText = document.getElementById('btnModalCheckUpdateText');
    const statusBox = document.getElementById('modalUpdateStatusBox');
    const statusText = document.getElementById('modalUpdateStatusText');
    const statusPill = document.getElementById('modalRemoteStatusPill');
    const changelogWrap = document.getElementById('modalChangelogWrap');
    const changelogList = document.getElementById('modalChangelogList');
    const btnApply = document.getElementById('btnModalApplyUpdate');
    const btnReload = document.getElementById('btnModalReloadApp');

    if (btnCheck) btnCheck.disabled = true;
    if (btnText) btnText.textContent = 'Checking...';
    if (statusPill) {
      statusPill.textContent = 'Memeriksa...';
      statusPill.className = 'update-status-pill checking';
    }
    if (statusBox) statusBox.className = 'update-status-box checking';
    if (statusText) statusText.innerHTML = 'Menghubungi repositori GitHub untuk memverifikasi versi terbaru...';
    if (btnApply) btnApply.style.display = 'none';
    if (btnReload) btnReload.style.display = 'none';
    if (changelogWrap) changelogWrap.style.display = 'none';

    try {
      const res = await fetch('/api/system/check_update');
      const data = await res.json();

      if (!data.success) {
        // Network or git failure
        if (statusPill) {
          statusPill.textContent = 'Gagal';
          statusPill.className = 'update-status-pill error';
        }
        if (statusBox) statusBox.className = 'update-status-box error';
        if (statusText) statusText.textContent = data.error || 'Gagal memeriksa pembaruan dari GitHub.';
        return;
      }

      this.latestRemote = data.remote;

      if (data.has_update) {
        // Newer version available on GitHub
        const dot = document.getElementById('headerUpdateDot');
        if (dot) dot.style.display = 'inline-block';

        if (statusPill) {
          statusPill.textContent = `${data.behind_count} Update Baru`;
          statusPill.className = 'update-status-pill available';
        }
        if (statusBox) statusBox.className = 'update-status-box available';
        if (statusText) {
          statusText.innerHTML = `
            <strong>Tersedia pembaruan baru dari GitHub!</strong><br>
            Versi di GitHub lebih baru <strong>(${data.behind_count} commit)</strong>. 
            Versi terbaru: <code class="font-mono">${data.remote.commit}</code> (${data.remote.commit_date}).
          `;
        }

        // Render changelog
        if (data.remote.changelog && data.remote.changelog.length > 0) {
          if (changelogList) {
            changelogList.innerHTML = data.remote.changelog.map(c => `
              <div class="changelog-item">
                <span class="changelog-hash font-mono">${c.commit}</span>
                <span class="changelog-date">${c.date}</span>
                <span class="changelog-msg">${this.escapeHtml(c.message)}</span>
              </div>
            `).join('');
          }
          if (changelogWrap) changelogWrap.style.display = 'block';
        }

        if (btnApply) {
          btnApply.style.display = 'inline-flex';
          btnApply.textContent = 'Update Sekarang';
          btnApply.disabled = false;
        }
      } else {
        // Already up to date
        const dot = document.getElementById('headerUpdateDot');
        if (dot) dot.style.display = 'none';

        if (statusPill) {
          statusPill.textContent = 'Terkini';
          statusPill.className = 'update-status-pill uptodate';
        }
        if (statusBox) statusBox.className = 'update-status-box uptodate';
        if (statusText) {
          statusText.innerHTML = `
            <strong>Aplikasi sudah versi terbaru.</strong><br>
            Tidak ada pembaruan baru di repositori GitHub. Commit aktif lokal <code class="font-mono">${data.current?.commit || ''}</code> telah sinkron dengan <code class="font-mono">origin/main</code>.
          `;
        }
      }
    } catch (err) {
      if (statusPill) {
        statusPill.textContent = 'Koneksi Error';
        statusPill.className = 'update-status-pill error';
      }
      if (statusBox) statusBox.className = 'update-status-box error';
      if (statusText) statusText.textContent = `Kesalahan: ${err.message || 'Tidak dapat terhubung ke server lokal'}`;
    } finally {
      this.isChecking = false;
      if (btnCheck) btnCheck.disabled = false;
      if (btnText) btnText.textContent = 'Check for Update';
    }
  }

  async applyUpdate() {
    if (this.isUpdating) return;
    this.isUpdating = true;

    const btnApply = document.getElementById('btnModalApplyUpdate');
    const btnReload = document.getElementById('btnModalReloadApp');
    const btnCheck = document.getElementById('btnModalCheckUpdate');
    const statusBox = document.getElementById('modalUpdateStatusBox');
    const statusText = document.getElementById('modalUpdateStatusText');
    const statusPill = document.getElementById('modalRemoteStatusPill');

    if (btnApply) {
      btnApply.disabled = true;
      btnApply.textContent = 'Mengunduh Pembaruan...';
    }
    if (btnCheck) btnCheck.disabled = true;
    if (statusPill) {
      statusPill.textContent = 'Mengupdate...';
      statusPill.className = 'update-status-pill checking';
    }
    if (statusBox) statusBox.className = 'update-status-box checking';
    if (statusText) statusText.innerHTML = 'Mengunduh commit terbaru dari GitHub dan memperbarui berkas aplikasi...';

    try {
      const res = await fetch('/api/system/apply_update', { method: 'POST' });
      const data = await res.json();

      if (!data.success) {
        if (statusPill) {
          statusPill.textContent = 'Update Gagal';
          statusPill.className = 'update-status-pill error';
        }
        if (statusBox) statusBox.className = 'update-status-box error';
        if (statusText) statusText.textContent = data.error || 'Pembaruan gagal diterapkan.';
        if (btnApply) {
          btnApply.disabled = false;
          btnApply.textContent = 'Coba Lagi';
        }
        return;
      }

      // Update successful
      if (data.version) {
        this.currentVersion = data.version;
        this.renderVersionInUI(data.version);
      }

      const dot = document.getElementById('headerUpdateDot');
      if (dot) dot.style.display = 'none';

      if (statusPill) {
        statusPill.textContent = 'Berhasil';
        statusPill.className = 'update-status-pill uptodate';
      }
      if (statusBox) statusBox.className = 'update-status-box uptodate';
      if (statusText) {
        statusText.innerHTML = `
          <strong>Pembaruan berhasil diterapkan!</strong><br>
          Aplikasi telah diperbarui ke commit <code class="font-mono">${data.version?.commit || ''}</code>. 
          Silakan klik tombol <strong>Reload Halaman</strong> untuk mengaktifkan pembaruan di antarmuka.
        `;
      }

      if (btnApply) btnApply.style.display = 'none';
      if (btnReload) {
        btnReload.style.display = 'inline-flex';
        btnReload.focus();
      }

      if (window.errorCatcher && window.errorCatcher.showToast) {
        window.errorCatcher.showToast('Pembaruan berhasil diterapkan. Silakan Reload Halaman.', 'info');
      }
    } catch (err) {
      if (statusPill) {
        statusPill.textContent = 'Error';
        statusPill.className = 'update-status-pill error';
      }
      if (statusBox) statusBox.className = 'update-status-box error';
      if (statusText) statusText.textContent = `Kesalahan saat update: ${err.message}`;
      if (btnApply) {
        btnApply.disabled = false;
        btnApply.textContent = 'Coba Lagi';
      }
    } finally {
      this.isUpdating = false;
      if (btnCheck) btnCheck.disabled = false;
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }
}
