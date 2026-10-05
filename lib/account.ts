/** CampusCare identities come from verified mailbox sessions, never platform headers. */
export type CampusUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};
