#!/usr/bin/env node
// Infrastructure adapted from Team Hub attendance-editing-concurrency.mjs.
// Fresh synthetic cluster, Unix socket only; no existing DB URL or credentials.
// Expected-denial assertions are mandatory: PGlite is NOT concurrency proof.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {join,isAbsolute} from 'node:path';import {tmpdir} from 'node:os';
import {install,migration,id,literal,json,actor,report,assignment,snapshot} from '../helpers/role-database.mjs';
const bin=process.env.PIT_ROLE_PG_BIN;
assert(bin&&isAbsolute(bin),'Set PIT_ROLE_PG_BIN to an installed PostgreSQL bin directory');
const root=mkdtempSync(join(tmpdir(),'pit-role-native-')),data=join(root,'db');
const env={PATH:process.env.PATH||'/usr/bin:/bin',HOME:root,LANG:'C.UTF-8',TZ:'UTC'};
const args=['-X','-h',root,'-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync(join(bin,'psql'),args,{input,env,encoding:'utf8',timeout:25000,maxBuffer:8*1024*1024}).trim();
const children=new Set();let started=false;const failures=[];let checks=0;
function session(name) {
  const child = spawn(join(bin, 'psql'), args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let out = '', err = '';
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', b => { out += b; });
    child.stderr.on('data', b => { err += b; });
    child.on('error', reject); child.stdin.on('error', reject);
    child.on('close', code => { children.delete(child); code ? reject(Error(err || `psql exited ${code}`)) : resolve(out.trim()); });
  });
  done.catch(() => {}); // Failure is asserted by the caller after gate release.
  child.stdin.write("set statement_timeout='15s';set idle_in_transaction_session_timeout='20s';\n");
  return { child, done, output: () => out };
}
function asyncSQL(query, name) {
  const s = session(name); s.child.stdin.end(`${query}\n`); return s.done;
}
async function waitFor(predicate, label) {
  const end = Date.now() + 10_000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw Error(`Timed out waiting for ${label}`);
}
async function transactionGate(query, name) {
  const s = session(name);
  s.child.stdin.write(`begin;${query}select 'PIT_ROLE_GATE_READY';\n`);
  await Promise.race([
    waitFor(() => s.output().includes('PIT_ROLE_GATE_READY'), `${name} readiness`),
    s.done.then(() => { throw Error(`${name} exited before the gate became ready`); }),
  ]);
  let released = false;
  return { done: s.done, release: async () => {
    if (!released) { released = true; s.child.stdin.end('commit;\n\\q\n'); }
    return s.done;
  } };
}
const blocked = (...names) => waitFor(() => Number(sql(`select count(*) from pg_stat_activity
  where application_name in (${names.map(literal).join(',')}) and wait_event_type='Lock'`)) === names.length, `${names.join(', ')} lock wait`);

