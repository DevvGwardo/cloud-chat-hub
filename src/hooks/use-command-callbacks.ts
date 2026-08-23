import { useContext } from 'react';
import { CommandCallbacksContext } from '@/contexts/command-callbacks-context-value';
import type { CommandCallbacks } from '@/contexts/CommandCallbacksContext';

export function useCommandCallbacks(): CommandCallbacks {
  return useContext(CommandCallbacksContext);
}
