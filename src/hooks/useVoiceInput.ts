import { useState, useRef, useCallback, useEffect } from 'react';
import { getApiBaseUrl } from '@/lib/api';
import type { Provider } from '@/stores/settings-store';

type TranscribeProvider = 'groq' | 'openai';

// Fallback that guarantees stopRecording() settles even if the recorder's stop
// event never fires (e.g. unmount raced us or a transcription request hangs).
const STOP_TIMEOUT_MS = 30_000;

export interface VoiceInputState {
  isRecording: boolean;
  isTranscribing: boolean;
  error: string | null;
}

export interface UseVoiceInputResult extends VoiceInputState {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  cancelRecording: () => void;
}

/**
 * Resolves which provider to use for transcription and its API key.
 * Priority: Groq (if key available) → OpenAI (if key available).
 * Returns null if no suitable provider is found.
 */
function resolveTranscriptionConfig(
  providers: Record<Provider, { apiKey: string }>,
): { provider: TranscribeProvider; apiKey: string } {
  if (providers.groq?.apiKey?.trim()) {
    return { provider: 'groq', apiKey: providers.groq.apiKey.trim() };
  }
  if (providers.openai?.apiKey?.trim()) {
    return { provider: 'openai', apiKey: providers.openai.apiKey.trim() };
  }
  // No local key — send an empty key so the server resolves the Groq/OpenAI
  // credential from the Hermes agent (~/.hermes). Avoids re-entering a key you
  // already have configured in Hermes.
  return { provider: 'groq', apiKey: '' };
}

