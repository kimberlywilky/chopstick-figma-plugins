import JSZip from 'jszip';
import { setStatus, clearStatus, downloadZip } from '../../../packages/shared/ts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScanIcon {
  name: string;
  brands: string[];
}

type SourceTab = 'page' | 'selection';

// ─── State ───────────────────────────────────────────────────────────────────

let icons: ScanIcon[] = [];
let allBrands: string[] = [];
const iconBrandSelections = new Map<string, Set<string>>(); // icon name -> selected brands
const expandedRows = new Set<string>();
const thumbnailCache = new Map<string, string>(); // `${name}::${brand}` -> object URL
let searchText = '';
let currentSource: SourceTab = 'page';

// ─── DOM References ──────────────────────────────────────────────────────────

const loading = document.getElementById('loading') as HTMLDivElement;
const emptyState = document.getElementById('empty-state') as HTMLDivElement;
const panels = document.getElementById('panels') as HTMLDivElement;
const iconListEl = document.getElementById('icon-list') as HTMLDivElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const brandDropdownBtn = document.getElementById('brand-dropdown-btn') as HTMLButtonElement;
const brandDropdownMenu = document.getElementById('brand-dropdown-menu') as HTMLDivElement;
const pageTabBtn = document.getElementById('tab-page') as HTMLButtonElement;
const selectionTabBtn = document.getElementById('tab-selection') as HTMLButtonElement;

// ─── Export Count / Button State ─────────────────────────────────────────────

function getTotalExportCount(): number {
  let count = 0;
  for (const set of iconBrandSelections.values()) {
    count += set.size;
  }
  return count;
}

function updateExportButton(): void {
  const count = getTotalExportCount();
  exportBtn.disabled = count === 0;
  exportBtn.textContent = count > 0 ? `Export ${count} icon${count === 1 ? '' : 's'}` : 'Export icons';
}

// ─── Filtering ───────────────────────────────────────────────────────────────

function getFilteredIcons(): ScanIcon[] {
  if (!searchText) return icons;
  const q = searchText.toLowerCase();
  return icons.filter((icon) => icon.name.toLowerCase().includes(q));
}

// ─── Brand Dropdown ───────────────────────────────────────────────────────────
//
// A brand counts as "fully active" only if every icon that has that brand
// also currently has it checked. This keeps the dropdown's own checkbox
// state consistent with whatever granular per-icon changes happen elsewhere.

function isBrandFullyActive(brand: string): boolean {
  const iconsWithBrand = icons.filter((icon) => icon.brands.includes(brand));
  if (iconsWithBrand.length === 0) return false;
  return iconsWithBrand.every((icon) => iconBrandSelections.get(icon.name)?.has(brand));
}

function setBrandAcrossAllIcons(brand: string, active: boolean): void {
  for (const icon of icons) {
    if (!icon.brands.includes(brand)) continue;
    const set = iconBrandSelections.get(icon.name) ?? new Set<string>();
    if (active) set.add(brand);
    else set.delete(brand);
    iconBrandSelections.set(icon.name, set);
  }
}

function renderBrandDropdown(): void {
  brandDropdownMenu.innerHTML = '';

  const toggleAll = document.createElement('div');
  toggleAll.className = 'toggle-actions';
  toggleAll.innerHTML = `
    <button class="toggle-btn" data-action="select-all-brands">Select all</button>
    <button class="toggle-btn" data-action="deselect-all-brands">Deselect all</button>
  `;
  brandDropdownMenu.appendChild(toggleAll);

  for (const brand of allBrands) {
    const label = document.createElement('label');
    label.className = 'checkbox-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isBrandFullyActive(brand);

    checkbox.addEventListener('change', () => {
      setBrandAcrossAllIcons(brand, checkbox.checked);
      renderIconList();
      updateExportButton();
      updateBrandDropdownCount();
    });

    const span = document.createElement('span');
    span.textContent = brand;

    label.appendChild(checkbox);
    label.appendChild(span);
    brandDropdownMenu.appendChild(label);
  }

  updateBrandDropdownCount();
}

function updateBrandDropdownCount(): void {
  const activeCount = allBrands.filter(isBrandFullyActive).length;
  brandDropdownBtn.textContent = `Brands (${activeCount}/${allBrands.length})`;
}

// ─── Icon List Rendering ──────────────────────────────────────────────────────

