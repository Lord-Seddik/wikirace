import { useState } from 'react';
import { DIFFICULTIES, DIFFICULTY_INFO, LANGS, THEMES, type Difficulty, type ThemeId } from '../../shared/constants';
import { PagePicker } from '../components/PagePicker';
import { Button, Card, Field, Segmented } from '../components/ui';
import { toast, useTitle } from '../lib/misc';
import { startRace } from '../lib/races';
import { storageGet, storageSet } from '../lib/store';

export function SoloPage() {
  useTitle('Solo race');
  const [lang, setLang] = useState(() => storageGet('wr_lang') ?? 'en');
  const [difficulty, setDifficulty] = useState<Difficulty>(() => (storageGet('wr_diff') as Difficulty) ?? 'medium');
  const [theme, setTheme] = useState<ThemeId>('any');
  const [custom, setCustom] = useState(false);
  const [start, setStart] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    storageSet('wr_lang', lang);
    storageSet('wr_diff', difficulty);
    if (custom && (!start || !target)) return toast('Pick both a start and a target page.', 'bad');
    setBusy(true);
    try {
      await startRace(custom ? { mode: 'solo', lang, start, target } : { mode: 'solo', lang, difficulty, theme });
    } catch (e) {
      toast((e as Error).message, 'bad');
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <span className="eyebrow">Practice</span>
          <h1>Solo race</h1>
          <p className="muted">Race against the clock. Results count for your stats, XP and achievements.</p>
        </div>
      </header>
      <Card>
        <div className="form-grid">
          <Field label="Wikipedia language">
            <select className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pages">
            <Segmented
              value={custom ? 'custom' : 'random'}
              onChange={(v) => setCustom(v === 'custom')}
              options={[
                { value: 'random', label: '🎲 Pick for me' },
                { value: 'custom', label: '✍️ I choose' },
              ]}
            />
          </Field>
        </div>

        {!custom ? (
          <>
            <div className="field">
              <span className="field-label">Difficulty</span>
              <div className="choice-grid">
                {DIFFICULTIES.map((d) => (
                  <button key={d} className={`choice${difficulty === d ? ' on' : ''}`} onClick={() => setDifficulty(d)}>
                    <span className="choice-icon">{DIFFICULTY_INFO[d].icon}</span>
                    <b>{DIFFICULTY_INFO[d].label}</b>
                    <small>{DIFFICULTY_INFO[d].blurb}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Target theme</span>
              <div className="chips">
                {THEMES.map((t) => (
                  <button key={t.id} className={`chip${theme === t.id ? ' on' : ''}`} onClick={() => setTheme(t.id)}>
                    {t.icon} {t.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="form-grid">
            <PagePicker lang={lang} value={start} onChange={setStart} label="Start page" placeholder="e.g. Pizza" />
            <PagePicker lang={lang} value={target} onChange={setTarget} label="Target page" placeholder="e.g. Moon" />
          </div>
        )}
        <div className="form-actions">
          <Button variant="primary" size="lg" onClick={go} loading={busy}>
            ▶ Start race
          </Button>
          <span className="muted small">The timer starts as soon as the first page loads.</span>
        </div>
      </Card>
    </div>
  );
}
