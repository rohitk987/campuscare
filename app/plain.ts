// Plain-language readings of the algorithm outputs, for staff who operate CampusCare day to day.
// The numbers stay available behind "How this was worked out"; these helpers say what they mean.
import type {Credibility,DuplicateMatch,PriorityFactor} from '@/lib/algorithms';

export function matchLabel(score:number){return score>=0.6?'Very likely the same':score>=0.45?'Likely the same':'Possibly the same';}

/** Why two reports look alike, in words: place, time, wording, photo, and a category warning. */
export function matchReasons(parts:DuplicateMatch['parts']){
 const out:string[]=[];
 if(parts.space>=0.999)out.push('same room');else if(parts.space>=0.5)out.push('next to each other');else if(parts.space>=0.3)out.push('same building');
 if(parts.time>=0.9)out.push('reported within a day');else if(parts.time>=0.5)out.push('within a week');
 if(parts.text>=0.4)out.push('similar wording');
 if(parts.photo!=null&&parts.photo>=0.8)out.push('same photo');else if(parts.photo)out.push('similar photo');
 if(parts.category<1)out.push('filed under different categories');
 return out;
}

function factorText(f:PriorityFactor){
 switch(f.key){
  case 'severity':return `${f.detail} faults are urgent by default`;
  case 'safety':return `Possible safety risk: ${f.detail}`;
  case 'crowd':return `Affects others: ${f.detail}`;
  case 'age':return `Waiting ${f.detail}`;
  case 'staff':return `Staff marked it ${f.detail} priority`;
  case 'credibility':return 'Reported by someone whose reports are usually confirmed';
 }
}
/** Why a complaint ranks where it does: safety words first whenever any were found, then the largest other factor. */
export function priorityReason(factors:PriorityFactor[]){
 const safety=factors.find(f=>f.key==='safety'&&f.value>0),rest=factors.filter(f=>f!==safety).sort((a,b)=>b.contribution-a.contribution);
 return [safety,rest[0]].filter((f):f is PriorityFactor=>!!f).map(factorText).join('. ');
}

export function reporterLine(c:Credibility){
 const verified=c.alpha-1,total=c.reports;
 if(!total)return 'No reviewed reports yet';
 return `${verified} of ${total} reviewed report${total===1?'':'s'} confirmed`;
}

export function technicianReason(t:{load:number;resolved:Record<string,number>},category:string){
 const done=t.resolved[category]||0;
 return `${t.load} open job${t.load===1?'':'s'}`+(done?`, has fixed ${done} ${category.toLowerCase()} problem${done===1?'':'s'} before`:'');
}

export function daysText(from:number,to:number){const n=Math.max(1,Math.round((to-from)/86_400_000));return n===1?'1 day':`${n} days`;}

/** Join a short list as "a, b and c". */
export function listText(items:string[]){return items.length<2?items.join(''):`${items.slice(0,-1).join(', ')} and ${items[items.length-1]}`;}
