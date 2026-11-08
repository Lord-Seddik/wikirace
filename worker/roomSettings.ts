import { isDifficulty, isLang, isTheme, type Lang } from '../shared/constants';
import { normalizeTitle } from '../shared/titles';
import type { RoomSettings } from '../shared/types';
import { levelForXp } from '../shared/progression';
import type { PlayerRow } from './players';
import { clampInt, cleanText } from './util';

export interface Identity {
  pid: string;
  name: string;
  avatar: string;
  color: string;
  rating: number;
  level: number;
}

export function identityOf(p: PlayerRow): Identity {
  return { pid: p.id, name: p.name, avatar: p.avatar, color: p.color, rating: p.rating, level: levelForXp(p.xp) };
}

export const DEFAULT_SETTINGS: RoomSettings = {
  name: 'Friendly race',
  isPublic: false,
  lang: 'en',
  rounds: 3,
  timeLimit: 300,
  difficulty: 'medium',
  theme: 'any',
  winBy: 'speed',
  maxPlayers: 8,
  visibility: 'clicks',
  noBack: false,
  finishWindow: 60,
  banned: [],
};

export function rankedSettings(lang: Lang): RoomSettings {
  return {
    ...DEFAULT_SETTINGS,
    name: 'Ranked match',
    lang,
    rounds: 1,
    timeLimit: 300,
    difficulty: 'medium',
    winBy: 'speed',
    visibility: 'clicks',
    finishWindow: 90,
  };
}

/** Merge a (possibly hostile) partial settings object over `base`, clamping every field. */
export function sanitizeSettings(input: Partial<RoomSettings> | undefined, base: RoomSettings): RoomSettings {
  const s = input ?? {};
  const out: RoomSettings = { ...base };
  if (s.name !== undefined) out.name = cleanText(s.name, 40) || base.name;
  if (s.isPublic !== undefined) out.isPublic = !!s.isPublic;
  if (isLang(s.lang)) out.lang = s.lang;
  if (s.rounds !== undefined) out.rounds = clampInt(s.rounds, 1, 10, base.rounds);
  if (s.timeLimit !== undefined) out.timeLimit = clampInt(s.timeLimit, 30, 1800, base.timeLimit);
  if (isDifficulty(s.difficulty)) out.difficulty = s.difficulty;
  if (isTheme(s.theme)) out.theme = s.theme;
  if (s.winBy === 'speed' || s.winBy === 'clicks') out.winBy = s.winBy;
  if (s.maxPlayers !== undefined) out.maxPlayers = clampInt(s.maxPlayers, 2, 16, base.maxPlayers);
  if (s.visibility === 'full' || s.visibility === 'clicks' || s.visibility === 'none') out.visibility = s.visibility;
  if (s.noBack !== undefined) out.noBack = !!s.noBack;
  if (s.finishWindow !== undefined) out.finishWindow = clampInt(s.finishWindow, 0, 600, base.finishWindow);
  if (Array.isArray(s.banned)) {
    out.banned = [...new Set(s.banned.map((b) => normalizeTitle(cleanText(b, 120))).filter(Boolean))].slice(0, 15);
  }
  return out;
}
