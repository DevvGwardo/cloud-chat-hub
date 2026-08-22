import React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { ExternalLink } from 'lucide-react';
import type { Provider } from '@/stores/settings-store';

import { PROVIDER_KEY_URLS } from '@/lib/provider-key-urls';

interface ApiKeyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: Provider;
  providerLabel: string;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  open,
  onOpenChange,
  provider,
  providerLabel,
}) => {
  const url = PROVIDER_KEY_URLS[provider];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>API Key Required</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              {providerLabel} requires an API key to send messages. You can get one for free from their platform.
            </span>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                Get your {providerLabel} API key
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <span className="block text-xs text-muted-foreground">
              Once you have your key, add it in Settings → Providers → {providerLabel}.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (url) window.open(url, '_blank', 'noopener,noreferrer');
            }}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            Get API Key
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
