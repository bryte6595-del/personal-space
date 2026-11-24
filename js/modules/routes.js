export const pageRoutes = {
  home:'index.html', profile:'profile.html', 'public-profile':'profile.html', posts:'posts.html',
  friends:'friends.html', messages:'chats.html', images:'media.html', videos:'media.html',
  audio:'media.html', projects:'projects.html', movies:'movies.html',
  recommendations:'recommendations.html', settings:'settings.html'
};

export function viewFromLocation(titles) {
  const path = location.pathname.split('/').pop() || 'index.html';
  const params = new URLSearchParams(location.search);
  if (path === 'profile.html' && params.has('member')) return 'public-profile';
  if (path === 'media.html') {
    const kind = params.get('type');
    return ['images','videos','audio'].includes(kind) ? kind : 'images';
  }
  const map = {
    'index.html':'home', 'profile.html':'profile', 'posts.html':'posts',
    'friends.html':'friends', 'chats.html':'messages', 'messages.html':'messages', 'projects.html':'projects',
    'movies.html':'movies', 'recommendations.html':'recommendations', 'settings.html':'settings'
  };
  if (map[path]) return map[path];
  const legacyHash = location.hash.slice(1);
  return legacyHash in titles ? legacyHash : 'home';
}
