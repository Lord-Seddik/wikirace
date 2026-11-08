/**
 * Everything the server asks Wikipedia.
 *
 * The browser downloads and renders articles itself (straight from Wikipedia). The server
 * only needs two light things to referee a race:
 *   - the list of article links on a page (to check a click is a real link), and
 *   - the canonical title of the page a link leads to (redirects resolved).
 * Both are small JSON responses, cached in memory, in the Cloudflare Cache API and at the edge.
 */
import { normalizeTitle } from '../shared/titles';
import type { PageSummary, SearchHit } from '../shared/types';
import { HttpError } from './util';

const UA = 'WikiRaceGame/1.0 (https://wikirace.seddikbachounda.com; Wikipedia racing game)';

interface LinkSet {
  title: string;
  links: Set<string>;
}

class LRU<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

const linkMem = new LRU<LinkSet>(150);
const titleMem = new LRU<string | null>(2000);
const linkInflight = new Map<string, Promise<LinkSet>>();

let cacheOrigin = 'https://wikirace.seddikbachounda.com';
export function setCacheOrigin(origin: string) {
  cacheOrigin = origin;
}

function cacheKey(kind: string, lang: string, title: string): Request {
  return new Request(`${cacheOrigin}/__cache/v3/${kind}/${lang}/${encodeURIComponent(title)}`);
}

async function cacheGet<T>(kind: string, lang: string, title: string): Promise<T | null> {
  try {
    const hit = await caches.default.match(cacheKey(kind, lang, title));
    return hit ? ((await hit.json()) as T) : null;
  } catch {
    return null;
  }
}

