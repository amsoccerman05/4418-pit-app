import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {parseMatches,parseNexus,liveFor,nextMatch,operationalReadiness} from '../supabase/functions/competition-feed/external.ts';
import {createCache} from '../supabase/functions/competition-feed/cache.ts';
const raw={key:'2026test_qm17',event_key:'2026test',comp_level:'qm',set_number:1,match_number:17,time:1800000000,predicted_time:1800000300,actual_time:null,winning_alliance:'',alliances:{red:{team_keys:['frc4418','frc1619','frc1339'],score:-1},blue:{team_keys:['frc2996','frc3648','frc4593'],score:-1}}};
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
