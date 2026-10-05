import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
// Exercise the real TSX components without a live account or browser. This is
// server-render coverage, not a substitute for Playwright/layout verification.
const require=createRequire(import.meta.url);
for(const extension of ['.ts','.tsx'])require.extensions[extension]=(module,path)=>module._compile(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,path);
require.extensions['.css']=()=>{};
require.cache[require.resolve('../src/client.ts')]={exports:{supabase:null}};
const {CompetitionDashboard}=require('../src/competition/Dashboard.tsx');
const {PitDisplay}=require('../src/competition/PitDisplay.tsx');
const {competitionReadiness}=require('../src/competition/readiness.ts');
const {EventStandings}=require('../src/competition/Standings.tsx');
const now=1800000000000;
function fixture(){
 const match={key:'2026test_qm17',label:'Q17',level:'qm',number:17,set:1,red:['4418','1619'],blue:['123','456'],alliance:'red',scheduled:now+60000,predicted:null,actual:null,completed:false,redScore:null,blueScore:null,winner:''};
 const profile={id:'crew',display_name:'Test Crew',active:true,role:'mentor'};
 const data={profiles:[profile],events:[{id:'event',status:'active',name:'Test event'}],issues:[{id:'repair',title:'Replace bracket',subsystem:'Intake',severity:'HIGH',status:'REPAIRING',assigned_to:'crew',event_id:'event'}],batteries:[{id:'battery',battery_number:'B01',active:true,status:'ON ROBOT'}],batteryEvents:[]};
 const d={config:{team_number:4418},matches:[{id:'ops',match_key:match.key,battery_id:'battery'}],runs:[{id:'pre',kind:'pre',match_id:'ops'}],items:[{run_id:'pre',required:true,blocking:true,completed_at:'done'}],can_manage:true};
 const c={context:d,contextAt:now,tick:now,feed:{matches:[match],eventName:'Test event',eventKey:'2026test',tbaAt:now,standings:{scope:'qualification',rank:7,numTeams:30,record:{wins:4,losses:2,ties:1}},standingsAt:now,nexus:{nowQueuing:'Qualification 17',matches:[{label:'Qualification 17',status:'Now queuing',red:match.red,blue:match.blue,queue:now+60000,replayOf:null}],announcements:[]}},liveAvailable:true,error:'',feedError:''};
 return {c,d,data,profile,state:competitionReadiness(d,data,c.feed.matches),dataUpdatedAt:now,dataError:'',team:4418,eventName:'Test event',close(){},open(){},openIssue(){},batteryAction(){},go(){},report(){}};
}
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
test('dashboard renders actual qualification card, consistent readiness reasons and issue owners',()=>{
 const html=render(CompetitionDashboard,fixture());
 for(const text of ['Open pit display','QUALIFICATION RANK','#7','4–2–1','NEEDS ATTENTION','Replace bracket','Owner: Test Crew','Now queuing'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('ROBOT READY'));
});
test('pit display renders batteries, owners and independent freshness, and protects a stale readiness headline',()=>{
 const props=fixture(),html=render(PitDisplay,props);
 for(const text of ['aria-label="Pit display"','Close pit display','Q17','Installed:','B01','Owner: Test Crew','Issues / batteries:','Nexus live'])assert.ok(html.includes(text),text);
 props.dataError='Offline';const stale=render(PitDisplay,props);assert.ok(stale.includes('VERIFY STATUS'));assert.ok(stale.includes('PIT DATA MAY BE STALE'));
});
test('standings rendering never fabricates zeros and marks old partial snapshots',()=>{
 const {c}=fixture();c.feed.standings=null;let html=render(EventStandings,{c,team:4418});assert.ok(html.includes('Not available'));assert.ok(!html.includes('0–0–0'));
 c.feed.standings={scope:'qualification',rank:3,numTeams:null,record:null};c.feed.standingsAt=now-360000;html=render(EventStandings,{c,team:4418});assert.ok(html.includes('#3'));assert.ok(html.includes('may be stale'));assert.ok(html.includes('Not available'));
 c.feed.standings.record={wins:0,losses:0,ties:0};html=render(EventStandings,{c,team:4418});assert.ok(html.includes('0–0–0'));
});
