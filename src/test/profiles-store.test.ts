import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useProfilesStore } from '@/stores/profiles-store';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/api', () => ({
  getApiBaseUrl: () => 'http://localhost:3001',
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      setActiveProvider: vi.fn(),
      updateProviderConfig: vi.fn(),
    }),
  },
}));

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

describe('useProfilesStore', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useProfilesStore.setState({
      profiles: [],
      activeProfile: 'default',
      selectedProfile: null,
      profileDetail: null,
      detailLoading: false,
      loading: false,
    });
  });

  it('updateProfileConfig PUTs content and refreshes detail + list', async () => {
    const updatedYaml = 'model: gpt-4o\nprovider: openai\n';

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, parsed: { model: 'gpt-4o', provider: 'openai' } }))
      .mockResolvedValueOnce(jsonResponse({
        name: 'work',
        path: '/home/.hermes/profiles/work',
        config: { model: 'gpt-4o', provider: 'openai' },
        hasEnv: false,
        skillCount: 0,
        sessionCount: 0,
      }))
      .mockResolvedValueOnce(jsonResponse({ content: updatedYaml, parsed: { model: 'gpt-4o', provider: 'openai' } }))
      .mockResolvedValueOnce(jsonResponse({ exists: false }))
      .mockResolvedValueOnce(jsonResponse({
        profiles: [{
          name: 'work',
          path: '/home/.hermes/profiles/work',
          active: false,
          model: 'gpt-4o',
          provider: 'openai',
          skillCount: 0,
          sessionCount: 0,
          hasEnv: false,
        }],
        activeProfile: 'default',
      }));

    await useProfilesStore.getState().updateProfileConfig('work', updatedYaml);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/hermes/profiles/work/config',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ content: updatedYaml }),
      }),
    );

    const detail = useProfilesStore.getState().profileDetail;
    expect(detail?.configYaml).toBe(updatedYaml);
    expect(detail?.model).toBe('gpt-4o');
    expect(useProfilesStore.getState().profiles[0]?.model).toBe('gpt-4o');
  });
});
