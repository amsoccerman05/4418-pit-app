import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {install,adapter,migration,id,json,actor,report,assignment,snapshot} from './helpers/role-database.mjs';
const changed=new Set(['pit_report_issue','pit_update_issue','pit_transition_battery','pit_competition_manage','competition_manager','scouting_context','scouting_submit','scouting_manage']);
test('literal Admin Lead adapter preserves ACLs/data and exact narrower boundaries',async t=>{
 const db=new PGlite();const owner=async(q,p=[])=>{await db.exec('reset role');return db.query(q,p);};
 const call=async(n,fn,p)=>{await db.exec(actor(n));return (await db.query(`select public.${fn}(${json(p)}) value`)).rows[0].value;};
 const manage=async(n,a,p)=>{await db.exec(actor(n));return (await db.query(`select public.pit_competition_manage('${a}',${json(p)}) value`)).rows[0].value;};
 const scoutManage=async(n,p)=>{await db.exec(actor(n));return db.query(`select public.pit_scouting_manage('assignment',${json(p)})`);};
 const issue=async()=> (await owner(`select * from pit_issues where id='${id(102)}'`)).rows[0];
 const state=async()=> (await owner(snapshot)).rows[0].state;
 try{await install(q=>db.exec(q),{includeAdapter:false});
 const catalog=()=>owner("select n.nspname,p.proname,p.prosrc,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','pit_private') order by n.nspname,p.proname");
 const before=(await catalog()).rows,profiles=(await owner('select * from profiles order by id')).rows,records=await state();await db.exec(migration(adapter));
 await t.test('only eight function bodies change by explicit role addition plus marked post-lock guards; ACL/profile/business rows stay identical',async()=>{
  const after=(await catalog()).rows;assert.equal(before.length,after.length);
  for(let i=0;i<after.length;i++){assert.equal(after[i].acl,before[i].acl);assert.equal(after[i].proname,before[i].proname);assert.equal(after[i].prosrc.replace(/ -- BEGIN CURRENT AUTHORITY RECHECK\n[\s\S]*? -- END CURRENT AUTHORITY RECHECK\n/g,''),before[i].prosrc.replaceAll("'lead'",changed.has(after[i].proname)?"'lead','admin_lead'":"'lead'"));}
  assert.deepEqual((await owner('select * from profiles order by id')).rows,profiles);assert.deepEqual(await state(),records);
  await db.exec(actor(2));assert.equal((await db.query('select pit_private.current_role() role')).rows[0].role,'admin_lead');
 });
 await t.test('Admin Lead works/manages issues with stale version, forged actor and retirement guards intact',async()=>{
  const rid=await call(2,'pit_report_issue',{event_id:id(100),subsystem:'Drivetrain',severity:'LOW',description:'Synthetic report',reported_by:id(7)});assert.equal((await owner(`select reported_by from pit_issues where id='${rid}'`)).rows[0].reported_by,id(2));
  const old=await issue();await call(2,'pit_update_issue',{id:old.id,expected_updated_at:old.updated_at,title:'Admin Lead repair',performed_by:id(7)});
  await assert.rejects(()=>call(2,'pit_update_issue',{id:old.id,expected_updated_at:old.updated_at,title:'Stale edit'}),/changed on another device/);
  await owner(`update pit_batteries set status='FLAGGED' where id='${id(101)}'`);
  await assert.rejects(()=>call(4,'pit_transition_battery',{id:id(101),expected_status:'FLAGGED',status:'READY'}),/permissions/);
  await call(2,'pit_transition_battery',{id:id(101),expected_status:'FLAGGED',status:'READY',performed_by:id(7)});
  assert.equal((await owner('select performed_by from pit_battery_events order by created_at desc limit 1')).rows[0].performed_by,id(2));
  for(const fn of ['pit_save_event','pit_save_battery','pit_activate_event'])await assert.rejects(()=>call(2,fn,{}),/permissions/);
  await assert.rejects(()=>call(2,'pit_transition_battery',{id:id(101),expected_status:'READY',status:'RETIRED'}),/permissions/);
  await call(1,'pit_transition_battery',{id:id(101),expected_status:'READY',status:'RETIRED'});
  await assert.rejects(()=>call(2,'pit_transition_battery',{id:id(101),expected_status:'RETIRED',status:'TESTING'}),/permissions/);
  await call(7,'pit_transition_battery',{id:id(101),expected_status:'RETIRED',status:'TESTING'});
 });
 await t.test('assigned-category eligibility remains required, revocation/demotion fail closed',async()=>{
  for(const [n,expected] of [[1,true],[2,true],[3,true],[4,true],[5,false],[8,false]]){await db.exec(actor(n));const c=(await db.query(`select public.pit_competition_context('${id(100)}') c`)).rows[0].c;assert.equal(c.can_manage,expected);}
  await assert.rejects(()=>manage(8,'template',{name:'Forbidden',kind:'pre',items:[{text:'A',required:true,blocking:true}]}),/leadership/);
  await manage(2,'item',{id:id(105),complete:true,version:1});
  await owner(`update team_member_positions set revoked_at=now() where user_id='${id(2)}'`);
  await assert.rejects(()=>scoutManage(2,assignment()),/leadership/);
  await owner(`update team_member_positions set revoked_at=null where user_id='${id(2)}'`);
  await owner(`update profiles set role='readonly' where id='${id(2)}'`);
  await assert.rejects(()=>manage(2,'item',{id:id(105),complete:false,version:2}),/permissions/);
  await owner(`update profiles set role='admin_lead' where id='${id(2)}'`);
 });
 await t.test('Admin Lead scouts and can be assigned; inactive/read-only reject; no direct writes or anonymous reads',async()=>{
  await call(2,'pit_scouting_submit',report());await scoutManage(2,{...assignment(),assignee_id:id(2)});
  const before=await state();
  for(const n of [5,6,9,null]){
   for(const fn of ['pit_report_issue','pit_update_issue','pit_transition_battery','pit_save_event','pit_save_battery','pit_activate_event','pit_scouting_submit'])await assert.rejects(()=>call(n,fn,{}));
   await assert.rejects(()=>manage(n,'item',{id:id(105),complete:false,version:2}));await assert.rejects(()=>scoutManage(n,assignment()));
   await db.exec(actor(n));await assert.rejects(()=>db.exec(`update pit_batteries set status='READY' where id='${id(101)}'`));
  }
  assert.deepEqual(await state(),before);
  await db.exec(actor(5));assert.ok((await db.query('select * from pit_issues')).rows.length);
  await db.exec(actor(6));assert.equal((await db.query('select * from pit_issues')).rows.length,0);
  await db.exec(actor(null));await assert.rejects(()=>db.query('select * from pit_issues'));
 });
 }finally{await db.close();}
});

