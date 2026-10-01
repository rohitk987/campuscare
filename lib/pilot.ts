/** The first CampusCare rollout is one institution. Never take these values from a request. */
export const PILOT_ORG_ID = 'bmsit-pilot';
export const PILOT_ORG_NAME = 'BMSIT';
export const PILOT_DOMAINS = ['bmsit.in', 'bmsit.ac.in'] as const;
export const PILOT_ACCESS_MESSAGE = 'CampusCare is currently available only to BMSIT accounts using @bmsit.in or @bmsit.ac.in. Sign out and use your BMSIT account.';

export function normaliseEmail(email: string): string { return email.trim().toLowerCase(); }
export function isPilotEmail(email: string): boolean {
  const value = normaliseEmail(email);
  const parts = value.split('@');
  return parts.length === 2 && !!parts[0] && !/\s/.test(value) &&
    PILOT_DOMAINS.some(domain => domain === parts[1]);
}
