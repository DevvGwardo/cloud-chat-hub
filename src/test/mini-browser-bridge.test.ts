import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMiniBrowserBridge } from '@/hooks/use-mini-browser-bridge';
import { useUIStore } from '@/stores/ui-store';

describe('useMiniBrowserBridge', () => {
  const create = vi.fn().mockResolvedValue(true);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  let navigatedCb: ((url: string) => void) | null = null;

  beforeEach(() => {
    create.mockClear();
    navigate.mockClear();
    close.mockClear();
    navigatedCb = null;

    useUIStore.setState({
      miniBrowserOpen: false,
      miniBrowserUrl: 'about:blank',
      miniBrowserDocked: false,
    });

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        browser: {
          create,
          navigate,
          close,
          onNavigated: (cb: (url: string) => void) => {
            navigatedCb = cb;
            return () => {
              navigatedCb = null;
            };
          },
        },
      },
    });
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it('creates BrowserView when miniBrowserOpen becomes true', () => {
    const { rerender } = renderHook(() => useMiniBrowserBridge());

    act(() => {
      useUIStore.setState({
        miniBrowserOpen: true,
        miniBrowserUrl: 'https://example.com',
      });
    });
    rerender();

    expect(create).toHaveBeenCalledWith('https://example.com');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates when url changes while open', () => {
    useUIStore.setState({
      miniBrowserOpen: true,
      miniBrowserUrl: 'https://example.com',
    });
    const { rerender } = renderHook(() => useMiniBrowserBridge());
    expect(create).toHaveBeenCalledWith('https://example.com');

    act(() => {
      useUIStore.setState({ miniBrowserUrl: 'https://example.org' });
    });
    rerender();

    expect(navigate).toHaveBeenCalledWith('https://example.org');
  });

  it('skips navigate when URL came from BrowserView onNavigated', () => {
    useUIStore.setState({
      miniBrowserOpen: true,
      miniBrowserUrl: 'https://example.com',
    });
    const { rerender } = renderHook(() => useMiniBrowserBridge());
    create.mockClear();
    navigate.mockClear();

    act(() => {
      navigatedCb?.('https://example.com/clicked');
    });
    rerender();

    expect(useUIStore.getState().miniBrowserUrl).toBe('https://example.com/clicked');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('closes BrowserView when miniBrowserOpen becomes false', () => {
    useUIStore.setState({
      miniBrowserOpen: true,
      miniBrowserUrl: 'https://example.com',
    });
    const { rerender } = renderHook(() => useMiniBrowserBridge());
    expect(create).toHaveBeenCalled();

    act(() => {
      useUIStore.setState({ miniBrowserOpen: false });
    });
    rerender();

    expect(close).toHaveBeenCalled();
  });
});

describe('/browse command', () => {
  it('opens mini-browser with resolved URL and dock preference', async () => {
    const { findCommand } = await import('@/lib/hermes-commands');
    const cmd = findCommand('browse');
    expect(cmd?.handler).toBeDefined();

    const setMiniBrowserOpen = vi.fn();
    const setMiniBrowserUrl = vi.fn();
    const setMiniBrowserDocked = vi.fn();
    const setRightSidebarHidden = vi.fn();

    const result = await cmd!.handler!('example.com', {
      setActiveSubTab: () => {},
      setActiveTab: () => {},
      setMiniBrowserOpen,
      setMiniBrowserUrl,
      setMiniBrowserDocked,
      setRightSidebarHidden,
    });

    expect(setMiniBrowserUrl).toHaveBeenCalledWith('https://example.com');
    expect(setMiniBrowserDocked).toHaveBeenCalledWith(true);
    expect(setRightSidebarHidden).toHaveBeenCalledWith(false);
    expect(setMiniBrowserOpen).toHaveBeenCalledWith(true);
    expect(result).toContain('https://example.com');
  });
});
