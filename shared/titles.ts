/**
 * Wikipedia title helpers. MediaWiki treats "united_kingdom", "United kingdom " and
 * "United_kingdom#History" as links to the same page as "United kingdom" (first letter is
 * case-insensitive, underscores are spaces, fragments are ignored). Both the client and
 * the server compare titles through normalizeTitle().
 */
export function normalizeTitle(raw: string): string {
  let t = String(raw ?? '');
  const hash = t.indexOf('#');
  if (hash >= 0) t = t.slice(0, hash);
  t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const first = String.fromCodePoint(t.codePointAt(0)!);
  return first.toUpperCase() + t.slice(first.length);
}

/** Title from a "/wiki/Some_Page#frag" href (percent-encoded). Empty string if not an article href. */
export function titleFromHref(href: string): string {
  const m = /^\/wiki\/([^?#]+)/.exec(href);
  if (!m) return '';
  try {
    return normalizeTitle(decodeURIComponent(m[1]));
  } catch {
    return '';
  }
}

export function sameTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeTitle(a) === normalizeTitle(b);
}

export function wikiUrl(lang: string, title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(normalizeTitle(title).replace(/ /g, '_'))}`;
}