const call=(fn,p)=>`${actor(2)}select public.${fn}(${json(p)});`;
const competition=(action,p,who=2)=>`${actor(who)}select public.pit_competition_manage(${literal(action)},${json(p)});`;
const scouting=p=>`${actor(2)}select public.pit_scouting_manage('assignment',${json(p)});`;
const demote=`update public.profiles set role='readonly' where id='${id(2)}';`;
const restore=`update profiles set role='mentor',active=true where id='${id(1)}';update public.profiles set role='lead',active=true where id='${id(3)}';update public.profiles set role='student',active=true where id='${id(4)}';update public.profiles set role='admin_lead',active=true where id='${id(2)}';update public.team_member_positions set revoked_at=null where user_id='${id(2)}';`;
async function scenario(name,lock,query,change=demote){
 const before=sql(snapshot);let gate;
 try{gate=await transactionGate(lock,`${name}-gate`);
  const request=asyncSQL(query,`${name}-write`);await blocked(`${name}-write`);
  sql(change);await gate.release();
  let rejected=false;try{await request;}catch(error){assert.match(error.message,/permissions|leadership/i);rejected=true;}
  assert(rejected,`${name}: write succeeded after committed authority loss`);
  assert.equal(sql(snapshot),before,`${name}: business/audit rows changed`);
  checks++;console.log(`PASS Pit: ${name}`);
 }catch(error){failures.push(`${name}: ${error.message}`);console.error(`FAIL Pit: ${name}: ${error.message}`);}
 finally{await gate?.release();sql(restore);}
}
try{
 execFileSync(join(bin,'initdb'),['-D',data,'-A','trust','-U','postgres','--no-locale','--encoding=UTF8'],{env,stdio:'pipe',timeout:30000});
 execFileSync(join(bin,'pg_ctl'),['-D',data,'-l',join(root,'server.log'),'-o',`-k ${root} -c listen_addresses='' -c unix_socket_permissions=0700`,'-w','start'],{env,stdio:'pipe',timeout:30000});started=true;
 await install(sql);
 sql(`insert into profiles(id,display_name,role,active) values('${id(9)}','Synthetic backup Mentor','mentor',true);update profiles set role='admin_lead' where role='admin';alter table profiles drop constraint profiles_role_check;alter table profiles add constraint profiles_role_check check(role in ('readonly','student','lead','admin_lead','mentor'));`);
 sql(migration('20261029190427_pit_canonical_roles.sql'));
 const version=sql(`select updated_at from pit_issues where id='${id(102)}'`);
 await scenario('issue-row-demotion',`select 1 from pit_issues where id='${id(102)}' for update;`,call('pit_update_issue',{id:id(102),expected_updated_at:version,title:'Forbidden pending edit'}));
 await scenario('battery-advisory-demotion','select pg_advisory_xact_lock(4418,1);',call('pit_transition_battery',{id:id(101),expected_status:'READY',status:'CHARGING',voltage:12.5,voltage_kind:'pre-match',notes:'Forbidden pending measurement'}));
 await scenario('report-event-row-demotion',`select 1 from pit_events where id='${id(100)}' for update;`,call('pit_report_issue',{event_id:id(100),subsystem:'Drivetrain',severity:'LOW',description:'Forbidden pending report'}));
 await scenario('competition-advisory-demotion','select pg_advisory_xact_lock(4418,30);',competition('item',{id:id(105),complete:true,version:1}));
 await scenario('checklist-row-demotion',`select 1 from pit_checklist_run_items where id='${id(105)}' for update;`,competition('item',{id:id(105),complete:true,version:1}));
 await scenario('scouting-request-demotion',`select pg_advisory_xact_lock(hashtextextended('pit-scouting-request:${id(200)}',0));`,call('pit_scouting_submit',report(200)));
 await scenario('scouting-management-demotion',`select pg_advisory_xact_lock(hashtextextended('pit-scouting-management:${id(100)}',0));`,scouting(assignment()));
 // Independent assignee avoids incidental assignee-role rejection masking actor loss.
 // A new target keeps this test independent if an earlier expected denial fails.
 await scenario('position-revocation',`select pg_advisory_xact_lock(hashtextextended('pit-scouting-management:${id(100)}',0));`,scouting({...assignment(),team_number:1619}),`update team_member_positions set revoked_at=now() where user_id='${id(2)}';`);
 // Additional row-lock boundaries: an advisory control alone is not enough.
 sql(`insert into pit_match_ops(id,event_id,match_key,updated_by) values('${id(106)}','${id(100)}','2026test_qm1','${id(1)}');`);
 await scenario('competition-config-row-demotion',`select 1 from pit_event_config where event_id='${id(100)}' for update;`,competition('config',{event_id:id(100),version:1,team_number:4418,tba_event_key:'2026test',nexus_event_key:null}));
 await scenario('competition-match-row-demotion',`select 1 from pit_match_ops where id='${id(106)}' for update;`,competition('match',{event_id:id(100),match_id:id(106),version:1,note:'Forbidden pending preparation',battery_id:null}));
 await scenario('student-run-template-row-demotion',`select 1 from pit_checklist_templates where id='${id(103)}' for update;`,competition('run',{id:id(107),event_id:id(100),match_id:id(106),template_id:id(103),template_version:1},4),`update profiles set role='readonly' where id='${id(4)}';`);
 await scenario('lead-link-issue-row-demotion',`select 1 from pit_issues where id='${id(102)}' for update;`,competition('link_issue',{event_id:id(100),match_id:id(106),issue_id:id(102)},3),`update profiles set role='readonly' where id='${id(3)}';`);
 const mentorCall=(fn,p)=>`${actor(1)}select public.${fn}(${json(p)});`;
 const mentorDemote=`update profiles set role='readonly' where id='${id(1)}';`;
 const eventEdit={id:id(100),name:'Forbidden event edit',start_date:'2026-10-28',end_date:'2026-10-30'};
 await scenario('mentor-battery-metadata-row-demotion',`select 1 from pit_batteries where id='${id(101)}' for update;`,mentorCall('pit_save_battery',{id:id(101),battery_number:'B01',notes:'Forbidden metadata edit'}),mentorDemote);
 await scenario('mentor-event-metadata-row-demotion',`select 1 from pit_events where id='${id(100)}' for update;`,mentorCall('pit_save_event',eventEdit),mentorDemote);
 await scenario('mentor-event-activation-advisory-demotion','select pg_advisory_xact_lock(4418,2);',mentorCall('pit_activate_event',{id:id(100)}),mentorDemote);
 await scenario('mentor-event-activation-row-demotion',`select 1 from pit_events where id='${id(100)}' for update;`,mentorCall('pit_activate_event',{id:id(100)}),mentorDemote);
 // Real lock wait positive control: current Mentor authority must still succeed.
 const gate=await transactionGate(`select 1 from pit_batteries where id='${id(101)}' for update;`,'mentor-positive-gate');
 try{const request=asyncSQL(mentorCall('pit_save_battery',{id:id(101),battery_number:'B01',notes:'Authorized after wait'}),'mentor-positive-write');await blocked('mentor-positive-write');await gate.release();await request;assert.equal(sql(`select notes from pit_batteries where id='${id(101)}'`),'Authorized after wait');checks++;console.log('PASS Pit: current-Mentor lock-wait positive control');}finally{await gate.release();}
 assert.deepEqual(failures,[],`Native lock-wait authorization failures: ${failures.join(' | ')}`);
 console.log(`${checks} Pit native lock-wait/demotion checks passed; PostgreSQL ${sql('show server_version')}.`);
}finally{
 for(const child of children)child.kill('SIGTERM');
 if(started)execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env,stdio:'pipe',timeout:30000});
 rmSync(root,{recursive:true,force:true});
}
