import { X } from 'lucide-react';

import type { DjGoal, DjSessionState } from '@shared/dj';

export interface DjSessionChipsProps {
  readonly session: DjSessionState;
  readonly goal: DjGoal;
  /** Songs in the playlist draft, shown on the goal switch. */
  readonly draftCount: number;
  readonly onEnergy: (energy: number) => void;
  readonly onRemoveConstraint: (constraint: string) => void;
  readonly onClearLanguage: () => void;
  readonly onToggleGoal: () => void;
}

const LEVELS = [1, 2, 3, 4, 5] as const;

/**
 * What the DJ remembers, as one compact row: a dial that is both the goal switch (Mix or Playlist) and
 * the energy level, then any language or "no …" the DJ is holding, each removable. Each edit changes the
 * session the next turn sends, so "calmer" or "no Tamil" is one tap rather than a sentence.
 */
export function DjSessionChips({ session, goal, draftCount, onEnergy, onRemoveConstraint, onClearLanguage, onToggleGoal }: DjSessionChipsProps) {
  return (
    <ul className="dj-chips" aria-label="What your DJ remembers">
      <li className="dj-dial">
        <button
          type="button"
          className="dj-dial-goal"
          onClick={onToggleGoal}
          aria-label={goal === 'mix' ? 'Mix. Switch to building a playlist' : 'Playlist. Switch to a live mix'}
        >
          {goal === 'mix' ? 'Mix' : `Playlist · ${draftCount}`}
        </button>
        <span className="dj-dial-sep" aria-hidden="true" />
        <span className="dj-dial-energy" role="radiogroup" aria-label="Energy">
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={session.energy === level}
              aria-label={`Energy ${level} of 5`}
              title={`Energy ${level} of 5`}
              className={`dj-energy-dot${level <= session.energy ? ' is-lit' : ''}`}
              onClick={() => onEnergy(level)}
            />
          ))}
        </span>
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
