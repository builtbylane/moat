import { isBlockingEffective, isHostBlocked, syncRules } from '../lib/blocking.ts';
import { getFocus, getSettings, setFocus, setSettings } from '../lib/storage.ts';
import {
  FOCUS_ALARM_NAME,
  FOCUS_DURATION_MS,
  type RuntimeMessage,
  type RuntimeResponse,
} from '../lib/types.ts';

const BADGE_COLOR_ON = '#1858c4';

async function updateBadge(effective: boolean): Promise<void> {
  if (effective) {
    await chrome.action.setBadgeText({ text: '\u2022' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_ON });
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

async function closeBlockedTabs(blocklist: string[]): Promise<void> {
  if (blocklist.length === 0) return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url) continue;
    let host: string;
    try {
      const url = new URL(tab.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      host = url.hostname;
    } catch {
      continue;
    }
    if (isHostBlocked(host, blocklist)) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // tab may already be gone
      }
    }
  }
}

async function reconcileRules(): Promise<void> {
  const [settings, focus] = await Promise.all([getSettings(), getFocus()]);
  const now = Date.now();

  if (focus?.active && focus.endsAt <= now) {
    await endFocus(focus.previousEnabled);
    return;
  }

  const effective = isBlockingEffective(settings, focus, now);
  await syncRules(effective, settings.blocklist);
  await updateBadge(effective);
  if (effective) {
    await closeBlockedTabs(settings.blocklist);
  }
}

const MAX_FOCUS_DURATION_MS = 24 * 60 * 60 * 1000;

function resolveDurationMs(durationMs: number | undefined): number {
  if (
    typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs > 0 &&
    durationMs <= MAX_FOCUS_DURATION_MS
  ) {
    return durationMs;
  }
  return FOCUS_DURATION_MS;
}

async function startFocus(durationMs?: number): Promise<void> {
  const settings = await getSettings();
  const now = Date.now();
  const duration = resolveDurationMs(durationMs);
  await setFocus({
    active: true,
    startedAt: now,
    endsAt: now + duration,
    previousEnabled: settings.enabled,
  });
  await chrome.alarms.create(FOCUS_ALARM_NAME, { when: now + duration });
  await reconcileRules();
}

async function toggleBlocking(): Promise<void> {
  const [settings, focus] = await Promise.all([getSettings(), getFocus()]);
  const now = Date.now();
  if (focus?.active && focus.endsAt > now) {
    return;
  }
  await setSettings({ enabled: !settings.enabled });
}

async function endFocus(previousEnabled: boolean): Promise<void> {
  await setFocus(null);
  await chrome.alarms.clear(FOCUS_ALARM_NAME);
  await setSettings({ enabled: previousEnabled });
}

async function cancelFocus(): Promise<void> {
  const focus = await getFocus();
  if (!focus) return;
  await endFocus(focus.previousEnabled);
}

async function blockSite(host: string): Promise<void> {
  const settings = await getSettings();
  const nextList = Array.from(new Set([...settings.blocklist, host])).sort();
  await setSettings({ blocklist: nextList });
  await reconcileRules();
}

chrome.runtime.onInstalled.addListener(() => {
  void reconcileRules();
});

chrome.runtime.onStartup.addListener(() => {
  void reconcileRules();
});

chrome.storage.onChanged.addListener(() => {
  void reconcileRules();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FOCUS_ALARM_NAME) {
    void (async () => {
      const focus = await getFocus();
      if (focus) await endFocus(focus.previousEnabled);
    })();
  }
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse: (r: RuntimeResponse) => void) => {
    (async () => {
      try {
        if (message.kind === 'startFocus') {
          await startFocus(message.durationMs);
        } else if (message.kind === 'cancelFocus') {
          await cancelFocus();
        } else if (message.kind === 'blockSite') {
          await blockSite(message.host);
        } else {
          sendResponse({ ok: false, error: 'unknown message' });
          return;
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  },
);

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-blocking') return;
  void (async () => {
    try {
      await toggleBlocking();
    } catch {
      // no caller to respond to
    }
  })();
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (details.tabId < 0) return;
  let host: string;
  try {
    const url = new URL(details.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    host = url.hostname;
  } catch {
    return;
  }
  const [settings, focus] = await Promise.all([getSettings(), getFocus()]);
  const now = Date.now();
  if (!isBlockingEffective(settings, focus, now)) return;
  if (!isHostBlocked(host, settings.blocklist)) return;
  try {
    await chrome.tabs.remove(details.tabId);
  } catch {
    // tab may already be closed
  }
});
