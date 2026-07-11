import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GoalsSettingsPanel } from '@/components/settings/GoalsSettingsPanel';

vi.mock('@/lib/hermes-api', () => ({
  fetchGoalsConfig: vi.fn(async () => ({ max_turns: 20, enabled: true })),
  updateGoalsConfig: vi.fn(async (body: { max_turns?: number; enabled?: boolean }) => ({
    max_turns: body.max_turns ?? 20,
    enabled: body.enabled ?? true,
  })),
}));

import { fetchGoalsConfig, updateGoalsConfig } from '@/lib/hermes-api';

describe('GoalsSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and saves goals config', async () => {
    render(
      <GoalsSettingsPanel
        fieldLabelClass="label"
        settingsCardClass="card"
        textInputClass="input"
      />,
    );

    await waitFor(() => {
      expect(fetchGoalsConfig).toHaveBeenCalled();
    });

    const save = await screen.findByRole('button', { name: /save/i });
    fireEvent.click(save);

    await waitFor(() => {
      expect(updateGoalsConfig).toHaveBeenCalled();
    });
  });
});
