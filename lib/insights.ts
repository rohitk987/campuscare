import {all} from './server';
import {betaReputation,duplicatePairs,findDuplicates,photoReuse,priorityScore,stDbscan,suggestAssignments,weeklyTrend,isPhotoHash} from './algorithms';
import type {AssignmentJob,AssignmentTechnician,Credibility,DuplicateMatch,PriorityInput,PriorityResult,ReportLike,SpatioTemporalPoint} from './algorithms';
import type {Building,Complaint,Member,Organisation} from './models';

/** Everything the algorithms need about one complaint, gathered server-side. */
export type AnalysedTicket = {
 id: string; ticketNo: string; title: string; category: string; status: string; verification: string;
 buildingId: string | null; latitude: number | null; longitude: number | null; photoHash: string | null; hasPhoto: boolean;
 reporterId: string; reporterName: string; priorityInput: PriorityInput; priority: PriorityResult; credibility: Credibility;
};
export type WorkspaceAnalysis = {
 tickets: Record<string, AnalysedTicket>;
 reports: ReportLike[];
 points: SpatioTemporalPoint[];
 jobs: AssignmentJob[];
 technicians: AssignmentTechnician[];
 reporters: { id: string; name: string; verified: number; rejected: number; credibility: Credibility }[];
};

type EvidenceRow = { id: string; latitude: number | null; longitude: number | null; photo_hash: string | null; has_photo: number };
type CountRow = { id: string; n: number };
type HistoryRow = { reporter_id: string; verified: number; rejected: number };
type LoadRow = { assignee_id: string; open: number };
type ResolvedRow = { assignee_id: string; category: string; n: number };

const OPEN = ['resolved', 'closed'];
const isOpen = (t: Pick<Complaint, 'status' | 'verification'>) => !OPEN.includes(t.status) && !['duplicate', 'not_confirmed'].includes(t.verification);

/**
 * Gather evidence, crowd and history signals for the tickets the viewer may see, then score them.
 * Callers decide what to reveal: priority score and band to everyone with access to the ticket,
 * the factor breakdown, credibility, duplicates and photo reuse to reviewers only.
 */
export async function analyseWorkspace(orgId: string, org: Pick<Organisation, 'response_hours'>, tickets: (Complaint & { assignee_name?: string | null })[], buildings: Building[], members: Member[], now = Date.now()): Promise<WorkspaceAnalysis> {
 const ids = JSON.stringify(tickets.map(t => t.id)), sessions = JSON.stringify(tickets.map(t => t.session_id).filter(Boolean));
 const [evidence, followers, duplicates, history, loads, resolved] = await Promise.all([
  all<EvidenceRow>('SELECT id,latitude,longitude,photo_hash,image_key IS NOT NULL has_photo FROM report_sessions WHERE org_id=? AND id IN (SELECT value FROM json_each(?))', orgId, sessions),
  all<CountRow>('SELECT complaint_id id,COUNT(*) n FROM followers WHERE org_id=? AND complaint_id IN (SELECT value FROM json_each(?)) GROUP BY complaint_id', orgId, ids),
  all<CountRow>('SELECT duplicate_id id,COUNT(*) n FROM complaints WHERE org_id=? AND duplicate_id IN (SELECT value FROM json_each(?)) GROUP BY duplicate_id', orgId, ids),
  all<HistoryRow>("SELECT reporter_id,SUM(verification='verified') verified,SUM(verification='not_confirmed') rejected FROM complaints WHERE org_id=? GROUP BY reporter_id", orgId),
  all<LoadRow>("SELECT assignee_id,COUNT(*) open FROM complaints WHERE org_id=? AND assignee_id IS NOT NULL AND status IN ('assigned','in_progress','on_hold') GROUP BY assignee_id", orgId),
  all<ResolvedRow>("SELECT assignee_id,category,COUNT(*) n FROM complaints WHERE org_id=? AND assignee_id IS NOT NULL AND status IN ('resolved','closed') GROUP BY assignee_id,category", orgId),
 ]);
 const bySession = new Map(evidence.map(e => [e.id, e])), byBuilding = new Map(buildings.map(b => [b.name + '|' + b.site_id, b]));
 const followerCount = new Map(followers.map(r => [r.id, r.n])), duplicateCount = new Map(duplicates.map(r => [r.id, r.n]));
 const credibility = new Map(history.map(h => [h.reporter_id, { ...h, credibility: betaReputation(h.verified, h.rejected) }]));
 const analysed: Record<string, AnalysedTicket> = {}, captured = new Map<string, { latitude: number; longitude: number }>();
 for (const t of tickets) {
  const e = t.session_id ? bySession.get(t.session_id) : undefined, b = byBuilding.get(t.building + '|' + t.site_id);
  // The map falls back to the building centre; duplicate matching uses only a real capture point.
  if (e?.latitude != null && e?.longitude != null) captured.set(t.id, { latitude: e.latitude, longitude: e.longitude });
  const latitude = e?.latitude ?? b?.latitude ?? null, longitude = e?.longitude ?? b?.longitude ?? null;
  const cred = credibility.get(t.reporter_id)?.credibility || betaReputation(0, 0);
  const priorityInput: PriorityInput = {
   category: t.category, text: `${t.title} ${t.item} ${t.description}`, reports: 1 + (duplicateCount.get(t.id) || 0), followers: followerCount.get(t.id) || 0,
   ageHours: Math.max(0, (now - t.created_at) / 3_600_000), reviewHours: org.response_hours,
   staffPriority: t.verification === 'verified' ? t.priority : null, credibility: cred.reports ? cred.score : null, open: isOpen(t),
  };
  analysed[t.id] = {
   id: t.id, ticketNo: t.ticket_no, title: t.title, category: t.category, status: t.status, verification: t.verification,
   buildingId: b?.id || null, latitude, longitude, photoHash: isPhotoHash(e?.photo_hash) ? e!.photo_hash : null, hasPhoto: !!e?.has_photo,
   reporterId: t.reporter_id, reporterName: t.reporter_name, priorityInput, priority: priorityScore(priorityInput), credibility: cred,
  };
 }
 const reports: ReportLike[] = tickets.map(t => ({ id: t.id, title: t.title, item: t.item, description: t.description, category: t.category, locationId: t.location_id, buildingId: analysed[t.id].buildingId, createdAt: t.created_at, latitude: captured.get(t.id)?.latitude ?? null, longitude: captured.get(t.id)?.longitude ?? null, photoHash: analysed[t.id].photoHash }));
 const points: SpatioTemporalPoint[] = tickets.filter(t => analysed[t.id].latitude != null && analysed[t.id].longitude != null)
  .map(t => ({ id: t.id, latitude: analysed[t.id].latitude!, longitude: analysed[t.id].longitude!, time: t.created_at, category: t.category, buildingId: analysed[t.id].buildingId || undefined }));
 const jobs: AssignmentJob[] = tickets.filter(t => t.verification === 'verified' && t.status === 'awaiting_assignment').map(t => ({ id: t.id, category: t.category, siteId: t.site_id, priority: analysed[t.id].priority.score }));
 const staff = members.filter(m => m.active && m.role === 'technician');
 const pool = staff.length ? staff : members.filter(m => m.active && m.role === 'admin');
 const openLoad = new Map(loads.map(l => [l.assignee_id, l.open]));
 // Site scope is enforced inside suggestAssignments: an out-of-scope slot is infeasible.
 const technicians: AssignmentTechnician[] = pool.map(m => ({ id: m.id, name: m.name, load: openLoad.get(m.id) || 0, resolved: Object.fromEntries(resolved.filter(r => r.assignee_id === m.id).map(r => [r.category, r.n])), sites: m.role === 'admin' || m.site_scope === '*' ? '*' : m.site_scope.split(',') }));
 const names = new Map(tickets.map(t => [t.reporter_id, t.reporter_name]));
 const reporters = [...credibility.entries()].filter(([id]) => names.has(id)).map(([id, h]) => ({ id, name: names.get(id)!, verified: h.verified, rejected: h.rejected, credibility: h.credibility }));
 return { tickets: analysed, reports, points, jobs, technicians, reporters };
}

