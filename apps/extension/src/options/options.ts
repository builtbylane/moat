import { PRESETS, type Preset } from '../lib/presets.ts';
import { getSettings, normalizeHost, setSettings, subscribe } from '../lib/storage.ts';
import type { Settings } from '../lib/types.ts';

const root = document.getElementById('app');
if (!root) throw new Error('options root missing');

interface LocalState {
  settings: Settings;
  inputValue: string;
  error: string;
  ioStatus: string;
  ioError: boolean;
}

let state: LocalState = {
  settings: { enabled: false, blocklist: [] },
  inputValue: '',
  error: '',
  ioStatus: '',
  ioError: false,
};

function buildHeader(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'options__header';

  const title = document.createElement('h1');
  title.className = 'moat-wordmark';
  title.textContent = 'Moat';
  title.style.margin = '0';

  const subtitle = document.createElement('p');
  subtitle.className = 'options__subtitle';
  subtitle.textContent = 'Choose which sites to block when Moat is on.';

  header.append(title, subtitle);
  return header;
}

function submitInput(): void {
  const raw = state.inputValue;
  const host = normalizeHost(raw);
  if (!host) {
    state = { ...state, error: "That doesn't look like a domain." };
    render(true);
    return;
  }
  if (state.settings.blocklist.includes(host)) {
    state = { ...state, inputValue: '', error: '' };
    render(true);
    return;
  }
  const next = [...state.settings.blocklist, host].sort();
  state = { ...state, inputValue: '', error: '' };
  render(true);
  void setSettings({ blocklist: next });
}

function removeHost(host: string): void {
  const next = state.settings.blocklist.filter((h) => h !== host);
  void setSettings({ blocklist: next });
}

function buildAddField(): HTMLElement {
  const field = document.createElement('div');
  field.className = 'field';

  const label = document.createElement('label');
  label.className = 'field__label';
  label.htmlFor = 'moat-add-input';
  label.textContent = 'Add a site';

  const row = document.createElement('div');
  row.className = 'field__row';

  const input = document.createElement('input');
  input.id = 'moat-add-input';
  input.className = 'input';
  input.type = 'text';
  input.placeholder = 'e.g. reddit.com';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = state.inputValue;
  if (state.error) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', 'moat-add-error');
  }
  input.addEventListener('input', () => {
    state = { ...state, inputValue: input.value, error: '' };
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitInput();
    }
  });

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary';
  button.textContent = 'Add';
  button.addEventListener('click', () => {
    submitInput();
  });

  row.append(input, button);

  const error = document.createElement('div');
  error.id = 'moat-add-error';
  error.className = 'error';
  error.setAttribute('role', 'alert');
  error.textContent = state.error;

  field.append(label, row, error);
  return field;
}

function isPresetFullyAdded(preset: Preset, blocklist: readonly string[]): boolean {
  return preset.hosts.every((host) => blocklist.includes(host));
}

function addPreset(preset: Preset): void {
  if (isPresetFullyAdded(preset, state.settings.blocklist)) return;
  const merged = new Set<string>(state.settings.blocklist);
  for (const host of preset.hosts) {
    merged.add(host);
  }
  const next = [...merged].sort();
  void setSettings({ blocklist: next });
}

function buildPresetsRow(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'presets';

  const label = document.createElement('div');
  label.className = 'presets__label';
  label.textContent = 'Quick add';

  const chips = document.createElement('div');
  chips.className = 'presets__chips';

  for (const preset of PRESETS) {
    const done = isPresetFullyAdded(preset, state.settings.blocklist);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = done ? 'chip chip--added' : 'chip';
    chip.setAttribute('aria-pressed', done ? 'true' : 'false');
    chip.setAttribute('data-preset', preset.name);
    if (done) {
      chip.setAttribute('aria-label', `${preset.name} preset already in blocklist`);
      chip.textContent = `\u2713 ${preset.name}`;
    } else {
      chip.setAttribute('aria-label', `Include ${preset.name} preset`);
      chip.textContent = `+ ${preset.name}`;
    }
    chip.addEventListener('click', () => {
      addPreset(preset);
    });
    chips.append(chip);
  }

  wrap.append(label, chips);
  return wrap;
}

