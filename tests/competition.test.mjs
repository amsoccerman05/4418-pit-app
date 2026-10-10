import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {parseEventMatches,parseEventTeams,parseMatches,parseNexus,liveFor,nextMatch,operationalReadiness} from '../supabase/functions/competition-feed/external.ts';
import {createCache} from '../supabase/functions/competition-feed/cache.ts';
const raw={key:'2026test_qm17',event_key:'2026test',comp_level:'qm',set_number:1,match_number:17,time:1800000000,predicted_time:1800000300,actual_time:null,winning_alliance:'',alliances:{red:{team_keys:['frc4418','frc1619','frc1339'],score:-1},blue:{team_keys:['frc2996','frc3648','frc4593'],score:-1}}};
test('event team directory normalizes names, deduplicates and sorts without requiring a schedule',()=>{
 const impulse={key:'frc4418',team_number:4418,nickname:'  IMPULSE\n Robotics  ',name:'Full sponsor name',city:'Private unused field'};
 const rows=[impulse,{...impulse,nickname:'Conflicting duplicate'}, {key:'frc2',team_number:2,nickname:'\t ',name:'  Full\u0000 Name\t'}, {key:'frc1',team_number:1}, {key:'frc2',team_number:2,nickname:'Later duplicate'}, {key:'frc1',team_number:1,name:'One'}, {key:'frc99999',team_number:99999,nickname:42,name:false}];
 assert.deepEqual(parseEventTeams(rows),[{key:'frc1',number:1,name:'One'},{key:'frc2',number:2,name:'Full Name'},{key:'frc4418',number:4418,name:'IMPULSE Robotics'},{key:'frc99999',number:99999,name:null}]);
 assert.equal(parseEventTeams([{...impulse,nickname:'x'.repeat(500)}])[0].name.length,200);
 assert.equal(parseEventTeams([{...impulse,nickname:null,name:'y'.repeat(500)}])[0].name.length,200);
 assert.deepEqual(parseEventTeams([]),[]);
});
test('event team directory rejects malformed envelopes and filters invalid team identities',()=>{
 for(const response of [null,undefined,{},'teams',123])assert.throws(()=>parseEventTeams(response),/Invalid TBA team response/);
 const valid={key:'frc4418',team_number:4418,nickname:'IMPULSE'};
 const malformed=[null,{},[],false,'frc4418',...['4418',0,-1,1.5,NaN,Infinity,100000,Number.MAX_SAFE_INTEGER+1].map(team_number=>({...valid,team_number,key:`frc${team_number}`})),...['frc04418','FRC4418','4418','frc4418b','frc4418 ',null,4418,'frc1'].map(key=>({...valid,key}))];
 assert.throws(()=>parseEventTeams(malformed),/Invalid TBA team response/);
 assert.deepEqual(parseEventTeams([...malformed,valid]),[{key:'frc4418',number:4418,name:'IMPULSE'}]);
});
test('all-event scouting keeps every alliance while operational matches stay team-only',()=>{
 const other={...raw,key:'2026test_qm1',match_number:1,alliances:{red:{team_keys:['frc1','frc2','frc3'],score:0},blue:{team_keys:['frc4','frc5','frc6'],score:12}},winning_alliance:'blue',actual_time:1800000000};
 const blue={...raw,key:'2026test_qm18',match_number:18,alliances:{red:raw.alliances.blue,blue:raw.alliances.red}};
 const final={...other,key:'2026test_f1m2',comp_level:'f',set_number:1,match_number:2};
 const all=parseEventMatches([final,blue,raw,other],'2026test',4418);
 assert.deepEqual(all.map(m=>m.key),['2026test_qm1','2026test_qm17','2026test_qm18','2026test_f1m2']);
 assert.deepEqual(all.map(m=>m.alliance),[null,'red','blue',null]);
 assert.deepEqual(all[0].red,['1','2','3']);assert.deepEqual(all[0].blue,['4','5','6']);
 assert.equal(all[0].redScore,0);assert.equal(all[0].blueScore,12);assert.equal(all[0].winner,'blue');assert.equal(all[0].completed,true);assert.equal(all[0].actual,1800000000000);assert.equal(all[3].label,'F1–2');
 const operations=parseMatches([final,blue,raw,other],'2026test',4418);
 assert.deepEqual(operations,all.filter(m=>m.alliance!==null));assert.equal(nextMatch(operations).key,raw.key);
 assert.deepEqual(parseEventMatches([raw],'2026test')[0].alliance,null);
 assert.deepEqual(parseMatches([other,final],'2026test',4418),[]);
});
test('event schedules reject malformed envelopes and discard invalid or cross-event rows',()=>{
 for(const response of [null,{},'matches'])assert.throws(()=>parseEventMatches(response,'2026test',4418),/Invalid TBA match response/);
 const invalid=[null,{}, {...raw,event_key:'2026other'}, {...raw,key:'2026other_qm17'}, {...raw,key:'2026test_qm99'}, {...raw,comp_level:'pm'}, {...raw,match_number:'17'}, {...raw,match_number:0}, {...raw,set_number:null}, {...raw,alliances:null}, {...raw,alliances:{red:raw.alliances.red}}, {...raw,alliances:{red:raw.alliances.red,blue:{team_keys:'frc2996'}}}, {...raw,alliances:{...raw.alliances,red:{team_keys:['frc4418',null]}}}, {...raw,alliances:{...raw.alliances,red:{team_keys:['frc4418','untrusted-team']}}}];
 assert.deepEqual(parseEventMatches(invalid,'2026test',4418),[]);
 assert.deepEqual(parseEventMatches([...invalid,raw],'2026test',4418),parseEventMatches([raw],'2026test',4418));
 assert.deepEqual(parseMatches([...invalid,raw],'2026test',4418),parseMatches([raw],'2026test',4418));
 const unresolved={...raw,key:'2026test_sf1m1',comp_level:'sf',match_number:1,time:null,predicted_time:0,actual_time:'1800000000',alliances:{red:{team_keys:[],score:-1},blue:{team_keys:[],score:null}}};
 const [m]=parseEventMatches([unresolved],'2026test',4418);assert.equal(m.alliance,null);assert.equal(m.scheduled,null);assert.equal(m.predicted,null);assert.equal(m.actual,null);assert.equal(m.completed,false);assert.equal(m.redScore,null);assert.equal(m.blueScore,null);
});
test('verified TBA/Nexus fields, null times, scores, next match and conservative matching',()=>{
 const [m]=parseMatches([raw,{...raw,key:'2026other_qm17',event_key:'2026other'}],'2026test',4418);assert.equal(m.scheduled,1800000000000);assert.equal(m.alliance,'red');assert.equal(m.completed,false);assert.equal(nextMatch([m]).key,m.key);
 const live=parseNexus({eventKey:'demo1234',dataAsOfTime:1800000000000,nowQueuing:'Qualification 17',matches:[{label:'Qualification 17',status:'On deck',redTeams:m.red,blueTeams:m.blue,times:{estimatedStartTime:1800000500000,estimatedQueueTime:null}}],announcements:[{id:'a',announcement:'Lunch',postedTime:1800000000000}]},'demo1234',4418);
 assert.equal(liveFor(m,live.matches).status,'On deck');assert.equal(liveFor(m,live.matches).queue,null);assert.equal(live.announcements[0].text,'Lunch');
 assert.equal(liveFor(m,[{...live.matches[0],replayOf:'Qualification 17'}]),null);assert.equal(liveFor({...m,level:'sf'},live.matches),null);assert.equal(liveFor(m,[{...live.matches[0],red:['999']}]),null);
 const scored=parseMatches([{...raw,alliances:{red:{...raw.alliances.red,score:20},blue:{...raw.alliances.blue,score:20}}}],'2026test',4418)[0];assert.equal(scored.completed,true);assert.equal(nextMatch([scored]),null);assert.equal(nextMatch([{...m,actual:1800000000000}]),null);
 assert.throws(()=>parseNexus({...live,eventKey:'wrong'},'demo1234',4418));
});
test('ETag caching, missing credentials, shared requests and outage retain last good data',async()=>{
 let n=0,now=1000,fail=false;const cache=createCache(async(_,options)=>{n++;if(fail)throw new Error('offline');if(n===2){assert.equal(options.headers['If-None-Match'],'v1');return new Response(null,{status:304});}assert.equal(options.headers['X-TBA-Auth-Key'],'server-only');return new Response(JSON.stringify([raw]),{headers:{etag:'v1'}});},()=>now);
 assert.equal((await cache('event','X-TBA-Auth-Key',undefined,60)).data,null);assert.equal(n,0);
 await Promise.all([cache('event','X-TBA-Auth-Key','server-only',60),cache('event','X-TBA-Auth-Key','server-only',60)]);assert.equal(n,1);now+=61;const checked=await cache('event','X-TBA-Auth-Key','server-only',60);assert.equal(checked.at,now);assert.equal(n,2);
 now+=61;fail=true;const stale=await cache('event','X-TBA-Auth-Key','server-only',60);assert.equal(stale.data[0].key,raw.key);assert.ok(stale.error);assert.equal(stale.at,checked.at);
});
test('event roster cache uses ETags and event-specific keys with shared reads and stale fallback',async()=>{
 const url='https://www.thebluealliance.com/api/v3/event/2026test/teams/simple',other=url.replace('2026test','2026other'),rawTeams=[{key:'frc4418',team_number:4418,nickname:'IMPULSE'}];
 let reads=0,now=1800000000000,offline=false;
 const cached=createCache(async(request,options)=>{
  reads++;assert.equal(options.headers['X-TBA-Auth-Key'],'server-only');
  if(offline)throw new Error('Offline');
  assert.equal(request,url);
  if(reads>1){assert.equal(options.headers['If-None-Match'],'teams-v1');return new Response(null,{status:304});}
  return new Response(JSON.stringify(rawTeams),{headers:{etag:'teams-v1'}});
 },()=>now);
 const get=(event=url,key='server-only')=>cached(event,'X-TBA-Auth-Key',key,300000);
 assert.equal((await cached(url,'X-TBA-Auth-Key',undefined,300000)).data,null);assert.equal(reads,0);
 const [first,shared]=await Promise.all([get(),get()]);assert.equal(reads,1);assert.deepEqual(first,shared);assert.deepEqual(parseEventTeams(first.data),[{key:'frc4418',number:4418,name:'IMPULSE'}]);
 now+=299999;assert.equal((await get()).at,first.at);assert.equal(reads,1);
 now+=2;const fresh=await get();assert.equal(reads,2);assert.equal(fresh.at,now);assert.equal(fresh.error,null);
 now+=300001;offline=true;const stale=await get();assert.equal(reads,3);assert.equal(stale.at,fresh.at);assert.ok(stale.error);assert.deepEqual(parseEventTeams(stale.data),parseEventTeams(first.data));
 const isolated=await get(other);assert.equal(isolated.data,null);assert.ok(isolated.error);assert.equal(isolated.at,0);
});
test('readiness blocks physical issues/incomplete blocking items without completing work from results',()=>{
 const optional={required:false,blocking:false,completed_at:null};assert.equal(operationalReadiness([],[],false),'NEEDS ATTENTION');assert.equal(operationalReadiness([],[optional],true),'READY');assert.equal(operationalReadiness([],[{...optional,required:true}],true),'NEEDS ATTENTION');assert.equal(operationalReadiness([],[{...optional,blocking:true}],true),'NOT READY');assert.equal(operationalReadiness([{status:'DEFERRED',severity:'ROBOT DOWN'}],[],true),'NOT READY');assert.equal(operationalReadiness([{status:'TESTING',severity:'HIGH'}],[],true),'NEEDS ATTENTION');
});
test('competition SQL: active leadership, snapshots, concurrency, battery/issues, audit and RLS',async()=>{
 const db=new PGlite(),uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;create table profiles(id uuid primary key,display_name text,role text,active boolean);create table areas(id uuid primary key,name text,active boolean);create table team_positions(key text primary key,category text,active boolean);create table team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);insert into team_positions values('software_lead','Functional Leads',true);`);
 for(const [n,role] of [[1,'mentor'],[2,'student'],[3,'student'],[4,'lead'],[5,'readonly']])await db.query('insert into profiles values($1,$2,$3,true)',[uid(n),role,role]);
 await db.query("insert into team_member_positions values($1,'software_lead',null)",[uid(2)]);
 for(const file of ['202609090001_pit_operations.sql','202610010001_competition_operations.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 async function as(n){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);await db.exec('set role authenticated');}
 const rpc=async(action,p)=>(await db.query('select pit_competition_manage($1,$2::jsonb) id',[action,JSON.stringify(p)])).rows[0].id;
 await as(1);const event=(await db.query("select pit_save_event($1::jsonb) id",[JSON.stringify({name:'Test',start_date:'2026-10-01',end_date:'2026-10-03'})])).rows[0].id;await db.query('select pit_activate_event($1::jsonb)',[JSON.stringify({id:event})]);
 const battery=(await db.query('select pit_save_battery($1::jsonb) id',[JSON.stringify({battery_number:'B01'})])).rows[0].id;
 await as(2);await rpc('config',{event_id:event,team_number:4418,tba_event_key:'2026test',nexus_event_key:'demo1234',version:0});
 const context=async()=>(await db.query('select pit_competition_context($1) c',[event])).rows[0].c;assert.equal((await context()).can_manage,true);
 const template={name:'Inspect',kind:'pre',items:[{text:'Safety check',required:true,blocking:true,area_id:null},{text:'Optional',required:false,blocking:false,area_id:null}]};
 const tid=await rpc('template',template),mid=await rpc('match',{event_id:event,match_key:'2026test_qm17'});assert.equal(await rpc('match',{event_id:event,match_key:'2026test_qm17'}),mid);
 await rpc('match',{match_id:mid,version:1,battery_id:battery,note:'Assigned'});assert.equal((await db.query('select status from pit_batteries where id=$1',[battery])).rows[0].status,'TESTING');assert.equal((await db.query("select count(*)::int n from pit_battery_events where match_number='2026test_qm17'")).rows[0].n,1);
 await assert.rejects(rpc('match',{match_id:mid,version:1,note:'Stale'}),/changed/);
 await assert.rejects(rpc('config',{event_id:event,version:1,team_number:4418,tba_event_key:'2026other'}),/already has match/);
 await as(3);const rid=uid(90);await rpc('run',{id:rid,match_id:mid,template_id:tid,template_version:1});await rpc('run',{id:rid,match_id:mid,template_id:tid,template_version:1});assert.equal((await context()).runs.length,1);
 const item=(await context()).items[0];await rpc('item',{id:item.id,version:1,complete:true,completed_by:uid(1)});let done=(await context()).items[0];assert.equal(done.completed_by,uid(3));assert.ok(done.completed_at);await assert.rejects(rpc('item',{id:item.id,version:1,complete:false}),/changed/);
 await assert.rejects(rpc('template',template),/leadership/);await assert.rejects(rpc('match',{event_id:event,match_key:'2026test_qm18'}),/leadership/);
 await as(2);await rpc('template',{...template,id:tid,version:1,active:true,items:[{...template.items[0],text:'New procedure'}]});assert.equal((await context()).runs[0].template_version,1);assert.equal((await context()).items.length,2);assert.equal((await context()).items[0].text,'Safety check');
 const issue=await rpc('report_issue',{match_id:mid,subsystem:'Intake',severity:'HIGH',description:'Loose chain'});assert.equal((await context()).links[0].issue_id,issue);assert.equal((await db.query('select discovered_match from pit_issues where id=$1',[issue])).rows[0].discovered_match,'2026test_qm17');
 await assert.rejects(rpc('link_issue',{match_id:mid,issue_id:issue}),/permissions/); // existing issue-management role is deliberately stricter
 await db.exec("reset role;update team_positions set active=false");await as(2);assert.equal((await context()).can_manage,false);
 await db.exec("reset role;update team_positions set active=true;update profiles set active=false where role='student'");await as(2);await assert.rejects(context(),/Active team/);
 await db.exec("reset role;update profiles set active=true where role='student'");
 await db.exec("reset role;update team_member_positions set revoked_at=now()");await as(2);assert.equal((await context()).can_manage,false);await assert.rejects(rpc('template',template),/leadership/);
 await as(4);assert.equal((await context()).can_manage,false); // base lead alone is not a Team Position
 await as(5);await assert.rejects(rpc('item',{id:item.id,version:2,complete:false}),/permissions/);
 await assert.rejects(db.query('update pit_checklist_run_items set text=$1',['overwrite']),/permission/);
 await db.exec("reset role;update pit_events set status='completed'");await as(3);await assert.rejects(rpc('item',{id:item.id,version:2,complete:false}),/no longer active/);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select pit_competition_context(null)'),/permission/);
 }finally{await db.close();}
});
