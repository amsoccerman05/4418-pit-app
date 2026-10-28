import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {canWork} from '../src/model.ts';
const source=readFileSync(new URL('../src/repository.ts',import.meta.url),'utf8');const ast=ts.createSourceFile('repository.ts',source,ts.ScriptTarget.Latest,true);const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='mutate');assert.ok(node);const code=ts.transpileModule(node.getText(ast).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
test('real repository adapter denies readonly/inactive/unknown before any transport',async()=>{const sent=[];const mutate=new Function('canWork','scopedPitRpc',code+';return mutate;')(canWork,async(...args)=>{sent.push(args);return{error:null};});
 for(const p of [{role:'readonly',active:true},{role:'admin_lead',active:false},{role:'future',active:true}])await assert.rejects(()=>mutate(false,{id:'me',...p},'transition_battery',{},{}),/View-only/);
 assert.equal(sent.length,0);await mutate(false,{id:'me',role:'admin_lead',active:true},'transition_battery',{},{});assert.equal(sent.length,1);
});
