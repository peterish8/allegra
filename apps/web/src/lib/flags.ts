/** Feature switches. Booleans only: NEXT_PUBLIC_* is inlined into the public bundle. */
export interface Flags {
  readonly import: boolean;
  readonly blend: boolean;
}

export const flags: Flags = {
  import: process.env.NEXT_PUBLIC_IMPORT_ENABLED === 'true',
  blend: process.env.NEXT_PUBLIC_BLEND_ENABLED === 'true'
};
