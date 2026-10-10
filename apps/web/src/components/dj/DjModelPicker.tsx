import { useState } from 'react';

import type { DjModelOption } from '../../lib/djSession';

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

  return (
    <div className="dj-model-picker">
      <label>{label}
        <select
          value={selected}
          onChange={(event) => {
            const next = event.target.value;
            if (next === OTHER) { setTyping(true); return; }
            setTyping(false);
            onChange(next);
          }}
        >
          {defaultLabel !== undefined ? <option value="">{defaultLabel}</option> : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.note ? `${option.label} · ${option.note}` : option.label}</option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
      </label>
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
