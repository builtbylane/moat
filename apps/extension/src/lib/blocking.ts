import type { FocusState, Settings } from './types.ts';

const RULE_ID_START = 1;

export function isBlockingEffective(
  settings: Settings,
  focus: FocusState | null,
  now: number,
): boolean {
  if (focus?.active && focus.endsAt > now) return true;
  return settings.enabled;
}

export function buildRules(blocklist: string[]): chrome.declarativeNetRequest.Rule[] {
  const blockedPagePath = chrome.runtime.getURL('src/blocked/blocked.html');
  return blocklist.map((host, idx) => ({
    id: RULE_ID_START + idx,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: `${blockedPagePath}?host=${encodeURIComponent(host)}` },
    },
    condition: {
      urlFilter: `||${host}^`,
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  }));
}

export async function syncRules(effective: boolean, blocklist: string[]): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  const addRules = effective ? buildRules(blocklist) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

export function isHostBlocked(host: string, blocklist: string[]): boolean {
  const normalized = host.replace(/^www\./, '').toLowerCase();
  return blocklist.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
}
