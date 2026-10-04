// The session cookie: an opaque token whose hash identifies the player.
export function sessionToken(cookie = '') {
  return cookie.split(';').map(part => part.trim()).find(part => part.startsWith('home_session='))?.slice('home_session='.length);
}
