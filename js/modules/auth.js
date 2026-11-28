// Log in and create account.
import { loadProfile } from './profile.js';
import { renderView } from './router.js';
import { setAuthMessage, showApp } from './shell.js';
import { ps } from './state.js';
import { errorText, setBusy } from './utils.js';

export async function handleAuth(event, kind) {
  event.preventDefault();
  const formEl = event.target;
  const fd = new FormData(formEl);
  const email = String(fd.get('email') || '').trim();
  const password = String(fd.get('password') || '');
  setBusy(formEl, true, kind === 'login' ? 'Logging in…' : 'Creating account…');
  setAuthMessage('');
  try {
    let result;
    if (kind === 'login') {
      result = await ps.supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      ps.currentUser = result.data.user;
      await loadProfile();
      showApp();
      await renderView();
    } else {
      const displayName = String(fd.get('display_name') || '').trim();
      const username = String(fd.get('username') || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Username must be 3–24 characters using letters, numbers and underscores.');
      result = await ps.supabase.auth.signUp({ email, password, options: { data: { display_name: displayName, username }, emailRedirectTo: window.location.origin } });
      if (result.error) throw result.error;
      if (result.data.session) {
        ps.currentUser = result.data.user;
        await loadProfile();
        showApp();
        await renderView();
      } else {
        setAuthMessage('Account created. Check your email and confirm the address. Then return to this page and log in with the same email and password. If the confirmation link sends you somewhere unexpected, the Supabase redirect URL needs configuring.');
      }
    }
  } catch (error) {
    const text = errorText(error);
    setAuthMessage(kind === 'register' && /database error saving new user/i.test(text) ? 'That username is already taken. Please choose another one.' : text, true);
  } finally { setBusy(formEl, false); }
}