function renderIconList(): void {
  iconListEl.innerHTML = '';
  const filtered = getFilteredIcons();

  for (const icon of filtered) {
    const selected = iconBrandSelections.get(icon.name) ?? new Set<string>();

    const row = document.createElement('div');
    row.className = 'icon-row';

    const header = document.createElement('div');
    header.className = 'icon-row-header';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.size === icon.brands.length && icon.brands.length > 0;
    checkbox.indeterminate = selected.size > 0 && selected.size < icon.brands.length;

    checkbox.addEventListener('change', () => {
      iconBrandSelections.set(icon.name, checkbox.checked ? new Set(icon.brands) : new Set());
      renderIconList();
      updateExportButton();
      updateBrandDropdownCount();
    });

    const nameSpan = document.createElement('span');
    nameSpan.className = 'icon-name';
    nameSpan.textContent = icon.name;

    const countSpan = document.createElement('span');
    countSpan.className = 'icon-count';
    countSpan.textContent = `${selected.size}/${icon.brands.length}`;

    const expandArrow = document.createElement('span');
    expandArrow.className = 'expand-arrow' + (expandedRows.has(icon.name) ? ' expanded' : '');
    expandArrow.textContent = '\u203A';

    header.appendChild(checkbox);
    header.appendChild(nameSpan);
    header.appendChild(countSpan);
    header.appendChild(expandArrow);

    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (expandedRows.has(icon.name)) expandedRows.delete(icon.name);
      else expandedRows.add(icon.name);
      renderIconList();
    });

    row.appendChild(header);

    if (expandedRows.has(icon.name)) {
      const variantsEl = document.createElement('div');
      variantsEl.className = 'icon-variants';

      for (const brand of icon.brands) {
        const variantLabel = document.createElement('label');
        variantLabel.className = 'checkbox-item variant-item';

        const variantCheckbox = document.createElement('input');
        variantCheckbox.type = 'checkbox';
        variantCheckbox.checked = selected.has(brand);
        variantCheckbox.addEventListener('change', () => {
          const set = iconBrandSelections.get(icon.name) ?? new Set<string>();
          if (variantCheckbox.checked) set.add(brand);
          else set.delete(brand);
          iconBrandSelections.set(icon.name, set);
          renderIconList();
          updateExportButton();
          updateBrandDropdownCount();
        });

        const cacheKey = `${icon.name}::${brand}`;
        const cachedUrl = thumbnailCache.get(cacheKey);
        let thumbEl: HTMLElement;
        if (cachedUrl) {
          const img = document.createElement('img');
          img.className = 'thumbnail';
          img.src = cachedUrl;
          thumbEl = img;
        } else {
          const placeholder = document.createElement('div');
          placeholder.className = 'thumbnail-placeholder';
          placeholder.dataset.name = icon.name;
          placeholder.dataset.brand = brand;
          thumbEl = placeholder;
        }

        const brandSpan = document.createElement('span');
        brandSpan.textContent = brand;

        variantLabel.appendChild(variantCheckbox);
        variantLabel.appendChild(thumbEl);
        variantLabel.appendChild(brandSpan);
        variantsEl.appendChild(variantLabel);
      }

      row.appendChild(variantsEl);
    }

    iconListEl.appendChild(row);
  }
}

// ─── Thumbnails ──────────────────────────────────────────────────────────────

