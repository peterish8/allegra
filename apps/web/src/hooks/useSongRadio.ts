import { useEffect, useState } from 'react';

import { fetchRadio, fetchSuggestions } from '../lib/api';
import { SongRadio, type RadioTransport } from '../lib/songRadio';

/** The shared ranking rules, fed fresh related songs throughout this listening session. */
export function useSongRadio(transportRef: { readonly current: RadioTransport }) {
  const [radio] = useState(() => new SongRadio(transportRef, {
    suggestions: (id, signal) => fetchSuggestions(id, signal, 20),
    pool: fetchRadio
  }));
  useEffect(() => () => radio.stop(), [radio]);
  return radio;
}
