import { useContext } from 'react';
import { PanelContext } from '@/contexts/panel-context-value';

export function usePanelId(): string {
  return useContext(PanelContext).panelId;
}

export function useChatScopeId(): string {
  return useContext(PanelContext).scopeId;
}