function applyThumbnail(name: string, brand: string, data: Uint8Array): void {
  const blob = new Blob([data], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  thumbnailCache.set(`${name}::${brand}`, url);

  const placeholder = iconListEl.querySelector<HTMLElement>(
    `.thumbnail-placeholder[data-name="${CSS.escape(name)}"][data-brand="${CSS.escape(brand)}"]`
  );
  if (!placeholder) return;

  const img = document.createElement('img');
  img.className = 'thumbnail';
  img.src = url;
  placeholder.replaceWith(img);
}

// ─── Source Tabs ─────────────────────────────────────────────────────────────
//
// Switching tabs resets all state and requests a fresh scan. currentIcons on
// the sandbox side only ever knows icon names and brand strings, not node
// IDs, so there's no way to reuse a previous scan's node references.

function resetState(): void {
  for (const url of thumbnailCache.values()) {
    URL.revokeObjectURL(url);
  }
  thumbnailCache.clear();
  iconBrandSelections.clear();
  expandedRows.clear();
  icons = [];
  allBrands = [];
  searchText = '';
  searchInput.value = '';
}

function switchSource(tab: SourceTab): void {
  if (tab === currentSource) return;
  currentSource = tab;
  resetState();

  loading.classList.remove('hidden');
  panels.classList.add('hidden');
  emptyState.classList.add('hidden');

  pageTabBtn.classList.toggle('active', tab === 'page');
  selectionTabBtn.classList.toggle('active', tab === 'selection');

  parent.postMessage(
    { pluginMessage: { type: tab === 'page' ? 'scan-page' : 'scan-selection' } },
    '*'
  );
}

pageTabBtn.addEventListener('click', () => switchSource('page'));
selectionTabBtn.addEventListener('click', () => switchSource('selection'));

// ─── Search ──────────────────────────────────────────────────────────────────

searchInput.addEventListener('input', () => {
  searchText = searchInput.value;
  renderIconList();
});

// ─── Brand Dropdown Toggle ────────────────────────────────────────────────────

brandDropdownBtn.addEventListener('click', () => {
  brandDropdownMenu.classList.toggle('hidden');
});

// ─── Toolbar: Select All / Deselect All (delegated) ──────────────────────────
//
// Icon-level select/deselect-all operates only on the currently filtered
// (searched) list, not the full icon set.

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.toggle-btn') as HTMLButtonElement | null;
  if (!btn) return;

  const action = btn.dataset.action;

  if (action === 'select-all-icons' || action === 'deselect-all-icons') {
    const filtered = getFilteredIcons();
    for (const icon of filtered) {
      iconBrandSelections.set(
        icon.name,
        action === 'select-all-icons' ? new Set(icon.brands) : new Set()
      );
    }
    renderIconList();
    updateExportButton();
    updateBrandDropdownCount();
  }

  if (action === 'select-all-brands' || action === 'deselect-all-brands') {
    const active = action === 'select-all-brands';
    for (const brand of allBrands) {
      setBrandAcrossAllIcons(brand, active);
    }
    renderBrandDropdown();
    renderIconList();
    updateExportButton();
  }
});

// ─── Export ──────────────────────────────────────────────────────────────────

exportBtn.addEventListener('click', () => {
  const selections = icons
    .map((icon) => ({
      name: icon.name,
      brands: Array.from(iconBrandSelections.get(icon.name) ?? [])
    }))
    .filter((s) => s.brands.length > 0);

  if (selections.length === 0) return;

  exportBtn.disabled = true;
  clearStatus();
  setStatus('loading', 'Exporting icons...');

  parent.postMessage({ pluginMessage: { type: 'start-export', selections } }, '*');
});

// ─── Message Handler ─────────────────────────────────────────────────────────

window.onmessage = (event: MessageEvent) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  if (msg.type === 'scan-result') {
    loading.classList.add('hidden');

    icons = msg.icons;
    allBrands = msg.brands;

    if (msg.emptySelection) {
      emptyState.textContent = 'Nothing selected. Select one or more icon components on the canvas.';
      emptyState.classList.remove('hidden');
      panels.classList.add('hidden');
      return;
    }

    if (icons.length === 0) {
      emptyState.textContent = 'No icons found.';
      emptyState.classList.remove('hidden');
      panels.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    panels.classList.remove('hidden');

    // Default: every icon, every brand selected
    for (const icon of icons) {
      iconBrandSelections.set(icon.name, new Set(icon.brands));
    }

    renderBrandDropdown();
    renderIconList();
    updateExportButton();
  }

  if (msg.type === 'scan-error') {
    loading.classList.add('hidden');
    emptyState.textContent = msg.message || 'Failed to scan.';
    emptyState.classList.remove('hidden');
  }

  if (msg.type === 'thumbnail') {
    applyThumbnail(msg.name, msg.brand, msg.data);
  }

  if (msg.type === 'export-progress') {
    setStatus('loading', `Exporting... (${msg.completed})`);
  }

  if (msg.type === 'export-complete') {
    (async () => {
      try {
        await downloadZip(msg.files, 'chopstick-icons', JSZip);
        setStatus('success', 'Export complete! Check your downloads.');
      } catch (err) {
        setStatus('error', 'Something went wrong. Check the console for details.');
      } finally {
        exportBtn.disabled = false;
      }
    })();
  }

  if (msg.type === 'export-error') {
    setStatus('error', msg.message || 'Export failed. Check the console for details.');
    exportBtn.disabled = false;
  }
};