/** Reviewer-only detail for one complaint: priority breakdown, likely duplicates, photo reuse, credibility, suggested technician. */
export function ticketInsight(analysis: WorkspaceAnalysis, id: string) {
 const self = analysis.tickets[id], query = analysis.reports.find(r => r.id === id);
 if (!self || !query) return null;
 const duplicates: (DuplicateMatch & { ticketNo: string; title: string; status: string })[] = findDuplicates(query, analysis.reports, { limit: 3 })
  .map(m => ({ ...m, ticketNo: analysis.tickets[m.id].ticketNo, title: analysis.tickets[m.id].title, status: analysis.tickets[m.id].status }));
 const reuse = photoReuse(analysis.reports).filter(p => p.a === id || p.b === id).map(p => { const other = p.a === id ? p.b : p.a; return { id: other, ticketNo: analysis.tickets[other].ticketNo, distance: p.distance }; });
 const plan = analysis.jobs.some(j => j.id === id) ? suggestAssignments(analysis.jobs, analysis.technicians) : null;
 const suggestion = plan?.suggestions.find(s => s.jobId === id) || null;
 return { priority: self.priority, credibility: self.credibility, duplicates, reuse, suggestion, photoHash: self.photoHash };
}

/** Reviewer-only workspace summary for the Insights page. The page recomputes from the inputs when its controls move. */
export function workspaceInsights(analysis: WorkspaceAnalysis, tickets: Complaint[], now = Date.now()) {
 return {
  generatedAt: now,
  tickets: Object.values(analysis.tickets).map(t => ({ id: t.id, ticketNo: t.ticketNo, title: t.title, category: t.category, status: t.status, verification: t.verification, reporterName: t.reporterName, priorityInput: t.priorityInput, priority: t.priority, credibility: t.credibility, latitude: t.latitude, longitude: t.longitude, hasPhoto: t.hasPhoto })),
  reports: analysis.reports, points: analysis.points, jobs: analysis.jobs, technicians: analysis.technicians, reporters: analysis.reporters,
  hotspots: stDbscan(analysis.points).hotspots,
  duplicates: duplicatePairs(analysis.reports).slice(0, 25),
  reuse: photoReuse(analysis.reports),
  assignments: suggestAssignments(analysis.jobs, analysis.technicians),
  trend: weeklyTrend(tickets.map(t => ({ createdAt: t.created_at, resolvedAt: t.resolved_at })), 8, now),
 };
}
