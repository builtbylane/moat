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
let initialized = false;
let loading = true;
let pending = false;
let error = '';
let loadVersion = 0;

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error('Moat took too long to respond.')),
          5000,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function runAction(action: () => Promise<void>): Promise<void> {
  if (pending) return;
  pending = true;
  error = '';
  render();
  try {
    await withTimeout(action());
    await load();
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t save your changes. Please try again.';
  } finally {
    pending = false;
    render();
  }
}

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
  if (!response) {
    throw new Error('Moat couldn’t respond. Reload the extension from Chrome’s Extensions page.');
  }
  if (response.ok === false) {
    throw new Error(response.error);
  }
}

function ensureTicking(shouldTick: boolean): void {
  if (shouldTick && tickHandle === null) {
    tickHandle = window.setInterval(() => {
      state = { ...state, now: Date.now() };
      if (!isFocusActive(state.focus, state.now)) {
        render();
        return;
      }
      const remaining = formatRemaining((state.focus?.endsAt ?? state.now) - state.now);
      const time = root?.querySelector('.focus-card__time');
      const subtitle = root?.querySelector('.popup__status-subtitle');
      if (time) time.textContent = remaining;
      if (subtitle) subtitle.textContent = `Focus ends in ${remaining}`;
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
  toggle.id = 'blocking-toggle';
  toggle.type = 'button';
  toggle.className = 'switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(effective));
  toggle.setAttribute('aria-label', 'Blocking enabled');
  if (focusActive) {
    toggle.setAttribute('aria-disabled', 'true');
  }
  toggle.addEventListener('click', () => {
    if (focusActive) return;
    void runAction(() => setSettings({ enabled: !state.settings.enabled }));
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
  btn.id = 'site-action';
  btn.type = 'button';
  if (isBlocked) {
    btn.className = 'btn btn--secondary';
    btn.textContent = 'Unblock this site';
    btn.addEventListener('click', () => {
      const filtered = state.settings.blocklist.filter((h) => h !== host);
      void runAction(() => setSettings({ blocklist: filtered }));
    });
  } else {
    btn.className = 'btn btn--accent-lite';
    btn.textContent = 'Block this site';
    btn.addEventListener('click', () => {
      const next = Array.from(new Set([...state.settings.blocklist, host])).sort();
      const tabId = state.currentTabId;
      const shouldCloseTab = state.settings.enabled;
      void runAction(async () => {
        await setSettings({ blocklist: next });
        if (shouldCloseTab && tabId !== null) {
          try {
            await chrome.tabs.remove(tabId);
          } catch {
            // tab may already be gone — ignore
          }
        }
        window.close();
      });
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
  end.id = 'end-focus';
  end.type = 'button';
  end.className = 'btn btn--secondary';
  end.textContent = 'End focus';
  end.addEventListener('click', () => {
    void runAction(() => sendMessage({ kind: 'cancelFocus' }));
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
  const selectDuration = (ms: number) => {
    state = { ...state, selectedDurationMs: ms };
    render();
    root?.querySelector<HTMLButtonElement>('.duration-picker [aria-checked="true"]')?.focus();
  };

  options.forEach((ms, idx) => {
    const opt = document.createElement('button');
    opt.id = `duration-${ms}`;
    opt.type = 'button';
    opt.className = 'duration-picker__segment';
    opt.setAttribute('role', 'radio');
    const isSelected = ms === state.selectedDurationMs;
    opt.setAttribute('aria-checked', String(isSelected));
    opt.tabIndex = isSelected ? 0 : -1;
    opt.textContent = formatDurationSegment(ms);
    opt.addEventListener('click', () => {
      selectDuration(ms);
    });
    opt.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (idx + 1) % options.length;
        const nextMs = options[next];
        if (nextMs !== undefined) {
          selectDuration(nextMs);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (idx - 1 + options.length) % options.length;
        const prevMs = options[prev];
        if (prevMs !== undefined) {
          selectDuration(prevMs);
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        const firstMs = options[0];
        if (firstMs !== undefined) {
          selectDuration(firstMs);
        }
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = options.length - 1;
        const lastMs = options[last];
        if (lastMs !== undefined) {
          selectDuration(lastMs);
        }
      }
    });
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
  btn.id = 'start-focus';
  btn.textContent = 'Start focus';
  btn.addEventListener('click', () => {
    void runAction(() => sendMessage({ kind: 'startFocus', durationMs: state.selectedDurationMs }));
  });

  wrap.append(picker, btn);
  return wrap;
}

function buildFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'popup__footer';

  const link = document.createElement('button');
  link.id = 'manage-sites';
  link.type = 'button';
  link.className = 'popup__footer-link';
  link.textContent = 'Manage blocked sites \u2192';
  link.addEventListener('click', () => {
    void runAction(() => chrome.runtime.openOptionsPage());
  });

  footer.append(link);
  return footer;
}

function render(): void {
  const focusActive = isFocusActive(state.focus, state.now);
  const effective = focusActive || state.settings.enabled;

  const next = document.createDocumentFragment();
  next.append(buildHeader());

  if (error) {
    const message = document.createElement('p');
    message.className = 'popup__error';
    message.setAttribute('role', 'alert');
    message.textContent = error;
    next.append(message);
  }

  if (!initialized) {
    if (loading) {
      const message = document.createElement('p');
      message.className = 'popup__message';
      message.setAttribute('role', 'status');
      message.textContent = 'Loading your settings…';
      next.append(message);
    } else {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn--primary';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => void load());
      next.append(retry);
    }
    next.append(buildFooter());
    root?.replaceChildren(next);
    root?.setAttribute('aria-busy', String(loading));
    return;
  }

  const focusedId = document.activeElement?.id;
  next.append(buildStatus(effective, focusActive));

  if (!focusActive && state.currentHost) {
    const isBlocked = state.settings.blocklist.includes(state.currentHost);
    next.append(buildSiteAction(state.currentHost, isBlocked));
  }

  next.append(buildPrimaryAction(focusActive), buildFooter());

  if (root) {
    root.replaceChildren(next);
    root.setAttribute('aria-busy', String(pending));
    for (const button of root.querySelectorAll('button')) {
      button.disabled = pending;
    }
    if (focusedId) document.getElementById(focusedId)?.focus();
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
  const version = ++loadVersion;
  loading = true;
  if (!initialized) {
    error = '';
    render();
  }
  try {
    const [settings, focus] = await withTimeout(Promise.all([getSettings(), getFocus()]));
    if (version !== loadVersion) return;
    state = { ...state, settings, focus, now: Date.now() };
    initialized = true;
    error = '';
  } catch {
    if (version !== loadVersion) return;
    error = 'Couldn’t load your settings. Try again, or reload Moat from Chrome’s Extensions page.';
  } finally {
    if (version === loadVersion) {
      loading = false;
      render();
    }
  }
}

const unsubscribe = subscribe(() => {
  void load();
});

window.addEventListener('pagehide', () => {
  ensureTicking(false);
  unsubscribe();
});

void load();
void loadCurrentTab().then((tab) => {
  state = { ...state, currentHost: tab.host, currentTabId: tab.id };
  render();
});
void loadShortcut().then((shortcut) => {
  state = { ...state, shortcut };
  render();
});
