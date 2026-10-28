import JSZip from 'jszip';
import { setStatus, clearStatus, downloadZip } from '../../../packages/shared/ts';

const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const loading = document.getElementById('loading') as HTMLDivElement;
const panels = document.getElementById('panels') as HTMLDivElement;
const collectionList = document.getElementById('collection-list') as HTMLDivElement;
const stylesPanel = document.getElementById('styles-panel') as HTMLElement;
const stylesList = document.getElementById('styles-list') as HTMLDivElement;
const emptyState = document.getElementById('empty-state') as HTMLDivElement;

// ─── State ───────────────────────────────────────────────────────────────────

const selectedCollections = new Set<string>();
const selectedStyleTypes = new Set<string>();

// ─── Export Button State ─────────────────────────────────────────────────────

function updateExportButton(): void {
  exportBtn.disabled = selectedCollections.size === 0 && selectedStyleTypes.size === 0;
}

// ─── Generic Checkbox List Rendering ─────────────────────────────────────────

function renderCheckboxList(
  container: HTMLDivElement,
  items: { label: string; value: string }[],
  stateSet: Set<string>
): void {
  container.innerHTML = '';

  for (const item of items) {
    const label = document.createElement('label');
    label.className = 'checkbox-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = item.value;
    checkbox.checked = true;

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        stateSet.add(item.value);
      } else {
        stateSet.delete(item.value);
      }
      updateExportButton();
    });

    const span = document.createElement('span');
    span.textContent = item.label;

    label.appendChild(checkbox);
    label.appendChild(span);
    container.appendChild(label);

    stateSet.add(item.value);
  }
}

// ─── Select All / Deselect All (delegated) ───────────────────────────────────

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.toggle-btn') as HTMLButtonElement | null;
  if (!btn) return;

  const targetId = btn.dataset.target;
  const action = btn.dataset.action;
  if (!targetId || !action) return;

  const container = document.getElementById(targetId);
  if (!container) return;

  const stateSet = targetId === 'collection-list' ? selectedCollections : selectedStyleTypes;
  const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

  checkboxes.forEach(cb => {
    if (action === 'select') {
      cb.checked = true;
      stateSet.add(cb.value);
    } else {
      cb.checked = false;
      stateSet.delete(cb.value);
    }
  });

  updateExportButton();
});

// ─── Data Loaded Handler ─────────────────────────────────────────────────────

function handleDataLoaded(
  collections: string[],
  styleTypes: { label: string; key: string }[]
): void {
  loading.classList.add('hidden');

  if (collections.length === 0 && styleTypes.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  panels.classList.remove('hidden');

  if (collections.length > 0) {
    renderCheckboxList(
      collectionList,
      collections.map(name => ({ label: name, value: name })),
      selectedCollections
    );
  }

  if (styleTypes.length > 0) {
    stylesPanel.classList.remove('hidden');
    renderCheckboxList(
      stylesList,
      styleTypes.map(st => ({ label: st.label, value: st.key })),
      selectedStyleTypes
    );
  }

  updateExportButton();
}

// ─── Export ──────────────────────────────────────────────────────────────────

exportBtn.addEventListener('click', () => {
  if (selectedCollections.size === 0 && selectedStyleTypes.size === 0) return;

  exportBtn.disabled = true;
  clearStatus();
  setStatus('loading', 'Reading Figma variables...');

  parent.postMessage({
    pluginMessage: {
      type: 'start-export',
      selectedCollections: Array.from(selectedCollections),
      selectedStyleTypes: Array.from(selectedStyleTypes)
    }
  }, '*');
});

// ─── Message Handler ─────────────────────────────────────────────────────────

window.onmessage = async (event: MessageEvent) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  if (msg.type === 'data-loaded') {
    handleDataLoaded(
      msg.collections as string[],
      msg.styleTypes as { label: string; key: string }[]
    );
  }

  if (msg.type === 'data-error') {
    loading.classList.add('hidden');
    emptyState.textContent = msg.message || 'Failed to load data.';
    emptyState.classList.remove('hidden');
  }

  if (msg.type === 'export') {
    setStatus('loading', 'Generating ZIP file...');

    try {
      // Token export files contain JSON objects, so we stringify them
      const files = msg.files.map((f: { path: string; content: unknown }) => ({
        path: f.path,
        content: JSON.stringify(f.content, null, 2)
      }));
      await downloadZip(files, 'chopstick-tokens', JSZip);
      setStatus('success', 'Export complete! Check your downloads.');
      exportBtn.disabled = false;
    } catch (err) {
      setStatus('error', 'Something went wrong. Check the console for details.');
      exportBtn.disabled = false;
    }
  }

  if (msg.type === 'export-error') {
    setStatus('error', msg.message || 'Export failed. Check the console for details.');
    exportBtn.disabled = false;
  }
};
