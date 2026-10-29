import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import React from 'react';
import {canWork,canManage,isAdmin,batteryStatusOptions,batteryMatch,batteryReference} from '../src/model.ts';
const source=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');const ast=ts.createSourceFile('main.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='BatteryDetail')found=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(found);
const js=ts.transpileModule(found.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function fixture(){const slots=[],effects=[];let cursor=0;const sent=[];const names={React,canWork,canManage,isAdmin,batteryStatusOptions,batteryMatch,batteryReference,Field:'Field',Select:'Select',Badge:'Badge',BatteryMatchLabel:'BatteryMatchLabel',BatteryForm:'BatteryForm',stamp:String,
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},
 useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,n)=>d!==slots[i][n])){slots[i]=deps;effects.push(fn);}}};
 const Component=new Function(...Object.keys(names),js+';return BatteryDetail;')(...Object.values(names));
 const p={battery:{id:'b',battery_number:'B01',status:'FLAGGED',active:true,notes:''},data:{batteryEvents:[]},profile:{id:'me',role:'lead',active:true},busy:false,name:String,save:async(...args)=>{sent.push(args);return true;},openIssue(){},remove(){}};
 const render=()=>{cursor=0;const tree=Component(p);if(effects.length){for(const fn of effects.splice(0))fn();cursor=0;return Component(p);}return tree;};
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];const nodes=()=>all(render());const field=label=>nodes().find(n=>n.type==='Field'&&n.props.label===label).props.children;
 return {p,sent,nodes,field,render};
}
test('Lead to Student resets only invalid transition; retained voltage/notes remain explicitly saveable',async()=>{
 const f=fixture();f.field('Battery status').props.onChange('READY');f.field('Voltage (optional)').props.onChange({target:{value:'12.5'}});f.field('Activity notes').props.onChange({target:{value:'My measurement notes'}});
 f.p.profile={...f.p.profile,role:'student'};f.render();assert.equal(f.field('Battery status').props.value,'FLAGGED');assert.deepEqual(f.field('Battery status').props.options,['FLAGGED']);assert.equal(f.field('Voltage (optional)').props.value,'12.5');assert.equal(f.field('Activity notes').props.value,'My measurement notes');assert.equal(f.sent.length,0);
 await f.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(f.sent.length,1);assert.equal(f.sent[0][1].status,'FLAGGED');assert.equal(f.sent[0][1].voltage,12.5);assert.equal(f.sent[0][1].notes,'My measurement notes');
});
test('Readonly and retired Student have no activity form; Admin Lead never gets retirement controls',()=>{
 const f=fixture();f.p.profile.role='admin_lead';assert.equal(f.field('Battery status').props.options.includes('RETIRED'),false);f.p.profile.role='readonly';assert.equal(f.nodes().some(n=>n.type==='form'),false);f.p.profile.role='student';f.p.battery.status='RETIRED';assert.equal(f.nodes().some(n=>n.type==='form'),false);
});
