import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfileProvider } from './profile-context.jsx';
import { ProfileGate } from './profile-gate.jsx';

const store = { create: async (o) => { const p = { id: 'p1', ...o }; return { profile: p, entry: p }; } };
const mount = (storage) => render(
  <ProfileProvider namespace="t" store={store} storage={storage}><ProfileGate><div>shell</div></ProfileGate></ProfileProvider>
);

describe('ProfileGate', () => {
  it('asks for a profile instead of the app when none exists', () => {
    mount(window.localStorage);
    expect(screen.queryByText('shell')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create profile' }).disabled).toBe(true);
  });

  it('shows the app once a profile exists', () => {
    const storage = { getItem: (k) => (k === 't.profiles' ? JSON.stringify([{ id: 'a', name: 'A' }]) : null), setItem() {}, key: () => null, length: 0 };
    mount(storage);
    expect(screen.getByText('shell')).toBeTruthy();
  });

  it('creates the first profile and activates it', async () => {
    localStorage.clear();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true });
    mount(window.localStorage);
    fireEvent.change(screen.getByPlaceholderText('e.g. Work'), { target: { value: 'Work Stuff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(localStorage.getItem('t.activeProfileId')).toBe('p1');
    expect(JSON.parse(localStorage.getItem('t.profiles'))[0].initials).toBe('WS');
  });
});