function buildList(): HTMLElement {
  if (state.settings.blocklist.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No sites blocked yet — add one above.';
    return empty;
  }

  const list = document.createElement('ul');
  list.className = 'list';

  for (const host of state.settings.blocklist) {
    const item = document.createElement('li');
    item.className = 'list__item';

    const text = document.createElement('span');
    text.className = 'list__host';
    text.textContent = host;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--ghost';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${host}`);
    remove.addEventListener('click', () => {
      removeHost(host);
    });

    item.append(text, remove);
    list.append(item);
  }

  return list;
}

function buildCard(): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card';
  card.append(buildAddField(), buildPresetsRow(), buildList());
  return card;
}

function triggerExport(): void {
  const payload = {
    moat: 1,
    exportedAt: new Date().toISOString(),
    blocklist: [...state.settings.blocklist],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'moat-blocklist.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

interface ImportShape {
  blocklist: unknown;
}

function readImportShape(value: unknown): ImportShape | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!('blocklist' in record)) return null;
  if (!Array.isArray(record.blocklist)) return null;
  return { blocklist: record.blocklist };
}

async function handleImportFile(file: File): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    state = {
      ...state,
      ioStatus: "Couldn't read that file — expected a Moat-exported JSON.",
      ioError: true,
    };
    render();
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    state = {
      ...state,
      ioStatus: "Couldn't read that file — expected a Moat-exported JSON.",
      ioError: true,
    };
    render();
    return;
  }

  const shape = readImportShape(parsed);
  if (!shape) {
    state = {
      ...state,
      ioStatus: "Couldn't read that file — expected a Moat-exported JSON.",
      ioError: true,
    };
    render();
    return;
  }

  const entries = shape.blocklist as unknown[];
  const existing = new Set<string>(state.settings.blocklist);
  const before = existing.size;
  let invalid = 0;
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      invalid += 1;
      continue;
    }
    const host = normalizeHost(entry);
    if (!host) {
      invalid += 1;
      continue;
    }
    existing.add(host);
  }

  const next = [...existing].sort();
  const added = existing.size - before;

  const pieces: string[] = [];
  pieces.push(
    added === 0 ? 'No new sites imported.' : `Imported ${added} ${added === 1 ? 'site' : 'sites'}.`,
  );
  if (invalid > 0) {
    pieces.push(`${invalid} ${invalid === 1 ? 'entry was' : 'entries were'} ignored as invalid.`);
  }

  state = { ...state, ioStatus: pieces.join(' '), ioError: false };
  render();
  void setSettings({ blocklist: next });
}

function buildIoCard(): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card card--io';

  const heading = document.createElement('h2');
  heading.className = 'io__heading';
  heading.textContent = 'Import / Export';

  const description = document.createElement('p');
  description.className = 'io__description';
  description.textContent = 'Move your blocklist between browsers or back it up.';

  const row = document.createElement('div');
  row.className = 'io__row';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn btn--secondary';
  exportBtn.id = 'moat-export-btn';
  exportBtn.textContent = 'Export blocklist';
  exportBtn.addEventListener('click', () => {
    triggerExport();
  });

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'btn btn--secondary';
  importBtn.id = 'moat-import-btn';
  importBtn.textContent = 'Import blocklist';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.id = 'moat-import-input';
  fileInput.className = 'io__file';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void handleImportFile(file).finally(() => {
      fileInput.value = '';
    });
  });

  importBtn.addEventListener('click', () => {
    fileInput.click();
  });

  row.append(exportBtn, importBtn, fileInput);

  const status = document.createElement('div');
  status.id = 'moat-io-status';
  status.className = state.ioError ? 'io__status io__status--error' : 'io__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = state.ioStatus;

  card.append(heading, description, row, status);
  return card;
}

function render(focusInput = false): void {
  const frag = document.createDocumentFragment();
  frag.append(buildHeader(), buildCard(), buildIoCard());
  if (root) {
    root.replaceChildren(frag);
  }
  if (focusInput) {
    const input = document.getElementById('moat-add-input');
    if (input instanceof HTMLInputElement) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }
}

async function load(): Promise<void> {
  const settings = await getSettings();
  state = { ...state, settings };
  render();
}

subscribe(() => {
  void load();
});

void load();
