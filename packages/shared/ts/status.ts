/**
 * Chopstick Figma Plugins - Status Helpers
 *
 * Shared functions for managing the status message element
 * across all plugins. Expects a #status element in the DOM.
 */

const statusEl = document.getElementById('status') as HTMLDivElement;

export function setStatus(type: 'loading' | 'success' | 'error', message: string): void {
  statusEl.className = type;
  statusEl.textContent = message;
}

export function clearStatus(): void {
  statusEl.className = '';
  statusEl.textContent = '';
}
