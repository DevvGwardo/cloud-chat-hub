import { useUIStore } from '@/stores/ui-store';

/**
 * Puts the UI into a known state (sidebar open, Threads tab, chat view) so every
 * tour target is mounted. Called before opening the tour.
 */
export function prepareUiForTour() {
  const ui = useUIStore.getState();
  ui.setSidebarOpen(true);
  ui.setActiveTab('chat');
  ui.setActiveSubTab('threads');
  ui.setKanbanFullscreen(false);
}
