/**
 * Everything that talks to Wikipedia.
 *
 * Articles are fetched with the Action API (`action=parse`), which returns the rendered
 * HTML *and* the list of article links on the page in one request. The HTML is rewritten
 * so that only real article links stay clickable (as `data-to="Title"`), and the link list
 * is cached separately: it is what the server uses to check that every move in a race is a
 * link that really exists on the page the player was on.
 *
 * Caching: a small in-memory LRU per isolate, then the Cloudflare Cache API (per colo),
 * then Wikipedia itself (with Cloudflare edge caching of the subrequest).
 */
import { normalizeTitle, titleFromHref, wikiUrl } from '../shared/titles';
import type { PageData, PageSummary, SearchHit } from '../shared/types';
import { HttpError } from './util';

const UA = 'WikiRaceGame/1.0 (https://wikirace.seddikbachounda.com; game that renders Wikipedia articles)';

export interface FullPage extends PageData {
  links: string[];
}

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

const pageMem = new LRU<FullPage>(16);
const linkMem = new LRU<LinkSet>(400);
const inflight = new Map<string, Promise<FullPage>>();

let cacheOrigin = 'https://wikirace.seddikbachounda.com';
export function setCacheOrigin(origin: string) {
  cacheOrigin = origin;
}

function cacheKey(kind: string, lang: string, title: string): Request {
  return new Request(`${cacheOrigin}/__cache/v2/${kind}/${lang}/${encodeURIComponent(title)}`);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wikiJson(url: string, edgeTtl?: number): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' },
      ...(edgeTtl ? { cf: { cacheTtl: edgeTtl, cacheEverything: true } } : {}),
    });
  } catch {
    throw new HttpError(502, 'Could not reach Wikipedia. Try again in a moment.');
  }
  if (res.status === 404) throw new HttpError(404, 'That page does not exist on Wikipedia.');
  if (!res.ok) throw new HttpError(502, `Wikipedia answered with an error (${res.status}).`);
  return res.json();
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

function absolutize(u: string, lang: string): string {
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `https://${lang}.wikipedia.org${u}`;
  return u;
}

const REMOVE_SELECTORS = [
  'script', 'link', 'meta', 'noscript', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'video', 'audio', 'source', 'track',
  '.mw-editsection', '.mw-empty-elt', '.navbar', '.mw-jump-link', '.noprint', '.ambox', '.mw-indicators',
];

/** Rewrites parser HTML: keep valid article links as data-to, neuter everything else. */
async function sanitize(html: string, links: Set<string>, lang: string): Promise<string> {
  let rw = new HTMLRewriter();
  for (const sel of REMOVE_SELECTORS) rw = rw.on(sel, { element: (el) => void el.remove() });
  rw = rw
    .on('*', {
      element(el) {
        const drop: string[] = [];
        for (const [name, value] of el.attributes) {
          if (/^on/i.test(name) || /^\s*javascript:/i.test(value)) drop.push(name);
        }
        for (const n of drop) el.removeAttribute(n);
      },
    })
    .on('a', {
      element(el) {
        const href = el.getAttribute('href');
        el.removeAttribute('target');
        if (href == null) return;
        el.removeAttribute('href');
        if (href.startsWith('#')) {
          el.setAttribute('data-anchor', href.slice(1));
          return;
        }
        const t = titleFromHref(href);
        if (t && links.has(t)) el.setAttribute('data-to', t);
        else el.setAttribute('data-dead', '');
      },
    })
    .on('area', { element: (el) => void el.removeAttribute('href') })
    .on('img', {
      element(el) {
        const src = el.getAttribute('src');
        if (src) el.setAttribute('src', absolutize(src, lang));
        const srcset = el.getAttribute('srcset');
        if (srcset) {
          el.setAttribute(
            'srcset',
            srcset
              .split(',')
              .map((part) => {
                const [u, ...rest] = part.trim().split(/\s+/);
                return [absolutize(u, lang), ...rest].join(' ');
              })
              .join(', '),
          );
        }
        el.setAttribute('loading', 'lazy');
        el.setAttribute('decoding', 'async');
      },
    });
  return rw.transform(new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })).text();
}

