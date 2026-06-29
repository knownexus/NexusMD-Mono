import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { CloudSyncCard } from '../src/index.js';

const noKeyController = {
  hasSyncKey: async () => false,
  getSyncProvider: () => null, setSyncProvider: () => {},
  setSyncPassphrase: async () => {}, clearSyncKey: async () => {},
  syncOnce: async () => ({ skipped: 'no-key' }),
  exportLocalBundle: async () => '', importLocalBundle: async () => ({ collections: [] }),
  getActiveProfileId: () => 'p1',
};
const providers = [{ id: 'gdrive', label: 'Google Drive', isConnected: () => false, connect: async () => {}, disconnect: async () => {} }];

describe('CloudSyncCard', () => {
  it('disables local export/import until a passphrase is set', async () => {
    render(<CloudSyncCard controller={noKeyController} providers={providers} fileIO={{ saveFile: async () => {}, pickFile: async () => null }} />);
    await waitFor(() => expect(screen.getByText('Export to file')).toBeTruthy());
    expect(screen.getByText('Export to file').disabled).toBe(true);
    expect(screen.getByText('Import from file').disabled).toBe(true);
  });
});
