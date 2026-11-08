/**
 * Beta: keep WikiRace focused on the race itself.
 * Everything below still exists (pages, API, database); flip a switch to bring it back.
 */
export const FEATURES = {
  /** Profile pages, levels, XP, sync key. */
  profiles: false,
  /** Achievement unlocks and lists. */
  achievements: false,
  /** Ranked Quick Match (matchmaking + rating). */
  ranked: false,
  /** Global leaderboards page (the Daily keeps a small "top today" list). */
  leaderboards: false,
  /** Shareable custom challenge links. */
  challenges: false,
  /** Public room browser + "public room" setting. */
  publicRooms: false,
  /** Emoji reactions during room races. */
  emotes: false,
  /** Full solo setup page (themes, hand-picked pages). */
  advancedSolo: false,
  /** "Spectate" switch in the lobby (late joiners still watch automatically). */
  spectate: false,
};
