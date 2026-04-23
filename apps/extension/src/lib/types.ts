export interface Settings {
  enabled: boolean;
  blocklist: string[];
}

export interface FocusState {
  active: boolean;
  startedAt: number;
  endsAt: number;
  previousEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  blocklist: [],
};

export const FOCUS_DURATION_MS = 60 * 60 * 1000;

export const FOCUS_DURATION_OPTIONS_MS: readonly number[] = [
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
  120 * 60 * 1000,
];

export const FOCUS_ALARM_NAME = 'moat:focus-end';

export type RuntimeMessage =
  | { kind: 'startFocus'; durationMs?: number }
  | { kind: 'cancelFocus' }
  | { kind: 'blockSite'; host: string };

export type RuntimeResponse = { ok: true } | { ok: false; error: string };
