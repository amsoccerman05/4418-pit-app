// Verified: TBA OpenAPI 3.26.0; Nexus OpenAPI 1.8.0. No credentials in normalized data.
export type Match = {key:string;label:string;level:string;number:number;set:number;red:string[];blue:string[];alliance:'red'|'blue';scheduled:number|null;predicted:number|null;actual:number|null;completed:boolean;redScore:number|null;blueScore:number|null;winner:string};
export type LiveMatch = {label:string;status:string;red:string[];blue:string[];queue:number|null;estimated:number|null;committed:number|null;replayOf:string|null};
const time=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;
const teams=(v:unknown)=>Array.isArray(v)?v.filter(x=>typeof x==='string').map(x=>x.replace(/^frc/,'')):[];
export function parseMatches(raw:unknown,event:string,team:number):Match[]{
 if(!Array.isArray(raw))throw new Error('Invalid TBA match response');
 return raw.filter(m=>m?.event_key===event&&typeof m.key==='string'&&m.key.startsWith(event+'_')&&['qm','ef','qf','sf','f'].includes(m.comp_level)&&[...teams(m.alliances?.red?.team_keys),...teams(m.alliances?.blue?.team_keys)].includes(String(team))).map(m=>{
  const red=teams(m.alliances.red.team_keys),blue=teams(m.alliances.blue.team_keys);
  const score=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
  const redScore=score(m.alliances.red.score),blueScore=score(m.alliances.blue.score);
  return {key:m.key,label:m.comp_level==='qm'?`Q${m.match_number}`:`${m.comp_level.toUpperCase()}${m.set_number}–${m.match_number}`,level:m.comp_level,number:m.match_number,set:m.set_number,red,blue,alliance:red.includes(String(team))?'red':'blue',scheduled:time(m.time)?m.time*1000:null,predicted:time(m.predicted_time)?m.predicted_time*1000:null,actual:time(m.actual_time)?m.actual_time*1000:null,completed:redScore!==null&&blueScore!==null,redScore,blueScore,winner:['red','blue'].includes(m.winning_alliance)?m.winning_alliance:''} as Match;
 }).sort((a,b)=>(['qm','ef','qf','sf','f'].indexOf(a.level)-['qm','ef','qf','sf','f'].indexOf(b.level))||a.set-b.set||a.number-b.number);
}
export function parseNexus(raw:any,event:string,team:number){
 if(!raw||raw.eventKey!==event||!Array.isArray(raw.matches)||!time(raw.dataAsOfTime))throw new Error('Invalid Nexus event response');
 const matches:LiveMatch[]=raw.matches.filter((m:any)=>[...teams(m.redTeams),...teams(m.blueTeams)].includes(String(team))).map((m:any)=>({label:String(m.label||''),status:['Queuing soon','Now queuing','On deck','On field'].includes(m.status)?m.status:'Status unavailable',red:teams(m.redTeams),blue:teams(m.blueTeams),queue:time(m.times?.estimatedQueueTime),estimated:time(m.times?.estimatedStartTime),committed:time(m.times?.actualCommitTime),replayOf:typeof m.replayOf==='string'?m.replayOf:null}));
 return {asOf:raw.dataAsOfTime as number,nowQueuing:typeof raw.nowQueuing==='string'?raw.nowQueuing:null,matches,announcements:(Array.isArray(raw.announcements)?raw.announcements:[]).filter((a:any)=>typeof a.announcement==='string').slice(-10).map((a:any)=>({id:String(a.id),text:a.announcement.slice(0,3000),at:time(a.postedTime)}))};
}
// Nexus labels are not stable TBA IDs. Only join unambiguous qualification/final
// labels with matching alliances; never guess playoff/replay correspondence.
export function liveFor(m:Match,live:LiveMatch[]){
 const label=m.level==='qm'?`Qualification ${m.number}`:m.level==='f'?`Final ${m.number}`:null;
 const equal=(a:string[],b:string[])=>[...a].sort().join(',')===[...b].sort().join(',');
 const candidates=live.filter(n=>label&&n.label===label&&!n.replayOf&&equal(m.red,n.red)&&equal(m.blue,n.blue));
 return candidates.length===1?candidates[0]:null;
}
export const nextMatch=(matches:Match[])=>matches.find(m=>!m.completed&&!m.actual)??null;
export function operationalReadiness(issues:{status:string;severity:string}[],items:{blocking:boolean;required:boolean;completed_at:string|null}[],hasPre:boolean){
 if(issues.some(i=>i.status!=='RESOLVED'&&i.severity==='ROBOT DOWN')||items.some(i=>i.blocking&&!i.completed_at))return 'NOT READY';
 if(!hasPre||items.some(i=>i.required&&!i.completed_at)||issues.some(i=>i.status!=='RESOLVED'&&i.severity==='HIGH'))return 'NEEDS ATTENTION';
 return 'READY';
}
