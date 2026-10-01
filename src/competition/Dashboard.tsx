import {canWork,type Data,type Profile} from '../model';
import {liveFor,nextMatch,type Competition,type Context} from './service';
const at=(n:number|null)=>n?new Date(n).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Not published';
export function CompetitionDashboard({c,d,data,profile,readiness,open,openIssue,batteryAction,go,report}:{c:Competition;d:Context;data:Data;profile:Profile;readiness:string;open:(key:string)=>void;openIssue:(id:string)=>void;batteryAction:(id:string)=>void;go:(page:any)=>void;report:()=>void}){
 const matches=c.feed?.matches||[],next=nextMatch(matches),team=d.config?.team_number||4418;
 const live=c.liveAvailable?c.feed?.nexus:null,n=next&&live?liveFor(next,live.matches):null;
 const ops=d.matches.find(o=>o.match_key===next?.key),battery=data.batteries.find(b=>b.id===ops?.battery_id);
 const pre=d.runs.filter(r=>r.match_id===ops?.id&&r.kind==='pre'),preItems=d.items.filter(i=>pre.some(r=>r.id===i.run_id));
 const incomplete=d.items.filter(i=>!i.completed_at&&(i.required||i.blocking));
 const active=data.events.find(e=>e.status==='active'),issues=data.issues.filter(i=>i.event_id===active?.id&&i.status!=='RESOLVED'),blocking=issues.filter(i=>i.severity==='ROBOT DOWN');
 const last=matches.filter(m=>m.completed).at(-1),lastOps=d.matches.find(o=>o.match_key===last?.key),post=d.runs.filter(r=>r.match_id===lastOps?.id&&r.kind==='post');
 const postPending=!!last&&(!post.length||d.items.some(i=>post.some(r=>r.id===i.run_id)&&(i.required||i.blocking)&&!i.completed_at));
 const attention=issues.some(i=>['ROBOT DOWN','HIGH'].includes(i.severity))||incomplete.length>0||!!next&&(!battery||!['READY','ON ROBOT'].includes(battery.status)||!pre.length)||postPending;
 const strong=n&&['Now queuing','On deck','On field'].includes(n.status),warn=n?.status==='Queuing soon';
 const queueMinutes=n?.queue?Math.ceil((n.queue-Date.now())/60000):null,scheduledMinutes=next?.scheduled?Math.ceil((next.scheduled-Date.now())/60000):null;
 const index=next?matches.indexOf(next):matches.length-1,near=matches.slice(Math.max(0,index-2),Math.max(0,index-2)+6),qual=matches.filter(m=>m.level==='qm');
 return <div className="comp-dashboard">
 <div className="comp-dashboard-primary"><section className="card comp-next"><small>NEXT MATCH · TEAM {team}</small>{next?<>
 <div className="comp-match-title"><h2>{next.label}</h2><span className={'badge '+(next.alliance==='red'?'danger':'info')}>{next.alliance.toUpperCase()}</span></div>
 <p className="comp-alliance">{next[next.alliance].map((t,i)=><span key={t}>{i>0?' · ':''}{t===String(team)?<strong>{t}</strong>:t}</span>)}</p><p>vs {next[next.alliance==='red'?'blue':'red'].join(' · ')}</p>
 <div className={'comp-timing '+(strong?'comp-timing-strong':warn?'comp-timing-warning':'')}>
 {n&&<strong>{n.status}</strong>}{n?.queue&&<p>{queueMinutes!>0?`Queue in ~${queueMinutes} min`:`Queue estimate ${at(n.queue)} · check live status`}</p>}
 {!n?.queue&&scheduledMinutes!==null&&<p>{scheduledMinutes>0?`Scheduled in ${scheduledMinutes} min`:'Scheduled time has passed · awaiting update'}</p>}
 <small>Scheduled {at(next.scheduled)}{n?.estimated?` · Nexus estimate ${at(n.estimated)}`:next.predicted?` · TBA estimate ${at(next.predicted)}`:''}</small></div>
 </>:<h2>No upcoming match published</h2>}
 {live&&(live.nowQueuing||live.matches.some(m=>!m.committed))&&<div className="comp-live-strip"><small>LIVE EVENT · NEXUS</small>{live.nowQueuing&&<p>Now queuing: {live.nowQueuing}</p>}{live.matches.filter(m=>!m.committed&&m.status!=='Status unavailable').slice(0,3).map(m=><p key={m.label}>{m.label} · <strong>{m.status}</strong></p>)}</div>}
 </section>
 <section className="card comp-readiness"><small>ROBOT STATUS</small><h2 className={readiness==='NOT READY'?'comp-danger':''}>{readiness==='READY'?'ROBOT READY':readiness==='NOT READY'?'ROBOT NOT READY':'NEEDS ATTENTION'}</h2>
 <p>{battery?`Battery ${battery.battery_number} · ${battery.status}`:'Battery not assigned'}{next?` for ${next.label}`:''}</p><p>Pre-match {pre.length?`${preItems.filter(i=>i.completed_at).length}/${preItems.length}`:'not started'}</p>
 {incomplete.length>0&&<p>{incomplete.length} required checks remaining · {incomplete.filter(i=>i.blocking).length} blocking</p>}<p>{blocking.length} blocking issues · {issues.length-blocking.length} other open</p>
 {attention&&readiness!=='READY'&&<button onClick={()=>document.getElementById('comp-attention')?.scrollIntoView({behavior:'smooth',block:'start'})}>View blockers</button>}
 </section></div>
 {next&&<div className="comp-primary-action"><button className="primary" onClick={()=>open(next.key)}>{strong?`Open ${next.label}`:pre.length?`Continue checklist · ${next.label}`:`Prepare for ${next.label}`}</button>{d.can_manage&&<button onClick={()=>open(next.key)}>{battery?'Change battery':'Assign battery'}</button>}{canWork(profile)&&<button onClick={report}>Report issue</button>}</div>}
 {attention&&<section className="card comp-attention" id="comp-attention"><h2>Needs attention</h2>
 {issues.filter(i=>['HIGH','ROBOT DOWN'].includes(i.severity)).map(i=><button className="comp-row" key={i.id} onClick={()=>openIssue(i.id)}>{i.title} · {i.subsystem} · {i.severity}</button>)}
 {incomplete.length>0&&<button className="comp-row" onClick={()=>go('checklists')}>{incomplete.length} incomplete required checks · View checklists</button>}
 {next&&!pre.length&&<button className="comp-row" onClick={()=>open(next.key)}>Pre-match checklist not started for {next.label}</button>}
 {next&&!battery&&<button className="comp-row" onClick={()=>open(next.key)}>Battery not assigned for {next.label}</button>}
 {next&&battery&&!['READY','ON ROBOT'].includes(battery.status)&&<button className="comp-row" onClick={()=>batteryAction(battery.id)}>Battery {battery.battery_number} · {battery.status}</button>}
 {postPending&&last&&<button className="comp-row" onClick={()=>open(last.key)}>Post-match inspection unfinished · {last.label}</button>}
 </section>}
 {near.length>0&&<section className="card"><h2>Team {team} match progress</h2><div className="comp-progress">{near.map(m=><button key={m.key} aria-current={m.key===next?.key?'step':undefined} onClick={()=>open(m.key)}><strong>{m.label}</strong><small>{m.completed?(m.winner?(m.winner===m.alliance?'Won':'Lost'):m.redScore===m.blueScore?'Tie':'Result pending'):m.actual?'In progress':m.key===next?.key?'NEXT':'Upcoming'}</small>{m.completed&&<small>Red {m.redScore} · Blue {m.blueScore}</small>}</button>)}</div>{qual.length>0&&<small>{team}: {qual.filter(m=>m.completed).length} of {qual.length} published qualification matches complete</small>}</section>}
 {last&&<section className="card comp-after"><h2>After {last.label}</h2><div className="comp-inline"><button onClick={()=>open(last.key)}>{postPending?'Start post-match inspection':'Open completed match'}</button>{lastOps?.battery_id&&canWork(profile)&&<button onClick={()=>batteryAction(lastOps.battery_id!)}>Battery actions</button>}</div>{!next&&canWork(profile)&&<button onClick={report}>Report issue</button>}<small>Inspection and battery handling require your confirmation.</small></section>}
 {!!live?.announcements.length&&<section className="card"><h2>Event update</h2>{[...live.announcements].sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,2).map(a=><p key={a.id}>{a.text} <small>{at(a.at)}</small></p>)}</section>}
 </div>;
}
