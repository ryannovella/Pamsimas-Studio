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

  function showToast(msg, type = 'error') {
    const toastArea = document.getElementById('errorToastArea');
    if (!toastArea) {
      alert(msg);
      return;
    }
    const toast = document.createElement('div');
    toast.className = `err-toast ${type}`;
    toast.innerHTML = `
      <div style="flex:1; min-width:0;">
        <strong style="font-size:0.85rem; display:block;">${type === 'error' ? 'Terjadi Kesalahan' : 'Info'}</strong>
        <span style="font-size:0.78rem; opacity:0.92; word-break:break-word;">${msg}</span>
      </div>
      <button onclick="this.closest('.err-toast').remove()" style="background:none; border:none; color:inherit; cursor:pointer; font-size:1.2rem; padding:0 4px;">&times;</button>
    `;
    toastArea.appendChild(toast);
    if (type !== 'error' || msg.length < 80) {
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 6000);
    }
  }

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
