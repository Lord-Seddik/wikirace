// API + realtime protocol types shared by the client and the Worker.
import type { Difficulty, Lang, ThemeId } from './constants';

/** An article as the client renders it (HTML already sanitized by the Worker). */
export interface PageData {
  lang: string;
  title: string;
  displayTitle: string;
  html: string;
  url: string;
}

export interface PageSummary {
  title: string;
  displayTitle: string;
  description: string;
  extract: string;
  thumbnail: string | null;
}

export interface SearchHit {
  title: string;
  description: string;
  thumbnail: string | null;
}

export interface PlayerPublic {
  id: string;
  name: string;
  avatar: string;
  color: string;
  rating: number;
  xp: number;
  level: number;
}

export interface PlayerStats {
  createdAt: number;
  rankedGames: number;
  rankedWins: number;
  mpGames: number;
  mpWins: number;
  mpRoundWins: number;
  racesFinished: number;
  dailyPlayed: number;
  dailyStreak: number;
  bestStreak: number;
  lastDaily: string | null;
  totalClicks: number;
  bestTimeMs: number | null;
  bestClicks: number | null;
}

export interface Me extends PlayerPublic {
  stats: PlayerStats;
}

export type RunMode = 'solo' | 'daily' | 'challenge';
export type RunStatus = 'active' | 'finished' | 'abandoned';

export interface RunView {
  id: string;
  playerId: string;
  mode: RunMode;
  lang: string;
  start: string;
  target: string;
  difficulty: string | null;
  dailyDate: string | null;
  challengeId: string | null;
  ranked: boolean;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  clicks: number;
  usedBack: boolean;
  path: string[];
  stack: string[];
  status: RunStatus;
}

export interface BestKnown {
  clicks: number;
  durationMs: number;
  path: string[];
  playerName: string;
  playerAvatar: string;
}

export interface RunResult {
  clicks: number;
  durationMs: number;
  rank: number | null;
  total: number | null;
  xpGained: number;
  streak: number | null;
  newAchievements: string[];
  bestKnown: BestKnown | null;
}

export interface StartRunResponse {
  run: RunView;
  page: PageData;
  serverNow: number;
  resumed: boolean;
}

export interface MoveResponse {
  run: RunView;
  page: PageData;
  result: RunResult | null;
  serverNow: number;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  name: string;
  avatar: string;
  color: string;
  clicks?: number;
  durationMs?: number;
  runId?: string;
  rating?: number;
  games?: number;
  wins?: number;
  streak?: number;
  bestStreak?: number;
  xp?: number;
  level?: number;
}

export interface DailyInfo {
  date: string;
  number: number;
  lang: string;
  start: string;
  target: string;
  nextAt: number;
  serverNow: number;
  stats: { finishers: number; players: number; avgClicks: number | null; bestClicks: number | null; distribution: { clicks: number; count: number }[] };
  me: { status: RunStatus; runId: string; clicks: number; durationMs: number | null; rank: number | null; total: number | null } | null;
}

export interface ChallengeInfo {
  id: string;
  lang: string;
  start: string;
  target: string;
  createdAt: number;
  plays: number;
  creator: { id: string; name: string; avatar: string; color: string } | null;
  leaderboard: LeaderboardEntry[];
}

export interface PublicRoom {
  code: string;
  name: string;
  hostName: string | null;
  players: number;
  maxPlayers: number;
  status: string;
  lang: string;
  difficulty: string;
}

export interface GlobalStats {
  players: number;
  racesToday: number;
  dailyFinishers: number;
  publicRooms: number;
  searching: number;
}

export interface ProfileResponse {
  player: PlayerPublic & { stats: PlayerStats };
  achievements: { id: string; unlockedAt: number }[];
  recentRuns: RunView[];
  recentMatches: { matchId: string; ranked: boolean; place: number; players: number; score: number; ratingBefore: number | null; ratingAfter: number | null; createdAt: number }[];
}

// ---------------------------------------------------------------------------------------
// Multiplayer rooms
// ---------------------------------------------------------------------------------------

