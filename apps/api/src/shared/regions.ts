// GENERATED from packages/shared/regions.ts by `npm run sync:shared`. Do not edit here.
/**
 * Indian states and union territories for the regional "Top 10 today", each with the language its
 * chart is built from (one of the catalog languages in apps/api/src/lib/languages.ts). Codes are
 * ISO 3166-2:IN without the country prefix, as Vercel's `x-vercel-ip-country-region` header sends them.
 * Places whose own language the catalog does not carry chart in Hindi.
 */
export interface IndianRegion {
  readonly code: string;
  readonly name: string;
  readonly language: string;
}

export const INDIAN_REGIONS: readonly IndianRegion[] = [
  { code: 'AP', name: 'Andhra Pradesh', language: 'telugu' },
  { code: 'AR', name: 'Arunachal Pradesh', language: 'hindi' },
  { code: 'AS', name: 'Assam', language: 'assamese' },
  { code: 'BR', name: 'Bihar', language: 'bhojpuri' },
  { code: 'CG', name: 'Chhattisgarh', language: 'hindi' },
  { code: 'GA', name: 'Goa', language: 'hindi' },
  { code: 'GJ', name: 'Gujarat', language: 'gujarati' },
  { code: 'HR', name: 'Haryana', language: 'haryanvi' },
  { code: 'HP', name: 'Himachal Pradesh', language: 'hindi' },
  { code: 'JH', name: 'Jharkhand', language: 'hindi' },
  { code: 'KA', name: 'Karnataka', language: 'kannada' },
  { code: 'KL', name: 'Kerala', language: 'malayalam' },
  { code: 'MP', name: 'Madhya Pradesh', language: 'hindi' },
  { code: 'MH', name: 'Maharashtra', language: 'marathi' },
  { code: 'MN', name: 'Manipur', language: 'hindi' },
  { code: 'ML', name: 'Meghalaya', language: 'english' },
  { code: 'MZ', name: 'Mizoram', language: 'english' },
  { code: 'NL', name: 'Nagaland', language: 'english' },
  { code: 'OD', name: 'Odisha', language: 'odia' },
  { code: 'PB', name: 'Punjab', language: 'punjabi' },
  { code: 'RJ', name: 'Rajasthan', language: 'rajasthani' },
  { code: 'SK', name: 'Sikkim', language: 'hindi' },
  { code: 'TN', name: 'Tamil Nadu', language: 'tamil' },
  { code: 'TG', name: 'Telangana', language: 'telugu' },
  { code: 'TR', name: 'Tripura', language: 'bengali' },
  { code: 'UP', name: 'Uttar Pradesh', language: 'hindi' },
  { code: 'UK', name: 'Uttarakhand', language: 'hindi' },
  { code: 'WB', name: 'West Bengal', language: 'bengali' },
  { code: 'AN', name: 'Andaman and Nicobar Islands', language: 'hindi' },
  { code: 'CH', name: 'Chandigarh', language: 'punjabi' },
  { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu', language: 'gujarati' },
  { code: 'DL', name: 'Delhi', language: 'hindi' },
  { code: 'JK', name: 'Jammu and Kashmir', language: 'urdu' },
  { code: 'LA', name: 'Ladakh', language: 'hindi' },
  { code: 'LD', name: 'Lakshadweep', language: 'malayalam' },
  { code: 'PY', name: 'Puducherry', language: 'tamil' }
];

/** Older ISO codes that some lookups still send. */
const ALIASES: Readonly<Record<string, string>> = { OR: 'OD', CT: 'CG', TS: 'TG', UT: 'UK', DN: 'DH', DD: 'DH' };

/** The region for a code like "TN" or "in-tn" (any case), or null. */
export function regionByCode(value: unknown): IndianRegion | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toUpperCase().replace(/^IN-/, '');
  const code = ALIASES[raw] ?? raw;
  return INDIAN_REGIONS.find((region) => region.code === code) ?? null;
}
