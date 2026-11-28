import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from './config.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { bindEvents } from './modules/events.js';
import { refreshNotificationBadges, startRealtime, stopRealtime } from './modules/realtime.js';
import { renderView } from './modules/router.js';
import { syncAppearanceControls } from './modules/settings.js';
import { renderShell, setAuthMessage, showApp, showAuth } from './modules/shell.js';
import { ps } from './modules/state.js';
import { initTheme, onThemeChange } from './modules/theme.js';
import { errorText } from './modules/utils.js';

// Entry point: builds the page frame, starts the theme, wires the events and checks the sign-in.
async function boot() {
  renderShell();
  initTheme();
  onThemeChange(syncAppearanceControls);
  bindEvents();
  if (!isConfigured) {
    showAuth();
    setAuthMessage('Supabase configuration is missing. Check js/config.js.', true);
    return;
  }
  ps.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  ps.supabase.auth.onAuthStateChange((_event, session) => {
    const previousUserId = ps.currentUser?.id || null;
    ps.currentUser = session?.user || null;
    if (!ps.currentUser) {
      if (previousUserId) stopRealtime();
      ps.currentProfile = null;
      showAuth();
      return;
    }
    showApp();
    // Do not redirect here. The page selected by the URL must survive session restoration.
    // Login/registration handlers and the initial getSession() path render the current page.
    if (previousUserId !== ps.currentUser.id) startRealtime(ps.currentUser.id);
  });
  const { data, error } = await ps.supabase.auth.getSession();
  if (error) setAuthMessage(error.message, true);
  ps.currentUser = data.session?.user || null;
  if (ps.currentUser) { startRealtime(ps.currentUser.id); showApp(); await renderView(); refreshNotificationBadges(); }
  else showAuth();
}
boot().catch(error => { showAuth(); setAuthMessage(errorText(error), true); });