export type WinBy = 'speed' | 'clicks';
export type Visibility = 'full' | 'clicks' | 'none';

export interface RoomSettings {
  name: string;
  isPublic: boolean;
  lang: Lang;
  rounds: number;
  /** Seconds per round. */
  timeLimit: number;
  difficulty: Difficulty;
  theme: ThemeId;
  winBy: WinBy;
  maxPlayers: number;
  /** What you can see of opponents while you are still racing. */
  visibility: Visibility;
  noBack: boolean;
  /** Seconds left for everyone once the first player finishes (0 = off). */
  finishWindow: number;
  /** Pages nobody may visit (canonical titles). */
  banned: string[];
}

export type RoomStatus = 'lobby' | 'playing' | 'roundEnd' | 'finished';

export interface RoomPlayer {
  id: string;
  name: string;
  avatar: string;
  color: string;
  rating: number;
  level: number;
  connected: boolean;
  spectator: boolean;
  score: number;
  roundWins: number;
}

export interface PlayerProgress {
  pid: string;
  /** null when hidden by the room's visibility rule. */
  current: string | null;
  path: string[] | null;
  /** Navigation stack (only sent for your own progress). */
  stack?: string[];
  clicks: number | null;
  finished: boolean;
  gaveUp: boolean;
  timeMs: number | null;
}

export interface RoundView {
  index: number;
  start: string;
  target: string;
  startsAt: number;
  endsAt: number | null;
  participants: string[];
  progress: Record<string, PlayerProgress>;
}

export interface RoundResultEntry {
  pid: string;
  name: string;
  avatar: string;
  color: string;
  place: number | null;
  clicks: number;
  timeMs: number | null;
  points: number;
  finished: boolean;
  gaveUp: boolean;
  path: string[];
  /** Server-side only (used for achievements); stripped before sending. */
  usedBack?: boolean;
}

export interface RoundResult {
  index: number;
  start: string;
  target: string;
  startedAt: number;
  endedAt: number;
  results: RoundResultEntry[];
}

export interface FinalStanding {
  pid: string;
  name: string;
  avatar: string;
  color: string;
  place: number;
  score: number;
  roundWins: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
}

export interface ChatMessage {
  id: string;
  pid: string | null;
  name: string;
  avatar?: string;
  color?: string;
  text: string;
  ts: number;
  kind: 'chat' | 'system';
}

export interface RoomView {
  code: string;
  ranked: boolean;
  settings: RoomSettings;
  status: RoomStatus;
  hostId: string | null;
  you: string;
  players: RoomPlayer[];
  round: RoundView | null;
  history: RoundResult[];
  standings: FinalStanding[] | null;
  chat: ChatMessage[];
  nextRoundAt: number | null;
  autoStartAt: number | null;
  preparing: boolean;
  /** Host only: the custom pages queued for the next round. */
  nextPair: { start: string; target: string } | null;
  hasCustomPair: boolean;
  matchId: string | null;
  now: number;
}

export type ClientMessage =
  | { t: 'chat'; text: string }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'start' }
  | { t: 'next' }
  | { t: 'giveup' }
  | { t: 'kick'; pid: string }
  | { t: 'spectate'; on: boolean }
  | { t: 'emote'; emoji: string }
  | { t: 'reset' }
  | { t: 'pair'; pair: { start: string; target: string } | null }
  | { t: 'transfer'; pid: string };

export type ServerMessage =
  | { t: 'state'; room: RoomView }
  | { t: 'emote'; pid: string; emoji: string }
  | { t: 'toast'; text: string; kind?: 'info' | 'good' | 'bad'; tag?: 'achievement' }
  | { t: 'error'; message: string; code?: string };

export interface RoomMoveResponse {
  ok: true;
  page: PageData;
  progress: PlayerProgress;
  finished: boolean;
}

export type MatchmakingServerMessage =
  | { t: 'queue'; lang: string; size: number; players: { name: string; avatar: string; color: string; rating: number }[]; matchAt: number | null; now: number }
  | { t: 'matched'; code: string };