/**
 * Converts a blob to base64 asynchronously. FileReader.readAsDataURL runs off
 * the main thread — building the string char-by-char with btoa would block the
 * UI for multi-MB recordings.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(new Error('Failed to read audio recording.'));
    reader.readAsDataURL(blob);
  });
}

async function transcribeAudio(
  audioBlob: Blob,
  provider: TranscribeProvider,
  apiKey: string,
): Promise<string> {
  const base64Audio = await blobToBase64(audioBlob);

  const mimeType = audioBlob.type || 'audio/webm';
  // Extract extension from mime type (e.g. audio/webm → webm, audio/mp4 → mp4)
  const ext = mimeType.split('/')[1] || 'webm';
  const filename = `recording.${ext}`;

  const response = await fetch(`${getApiBaseUrl()}/functions/v1/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      api_key: apiKey,
      audio: base64Audio,
      filename,
    }),
  });

  if (!response.ok) {
    let errorMsg = `Transcription failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) errorMsg = data.error;
    } catch {
      // Non-JSON error
    }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  return data.text ?? '';
}

export function useVoiceInput(
  providers: Record<Provider, { apiKey: string }>,
): UseVoiceInputResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // True while startRecording is awaiting getUserMedia — guards re-entry so a
  // double invocation can't open a second (leaked) mic stream.
  const startPendingRef = useRef(false);
  // The in-flight stopRecording() promise and its resolver — a second call
  // returns the same promise instead of overwriting recorder.onstop.
  const stopPromiseRef = useRef<{
    promise: Promise<string | null>;
    resolve: (value: string | null) => void;
  } | null>(null);
  // Set on unmount so a late recorder.onstop settles without transcribing.
  const unmountedRef = useRef(false);

  // Keep a ref to providers so callbacks don't recreate on every provider change
  const providersRef = useRef(providers);
  providersRef.current = providers;

  // ── Stream cleanup (defined first so startRecording can reference it) ──────
  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // Cleanup on unmount — stop any active recording/stream so the OS mic indicator goes away
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        // Never null `onstop` here: a pending stopRecording() promise must
        // settle. The handler skips transcription once unmounted, and the
        // timeout in stopRecording() is the last-resort resolver.
        recorder.stop();
      }
      cleanupStream();
      mediaRecorderRef.current = null;
      chunksRef.current = [];
    };
    // cleanupStream is stable (useCallback with [] deps), so this stays mount-only
  }, [cleanupStream]);

  // ── Start recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    // Re-entry guard: a start is already in flight or a recorder is active.
    // Without this, a double invocation opens a second (never-stopped) mic
    // stream and discards the first recorder's chunks.
    if (startPendingRef.current) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') return;
    startPendingRef.current = true;
    setError(null);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Unmounted while the permission prompt was up — don't keep the mic open
      if (unmountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      // Determine supported MIME type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';

      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onerror = () => {
        setError('Microphone recording error.');
        cleanupStream();
        setIsRecording(false);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // Collect chunks every second
      setIsRecording(true);
    } catch (err: unknown) {
      const error = err as DOMException;
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setError('Microphone permission denied. Allow microphone access in your system settings.');
      } else if (error.name === 'NotFoundError') {
        setError('No microphone found. Connect a microphone and try again.');
      } else {
        setError(error.message || 'Failed to start recording.');
      }
    } finally {
      startPendingRef.current = false;
    }
  }, [cleanupStream]);

  // ── Stop recording and transcribe ────────────────────────────────────────
  const stopRecording = useCallback(async (): Promise<string | null> => {
    // Re-entry guard: a stop is already in flight — return the same promise.
    // Otherwise a second call would overwrite recorder.onstop and orphan the
    // first caller's promise.
    if (stopPromiseRef.current) return stopPromiseRef.current.promise;

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      cleanupStream();
      setIsRecording(false);
      return null;
    }

    const config = resolveTranscriptionConfig(providersRef.current);

    // Assigned by the promise executor below (which runs synchronously) so
    // cancelRecording() can settle a pending stop from outside.
    let settleStop: (value: string | null) => void = () => {};

    // Return a promise that resolves when the recorder stops and data is collected
    const promise = new Promise<string | null>((resolve) => {
      // Last-resort fallback: if the stop event never fires (or a transcription
      // request hangs), settle so awaiting callers don't hang forever.
      const timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch {
            // already stopped
          }
        }
        cleanupStream();
        setIsRecording(false);
        settleStop(null);
      }, STOP_TIMEOUT_MS);

      settleStop = (value: string | null) => {
        if (timer) clearTimeout(timer);
        stopPromiseRef.current = null;
        resolve(value);
      };

      recorder.onstop = async () => {
        cleanupStream();
        setIsRecording(false);

        // Component unmounted while stopping — settle without transcribing
        if (unmountedRef.current) {
          settleStop(null);
          return;
        }

        if (chunksRef.current.length === 0) {
          setError('No audio recorded.');
          settleStop(null);
          return;
        }

        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        setIsTranscribing(true);
        setError(null);

        try {
          const text = await transcribeAudio(blob, config.provider, config.apiKey);
          if (!text.trim()) {
            setError('No speech detected. Try again.');
            settleStop(null);
          } else {
            settleStop(text.trim());
          }
        } catch (err: unknown) {
          const error = err as Error;
          setError(error.message || 'Transcription failed.');
          settleStop(null);
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.stop();
    });

    stopPromiseRef.current = { promise, resolve: settleStop };
    return promise;
  }, [cleanupStream]);

  // ── Cancel recording (no transcription) ──────────────────────────────────
  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      // Settle any pending stopRecording() promise first, then remove onstop
      // so the late handler can't transcribe.
      stopPromiseRef.current?.resolve(null);
      stopPromiseRef.current = null;
      recorder.onstop = null;
      recorder.stop();
    } else if (stopPromiseRef.current) {
      // A stop/transcription is already in flight — settle it as cancelled so
      // awaiting callers don't hang.
      stopPromiseRef.current.resolve(null);
      stopPromiseRef.current = null;
    }
    cleanupStream();
    setIsRecording(false);
    setIsTranscribing(false);
    setError(null);
  }, [cleanupStream]);

  return {
    isRecording,
    isTranscribing,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
