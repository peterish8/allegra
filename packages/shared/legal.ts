/**
 * What Allegra's policies promise, as values the code enforces. The website's policy pages, the
 * phone's sign-in step, the API and the Convex retention sweep all read these, so the text a
 * listener agreed to and the behaviour behind it cannot drift apart.
 *
 * Changing a policy in a way that needs fresh consent means moving POLICY_VERSION on.
 */

/** The date the current policies took effect. Stored with each consent. */
export const POLICY_VERSION = '2026-10-05';

/** Accounts are for adults: under India's DPDP Act everyone below 18 is a child. */
export const MINIMUM_AGE = 18;

/** A guest profile nobody has used for this long is erased. */
export const GUEST_RETENTION_DAYS = 90;

/** An account nobody has used for this long is erased. */
export const ACCOUNT_RETENTION_DAYS = 730;

/**
 * A listener who only reads moves their last-active time on at most this often (the API's
 * keepActive). The inactivity sweep adds it to every retention period, so nobody is erased
 * before the period the policy states.
 */
export const ACTIVE_TOUCH_DAYS = 7;

export const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  copyright: '/copyright'
} as const;

export type LegalDocument = keyof typeof LEGAL_PATHS;

/**
 * Who runs Allegra and who answers complaints. Shown on every policy page.
 *
 * Fill all four in before the policies are published: the IT Rules 2021 need a named grievance
 * officer, and a policy has to say who is responsible for the data. While a field is empty the
 * pages say that the details are not published yet rather than inventing any.
 */
export const OPERATOR = {
  name: '',
  address: '',
  grievanceOfficer: '',
  email: ''
} as const;

export function operatorPublished(): boolean {
  return Object.values(OPERATOR).every((value) => value.trim().length > 0);
}

/** When the listener agreed, and to which policies. */
export interface Consent {
  readonly policyVersion: string;
  /** ISO time. */
  readonly at: string;
}

/** Why someone reported a shared playlist. */
export const REPORT_REASONS = ['copyright', 'illegal', 'abuse', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}

export const REPORT_DETAILS_MAX = 1000;
export const REPORT_CONTACT_MAX = 200;
/** A closed report's contact details and message are deleted this long after it closes. */
export const REPORT_DETAIL_RETENTION_DAYS = 365;

/** Library removal markers are kept long enough for devices that have been offline to catch up. */
export const LIBRARY_TOMBSTONE_RETENTION_DAYS = 90;
