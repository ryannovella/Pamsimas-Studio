/**
 * PAMSIMAS STUDIO - Custom Autocomplete Dropdown Component
 * High performance real-time prefix-first search with keyboard navigation.
 */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function highlightText(text, query) {
  if (!text) return '';
  const str = String(text);
  const q = (query || '').trim();
  if (!q) return escapeHtml(str);

  const lower = str.toLowerCase();
  const lowerQ = q.toLowerCase();
  const idx = lower.indexOf(lowerQ);
  if (idx === -1) {
    return escapeHtml(str);
  }
  const before = escapeHtml(str.slice(0, idx));
  const match = escapeHtml(str.slice(idx, idx + q.length));
  const after = escapeHtml(str.slice(idx + q.length));
  return `${before}<mark class="autocomplete-highlight">${match}</mark>${after}`;
}

export class Autocomplete {
  constructor({
    input,
    getItems,
    renderItem,
    onSelect,
    minChars = 0,
    maxResults = 15,
    containerClass = ''
  }) {
    this.input = typeof input === 'string' ? document.querySelector(input) : input;
    if (!this.input) return;

    this.getItems = getItems;
    this.renderItem = renderItem;
    this.onSelect = onSelect;
    this.minChars = minChars;
    this.maxResults = maxResults;

    this.dropdown = null;
    this.items = [];
    this.selectedIndex = -1;
    this.isOpen = false;
    this.currentQuery = '';

    // Disable native browser autocomplete & datalist interference
    this.input.setAttribute('autocomplete', 'off');
    this.input.removeAttribute('list');

    this.boundOnInput = this.onInput.bind(this);
    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnFocus = this.onFocus.bind(this);
    this.boundOnClick = this.onClick.bind(this);
    this.boundOnBlur = this.onBlur.bind(this);
    this.boundOnClickOutside = this.onClickOutside.bind(this);

    this.init();
  }

  init() {
    // Ensure parent has relative positioning
    const parent = this.input.parentElement;
    if (parent && window.getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    // Create dropdown container
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'autocomplete-dropdown';
    this.dropdown.style.display = 'none';
    this.input.parentNode.appendChild(this.dropdown);

    // Event listeners
    this.input.addEventListener('input', this.boundOnInput);
    this.input.addEventListener('keydown', this.boundOnKeyDown, { capture: true });
    this.input.addEventListener('focus', this.boundOnFocus);
    this.input.addEventListener('click', this.boundOnClick);
    this.input.addEventListener('blur', this.boundOnBlur);
    document.addEventListener('pointerdown', this.boundOnClickOutside);
  }

  onClick(e) {
    if (!this.isOpen) {
      const query = this.input.value || '';
      this.updateSuggestions(query);
    }
  }

  async onInput(e) {
    const query = this.input.value || '';
    this.currentQuery = query;
    if (query.trim().length < this.minChars) {
      this.close();
      return;
    }
    await this.updateSuggestions(query);
  }

  onFocus(e) {
    const query = this.input.value || '';
    if (query.trim().length >= this.minChars) {
      this.updateSuggestions(query);
    }
  }

  onBlur(e) {
    // Small delay to allow pointerdown / click on dropdown item to register
    setTimeout(() => {
      if (!this.dropdown.contains(document.activeElement)) {
        this.close();
      }
    }, 150);
  }

  onClickOutside(e) {
    if (!this.isOpen) return;
    if (!this.dropdown.contains(e.target) && e.target !== this.input) {
      this.close();
    }
  }

  async updateSuggestions(query) {
    try {
      const results = await this.getItems(query);
      this.items = results || [];
      this.selectedIndex = this.items.length > 0 ? 0 : -1;
      this.render();
    } catch (err) {
      console.warn('Autocomplete getItems error:', err);
      this.close();
    }
  }

  render() {
    if (!this.items || this.items.length === 0) {
      this.dropdown.innerHTML = '<div class="autocomplete-empty">Tidak ada hasil ditemukan</div>';
      this.dropdown.style.display = 'flex';
      this.isOpen = true;
      return;
    }

    this.dropdown.innerHTML = '';
    this.items.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = `autocomplete-item ${idx === this.selectedIndex ? 'active' : ''}`;

      if (this.renderItem) {
        el.innerHTML = this.renderItem(item, this.currentQuery);
      } else {
        el.textContent = typeof item === 'string' ? item : JSON.stringify(item);
      }

      // Prevent input from losing focus immediately on pointerdown
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
      });

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(item);
      });

      this.dropdown.appendChild(el);
    });

    this.dropdown.style.display = 'flex';
    this.isOpen = true;
  }

  onKeyDown(e) {
    if (!this.isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      if ((this.input.value || '').trim().length >= this.minChars) {
        this.updateSuggestions(this.input.value || '');
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (!this.isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (this.items.length > 0) {
        this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
        this.updateActiveItem();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (this.items.length > 0) {
        this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
        this.updateActiveItem();
      }
    } else if (e.key === 'Enter') {
      if (this.items.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
        const chosen = this.selectedIndex >= 0 && this.selectedIndex < this.items.length
          ? this.items[this.selectedIndex]
          : this.items[0];
        this.select(chosen);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === 'Tab') {
      this.close();
    }
  }

  updateActiveItem() {
    const itemEls = this.dropdown.querySelectorAll('.autocomplete-item');
    itemEls.forEach((el, idx) => {
      if (idx === this.selectedIndex) {
        el.classList.add('active');
        el.scrollIntoView({ block: 'nearest' });
      } else {
        el.classList.remove('active');
      }
    });
  }

  select(item) {
    if (this.onSelect) {
      this.onSelect(item, this.input);
    }
    this.close();
  }

  close() {
    if (this.dropdown) {
      this.dropdown.style.display = 'none';
      this.dropdown.innerHTML = '';
    }
    this.isOpen = false;
    this.selectedIndex = -1;
  }

  destroy() {
    if (this.input) {
      this.input.removeEventListener('input', this.boundOnInput);
      this.input.removeEventListener('keydown', this.boundOnKeyDown, { capture: true });
      this.input.removeEventListener('focus', this.boundOnFocus);
      this.input.removeEventListener('click', this.boundOnClick);
      this.input.removeEventListener('blur', this.boundOnBlur);
    }
    document.removeEventListener('pointerdown', this.boundOnClickOutside);
    if (this.dropdown && this.dropdown.parentNode) {
      this.dropdown.parentNode.removeChild(this.dropdown);
    }
  }
}
