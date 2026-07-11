import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getApiBaseUrl } from '@/lib/api';
import { useSettingsStore } from '@/stores/settings-store';

export interface Profile {
  name: string;
  path: string;
  active: boolean;
  model?: string;
  provider?: string;
  skillCount: number;
  sessionCount: number;
  hasEnv: boolean;
}

export interface ProfileDetail {
  name: string;
  path: string;
  provider: string;
  model: string;
  configYaml: string;
  hasEnv: boolean;
  envKeys: string[];
  skillCount: number;
  sessionCount: number;
  skills: string[];
}

interface ProfilesState {
  profiles: Profile[];
  activeProfile: string;
  selectedProfile: string | null;
  profileDetail: ProfileDetail | null;
  detailLoading: boolean;
  loading: boolean;
  fetchProfiles: () => Promise<void>;
  activateProfile: (name: string) => Promise<void>;
  createProfile: (name: string, cloneFrom?: string) => Promise<void>;
  deleteProfile: (name: string) => Promise<void>;
  fetchProfileDetail: (name: string) => Promise<void>;
  updateProfileConfig: (name: string, content: string) => Promise<void>;
  getProfilesForRoomSelection: () => Profile[];
}

// The active profile is stored client-side and sent to the server on every
// Hermes-related request via X-Hermes-Profile. This keeps each window
// independent and ensures CloudChat never writes to any shared file that the
// hermes CLI might read.
export function getActiveProfile(): string {
  return useProfilesStore.getState().activeProfile || 'default';
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Hermes-Profile': getActiveProfile(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const useProfilesStore = create<ProfilesState>()(
  persist(
    (set, get) => ({
      profiles: [],
      activeProfile: 'default',
      selectedProfile: null,
      profileDetail: null,
      detailLoading: false,
      loading: false,

      fetchProfiles: async () => {
        set({ loading: true });
        try {
          const data = await apiFetch('/api/hermes/profiles');
          set({ profiles: data.profiles });
          // Sync the active profile's provider into settings store
          const activeName = get().activeProfile;
          const active = data.profiles.find((p: Profile) => p.name === activeName);
          if (active?.provider) {
            useSettingsStore.getState().setActiveProvider(active.provider);
            if (active.model) {
              useSettingsStore.getState().updateProviderConfig(active.provider, { model: active.model });
            }
          }
        } catch (e) {
          console.error('Failed to fetch profiles:', e);
        } finally {
          set({ loading: false });
        }
      },

      activateProfile: async (name) => {
        set({ activeProfile: name });
        await get().fetchProfiles();
      },

      createProfile: async (name, cloneFrom) => {
        await apiFetch('/api/hermes/profiles/create', {
          method: 'POST',
          body: JSON.stringify({ name, cloneFrom }),
        });
        await get().fetchProfiles();
      },

      deleteProfile: async (name) => {
        if (name === get().activeProfile) {
          throw new Error('Cannot delete the active profile — switch to another profile first');
        }
        await apiFetch('/api/hermes/profiles/delete', {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        await get().fetchProfiles();
      },

      fetchProfileDetail: async (name: string) => {
        set({ detailLoading: true, selectedProfile: name });
        try {
          const encoded = encodeURIComponent(name);
          const [detail, configRes, envRes] = await Promise.all([
            apiFetch(`/api/hermes/profiles/${encoded}/detail`),
            apiFetch(`/api/hermes/profiles/${encoded}/config`),
            apiFetch(`/api/hermes/profiles/${encoded}/env`),
          ]);

          const config = (detail.config ?? configRes.parsed ?? {}) as Record<string, unknown>;
          const envKeys: string[] = [];
          if (envRes.exists && typeof envRes.content === 'string') {
            for (const line of envRes.content.split('\n')) {
              const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
              if (match) envKeys.push(match[1]);
            }
          }

          const profileDetail: ProfileDetail = {
            name: detail.name,
            path: detail.path,
            provider: String(config.provider ?? ''),
            model: String(config.model ?? ''),
            configYaml: configRes.content ?? '',
            hasEnv: detail.hasEnv,
            envKeys,
            skillCount: detail.skillCount,
            sessionCount: detail.sessionCount,
            skills: Array.isArray(detail.skills) ? detail.skills : [],
          };
          set({ profileDetail, detailLoading: false });
        } catch (e) {
          console.error('Failed to fetch profile detail:', e);
          set({ detailLoading: false, profileDetail: null });
        }
      },

      updateProfileConfig: async (name: string, content: string) => {
        const encoded = encodeURIComponent(name);
        await apiFetch(`/api/hermes/profiles/${encoded}/config`, {
          method: 'PUT',
          body: JSON.stringify({ content }),
        });
        await get().fetchProfileDetail(name);
        await get().fetchProfiles();
      },

      getProfilesForRoomSelection: () => {
        return get().profiles.filter((p) => !p.name.startsWith('session-'));
      },
    }),
    {
      name: 'cloudchat-active-profile',
      partialize: (state) => ({ activeProfile: state.activeProfile }),
    },
  ),
);
