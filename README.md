# Personal Space — update 3: color themes and tidier code

## What's new
**Appearance (Settings -> Appearance)**
- Mode: Light, Dark, or "Match my device" (follows your phone/computer, live).
- Accent color: Teal, Blue, Purple, Green, Warm, Rose. Every combination works with every mode.
- Saved to your account (needs `03-theme-preferences.sql`), so it follows you to other devices. Without that script it is remembered per device.
- No flash: the chosen theme is applied before the page paints. The moon/sun button in the top bar still flips light/dark.
- Contrast: every text/background pair in every palette was checked to be at least 4.6:1.

**Tidier code (nothing visible changes, it is just easier to work on)**
- The 10 page files are now about 15 lines each. The login screen, sidebar and top bar are built once in `js/modules/shell.js`. To add a sidebar section: add one line to `NAV` in `shell.js`, and copy one page file.
- The old 96 KB `app.js` is split into modules in `js/modules/`:
  - `state.js` shared state · `utils.js` small helpers · `shell.js` page frame + sidebar
  - `router.js` go / renderView · `routes.js` page names
  - `posts.js` posts, likes, comments, Home · `profile.js` profiles + cropper
  - `friends.js` · `chats.js` · `collections.js` (media, projects, movies, recommendations)
  - `realtime.js` live updates + notifications · `auth.js` · `settings.js` · `theme.js`
  - `events.js` all clicks / typing / form submits, passed to the right feature
  - `js/app.js` is only the start-up code (about 40 lines).
- Small improvements: no brief flash of the login screen for signed-in users; the sidebar highlights the right page immediately; slightly tighter sidebar so all links fit on laptop screens; sliders/checkboxes use your accent color.

## Deployment (in this order)
1. Back up your GitHub repository.
2. Supabase -> SQL Editor. If you have not already, run `01-security-fixes.sql` then `02-showcase-and-blocking.sql`. Then run `03-theme-preferences.sql`. Each once; safe to re-run. Never rerun the older scripts.
3. Delete the old files in your repository and upload the contents of this ZIP's root (not an enclosing folder). IMPORTANT: the old big `js/app.js` is replaced, and there is a new `js/modules/` folder and `js/theme-init.js`. Keep your own `js/config.js`.
4. Wait for GitHub Pages, then hard refresh (Ctrl+Shift+R, or clear the site data on a phone).
5. Supabase -> Authentication -> URL Configuration: set Site URL to https://bryte6595-del.github.io/personal-space/ and add it under Redirect URLs.

## Quick checks
- Settings: click each accent and mode; the page changes at once. Reload: it stays. Log in on another device: same look.
- "Match my device": change your computer's light/dark setting; the site follows.
- Click through every sidebar link; send a chat message; write a post; crop a profile picture.
- Phone width: menu opens and closes; all pages readable in light and dark.

## Tested before sending
- Database: all SQL scripts run in order on a real PostgreSQL 16 with a mock of Supabase; 49 security checks + theme-column checks pass; re-running is harmless.
- Code: every file passes a syntax check and a "no undefined names" check; all 13 pages render identically to the previous version (apart from the new Settings controls); 41 browser checks passed (themes, account sync, no flash, posts, comments, likes, load more, friends search, chat, cropper, menus, logout) with zero script, console or network errors.
- NOT tested: your real Supabase project, real phones, GitHub Pages hosting.
