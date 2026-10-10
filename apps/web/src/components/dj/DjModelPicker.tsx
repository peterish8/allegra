import { useState } from 'react';

import type { DjModelOption } from '../../lib/djSession';
import { DjSelect, type DjSelectOption } from './DjSelect';

const OTHER = '__other__';

export interface DjModelPickerProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly DjModelOption[];
  readonly onChange: (value: string) => void;
  /** The choice for an empty value, the provider's own default ("Default · coral"). Omit when a value is required. */
  readonly defaultLabel?: string;
  readonly placeholder: string;
  readonly maxLength: number;
}

/**
 * A model (or voice) dropdown: named choices with a short note, and "Other…" for any ID the provider
 * takes, which opens a text field. Give it a `key` per provider so switching provider resets it.
 */
export function DjModelPicker({ label, value, options, onChange, defaultLabel, placeholder, maxLength }: DjModelPickerProps) {
  const listed = value === '' ? defaultLabel !== undefined : options.some((option) => option.id === value);
  const [typing, setTyping] = useState(!listed);
  const selected = typing || !listed ? OTHER : value;

  const choices: DjSelectOption<string>[] = [
    ...(defaultLabel !== undefined ? [{ value: '', label: defaultLabel }] : []),
    ...options.map((option) => ({ value: option.id, label: option.label, ...(option.note ? { note: option.note } : {}) })),
    { value: OTHER, label: 'Other…', note: 'type any model ID' }
  ];

  return (
    <div className="dj-model-picker">
      <DjSelect
        label={label}
        value={selected}
        options={choices}
        onChange={(next) => {
          if (next === OTHER) { setTyping(true); return; }
          setTyping(false);
          onChange(next);
        }}
      />
      {selected === OTHER ? (
        <input
          aria-label={`${label}: type an ID`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLength}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
        />
      ) : null}
    </div>
  );
}
