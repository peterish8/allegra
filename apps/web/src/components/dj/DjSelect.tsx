import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export interface DjSelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** A short second line ("tested with the DJ · cheap"). */
  readonly note?: string;
}

export interface DjSelectProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly DjSelectOption<T>[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}

/** More choices than this and the open list gets a search field (an endpoint can list ~800 models). */
const SEARCH_FROM = 12;

/**
 * The DJ settings' dropdown, in the page's own glass instead of the browser's menu. A button that
 * opens a listbox: arrows, Home/End and a typed letter move, Enter or Space picks, Escape closes and
 * returns focus, a tap outside closes. A long list opens with a search field that filters as you type.
 */
export function DjSelect<T extends string>({ label, value, options, onChange, disabled }: DjSelectProps<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchable = options.length > SEARCH_FROM;
  const selected = options.find((option) => option.value === value) ?? options[0];

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => `${option.label} ${option.note ?? ''} ${option.value}`.toLowerCase().includes(needle));
  }, [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    (searchRef.current ?? listRef.current)?.focus({ preventScroll: true });
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const show = (): void => {
    setQuery('');
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };
  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const choose = (index: number): void => {
    const option = shown[index];
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    close();
  };

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show();
    }
  };

  /** Shared by the list and the search field; in the search field, letters and Space type. */
  const onListKey = (event: KeyboardEvent<HTMLElement>, typing: boolean): void => {
    const last = shown.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((index) => Math.min(last, index + 1)),
      ArrowUp: () => setActive((index) => Math.max(0, index - 1)),
      Enter: () => choose(active),
      Escape: close,
      Tab: () => setOpen(false),
      ...(typing ? {} : { Home: () => setActive(0), End: () => setActive(last), ' ': () => choose(active) })
    };
    const run = keys[event.key];
    if (run) {
      if (event.key !== 'Tab') event.preventDefault();
      // Escape closes this list only, not the sheet or dialog around it.
      if (event.key === 'Escape') event.stopPropagation();
      run();
      return;
    }
    // Without a search field, a typed letter jumps to the next choice that starts with it.
    if (!typing && event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase();
      const order = [...shown.keys()].map((offset) => (active + 1 + offset) % shown.length);
      const match = order.find((index) => shown[index]?.label.toLowerCase().startsWith(letter));
      if (match !== undefined) setActive(match);
    }
  };

  const activeId = shown[active] ? `${id}-option-${active}` : undefined;
  return (
    <div className={`dj-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <span className="dj-select__label" id={`${id}-label`}>{label}</span>
      <button
        ref={buttonRef}
        type="button"
        id={`${id}-button`}
        className="dj-select__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-labelledby={`${id}-label ${id}-button`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onButtonKey}
      >
        <span className="dj-select__value">{selected?.label ?? ''}</span>
        <ChevronDown size={14} aria-hidden="true" className="dj-select__chevron" />
      </button>
      {open ? (
        <div className="dj-select__pop">
          {searchable ? (
            <div className="dj-select__search">
              <Search size={13} aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActive(0); }}
                onKeyDown={(event) => onListKey(event, true)}
                placeholder={`Search ${options.length} choices`}
                aria-label={`Search ${label.toLowerCase()}`}
                aria-controls={`${id}-list`}
                aria-activedescendant={activeId}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          ) : null}
          <ul
            ref={listRef}
            id={`${id}-list`}
            className="dj-select__list"
            role="listbox"
            tabIndex={-1}
            aria-labelledby={`${id}-label`}
            aria-activedescendant={activeId}
            onKeyDown={(event) => onListKey(event, false)}
          >
            {shown.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                className={`dj-select__option${index === active ? ' is-active' : ''}`}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span className="dj-select__text">
                  <span>{option.label}</span>
                  {option.note ? <small>{option.note}</small> : null}
                </span>
                {option.value === value ? <Check size={14} aria-hidden="true" className="dj-select__check" /> : null}
              </li>
            ))}
            {shown.length === 0 ? <li className="dj-select__empty" role="presentation">Nothing matches “{query}”.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