async function cachePut(kind: string, lang: string, title: string, value: unknown, ttlSeconds: number) {
  try {
    await caches.default.put(
      cacheKey(kind, lang, title),
      new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSeconds}` },
      }),
    );
  } catch {
    /* Cache API unavailable (e.g. workers.dev): fine, memory + Wikipedia still work. */
  }
}

function apiUrl(lang: string, params: Record<string, string>): string {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.search = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  return u.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON from Wikimedia, with one retry when Wikipedia is busy (429/5xx) or unreachable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wikiJson(url: string, edgeTtl?: number): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' },
        ...(edgeTtl ? { cf: { cacheTtl: edgeTtl, cacheEverything: true } } : {}),
      });
    } catch {
      res = null;
    }
    if (res?.ok) {
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        /* rate-limit pages come back as plain text */
      }
    } else if (res?.status === 404) {
      throw new HttpError(404, 'That page does not exist on Wikipedia.');
    }
    if (attempt >= 1) throw new HttpError(503, 'Wikipedia is busy right now. Try that click again in a second.', 'wiki_busy');
    await sleep(400);
  }
}

function rememberLinks(lang: string, keys: string[], set: LinkSet) {
  for (const k of keys) linkMem.set(`${lang}:${k}`, set);
}

/** Article links of a page (used to validate moves). Follows redirects; `title` is canonical. */
export async function getLinks(lang: string, rawTitle: string): Promise<LinkSet> {
  const norm = normalizeTitle(rawTitle);
  const key = `${lang}:${norm}`;
  const mem = linkMem.get(key);
  if (mem) return mem;
  const running = linkInflight.get(key);
  if (running) return running;
  const job = (async () => {
    const cached = await cacheGet<{ title: string; links: string[] }>('links', lang, norm);
    if (cached) {
      const set = { title: cached.title, links: new Set(cached.links) };
      rememberLinks(lang, [norm, cached.title], set);
      return set;
    }
    const data = await wikiJson(apiUrl(lang, { action: 'parse', page: norm, prop: 'links', redirects: '1' }), 3600);
    if (data.error || !data.parse) throw new HttpError(404, `There is no Wikipedia article called "${norm}".`, 'missing_page');
    const title = normalizeTitle(data.parse.title);
    const links = [
      ...new Set(
        ((data.parse.links ?? []) as { ns: number; title: string; exists?: boolean }[])
          .filter((l) => l.ns === 0 && l.exists)
          .map((l) => normalizeTitle(l.title)),
      ),
    ];
    const set = { title, links: new Set(links) };
    rememberLinks(lang, [norm, title], set);
    titleMem.set(key, title);
    const puts = [cachePut('links', lang, title, { title, links }, 24 * 3600)];
    if (norm !== title) puts.push(cachePut('links', lang, norm, { title, links }, 24 * 3600));
    await Promise.all(puts);
    return set;
  })();
  linkInflight.set(key, job);
  try {
    return await job;
  } finally {
    linkInflight.delete(key);
  }
}

/** Where a link leads: the canonical article title (redirects followed), or null if missing. */
export async function canonicalTitle(lang: string, rawTitle: string): Promise<string | null> {
  const norm = normalizeTitle(rawTitle);
  const key = `${lang}:${norm}`;
  const known = titleMem.get(key);
  if (known !== undefined) return known;
  const mem = linkMem.get(key);
  if (mem) return mem.title;
  const resolved = (await resolveTitles(lang, [norm])).get(norm) ?? null;
  titleMem.set(key, resolved);
  return resolved;
}

/**
 * Resolve titles to canonical article titles (follows redirects).
 * Returns a map input → canonical title, or null if the article does not exist.
 */
export async function resolveTitles(lang: string, titles: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(titles.map(normalizeTitle).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const data = await wikiJson(apiUrl(lang, { action: 'query', titles: chunk.join('|'), redirects: '1' }), 3600);
    const q = data.query ?? {};
    const norm = new Map<string, string>(((q.normalized ?? []) as { from: string; to: string }[]).map((n) => [n.from, n.to]));
    const redir = new Map<string, string>(((q.redirects ?? []) as { from: string; to: string }[]).map((r) => [r.from, r.to]));
    const pages = new Map<string, { title: string; missing?: boolean; invalid?: boolean; ns: number }>(
      ((q.pages ?? []) as { title: string; missing?: boolean; invalid?: boolean; ns: number }[]).map((p) => [p.title, p]),
    );
    for (const t of chunk) {
      let cur = norm.get(t) ?? t;
      cur = redir.get(cur) ?? cur;
      const page = pages.get(cur);
      out.set(t, page && !page.missing && !page.invalid && page.ns === 0 ? normalizeTitle(page.title) : null);
    }
  }
  const result = new Map<string, string | null>();
  for (const t of titles) result.set(t, out.get(normalizeTitle(t)) ?? null);
  return result;
}

/**
 * The same articles on another Wikipedia, via English interlanguage links.
 * Returns a map English title → local title, or null when that wiki has no such article.
 */
export async function translateFromEnglish(lang: string, titles: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(titles.map(normalizeTitle).filter(Boolean))];
  if (!unique.length) return out;
  const data = await wikiJson(apiUrl('en', { action: 'query', titles: unique.join('|'), redirects: '1', prop: 'langlinks', lllang: lang, lllimit: 'max' }), 24 * 3600);
  const q = data.query ?? {};
  const norm = new Map<string, string>(((q.normalized ?? []) as { from: string; to: string }[]).map((n) => [n.from, n.to]));
  const redir = new Map<string, string>(((q.redirects ?? []) as { from: string; to: string }[]).map((r) => [r.from, r.to]));
  const pages = new Map<string, { langlinks?: { lang: string; title: string }[] }>(
    ((q.pages ?? []) as { title: string; langlinks?: { lang: string; title: string }[] }[]).map((p) => [p.title, p]),
  );
  for (const t of titles) {
    const n = normalizeTitle(t);
    let cur = norm.get(n) ?? n;
    cur = redir.get(cur) ?? cur;
    const local = pages.get(cur)?.langlinks?.find((l) => l.lang === lang)?.title;
    out.set(t, local ? normalizeTitle(local) : null);
  }
  return out;
}

export async function getSummary(lang: string, rawTitle: string): Promise<PageSummary> {
  const title = normalizeTitle(rawTitle);
  const data = await wikiJson(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`,
    6 * 3600,
  );
  return {
    title: normalizeTitle(data.titles?.normalized ?? data.title ?? title),
    displayTitle: textOf(String(data.displaytitle ?? data.title ?? title)),
    description: String(data.description ?? ''),
    extract: String(data.extract ?? ''),
    thumbnail: data.thumbnail?.source ? absolutize(String(data.thumbnail.source), lang) : null,
  };
}

