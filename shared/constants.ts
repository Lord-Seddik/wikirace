// Constants shared by the browser app and the Worker.

export const LANGS = [
  { code: 'en', name: 'English', rtl: false },
  { code: 'fr', name: 'Français', rtl: false },
  { code: 'es', name: 'Español', rtl: false },
  { code: 'de', name: 'Deutsch', rtl: false },
  { code: 'it', name: 'Italiano', rtl: false },
  { code: 'pt', name: 'Português', rtl: false },
  { code: 'nl', name: 'Nederlands', rtl: false },
  { code: 'pl', name: 'Polski', rtl: false },
  { code: 'tr', name: 'Türkçe', rtl: false },
  { code: 'ar', name: 'العربية', rtl: true },
] as const;

export type Lang = (typeof LANGS)[number]['code'];

export function isLang(x: unknown): x is Lang {
  return typeof x === 'string' && LANGS.some((l) => l.code === x);
}

export function langInfo(code: string) {
  return LANGS.find((l) => l.code === code) ?? LANGS[0];
}

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export function isDifficulty(x: unknown): x is Difficulty {
  return typeof x === 'string' && (DIFFICULTIES as readonly string[]).includes(x);
}

export const DIFFICULTY_INFO: Record<Difficulty, { label: string; blurb: string; icon: string }> = {
  easy: { label: 'Easy', blurb: 'Well-known targets, lots of roads lead there.', icon: '🌱' },
  medium: { label: 'Medium', blurb: 'Specific targets. You will need a plan.', icon: '🔥' },
  hard: { label: 'Hard', blurb: 'Random start, obscure target. Good luck.', icon: '💀' },
};

export const THEMES = [
  { id: 'any', name: 'Anything', icon: '🎲' },
  { id: 'geography', name: 'Geography', icon: '🌍' },
  { id: 'history', name: 'History', icon: '🏛️' },
  { id: 'science', name: 'Science', icon: '🔬' },
  { id: 'nature', name: 'Nature', icon: '🌿' },
  { id: 'culture', name: 'Arts & Culture', icon: '🎭' },
  { id: 'sports', name: 'Sports & Games', icon: '⚽' },
  { id: 'tech', name: 'Technology', icon: '💻' },
  { id: 'food', name: 'Food & Drink', icon: '🍕' },
  { id: 'oddities', name: 'Oddities', icon: '🦆' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
export function isTheme(x: unknown): x is ThemeId {
  return typeof x === 'string' && THEMES.some((t) => t.id === x);
}

export const AVATARS = [
  '🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐙', '🦉', '🐧', '🦄', '🐝', '🦋',
  '🐢', '🦖', '🐳', '🦜', '🐺', '🦝', '🦔', '🐹', '🐰', '🐻', '🐮', '🐷',
  '🐵', '🦒', '🦓', '🐘', '🦩', '🦥', '🦦', '🦚', '🐞', '🦈', '🐬', '🐲',
  '👽', '🤖', '👾', '🧙', '🥷', '🎃', '☄️', '🌵', '🍄', '🍕', '🚀', '⚡',
];

export const COLORS = [
  '#7c5cff', '#22d3ee', '#f472b6', '#facc15', '#4ade80', '#fb923c',
  '#60a5fa', '#f87171', '#a3e635', '#c084fc', '#2dd4bf', '#e879f9',
];

export const EMOTES = ['👏', '😂', '🔥', '😱', '🤯', '🐢', '🧠', '💀'];

/** Day #1 of the Daily Challenge. */
export const LAUNCH_DATE = '2026-11-08';

export const RATING_START = 1000;

export const NAME_ADJECTIVES = [
  'Swift', 'Curious', 'Clever', 'Lucky', 'Brave', 'Sneaky', 'Witty', 'Nimble', 'Cosmic', 'Mighty',
  'Sleepy', 'Jolly', 'Fuzzy', 'Silent', 'Rapid', 'Bold', 'Electric', 'Golden', 'Hidden', 'Wandering',
];
export const NAME_NOUNS = [
  'Otter', 'Falcon', 'Panda', 'Fox', 'Owl', 'Comet', 'Tiger', 'Koala', 'Wizard', 'Ninja',
  'Badger', 'Lynx', 'Dolphin', 'Raven', 'Gecko', 'Yak', 'Narwhal', 'Pilot', 'Scholar', 'Explorer',
];

/** Daily Challenge number for a UTC date 'YYYY-MM-DD' (launch day = #1). */
export function dailyNumber(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${LAUNCH_DATE}T00:00:00Z`)) / 86_400_000) + 1;
}
