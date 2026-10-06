import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
for(const extension of ['.ts','.tsx'])require.extensions[extension]=(module,path)=>module._compile(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,path);
require.extensions['.css']=()=>{};
let reply,calls=[];
require.cache[require.resolve('../src/client.ts')]={exports:{supabase:{rpc:async(name,args)=>{calls.push({name,args});return reply;}}}};
const {loadPurchaseLinks,previewPurchase,attachPurchase}=require('../src/purchasing/service.ts');
const {PurchaseLinks}=require('../src/purchasing/PurchaseLinks.tsx');
const issue='11111111-1111-4111-8111-111111111111',po='22222222-2222-4222-8222-222222222222',time='2026-10-05T10:00:00Z';
const summary={po_id:po,po_number:17,status:'draft',requester_name:'Test requester'},context={issue_id:issue,issue_updated_at:time,can_attach:true,links:[{...summary,linked_at:time}]};
test('read adapters use exact bounded RPC arguments and reject malformed results',async()=>{
 calls=[];reply={data:context,error:null};assert.deepEqual(await loadPurchaseLinks(issue),context);assert.deepEqual(calls,[{name:'finance_repair_context',args:{p_issue_id:issue}}]);
 reply={data:{...summary,issue_id:issue,issue_updated_at:time,can_attach:true},error:null};await previewPurchase(issue,po);assert.deepEqual(calls[1],{name:'finance_repair_po_candidate',args:{p_issue_id:issue,p_po_id:po}});
 reply={data:{...context,issue_id:po},error:null};await assert.rejects(loadPurchaseLinks(issue),/Unexpected/);
 reply={data:null,error:{code:'42501',message:'Unavailable'}};await assert.rejects(previewPurchase(issue,po),error=>error.code==='42501');
});
test('attachment uses only reviewed payload, one call, and requires matching result',async()=>{
 calls=[];reply={data:context,error:null};await attachPurchase({issue_id:issue,po_id:po,expected_issue_updated_at:time,reason:'Replacement bracket'});assert.deepEqual(calls,[{name:'finance_attach_repair_po',args:{p_issue_id:issue,p_po_id:po,p_expected_issue_updated_at:time,p_reason:'Replacement bracket'}}]);
 reply={data:{...context,links:[]},error:null};await assert.rejects(attachPurchase({issue_id:issue,po_id:po,expected_issue_updated_at:time,reason:'Test'}),/Unconfirmed/);assert.equal(calls.length,2);
});
test('real presenter keeps demo disconnected and explains workflow boundary',()=>{
 calls=[];const html=renderToStaticMarkup(React.createElement(PurchaseLinks,{issueId:issue,issueUpdatedAt:time,editable:true,demo:true,busy:false}));assert.match(html,/No Finance data is loaded/);assert.match(html,/does not mean ordered, received, or installed/);assert.doesNotMatch(html,/Review purchase order|Link this purchase order/);assert.deepEqual(calls,[]);
});
