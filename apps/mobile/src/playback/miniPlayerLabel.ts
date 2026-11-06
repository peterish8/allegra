/**
 * The mini player's accessibility label. `.github/scripts/player-assertions.sh` reads the playing song from exactly
 * this shape (pill_title) and the player probe reopens Now Playing by tapping it, so V6's
 * "<title> by <artist>. Open player" left the probe unable to reopen the player and broke its later checks.
 * The artist is read as the hint instead.
 */
export const miniPlayerLabel = (title: string): string => `Now playing: ${title}. Open player`;