test('adapter atomically refuses missing prerequisite and unseen function, ACL, security or policy drift',async()=>{
 const db=new PGlite();
 try{
  await install(q=>db.exec(q),{includeAdapter:false});
  const functionName='public.pit_update_issue(jsonb)';
  const baseline=(await db.query(`select pg_get_functiondef('${functionName}'::regprocedure) def`)).rows[0].def;
  const helper=(await db.query(`select pg_get_functiondef('public.team_my_positions()'::regprocedure) def`)).rows[0].def;
  const catalog=async()=> (await db.query(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(oid::regprocedure::text,pg_get_functiondef(oid),proacl::text) order by oid) from pg_proc where pronamespace in ('public'::regnamespace,'pit_private'::regnamespace)),'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public')) state`)).rows[0].state;
  for(const [alter,restore,reason] of [
   ["alter table profiles drop constraint profiles_role_check;", "alter table profiles add constraint profiles_role_check check(role in ('readonly','student','lead','admin_lead','admin','mentor'));", /literal-role CHECK/],
   [helper.replace("'admin_lead',",''),helper,/position eligibility/],
   [baseline.replace('begin','begin\n -- synthetic unexpected drift'),baseline,/function\/ACL drift/],
   [`alter function ${functionName} security invoker;`,baseline,/function\/ACL drift/],
   [`grant execute on function ${functionName} to anon;`,`revoke execute on function ${functionName} from anon;`,/function\/ACL drift/],
   ['alter policy pit_member_read on pit_issues using(true);',`alter policy pit_member_read on pit_issues using((select pit_private.current_role())=any(array['readonly','student','lead','admin','mentor']));`,/policy drift/],
  ]){
   await db.exec(alter);const before=await catalog();
   await assert.rejects(()=>db.exec(migration(adapter)),reason);
   await db.exec('rollback;');assert.deepEqual(await catalog(),before,'failed migration must not partially modify definitions or grants');
   await db.exec(restore);
  }
  await db.exec(migration(adapter));
 }finally{await db.close();}
});
