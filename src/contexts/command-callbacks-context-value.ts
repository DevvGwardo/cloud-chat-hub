import { createContext } from 'react';
import type { CommandCallbacks } from '@/contexts/CommandCallbacksContext';

export const CommandCallbacksContext = createContext<CommandCallbacks>({});