function rememberLinks(lang: string, keys: string[], set: LinkSet) {
  for (const k of keys) linkMem.set(`${lang}:${k}`, set);
}

/** Full article: sanitized HTML + link list. Follows redirects; `title` is canonical. */
export async function getPage(lang: string, rawTitle: string): Promise<FullPage> {
  const norm = normalizeTitle(rawTitle);
  if (!norm) throw new HttpError(400, 'Missing page title');
  const memKey = `${lang}:${norm}`;
  const mem = pageMem.get(memKey);
  if (mem) return mem;
  const running = inflight.get(memKey);
  if (running) return running;

  const job = (async () => {
    const cached = await cacheGet<FullPage>('page', lang, norm);
    if (cached) {
      pageMem.set(memKey, cached);
      rememberLinks(lang, [norm, cached.title], { title: cached.title, links: new Set(cached.links) });
      return cached;
    }
    const data = await wikiJson(
      apiUrl(lang, {
        action: 'parse',
        page: norm,
        prop: 'text|links|displaytitle',
        redirects: '1',
        disableeditsection: '1',
        disabletoc: '1',
        disablelimitreport: '1',
      }),
      900,
    );
    if (data.error) {
      if (data.error.code === 'missingtitle' || data.error.code === 'invalidtitle') {
        throw new HttpError(404, `There is no Wikipedia article called "${norm}".`, 'missing_page');
      }
      throw new HttpError(502, data.error.info ?? 'Wikipedia error');
    }
    const p = data.parse;
    if (!p || p.ns !== undefined && p.ns !== 0) throw new HttpError(400, 'Only encyclopedia articles can be used.');
    const title = normalizeTitle(p.title);
    const links: string[] = [
      ...new Set(
        ((p.links ?? []) as { ns: number; title: string; exists?: boolean }[])
          .filter((l) => l.ns === 0 && l.exists)
          .map((l) => normalizeTitle(l.title)),
      ),
    ];
    const linkSet = new Set(links);
    const html = await sanitize(String(p.text ?? ''), linkSet, lang);
    const page: FullPage = {
      lang,
      title,
      displayTitle: textOf(String(p.displaytitle ?? title)) || title,
      html,
      url: wikiUrl(lang, title),
      links,
    };
    pageMem.set(memKey, page);
    pageMem.set(`${lang}:${title}`, page);
    rememberLinks(lang, [norm, title], { title, links: linkSet });
    const puts = [cachePut('page', lang, title, page, 6 * 3600), cachePut('links', lang, title, { title, links }, 24 * 3600)];
    if (norm !== title) {
      puts.push(cachePut('page', lang, norm, page, 6 * 3600), cachePut('links', lang, norm, { title, links }, 24 * 3600));
    }
    await Promise.all(puts);
    return page;
  })();
  inflight.set(memKey, job);
  try {
    return await job;
  } finally {
    inflight.delete(memKey);
  }
}

export function clientPage(p: FullPage): PageData {
  return { lang: p.lang, title: p.title, displayTitle: p.displayTitle, html: p.html, url: p.url };
}

/** Article links of a page (used to validate moves). Lighter than getPage on a cache miss. */
export async function getLinks(lang: string, rawTitle: string): Promise<LinkSet> {
  const norm = normalizeTitle(rawTitle);
  const mem = linkMem.get(`${lang}:${norm}`);
  if (mem) return mem;
  const cached = await cacheGet<{ title: string; links: string[] }>('links', lang, norm);
  if (cached) {
    const set = { title: cached.title, links: new Set(cached.links) };
    rememberLinks(lang, [norm, cached.title], set);
    return set;
  }
  const data = await wikiJson(apiUrl(lang, { action: 'parse', page: norm, prop: 'links', redirects: '1' }), 900);
  if (data.error) throw new HttpError(404, `There is no Wikipedia article called "${norm}".`, 'missing_page');
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
  await cachePut('links', lang, title, { title, links }, 24 * 3600);
  if (norm !== title) await cachePut('links', lang, norm, { title, links }, 24 * 3600);
  return set;
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
