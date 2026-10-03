import {all} from './server';

type Viewer={userId:string;role:string;memberId:string;siteIds:string[]};
type ComplaintRow=Record<string,unknown>&{id:string;created_at:number};
const batchSize=100;
const selection=`SELECT c.*,l.name room,l.floor,b.name building,s.name site,m.name assignee_name
 FROM complaints c
 JOIN locations l ON l.id=c.location_id AND l.org_id=c.org_id
 JOIN buildings b ON b.id=l.building_id AND b.org_id=c.org_id
 JOIN sites s ON s.id=c.site_id AND s.org_id=c.org_id
 LEFT JOIN members m ON m.id=c.assignee_id AND m.org_id=c.org_id
 WHERE c.org_id=? AND c.site_id IN (SELECT value FROM json_each(?))
 AND (c.reporter_id=? OR ? IN ('admin','verifier') OR (?='technician' AND c.assignee_id=?) OR c.visibility='shared')`;

/** Keep the full-history workspace contract shared by the web and native clients.
 * Apply authorization before reading, then exhaust bounded database batches.
 * The unique ID tie-breaker prevents lost/duplicated rows with equal timestamps.
 */
export async function visibleComplaints(orgId:string,viewer:Viewer){
 if(!viewer.siteIds.length)return [];
 const tickets:ComplaintRow[]=[];
 let cursor:Pick<ComplaintRow,'id'|'created_at'>|undefined;
 for(;;){
  const cursorFilter=cursor?' AND (c.created_at<? OR (c.created_at=? AND c.id<?))':'';
  const params=[orgId,JSON.stringify(viewer.siteIds),viewer.userId,viewer.role,viewer.role,viewer.memberId,
   ...(cursor?[cursor.created_at,cursor.created_at,cursor.id]:[])];
  const batch=await all(selection+cursorFilter+' ORDER BY c.created_at DESC,c.id DESC LIMIT '+batchSize,...params) as ComplaintRow[];
  tickets.push(...batch);
  if(batch.length<batchSize)return tickets;
  const last=batch[batch.length-1];cursor={id:last.id,created_at:last.created_at};
 }
}
