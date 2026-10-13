'use client';

export class AccessRequestError extends Error {
 status: number;

 constructor(message: string, status: number) {
  super(message);
  this.name = 'AccessRequestError';
  this.status = status;
 }
}

export type AccessStatus = {
 configured?: boolean;
 verified?: boolean;
 userId?: string;
 email?: string;
 [key: string]: unknown;
};

export async function accessAction(action: string, data: Record<string, unknown> = {}) {
 const response = await fetch('/api/access', {
  method: 'POST',
  headers: {'Content-Type': 'application/json', 'X-Campuscare-Request': '1'},
  body: JSON.stringify({action, ...data}),
 });
 const result = await response.json() as Record<string, unknown>;
 if (!response.ok) {
  throw new AccessRequestError(typeof result.error === 'string' ? result.error : 'The request could not be completed.', response.status);
 }
 return result;
}

export async function accessStatus(): Promise<AccessStatus> {
 const response = await fetch('/api/access?op=status', {cache: 'no-store'});
 const result = await response.json() as Record<string, unknown>;
 if (!response.ok) {
  throw new AccessRequestError(typeof result.error === 'string' ? result.error : 'Access could not be checked.', response.status);
 }
 return result as AccessStatus;
}

export async function signOut(): Promise<void> {
 await accessAction('logout');
 // A full reload clears any workspace state that may still be held in the client tree.
 // eslint-disable-next-line @next/next/no-location-assign-relative-destination
 window.location.assign('/');
}
