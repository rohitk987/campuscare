export type OrganisationRole = 'admin' | 'verifier' | 'technician' | 'reporter' | string;

export interface Organisation {
  id: string;
  name: string;
  type: string;
  color: string;
  demo: number;
  max_accuracy: number;
  response_hours: number;
  emergency_contact: string;
  identifier_label: string;
}

export interface Member {
  id: string;
  org_id: string;
  user_id: string | null;
  email: string;
  name: string;
  role: OrganisationRole;
  site_scope: string;
  active: number;
}

export interface Site {
  id: string;
  org_id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radius: number;
  enabled: number;
}

export interface Building {
  id: string;
  org_id: string;
  site_id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radius: number;
  confident?: boolean;
}

export interface Location {
  id: string;
  org_id: string;
  building_id: string;
  floor: string;
  name: string;
  private: number;
}

export interface Complaint {
  id: string;
  org_id: string;
  site_id: string;
  location_id: string;
  reporter_id: string;
  reporter_name: string;
  ticket_no: string;
  title: string;
  description: string;
  item: string;
  category: string;
  priority: string;
  verification: string;
  status: string;
  assignee_id: string | null;
  duplicate_id: string | null;
  reopen: string;
  visibility: string;
  session_id: string | null;
  demo: number;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
  version: number;
  building: string;
  floor: string;
  room: string;
  site: string;
  own?: boolean;
  can_view_evidence?: boolean;
}

export interface Notification {
  id: string;
  complaint_id: string;
  message: string;
  created_at: number;
  read_at: number | null;
}

export interface CampusIdentity {
  id: string;
  name: string;
  email: string;
}

export interface Workspace {
  sites: Site[];
  buildings: Building[];
  locations: Location[];
  tickets: Complaint[];
  members: Member[];
  member: Member;
  notifications: Notification[];
  following: string[];
  categories: string[];
  accessIdentity: { id: string; email: string };
}

export interface ApiError extends Error {
  status: number;
}

export interface AdminDialogConfig {
  type: 'organisation' | 'site' | 'building' | 'location' | 'member';
  record?: AdminDialogRecord;
  buildingId?: string;
}

export interface AdminDialogRecord {
  id?: string;
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
  radius?: number;
  enabled?: number;
  site_id?: string;
  floor?: string;
  private?: number;
  email?: string;
  role?: string;
  site_scope?: string;
}

export interface AccessCohort {
  id: string;
  name: string;
  admission_year: number;
  starts_at: number;
  ends_at: number;
  active: number;
}

export interface StudentAccessRecord {
  id: string;
  name: string;
  email: string;
  usn: string;
  cohort_id: string;
  cohort_name: string;
  status: string;
}

export interface StudentAccessData {
  cohorts: AccessCohort[];
  students: StudentAccessRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface StudentAccessEditorRecord {
  type: 'cohort' | 'student';
  id?: string;
  name: string;
  admissionYear?: number;
  starts?: string;
  ends?: string;
  active?: boolean;
  email?: string;
  usn?: string;
  cohortId?: string;
  status?: string;
}

export interface DetailEvent {
  id: string;
  action: string;
  actor: string;
  note: string;
  created_at: number;
}

export interface ComplaintEvidence {
  latitude: number;
  longitude: number;
  accuracy: number;
  captured_at: number;
  received_at: number;
  available: boolean;
}

export interface ComplaintDetail {
  ticket: Complaint;
  events: DetailEvent[];
  evidence: ComplaintEvidence | null;
  own: boolean;
}

export interface ReportSessionResponse {
  sessionId: string;
  candidates: Building[];
}

export interface PhotoEvidenceResponse {
  accuracy: number;
  receivedAt: number;
}

export interface SubmittedComplaintResponse {
  id: string;
}
