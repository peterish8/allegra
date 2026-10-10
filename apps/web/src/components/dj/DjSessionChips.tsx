import { X } from 'lucide-react';
import type { CSSProperties } from 'react';

import type { DjGoal, DjSessionState } from '@shared/dj';

import { DJ_ENERGY_WORDS, djEnergyWord } from '../../lib/djSession';

export interface DjSessionChipsProps {
  readonly session: DjSessionState;
  readonly goal: DjGoal;
  /** Songs in the playlist draft, shown on the Playlist option. */
  readonly draftCount: number;
  readonly onEnergy: (energy: number) => void;
  readonly onRemoveConstraint: (constraint: string) => void;
  readonly onClearLanguage: () => void;
  readonly onGoal: (goal: DjGoal) => void;
}

const LEVELS = [1, 2, 3, 4, 5] as const;

/** What each mode does, said on the switch itself. */
const MODE_HINT: Readonly<Record<DjGoal, string>> = {
  mix: 'Changes what plays next',
  playlist: 'Builds a playlist you can save, without touching what plays'
};

/**
 * What the DJ works on and what it remembers, as one row under the prompt: a Live DJ / Playlist switch,
 * an energy control that names its level (Calm to Hype), then any language or "no …" the DJ is
 * holding, each removable. Each edit changes the session the next turn sends.
 */
export function DjSessionChips({ session, goal, draftCount, onEnergy, onRemoveConstraint, onClearLanguage, onGoal }: DjSessionChipsProps) {
  const word = djEnergyWord(session.energy);
  return (
    <ul className="dj-chips" aria-label="What your DJ works on and remembers">
      <li className="dj-mode" role="radiogroup" aria-label="What your DJ works on">
        {(['mix', 'playlist'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={goal === option}
            className="dj-mode-option"
            title={MODE_HINT[option]}
            onClick={() => { if (goal !== option) onGoal(option); }}
          >
            {option === 'mix' ? 'Live DJ' : draftCount > 0 ? `Playlist · ${draftCount}` : 'Playlist'}
          </button>
        ))}
      </li>
      <li className="dj-energy">
        <span className="dj-energy-bars" role="radiogroup" aria-label={`Energy: ${word}`}>
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={session.energy === level}
              aria-label={`${DJ_ENERGY_WORDS[level - 1]}, energy ${level} of 5`}
              title={DJ_ENERGY_WORDS[level - 1]}
              className={`dj-energy-bar${level <= session.energy ? ' is-lit' : ''}`}
              style={{ '--bar': level } as CSSProperties}
              onClick={() => onEnergy(level)}
            />
          ))}
        </span>
        <span className="dj-energy-word" aria-hidden="true">{word}</span>
      </li>
      {session.language ? (
        <li className="dj-chip">
          <span>{session.language}</span>
          <button type="button" className="dj-chip-x" onClick={onClearLanguage} aria-label={`Forget the language ${session.language}`}><X size={12} /></button>
        </li>
      ) : null}
      {session.constraints.map((constraint) => (
        <li className="dj-chip" key={constraint}>
          <span>{constraint}</span>
          <button type="button" className="dj-chip-x" onClick={() => onRemoveConstraint(constraint)} aria-label={`Drop “${constraint}”`}><X size={12} /></button>
        </li>
      ))}
    </ul>
  );
}
