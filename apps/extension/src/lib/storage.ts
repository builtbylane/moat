import { DEFAULT_SETTINGS, type FocusState, type Settings } from './types.ts';

const SETTINGS_KEY = 'settings';
const FOCUS_KEY = 'focus';

export async function getSettings(): Promise<Settings> {
  const got = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = got[SETTINGS_KEY] as Partial<Settings> | undefined;
  const blocklist = Array.isArray(stored?.blocklist)
    ? stored.blocklist.map(normalizeHost).filter((host): host is string => host !== null)
    : [];
  return {
    enabled: typeof stored?.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
    blocklist: [...new Set(blocklist)].sort(),
  };
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
}

export async function getFocus(): Promise<FocusState | null> {
  const got = await chrome.storage.local.get(FOCUS_KEY);
  const stored = got[FOCUS_KEY] as FocusState | undefined;
  if (
    !stored ||
    typeof stored.active !== 'boolean' ||
    typeof stored.previousEnabled !== 'boolean' ||
    !Number.isFinite(stored.startedAt) ||
    !Number.isFinite(stored.endsAt) ||
    stored.endsAt <= stored.startedAt
  ) {
    return null;
  }
  return stored ?? null;
}

export async function setFocus(state: FocusState | null): Promise<void> {
  if (state === null) {
    await chrome.storage.local.remove(FOCUS_KEY);
  } else {
    await chrome.storage.local.set({ [FOCUS_KEY]: state });
  }
}

export type StorageChangeListener = () => void;

export function subscribe(listener: StorageChangeListener): () => void {
  const handler = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: chrome.storage.AreaName,
  ) => {
    if (
      (area === 'sync' && SETTINGS_KEY in changes) ||
      (area === 'local' && FOCUS_KEY in changes)
    ) {
      listener();
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeHost(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, '');
  value = value.split('/')[0] ?? '';
  value = value.split('?')[0] ?? '';
  value = value.split('#')[0] ?? '';
  if (value.startsWith('www.')) value = value.slice(4);
  if (!HOST_PATTERN.test(value)) return null;
  return value;
}
