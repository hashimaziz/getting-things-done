import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMediaQuery, WIDE_SCREEN_QUERY } from '@/lib/media-query';

describe('useMediaQuery', () => {
  it('answers from the window width', () => {
    (window as unknown as { innerWidth: number }).innerWidth = 1280;
    const { result } = renderHook(() => useMediaQuery(WIDE_SCREEN_QUERY));
    expect(result.current).toBe(true);
  });

  it('follows a width change through the media query listener', () => {
    (window as unknown as { innerWidth: number }).innerWidth = 480;
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    const add = vi.fn((_type: string, fn: (event: { matches: boolean }) => void) => {
      listeners.push(fn);
    });
    const original = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: add,
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    const { result, unmount } = renderHook(() => useMediaQuery(WIDE_SCREEN_QUERY));
    expect(result.current).toBe(false);
    expect(add).toHaveBeenCalledWith('change', expect.any(Function));

    act(() => listeners[0]?.({ matches: true }));
    expect(result.current).toBe(true);

    unmount();
    window.matchMedia = original;
  });
});
