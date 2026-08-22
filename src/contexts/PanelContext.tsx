import type { ReactNode } from 'react';

import { PanelContext, type PanelContextValue } from './panel-context-value';

export function PanelProvider({
  value,
  children,
}: {
  value: string | PanelContextValue;
  children: ReactNode;
}) {
  const normalizedValue = typeof value === 'string'
    ? { panelId: value, scopeId: value }
    : value;

  return (
    <PanelContext.Provider value={normalizedValue}>
      {children}
    </PanelContext.Provider>
  );
}
