/** Feature switches. Booleans only: NEXT_PUBLIC_* is inlined into the public bundle. */
export interface Flags {
  readonly import: boolean;
  readonly blend: boolean;
  /** `/dev/quick-picks`, the local LightFM comparison. Development builds only. */
  readonly quickPicksPreview?: boolean;
}

export const flags: Flags = {
  import: process.env.NEXT_PUBLIC_IMPORT_ENABLED === 'true',
  blend: process.env.NEXT_PUBLIC_BLEND_ENABLED === 'true',
  quickPicksPreview: process.env.NODE_ENV !== 'production'
};
