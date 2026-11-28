// Appearance.
import { ps } from './state.js';
import { $ } from './utils.js';

// Appearance: mode (light / dark / auto) and accent color. Saved on this device, and to your account when signed in.
export const MODES = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Match my device']];
export const ACCENTS = [['teal', 'Teal'], ['blue', 'Blue'], ['purple', 'Purple'], ['green', 'Green'], ['warm', 'Warm'], ['rose', 'Rose']];
const listeners = [];
let adoptedFor = null;

export function onThemeChange(fn) { listeners.push(fn); }
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } }
const validMode = value => MODES.some(([id]) => id === value);
const validAccent = value => ACCENTS.some(([id]) => id === value);

export function getPrefs() {
  let mode = read('ps-mode');
  if (!mode) mode = read('ps-theme') === 'dark' ? 'dark' : 'light'; // older versions stored only light/dark
  let accent = read('ps-accent');
  return { mode: validMode(mode) ? mode : 'light', accent: validAccent(accent) ? accent : 'teal' };
}
function resolvedMode(mode) {
  const darkDevice = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return mode === 'dark' || (mode === 'auto' && darkDevice) ? 'dark' : 'light';
}
function updateThemeButton() {
  const button = $('#theme-toggle');
  if (!button) return;
  const dark = document.documentElement.dataset.mode === 'dark';
  const label = dark ? 'Light theme' : 'Dark theme';
  button.dataset.tooltip = label;
  button.title = label;
  button.setAttribute('aria-label', `Switch to ${label.toLowerCase()}`);
  button.innerHTML = dark
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2Z"></path></svg>';
}
function applyTheme(mode, accent) {
  const root = document.documentElement;
  root.dataset.mode = resolvedMode(mode);
  root.dataset.pref = mode;
  root.dataset.accent = accent;
  updateThemeButton();
  listeners.forEach(fn => fn());
}
export function initTheme() {
  const { mode, accent } = getPrefs();
  applyTheme(mode, accent);
  const query = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (query && query.addEventListener) query.addEventListener('change', () => { const now = getPrefs(); if (now.mode === 'auto') applyTheme(now.mode, now.accent); });
}
async function saveToAccount(mode, accent) {
  if (!ps.supabase || !ps.currentUser) return;
  try { await ps.supabase.from('profiles').update({ ui_mode: mode, ui_accent: accent }).eq('id', ps.currentUser.id); } catch { /* column missing or offline: the device setting still works */ }
}
export function setMode(mode) {
  if (!validMode(mode)) return;
  const { accent } = getPrefs();
  write('ps-mode', mode);
  applyTheme(mode, accent);
  saveToAccount(mode, accent);
}
export function setAccent(accent) {
  if (!validAccent(accent)) return;
  const { mode } = getPrefs();
  write('ps-accent', accent);
  applyTheme(mode, accent);
  saveToAccount(mode, accent);
}
export function toggleMode() { setMode(document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark'); }
// Called after the profile loads: a saved account choice follows you to a new device. Only done once per sign-in.
export function adoptProfilePrefs(profile) {
  const userId = profile?.id;
  if (!userId || adoptedFor === userId) return;
  adoptedFor = userId;
  if (!validMode(profile.ui_mode) || !validAccent(profile.ui_accent)) return;
  const now = getPrefs();
  if (now.mode === profile.ui_mode && now.accent === profile.ui_accent) return;
  write('ps-mode', profile.ui_mode);
  write('ps-accent', profile.ui_accent);
  applyTheme(profile.ui_mode, profile.ui_accent);
}
