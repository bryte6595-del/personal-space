// Shared state.
import { viewFromLocation } from './routes.js';

export const titles = { home:'Home', profile:'My profile', 'public-profile':'Member profile', posts:'Posts', friends:'Friends & followers', messages:'Chats', images:'Images', videos:'Videos', audio:'Audio', projects:'Projects & games', movies:'Movies', recommendations:'Recommendations', settings:'Settings' };
export const PAGE_SIZE = 10;
// Shared state for the whole app. Every module imports `ps` (personal space) and reads or writes its fields.
// `dom` looks elements up when asked, because the page shell is built by JavaScript after the page loads.
// (the `titles` and `PAGE_SIZE` constants are moved in here by the build step)
const params = new URLSearchParams(location.search);
export const ps = {
  supabase: null,
  currentUser: null,
  currentProfile: null,
  currentView: viewFromLocation(titles),
  activeChatUser: params.get('chat'),
  chatProfiles: {},
  viewedProfileId: params.get('member'),
  renderToken: 0,
  realtimeChannel: null,
  realtimeUserId: null,
  presenceChannel: null,
  onlineUserIds: new Set(),
  realtimeRefreshTimer: null,
  notificationPanelOpen: false,
  notificationRefreshTimer: null,
  activeCropper: null,
  messagePreviewUrl: null,
  feedContext: null
};
export const dom = {
  get authScreen() { return document.getElementById('auth-screen'); },
  get app() { return document.getElementById('app'); },
  get viewContainer() { return document.getElementById('view-container'); }
};
