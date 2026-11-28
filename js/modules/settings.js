// Settings page.
import { dom, ps } from './state.js';
import { ACCENTS, MODES, getPrefs } from './theme.js';
import { $$, esc, pageHead, section } from './utils.js';

export function renderSettings() {
  const { mode, accent } = getPrefs();
  const modeButtons = MODES.map(([id, label]) => `<button class="choice" type="button" data-set-mode="${id}" aria-pressed="${id === mode}">${esc(label)}</button>`).join('');
  const accentButtons = ACCENTS.map(([id, label]) => `<button class="swatch swatch-${id}" type="button" data-set-accent="${id}" aria-pressed="${id === accent}"><span class="swatch-dot"></span>${esc(label)}</button>`).join('');
  dom.viewContainer.innerHTML = pageHead('Settings', 'Manage your account and appearance.') +
    section('Appearance', `<p class="muted appearance-note">Your choice is saved to your account, so it follows you to other devices.</p><p><strong>Mode</strong></p><div class="choice-row" role="group" aria-label="Mode">${modeButtons}</div><p><strong>Accent color</strong></p><div class="swatch-row" role="group" aria-label="Accent color">${accentButtons}</div>`) +
    section('Account', `<p>Email: ${esc(ps.currentUser.email || '')}</p><p>Username: @${esc(ps.currentProfile.username)}</p><p class="muted">Use the log out button in the sidebar to end this session.</p><button class="button" id="reset-password">Send password reset email</button>`) +
    section('Privacy', '<p class="muted">Your posts use Public, Friends only or Private visibility. Media files are private to their owner. Projects, movies and recommendations are private unless you mark them Public. Do not upload sensitive documents.</p>');
}
// Keeps the Mode / Accent buttons in step when the theme changes (including the moon/sun button in the top bar).
export function syncAppearanceControls() {
  const { mode, accent } = getPrefs();
  $$('[data-set-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.setMode === mode)));
  $$('[data-set-accent]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.setAccent === accent)));
}
