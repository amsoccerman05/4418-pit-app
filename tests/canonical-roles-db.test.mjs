import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
import {install,migration,id,json,actor,report,assignment,snapshot} from './helpers/role-database.mjs';
const canonical=migration('20261029190427_pit_canonical_roles.sql');
const pins=JSON.parse(readFileSync(new URL('./helpers/pit-canonical-role-pins.json',import.meta.url),'utf8'));
const convert=`update profiles set role='admin_lead' where role='admin';alter table profiles drop constraint profiles_role_check;alter table profiles add constraint profiles_role_check check(role in ('readonly','student','lead','admin_lead','mentor'));`;
const catalog=async db=>(await db.query("select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'owner',p.proowner,'security',p.prosecdef,'config',p.proconfig) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','pit_private')),'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),'profiles',(select jsonb_agg(to_jsonb(p) order by id) from profiles p),'positions',(select jsonb_agg(to_jsonb(p) order by user_id) from team_member_positions p)) state")).rows[0].state;
test('canonical Pit migration removes Owner Admin while preserving Mentor, Admin Lead and assigned leadership boundaries',async t=>{
 const db=new PGlite();const owner=async(q,p=[])=>{await db.exec('reset role');return db.query(q,p);};
 const call=async(n,fn,p)=>{await db.exec(actor(n));return (await db.query(`select public.${fn}(${json(p)}) value`)).rows[0].value;};
 try{
  await install(q=>db.exec(q));await db.exec(convert);const before=await catalog(db);await db.exec(canonical);const after=await catalog(db);
  await t.test('exact pinned definitions and policies only, no grants/profile/position changes',async()=>{
   assert.deepEqual(after.profiles,before.profiles);assert.deepEqual(after.positions,before.positions);
   for(let i=0;i<before.functions.length;i++){const old=before.functions[i],next=after.functions[i],pin=pins.functions.find(p=>p.schema+'.'+p.name===old.name);assert.deepEqual({...next,definition:null},{...old,definition:null});assert.equal(next.definition,pin?.expected_definition??old.definition);if(pin)assert.equal(old.definition,pin.definition);}
   for(const old of before.policies){const pin=pins.policies.find(p=>p.before.tablename===old.tablename&&p.before.policyname===old.policyname);assert.deepEqual(after.policies.find(p=>p.tablename===old.tablename&&p.policyname===old.policyname),pin?.after??old);}
  });
  await t.test('Admin Lead can repair, work batteries and scout; only Mentor can administer events/fleet/retirement',async()=>{
   for(const n of [2,7]){const issue=await call(n,'pit_report_issue',{event_id:id(100),subsystem:'Drivetrain',severity:'LOW',description:'Synthetic canonical issue'});const row=(await owner('select * from pit_issues where id=$1',[issue])).rows[0];await call(n,'pit_update_issue',{id:issue,expected_updated_at:row.updated_at,title:'Repair update'});for(const fn of ['pit_save_event','pit_activate_event','pit_save_battery'])await assert.rejects(()=>call(n,fn,{}),/permissions/);await assert.rejects(()=>call(n,'pit_transition_battery',{id:id(101),expected_status:'READY',status:'RETIRED'}),/permissions/);}
   await call(1,'pit_transition_battery',{id:id(101),expected_status:'READY',status:'RETIRED'});await call(1,'pit_transition_battery',{id:id(101),expected_status:'RETIRED',status:'READY'});
   await call(2,'pit_scouting_submit',report(250));
  });
  await t.test('competition management remains assigned-position based for Admin Lead, with no generic admin bypass',async()=>{
   for(const [n,expected] of [[1,true],[2,true],[3,true],[4,true],[5,false],[7,false],[8,false]]){await db.exec(actor(n));assert.equal((await db.query(`select public.pit_competition_context('${id(100)}') c`)).rows[0].c.can_manage,expected);}
   await owner(`insert into team_member_positions values('${id(7)}','functional',null)`);await db.exec(actor(7));assert.equal((await db.query(`select (public.pit_competition_context('${id(100)}')->>'can_manage')::boolean allowed`)).rows[0].allowed,true);await owner(`update team_member_positions set revoked_at=now() where user_id='${id(7)}'`);await db.exec(actor(7));assert.equal((await db.query(`select (public.pit_competition_context('${id(100)}')->>'can_manage')::boolean allowed`)).rows[0].allowed,false);
  });
  await t.test('Readonly, inactive and removed role fail closed; direct writes remain denied',async()=>{
   for(const n of [5,6])for(const fn of ['pit_report_issue','pit_update_issue','pit_transition_battery','pit_save_event','pit_save_battery','pit_activate_event','pit_scouting_submit'])await assert.rejects(()=>call(n,fn,{}));
   await assert.rejects(()=>owner(`update profiles set role='admin' where id='${id(7)}'`),/check constraint/);
   await db.exec(actor(2));await assert.rejects(()=>db.exec(`update pit_batteries set status='FLAGGED' where id='${id(101)}'`));
  });
  await t.test('replay refuses atomically',async()=>{await db.exec('reset role');const prior=await catalog(db);await assert.rejects(()=>db.exec(canonical),/function\/ACL drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),prior);});
 }finally{await db.close();}
});
test('canonical Pit migration refuses an unconverted six-role profile contract',async()=>{const db=new PGlite();try{await install(q=>db.exec(q));const before=await catalog(db);await assert.rejects(()=>db.exec(canonical),/five-role CHECK/);await db.exec('rollback');assert.deepEqual(await catalog(db),before);}finally{await db.close();}});
