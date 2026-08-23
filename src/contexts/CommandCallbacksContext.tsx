import type { ReactNode } from 'react';

import { CommandCallbacksContext } from './command-callbacks-context-value';

export interface CommandCallbacks {
  stopAgent?: () => void;
  retryMessage?: () => void;
  newConversation?: () => void;
  renameConversation?: (title: string) => void;
  undoMessage?: () => void;
  approveCommand?: () => void;
  denyCommand?: () => void;
  resetSession?: () => void;
  compressContext?: () => void;
  resumeSession?: (sessionId?: string) => Promise<string>;
}

export function CommandCallbacksProvider({
  callbacks,
  children,
}: {
  callbacks: CommandCallbacks;
  children: ReactNode;
}) {
  return (
    <CommandCallbacksContext.Provider value={callbacks}>
      {children}
    </CommandCallbacksContext.Provider>
  );
}
