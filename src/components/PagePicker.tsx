import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../../shared/types';
import { api, qs } from '../lib/api';
import { toast, useDebounced } from '../lib/misc';

/** Wikipedia article search box (autocomplete) with a 🎲 random button. */
export function PagePicker({
  lang,
  value,
  onChange,
  placeholder,
  label,
}: {
  lang: string;
  value: string;
  onChange: (title: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const [text, setText] = useState(value);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rolling, setRolling] = useState(false);
  const q = useDebounced(text, 220);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value), [value]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    api<SearchHit[]>(`/api/wiki/search?${qs({ lang, q })}`, { signal: ctrl.signal, auth: false })
      .then((h) => {
        setHits(h);
        setActive(0);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [q, lang, open]);

  useEffect(() => {
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const choose = (title: string) => {
    setText(title);
    onChange(title);
    setOpen(false);
  };

  const random = async () => {
    setRolling(true);
    try {
      const r = await api<{ title: string }>(`/api/wiki/random?${qs({ lang })}`, { auth: false });
      choose(r.title);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setRolling(false);
    }
  };

  return (
    <div className="picker" ref={box}>
      {label && <span className="field-label">{label}</span>}
      <div className="picker-row">
        <input
          className="input"
          value={text}
          placeholder={placeholder ?? 'Search Wikipedia…'}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (!e.target.value) onChange('');
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => text !== value && onChange(text.trim())}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(hits.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (hits[active]) choose(hits[active].title);
              else choose(text.trim());
            } else if (e.key === 'Escape') setOpen(false);
          }}
          aria-autocomplete="list"
        />
        <button type="button" className="icon-btn" onClick={random} disabled={rolling} title="Random article">
          {rolling ? '…' : '🎲'}
        </button>
      </div>
      {open && hits.length > 0 && (
        <ul className="picker-list" role="listbox">
          {hits.map((h, i) => (
            <li key={h.title} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onPointerDown={(e) => (e.preventDefault(), choose(h.title))}>
              {h.thumbnail ? <img src={h.thumbnail} alt="" /> : <span className="picker-ph">📄</span>}
              <span>
                <b>{h.title}</b>
                {h.description && <small>{h.description}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
