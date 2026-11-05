export function initErrorCatcher() {
  function sendClientError(message, stack) {
    try {
      fetch('/api/logs/client_error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, stack })
      }).catch(() => {});
    } catch (_) {}
  }

  function dismissToast(toast) {
    if (!toast || toast.classList.contains('fade-out')) return;
    toast.classList.add('fade-out');
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 200);
  }

  function showToast(msg, type = 'info', duration = null) {
    const toastArea = document.getElementById('errorToastArea');
    if (!toastArea) {
      alert(msg);
      return;
    }
    const toast = document.createElement('div');
    toast.className = `err-toast ${type}`;

    let iconSvg = '';
    let title = 'Info';

    if (type === 'success') {
      title = 'Berhasil';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" class="err-toast-icon"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    } else if (type === 'warning') {
      title = 'Perhatian';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.2" class="err-toast-icon"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    } else if (type === 'error') {
      title = 'Terjadi Kesalahan';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.2" class="err-toast-icon"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    } else {
      title = 'Informasi';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" class="err-toast-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }

    const cleanMsg = String(msg || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

    toast.innerHTML = `
      ${iconSvg}
      <div style="flex:1; min-width:0;">
        <strong style="font-size:0.83rem; font-weight:600; display:block; margin-bottom:2px;">${title}</strong>
        <span style="font-size:0.78rem; opacity:0.95; word-break:break-word; line-height:1.4;">${cleanMsg}</span>
      </div>
      <button type="button" class="err-toast-close" title="Tutup">&times;</button>
    `;

    const closeBtn = toast.querySelector('.err-toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => dismissToast(toast));
    }

    toastArea.appendChild(toast);

    const autoTime = duration !== null ? duration : (type === 'error' ? 6500 : (type === 'warning' ? 5000 : 4000));
    if (autoTime > 0) {
      setTimeout(() => dismissToast(toast), autoTime);
    }
  }

  window.showToast = showToast;

  window.addEventListener('error', (event) => {
    const msg = event.message || 'JavaScript Error';
    const file = event.filename ? ` @ ${event.filename}:${event.lineno}:${event.colno}` : '';
    const full = msg + file;
    const stack = event.error ? (event.error.stack || event.error.message) : full;
    showToast(`${msg}`, 'error');
    sendClientError(full, stack);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason ? (reason.message || String(reason)) : 'Unhandled Promise Rejection';
    const stack = reason && reason.stack ? reason.stack : msg;
    showToast(`Promise error: ${msg}`, 'error');
    sendClientError(`Unhandled Rejection: ${msg}`, stack);
  });

  window.addEventListener('DOMContentLoaded', () => {
    const logBtn = document.getElementById('btnViewErrorLogs');
    if (logBtn) logBtn.addEventListener('click', () => window.errorCatcher.openModal());
  });

  window.errorCatcher = {
    showToast,
    sendClientError,
    async openModal() {
      const modal = document.getElementById('errorLogsModal');
      const pre = document.getElementById('errorLogsContent');
      const info = document.getElementById('errorLogsPath');
      if (!modal || !pre) return;
      modal.classList.add('active');
      if (pre) pre.textContent = 'Memuat log...';
      try {
        const res = await fetch('/api/logs/errors?lines=300');
        const data = await res.json();
        if (pre) pre.textContent = data.logs || '(log kosong)';
        if (info) info.textContent = data.log_file || '';
      } catch (e) {
        if (pre) pre.textContent = 'Gagal memuat log: ' + e.message;
      }
    },
    closeModal() {
      const modal = document.getElementById('errorLogsModal');
      if (modal) modal.classList.remove('active');
    },
    async clearLogs() {
      if (!confirm('Hapus semua log error?')) return;
      try {
        const res = await fetch('/api/logs/errors', { method: 'DELETE' });
        const data = await res.json();
        showToast(data.message || 'Log dibersihkan', 'info');
        const pre = document.getElementById('errorLogsContent');
        if (pre) pre.textContent = 'Log dibersihkan.';
      } catch (e) {
        showToast('Gagal membersihkan log: ' + e.message, 'error');
      }
    },
    async fetchAndReportUploadError(err, context = 'upload') {
      try {
        const res = await fetch('/api/logs/errors?lines=50');
        const data = await res.json();
        const lastLog = data.logs ? data.logs.slice(-1500) : '';
        showToast(`${context}: ${err} — cek Panel Log Error untuk detail.`, 'error');
        if (lastLog) console.error('Last backend log:', lastLog);
      } catch (_) {
        showToast(`Gagal ${context}: ${err}`, 'error');
      }
    }
  };

  window.closeErrorLogsModal = () => window.errorCatcher.closeModal();
  window.clearErrorLogs = () => window.errorCatcher.clearLogs();
  window.viewErrorLogs = () => window.errorCatcher.openModal();
}
