/**
 * Articles are loaded by the browser, straight from Wikipedia (its API allows this with
 * `origin=*`). That keeps the heavy work (downloading and preparing ~1 MB of HTML per page)
 * off our server; the server only referees each click with small cached link lists.
 */
import type { PageData } from '../../shared/types';
import { normalizeTitle, titleFromHref, wikiUrl } from '../../shared/titles';

const cache = new Map<string, Promise<PageData>>();
const MAX_CACHED = 40;

const REMOVE = [
  'script', 'link', 'meta', 'noscript', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'video', 'audio', 'source', 'track',
  '.mw-editsection', '.mw-empty-elt', '.navbar', '.mw-jump-link', '.noprint', '.ambox', '.mw-indicators',
].join(',');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wikiFetch(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url);
    } catch {
      res = null;
    }
    if (res?.ok) {
      try {
        return await res.json();
      } catch {
        /* "too many requests" pages are plain text: retry */
      }
    }
    if (attempt >= 2) throw new Error(res ? 'Wikipedia is busy right now. Try again in a moment.' : "Couldn't reach Wikipedia. Check your connection.");
    await sleep(500 * (attempt + 1));
  }
}

function absolutize(u: string, lang: string): string {
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `https://${lang}.wikipedia.org${u}`;
  return u;
}

/** Keep real article links clickable (as data-to="Title"), disable everything else. */
function prepareHtml(html: string, links: Set<string>, lang: string): string {
  const doc = new DOMParser().parseFromString(`<div id="wr-root">${html}</div>`, 'text/html');
  const root = doc.getElementById('wr-root')!;
  root.querySelectorAll(REMOVE).forEach((el) => el.remove());
  root.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href');
    a.removeAttribute('target');
    if (href == null) return;
    a.removeAttribute('href');
    if (href.startsWith('#')) {
      a.setAttribute('data-anchor', href.slice(1));
      return;
    }
    const t = titleFromHref(href);
    if (t && links.has(t)) a.setAttribute('data-to', t);
    else a.setAttribute('data-dead', '');
  });
  root.querySelectorAll('area').forEach((a) => a.removeAttribute('href'));
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src) img.setAttribute('src', absolutize(src, lang));
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      img.setAttribute(
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
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  });
  return root.innerHTML;
}

function textOf(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
}

async function fetchArticle(lang: string, title: string): Promise<PageData> {
  const params = new URLSearchParams({
    action: 'parse',
    format: 'json',
    formatversion: '2',
    origin: '*',
    redirects: '1',
    page: title,
    prop: 'text|links|displaytitle',
    disableeditsection: '1',
    disabletoc: '1',
    disablelimitreport: '1',
  });
  const data = await wikiFetch(`https://${lang}.wikipedia.org/w/api.php?${params}`);
  if (data.error || !data.parse) {
    throw new Error(data.error?.code === 'missingtitle' ? `Wikipedia has no page called "${title}".` : (data.error?.info ?? 'Wikipedia error'));
  }
  const p = data.parse;
  const links = new Set<string>(
    ((p.links ?? []) as { ns: number; title: string; exists?: boolean }[]).filter((l) => l.ns === 0 && l.exists).map((l) => normalizeTitle(l.title)),
  );
  const canonical = normalizeTitle(p.title);
  return {
    lang,
    title: canonical,
    displayTitle: textOf(String(p.displaytitle ?? canonical)) || canonical,
    html: prepareHtml(String(p.text ?? ''), links, lang),
    url: wikiUrl(lang, canonical),
  };
}

/** Load (or reuse) an article. Redirects are followed; `title` of the result is canonical. */
export function loadArticle(lang: string, rawTitle: string): Promise<PageData> {
  const title = normalizeTitle(rawTitle);
  const key = `${lang}:${title}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const job = fetchArticle(lang, title).then((page) => {
    if (page.title !== title) cache.set(`${lang}:${page.title}`, Promise.resolve(page));
    return page;
  });
  job.catch(() => cache.delete(key));
  cache.set(key, job);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return job;
}

let prefetching = 0;
/** Warm the cache when the pointer rests on a link, so the click feels instant. */
export function prefetchArticle(lang: string, title: string) {
  const key = `${lang}:${normalizeTitle(title)}`;
  if (cache.has(key) || prefetching >= 3) return;
  prefetching++;
  loadArticle(lang, title)
    .catch(() => {})
    .finally(() => prefetching--);
}