export async function searchTitles(lang: string, q: string): Promise<SearchHit[]> {
  const data = await wikiJson(
    `https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=8`,
    3600,
  );
  return ((data.pages ?? []) as { title: string; description?: string; thumbnail?: { url?: string } }[]).map((p) => ({
    title: normalizeTitle(p.title),
    description: p.description ?? '',
    thumbnail: p.thumbnail?.url ? absolutize(p.thumbnail.url, lang) : null,
  }));
}

/** A random, reasonably long, non-disambiguation article. */
export async function randomArticle(lang: string, rng: () => number = Math.random): Promise<string> {
  const data = await wikiJson(
    apiUrl(lang, { action: 'query', generator: 'random', grnnamespace: '0', grnlimit: '20', prop: 'info|pageprops', ppprop: 'disambiguation' }),
  );
  const pages = ((data.query?.pages ?? []) as { title: string; length?: number; pageprops?: Record<string, string> }[])
    .filter((p) => !p.pageprops || !('disambiguation' in p.pageprops))
    .sort((a, b) => (b.length ?? 0) - (a.length ?? 0));
  if (!pages.length) throw new HttpError(502, 'Wikipedia did not return a random article');
  const good = pages.filter((p) => (p.length ?? 0) > 9000);
  const pool = good.length ? good : pages.slice(0, 3);
  return normalizeTitle(pool[Math.floor(rng() * pool.length)].title);
}

function absolutize(u: string, lang: string): string {
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `https://${lang}.wikipedia.org${u}`;
  return u;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

const MAIN_PAGES = new Set([
  'Main Page', 'Hauptseite', 'Portada', 'Pagina principale', 'Hoofdpagina', 'Anasayfa', 'Ana Sayfa',
  'الصفحة الرئيسية', 'Accueil', 'Página principal', 'Strona główna',
]);
const NSFW = /porn|sex|xxx|nud[eo]|naked|nackt|desnud|onlyfans|erot|hentai|fetish|xvideos|xhamster|إباح|سكس|جنس|عري/i;
const topMem = new Map<string, { at: number; titles: string[] }>();

/** Most-read articles of a recent day for a language (used for non-English pairs). */
export async function topArticles(lang: string): Promise<string[]> {
  const day = new Date(Date.now() - 2 * 86_400_000);
  const key = `${lang}:${day.toISOString().slice(0, 10)}`;
  const mem = topMem.get(key);
  if (mem && Date.now() - mem.at < 12 * 3600_000) return mem.titles;
  const cached = await cacheGet<string[]>('top', lang, key);
  if (cached?.length) {
    topMem.set(key, { at: Date.now(), titles: cached });
    return cached;
  }
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, '0');
  const d = String(day.getUTCDate()).padStart(2, '0');
  const data = await wikiJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${y}/${m}/${d}`, 12 * 3600);
  const titles = ((data.items?.[0]?.articles ?? []) as { article: string }[])
    .map((a) => normalizeTitle(a.article))
    .filter((t) => t && !t.includes(':') && !MAIN_PAGES.has(t) && !NSFW.test(t) && t !== '-');
  if (titles.length) {
    topMem.set(key, { at: Date.now(), titles });
    await cachePut('top', lang, key, titles, 12 * 3600);
  }
  return titles;
}
