import { getFocus, getSettings, normalizeHost, setSettings, subscribe } from '../lib/storage.ts';
import {
  FOCUS_DURATION_MS,
  FOCUS_DURATION_OPTIONS_MS,
  type FocusState,
  type RuntimeMessage,
  type RuntimeResponse,
  type Settings,
} from '../lib/types.ts';

interface State {
  settings: Settings;
  focus: FocusState | null;
  now: number;
  currentHost: string | null;
  currentTabId: number | null;
  shortcut: string | null;
  selectedDurationMs: number;
}

const root = document.getElementById('app');
if (!root) throw new Error('popup root missing');

let state: State = {
  settings: { enabled: false, blocklist: [] },
  focus: null,
  now: Date.now(),
  currentHost: null,
  currentTabId: null,
  shortcut: null,
  selectedDurationMs: FOCUS_DURATION_MS,
};

let tickHandle: number | null = null;

function formatRemaining(ms: number): string {
  const safe = Math.max(0, ms);
  const total = Math.ceil(safe / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDurationShort(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hr`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours} hr ${rest} min`;
  }
  return `${minutes} min`;
}

function formatDurationSegment(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours}h${rest}m`;
  }
  return `${minutes}m`;
}

function isFocusActive(focus: FocusState | null, now: number): boolean {
  return !!focus?.active && focus.endsAt > now;
}

export function deriveCurrentHost(url: string | undefined, extensionOrigin: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.origin === extensionOrigin) return null;
  const host = parsed.hostname;
  if (!host) return null;
  const normalized = normalizeHost(host);
  return normalized;
}

async function sendMessage(message: RuntimeMessage): Promise<void> {
  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse | undefined;
  if (response && response.ok === false) {
    throw new Error(response.error);
  }
}

function ensureTicking(shouldTick: boolean): void {
  if (shouldTick && tickHandle === null) {
    tickHandle = window.setInterval(() => {
      state = { ...state, now: Date.now() };
      render();
    }, 1000);
  } else if (!shouldTick && tickHandle !== null) {
    window.clearInterval(tickHandle);
    tickHandle = null;
  }
}

function buildHeader(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'popup__header';
  const word = document.createElement('span');
  word.className = 'moat-wordmark';
  word.textContent = 'Moat';
  header.append(word);
  return header;
}

function buildStatus(effective: boolean, focusActive: boolean): HTMLElement {
  const row = document.createElement('section');
  row.className = 'popup__status';

  const text = document.createElement('div');
  text.className = 'popup__status-text';

  const title = document.createElement('div');
  title.className = 'popup__status-title';
  const label = document.createElement('span');
  label.textContent = 'Blocking is ';
  const status = document.createElement('strong');
  status.textContent = effective ? 'on' : 'off';
  title.append(label, status);

  const subtitle = document.createElement('div');
  subtitle.className = 'popup__status-subtitle';
  if (focusActive && state.focus) {
    subtitle.textContent = `Focus ends in ${formatRemaining(state.focus.endsAt - state.now)}`;
  } else {
    const count = state.settings.blocklist.length;
    subtitle.textContent =
      count === 0 ? 'No sites blocked yet' : `${count} site${count === 1 ? '' : 's'} blocked`;
  }

  text.append(title, subtitle);

  const toggleWrap = document.createElement('div');
  toggleWrap.className = 'popup__status-toggle';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(state.settings.enabled));
  toggle.setAttribute('aria-label', 'Blocking enabled');
  if (focusActive) {
    toggle.setAttribute('aria-disabled', 'true');
  }
  toggle.addEventListener('click', () => {
    if (focusActive) return;
    void setSettings({ enabled: !state.settings.enabled });
  });

  toggleWrap.append(toggle);

  if (state.shortcut) {
    const hint = document.createElement('span');
    hint.className = 'popup__shortcut-hint';
    hint.textContent = state.shortcut;
    hint.setAttribute('aria-label', `Keyboard shortcut ${state.shortcut}`);
    toggleWrap.append(hint);
  }

  row.append(text, toggleWrap);
  return row;
}

function buildSiteAction(host: string, isBlocked: boolean): HTMLElement {
  const row = document.createElement('section');
  row.className = 'popup__site';

  const label = document.createElement('div');
  label.className = 'popup__site-host';
  label.textContent = host;

  const btn = document.createElement('button');
  btn.type = 'button';
  if (isBlocked) {
    btn.className = 'btn btn--secondary';
    btn.textContent = 'Unblock this site';
    btn.addEventListener('click', () => {
      const filtered = state.settings.blocklist.filter((h) => h !== host);
      void setSettings({ blocklist: filtered });
    });
  } else {
    btn.className = 'btn btn--accent-lite';
    btn.textContent = 'Block this site';
    btn.addEventListener('click', () => {
      const next = Array.from(new Set([...state.settings.blocklist, host])).sort();
      const tabId = state.currentTabId;
      const shouldCloseTab = state.settings.enabled;
      void (async () => {
        await setSettings({ blocklist: next });
        if (shouldCloseTab && tabId !== null) {
          try {
            await chrome.tabs.remove(tabId);
          } catch {
            // tab may already be gone — ignore
          }
        }
        window.close();
      })();
    });
  }

  row.append(label, btn);
  return row;
}

function buildFocusCard(): HTMLElement {
  const card = document.createElement('section');
  card.className = 'focus-card';

  const head = document.createElement('div');
  head.className = 'focus-card__head';

  const label = document.createElement('span');
  label.className = 'focus-card__label';
  const totalMs = state.focus ? state.focus.endsAt - state.focus.startedAt : 0;
  label.textContent = totalMs > 0 ? `Focus \u00B7 ${formatDurationShort(totalMs)}` : 'Focus';

  const time = document.createElement('span');
  time.className = 'focus-card__time';
  const remaining = state.focus ? state.focus.endsAt - state.now : 0;
  time.textContent = formatRemaining(remaining);

  head.append(label, time);

  const end = document.createElement('button');
  end.type = 'button';
  end.className = 'btn btn--secondary';
  end.textContent = 'End focus';
  end.addEventListener('click', () => {
    void sendMessage({ kind: 'cancelFocus' });
  });

  card.append(head, end);
  return card;
}

function buildDurationPicker(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'duration-picker';
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', 'Focus duration');

  const options = FOCUS_DURATION_OPTIONS_MS;
  const buttons: HTMLButtonElement[] = [];

  const focusIndex = (idx: number) => {
    const b = buttons[idx];
    if (b) b.focus();
  };

  options.forEach((ms, idx) => {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'duration-picker__segment';
    opt.setAttribute('role', 'radio');
    const isSelected = ms === state.selectedDurationMs;
    opt.setAttribute('aria-checked', String(isSelected));
    opt.tabIndex = isSelected ? 0 : -1;
    opt.textContent = formatDurationSegment(ms);
    opt.addEventListener('click', () => {
      state = { ...state, selectedDurationMs: ms };
      render();
    });
    opt.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (idx + 1) % options.length;
        const nextMs = options[next];
        if (nextMs !== undefined) {
          state = { ...state, selectedDurationMs: nextMs };
          render();
          focusIndex(next);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (idx - 1 + options.length) % options.length;
        const prevMs = options[prev];
        if (prevMs !== undefined) {
          state = { ...state, selectedDurationMs: prevMs };
          render();
          focusIndex(prev);
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        const firstMs = options[0];
        if (firstMs !== undefined) {
          state = { ...state, selectedDurationMs: firstMs };
          render();
          focusIndex(0);
        }
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = options.length - 1;
        const lastMs = options[last];
        if (lastMs !== undefined) {
          state = { ...state, selectedDurationMs: lastMs };
          render();
          focusIndex(last);
        }
      }
    });
    buttons.push(opt);
    wrap.append(opt);
  });

  return wrap;
}

function buildPrimaryAction(focusActive: boolean): HTMLElement {
  if (focusActive) return buildFocusCard();

  const wrap = document.createElement('section');
  wrap.className = 'popup__action';

  const picker = buildDurationPicker();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--primary';
  btn.textContent = 'Start focus';
  btn.addEventListener('click', () => {
    void sendMessage({ kind: 'startFocus', durationMs: state.selectedDurationMs });
  });

  wrap.append(picker, btn);
  return wrap;
}

function buildFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'popup__footer';

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'popup__footer-link';
  link.textContent = 'Manage blocked sites \u2192';
  link.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  footer.append(link);
  return footer;
}

function render(): void {
  const focusActive = isFocusActive(state.focus, state.now);
  const effective = focusActive || state.settings.enabled;

  const next = document.createDocumentFragment();
  next.append(buildHeader(), buildStatus(effective, focusActive));

  if (!focusActive && state.currentHost) {
    const isBlocked = state.settings.blocklist.includes(state.currentHost);
    next.append(buildSiteAction(state.currentHost, isBlocked));
  }

  next.append(buildPrimaryAction(focusActive), buildFooter());

  if (root) {
    root.replaceChildren(next);
  }
  ensureTicking(focusActive);
}

async function loadCurrentTab(): Promise<{ id: number | null; host: string | null }> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) return { id: null, host: null };
    const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
    return {
      id: tab.id ?? null,
      host: deriveCurrentHost(tab.url, extensionOrigin),
    };
  } catch {
    return { id: null, host: null };
  }
}

async function loadShortcut(): Promise<string | null> {
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === 'toggle-blocking');
    const shortcut = cmd?.shortcut ?? '';
    return shortcut ? shortcut : null;
  } catch {
    return null;
  }
}

async function load(): Promise<void> {
  const [settings, focus, tab, shortcut] = await Promise.all([
    getSettings(),
    getFocus(),
    loadCurrentTab(),
    loadShortcut(),
  ]);
  state = {
    ...state,
    settings,
    focus,
    now: Date.now(),
    currentHost: tab.host,
    currentTabId: tab.id,
    shortcut,
  };
  render();
}

subscribe(() => {
  void load();
});

window.addEventListener('pagehide', () => {
  ensureTicking(false);
});

void load();
