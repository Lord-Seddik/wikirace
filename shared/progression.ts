// XP, levels and achievements. Unlock rules live in worker/achievements.ts.

export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1;
}

export function xpForLevel(level: number): number {
  return 40 * (level - 1) ** 2;
}

/** 0..1 progress towards the next level. */
export function levelProgress(xp: number): number {
  const lvl = levelForXp(xp);
  const lo = xpForLevel(lvl);
  const hi = xpForLevel(lvl + 1);
  return Math.min(1, (xp - lo) / (hi - lo));
}

export function rankTitle(rating: number): string {
  if (rating >= 1600) return 'Legend';
  if (rating >= 1450) return 'Grandmaster';
  if (rating >= 1300) return 'Master';
  if (rating >= 1150) return 'Expert';
  if (rating >= 1000) return 'Explorer';
  if (rating >= 850) return 'Wanderer';
  return 'Novice';
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_finish', name: 'First Steps', description: 'Finish your first race.', icon: '👣' },
  { id: 'races_10', name: 'Regular', description: 'Finish 10 races.', icon: '🏃' },
  { id: 'races_50', name: 'Veteran Racer', description: 'Finish 50 races.', icon: '🎖️' },
  { id: 'races_200', name: 'Living Encyclopedia', description: 'Finish 200 races.', icon: '📚' },
  { id: 'speed_60', name: 'Quick Thinker', description: 'Finish a race in under 60 seconds.', icon: '⏱️' },
  { id: 'speed_30', name: 'Lightning Fingers', description: 'Finish a race in under 30 seconds.', icon: '⚡' },
  { id: 'clicks_3', name: 'Minimalist', description: 'Finish a race in 3 clicks or fewer.', icon: '🎯' },
  { id: 'clicks_2', name: 'Shortcut Master', description: 'Finish a race in 2 clicks or fewer.', icon: '🪄' },
  { id: 'scenic', name: 'Scenic Route', description: 'Finish a race after 25 or more clicks. Never give up!', icon: '🗺️' },
  { id: 'no_back', name: 'No Regrets', description: 'Finish a race of 5+ clicks without pressing Back.', icon: '➡️' },
  { id: 'philosopher', name: 'Philosopher', description: 'Pass through the "Philosophy" article during a race.', icon: '🤔' },
  { id: 'hard_win', name: 'Deep Diver', description: 'Finish a Hard race.', icon: '🤿' },
  { id: 'polyglot', name: 'Polyglot', description: 'Finish a race on a non-English Wikipedia.', icon: '🌐' },
  { id: 'daily_1', name: 'Daily Racer', description: 'Complete a Daily Challenge.', icon: '📅' },
  { id: 'streak_3', name: 'On a Roll', description: 'Reach a 3-day Daily streak.', icon: '🔥' },
  { id: 'streak_7', name: 'Week Warrior', description: 'Reach a 7-day Daily streak.', icon: '🗓️' },
  { id: 'streak_30', name: 'Unstoppable', description: 'Reach a 30-day Daily streak.', icon: '🌋' },
  { id: 'daily_top10', name: 'Podium Hunter', description: 'Place top 10 on a Daily Challenge.', icon: '🏅' },
  { id: 'daily_first', name: 'Daily Champion', description: 'Hold #1 on a Daily Challenge when you finish.', icon: '👑' },
  { id: 'creator', name: 'Puzzle Maker', description: 'Create a custom challenge.', icon: '🧩' },
  { id: 'mp_round_win', name: 'Round Winner', description: 'Win a multiplayer round.', icon: '🥇' },
  { id: 'mp_match_win', name: 'Champion', description: 'Win a multiplayer match.', icon: '🏆' },
  { id: 'mp_10', name: 'Social Butterfly', description: 'Play 10 multiplayer matches.', icon: '🦋' },
  { id: 'ranked_1', name: 'Into the Arena', description: 'Play a ranked Quick Match.', icon: '⚔️' },
  { id: 'rating_1200', name: 'Rising Star', description: 'Reach a 1200 rating.', icon: '⭐' },
  { id: 'rating_1500', name: 'Grandmaster', description: 'Reach a 1500 rating.', icon: '💎' },
];

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
