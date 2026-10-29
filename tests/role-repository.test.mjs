import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {canWork,isAdmin} from '../src/model.ts';
const source=readFileSync(new URL('../src/repository.ts',import.meta.url),'utf8');const ast=ts.createSourceFile('repository.ts',source,ts.ScriptTarget.Latest,true);const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='mutate');assert.ok(node);const code=ts.transpileModule(node.getText(ast).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
test('real repository adapter denies readonly/inactive/unknown before any transport',async()=>{const sent=[];const mutate=new Function('canWork','isAdmin','scopedPitRpc',code+';return mutate;')(canWork,isAdmin,async(...args)=>{sent.push(args);return{error:null};});
 for(const p of [{role:'readonly',active:true},{role:'admin_lead',active:false},{role:'future',active:true}])await assert.rejects(()=>mutate(false,{id:'me',...p},'transition_battery',{},{}),/View-only/);
 assert.equal(sent.length,0);await mutate(false,{id:'me',role:'admin_lead',active:true},'transition_battery',{},{});assert.equal(sent.length,1);
});

test('staff actions require a current Mentor before transport; Admin Lead retains ordinary work',async()=>{const sent=[];const mutate=new Function('canWork','isAdmin','scopedPitRpc',code+';return mutate;')(canWork,isAdmin,async(...args)=>{sent.push(args);return{error:null};});
 for(const action of ['save_event','activate_event','save_battery']){for(const role of ['student','lead','admin_lead'])await assert.rejects(()=>mutate(false,{id:'me',role,active:true},action,{},{}),/Mentor access/);await mutate(false,{id:'staff',role:'mentor',active:true},action,{},{});}
 assert.equal(sent.length,3);
});
