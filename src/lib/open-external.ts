/** Open a URL in the system browser (Electron) or a new tab (web). */
export function openExternalUrl(url: string): void {
  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
