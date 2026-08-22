import { createContext } from 'react';

export interface PanelContextValue {
  panelId: string;
  scopeId: string;
}

export const PanelContext = createContext<PanelContextValue>({
  panelId: 'default',
  scopeId: 'default',
});
