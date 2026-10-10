import { X } from 'lucide-react';
import type { CSSProperties } from 'react';

import type { DjExploration, DjGoal, DjSessionState, DjSetShape } from '@shared/dj';

import { DJ_ENERGY_WORDS, DJ_EXPLORATIONS, DJ_SHAPES, djEnergyWord, nextOption } from '../../lib/djSession';

export interface DjSessionChipsProps {
  readonly session: DjSessionState;
  readonly goal: DjGoal;
  /** Songs in the playlist draft, shown on the Playlist option. */
  readonly draftCount: number;
  readonly shape: DjSetShape;
  readonly exploration: DjExploration;
  /** Artists ruled out for this session, each removable. */
  readonly excludeArtists: readonly string[];
  readonly onEnergy: (energy: number) => void;
  readonly onRemoveConstraint: (constraint: string) => void;
  readonly onClearLanguage: () => void;
  readonly onGoal: (goal: DjGoal) => void;
  readonly onShape: (shape: DjSetShape) => void;
  readonly onExploration: (exploration: DjExploration) => void;
  readonly onAllowArtist: (name: string) => void;
}

const titleCase = (name: string): string => name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());

const LEVELS = [1, 2, 3, 4, 5] as const;

/** What each mode does, said on the switch itself. */
const MODE_HINT: Readonly<Record<DjGoal, string>> = {
  mix: 'Changes what plays next',
  playlist: 'Builds a playlist you can save, without touching what plays'
};

/**
 * What the DJ works on and what it remembers, as one row under the prompt: a Live DJ / Playlist switch,
 * an energy control that names its level (Calm to Hype), the set's planned shape and how far it
 * explores (each word cycles on a press), then any language, "no …" or ruled-out artist the DJ is
 * holding, each removable. Each edit changes the session the next turn sends.
 */
export function DjSessionChips({
  session, goal, draftCount, shape, exploration, excludeArtists,
  onEnergy, onRemoveConstraint, onClearLanguage, onGoal, onShape, onExploration, onAllowArtist
}: DjSessionChipsProps) {
  const word = djEnergyWord(session.energy);
  const shapeOption = DJ_SHAPES.find(({ value }) => value === shape) ?? DJ_SHAPES[0]!;
  const exploreOption = DJ_EXPLORATIONS.find(({ value }) => value === exploration) ?? DJ_EXPLORATIONS[1]!;
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
      <li className="dj-mode dj-set-options">
        <button
          type="button"
          className="dj-mode-option"
          title={shapeOption.hint}
          aria-label={`Set shape: ${shapeOption.label}. ${shapeOption.hint}. Press for the next shape.`}
          onClick={() => onShape(nextOption(DJ_SHAPES, shape))}
        >{shapeOption.label}</button>
        <button
          type="button"
          className="dj-mode-option"
          title={exploreOption.hint}
          aria-label={`Exploration: ${exploreOption.label}. ${exploreOption.hint}. Press for the next level.`}
          onClick={() => onExploration(nextOption(DJ_EXPLORATIONS, exploration))}
        >{exploreOption.label}</button>
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
      {excludeArtists.map((name) => (
        <li className="dj-chip" key={`no-${name}`}>
          <span>No {titleCase(name)}</span>
          <button type="button" className="dj-chip-x" onClick={() => onAllowArtist(name)} aria-label={`Allow ${titleCase(name)} again`}><X size={12} /></button>
        </li>
      ))}
    </ul>
  );
}
