import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderInRouter } from '@/test/render';
import { CommandPalette } from './command-palette';
import { useCommandPalette } from './command-palette';
import { ALL_NAV_ITEMS } from '@/lib/navigation';
import { SHORTCUT_ACTIONS } from '@/shortcuts/registry';

/**
 * The palette.
 *
 * Two properties are worth protecting. It must be able to find anything, so every
 * navigation destination and every shortcut action is reachable from it. And it must
 * not be a second, disagreeing copy of the navigation: destinations are taken from
 * the navigation table, and a test compares the two lists so they cannot drift.
 */

function renderPalette(onOpenChange = vi.fn()) {
  const onEditShortcuts = vi.fn();
  const result = renderInRouter(
    <CommandPalette open onOpenChange={onOpenChange} onEditShortcuts={onEditShortcuts} />,
  );
  return { ...result, onOpenChange, onEditShortcuts };
}

describe('contents', () => {
  it('opens with focus in the search field', async () => {
    renderPalette();

    const input = await screen.findByPlaceholderText(/search actions/i);
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('lists every navigation destination', async () => {
    renderPalette();

    for (const item of ALL_NAV_ITEMS) {
      // Typed into the search so cmdk's grouping and filtering do the work a user
      // would do, rather than asserting on the implementation's grouping.
      expect(await screen.findByText(item.label)).toBeInTheDocument();
    }
  });

  it('lists the actions as well as the destinations', async () => {
    renderPalette();

    expect(await screen.findByText('Capture something')).toBeInTheDocument();
    expect(await screen.findByText('Go to weekly review')).toBeInTheDocument();
  });

  it('does not offer to open the palette while the palette is open', async () => {
    renderPalette();

    expect(await screen.findByText('Capture something')).toBeInTheDocument();
    // Checked among the results rather than the whole document: the dialog is
    // labelled "Command palette" for screen readers, so the string is legitimately
    // on the page and only the presence of an extra row would be wrong.
    const labels = [...document.querySelectorAll('[cmdk-item]')].map((node) => node.textContent);
    expect(labels).not.toContain('Command palette');
  });

  it('offers every action in the shortcut registry', async () => {
    renderPalette();

    for (const action of SHORTCUT_ACTIONS.filter((entry) => entry.id !== 'commandPalette')) {
      expect(await screen.findByText(action.label), action.id).toBeInTheDocument();
    }
  });

  it('groups results', async () => {
    renderPalette();

    expect(await screen.findByText('Go to')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });
});

describe('searching', () => {
  it('narrows to matching destinations', async () => {
    const { user } = renderPalette();

    await user.type(await screen.findByPlaceholderText(/search actions/i), 'inbox');

    await waitFor(() => {
      expect(screen.getByText('Inbox')).toBeInTheDocument();
    });
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('finds a destination by its container name, not just its label', async () => {
    // The label says "Next Actions" and the route says next_action. Someone
    // remembering either should land in the same place.
    const { user } = renderPalette();

    await user.type(await screen.findByPlaceholderText(/search actions/i), 'waiting');

    expect(await screen.findByText('Waiting For')).toBeInTheDocument();
  });

  it('finds an action by its description', async () => {
    const { user } = renderPalette();

    await user.type(
      await screen.findByPlaceholderText(/search actions/i),
      'inbox without deciding',
    );

    expect(await screen.findByText('Capture something')).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    const { user } = renderPalette();

    await user.type(await screen.findByPlaceholderText(/search actions/i), 'zzzznotathing');

    expect(await screen.findByText(/nothing matches/i)).toBeInTheDocument();
  });
});

describe('running a command', () => {
  it('navigates when a destination is chosen', async () => {
    const { user } = renderPalette();

    await user.click(await screen.findByText('Archive'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes when a command runs', async () => {
    const onOpenChange = vi.fn();
    const { user } = renderPalette(onOpenChange);

    await user.click(await screen.findByText('Archive'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('toggles the theme from the palette', async () => {
    const { user } = renderPalette();

    // The cycle starts at `system`, which the test environment resolves to light.
    // So one click is an explicit light and the next is dark. Asserting a single
    // click turns dark would pass on a machine whose OS asks for dark and fail here.
    await user.click(await screen.findByText('Toggle light and dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(await screen.findByText('Toggle light and dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('hands the shortcut editor over rather than pretending to be it', async () => {
    const { user, onEditShortcuts } = renderPalette();

    await user.click(await screen.findByText('Edit keyboard shortcuts'));

    expect(onEditShortcuts).toHaveBeenCalledOnce();
  });

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn();
    const { user } = renderPalette(onOpenChange);

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});

describe('the open state hook', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useCommandPalette());
    expect(result.current.open).toBe(false);
  });

  it('toggles', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it('closes without toggling', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => result.current.setOpen(true));
    act(() => result.current.close());

    expect(result.current.open).toBe(false);
  });
});

/**
 * The palette and the sidebar must offer the same destinations.
 *
 * Without this, adding a route to the navigation table and forgetting the palette
 * (or vice versa) produces an app where search cannot find a screen that the
 * sidebar shows. Both read the same table today; this asserts that it stays true.
 */
describe('agreement with the navigation', () => {
  it('offers exactly the destinations the sidebar offers', async () => {
    renderPalette();

    const list = await screen.findByRole('dialog');
    const labels = ALL_NAV_ITEMS.map((item) => item.label);

    for (const label of labels) {
      expect(within(list).getByText(label)).toBeInTheDocument();
    }
  });
});
