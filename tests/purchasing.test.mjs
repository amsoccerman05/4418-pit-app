import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePoReference,poUrl,parsePurchaseContext,parsePurchaseCandidate,bridgeUnavailable,PO_STATUSES} from '../src/purchasing/model.ts';
const id='22222222-2222-4222-8222-222222222222',issue='11111111-1111-4111-8111-111111111111';
const summary={po_id:id,po_number:17,status:'submitted_to_school',requester_name:'Fixture requester'};
const context=()=>({issue_id:issue,issue_updated_at:'2026-10-05T10:00:00Z',can_attach:true,links:[{...summary,linked_at:'2026-10-05T10:00:00Z'}]});
test('PO reference accepts only canonical Finance links or UUIDs',()=>{
 for(const value of [id,` ${id.toUpperCase()} `,`https://finance.frc4418.org/#po/${id}`])assert.equal(parsePoReference(value),id);
 for(const value of ['', '17', 'javascript:alert(1)',`http://finance.frc4418.org/#po/${id}`,`https://finance.frc4418.org.evil.test/#po/${id}`,`https://example.test/#po/${id}`,`https://finance.frc4418.org/?token=secret#po/${id}`,`https://user@finance.frc4418.org/#po/${id}`,`https://finance.frc4418.org/path#po/${id}`,`https://finance.frc4418.org/#po/${id}/edit`])assert.equal(parsePoReference(value),null,value);
 assert.equal(poUrl('bad'),null);assert.equal(poUrl(id),`https://finance.frc4418.org/#po/${id}`);
});
test('context accepts minimal authorized results without inferring hidden count',()=>{assert.deepEqual(parsePurchaseContext(context(),issue),context());const empty={...context(),links:[]};assert.deepEqual(parsePurchaseContext(empty,issue),empty);});
test('context fails closed for wrong repair, invalid dates, duplicate PO and malformed status',()=>{
 for(const value of [null,{}, {...context(),issue_id:id},{...context(),issue_updated_at:'bad'},{...context(),can_attach:'yes'},{...context(),links:[...context().links,...context().links]},{...context(),links:[{...summary,linked_at:'bad'}]},{...context(),links:[{...context().links[0],status:'ordered'}]},{...context(),links:[{...context().links[0],po_id:'bad'}]},{...context(),links:[{...context().links[0],po_number:0}]}])assert.equal(parsePurchaseContext(value,issue),null);
});
test('candidate must match both exact PO and repair and return version/capability',()=>{
 const candidate={...summary,issue_id:issue,issue_updated_at:context().issue_updated_at,can_attach:false};assert.deepEqual(parsePurchaseCandidate(candidate,id,issue),candidate);
 for(const value of [null,summary,{...candidate,po_id:issue},{...candidate,issue_id:id},{...candidate,issue_updated_at:null},{...candidate,can_attach:undefined}])assert.equal(parsePurchaseCandidate(value,id,issue),null);
});
test('missing deployment classification is narrow and status never implies received parts',()=>{
 assert.equal(bridgeUnavailable({code:'PGRST202'}),true);assert.equal(bridgeUnavailable({code:'42883'}),true);for(const value of [null,new Error('network'),{code:'42501'}, {message:'PGRST202'}])assert.equal(bridgeUnavailable(value),false);
 assert.equal(PO_STATUSES.submitted_to_school,'Submitted to school');assert.equal(Object.hasOwn(PO_STATUSES,'ordered'),false);assert.equal(Object.hasOwn(PO_STATUSES,'received'),false);
});
import {issueRouteId,isIssueRoute,canDismissCompletedEditor} from '../src/issue-route.ts';
test('repair deep link accepts one opaque UUID and rejects extended routes',()=>{assert.equal(issueRouteId(`#issue/${issue.toUpperCase()}`),issue);for(const value of ['#issues',`#issue/${issue}/edit`,`#issue/${issue}?name=private`,'#issue/invalid','#issue/'])assert.equal(issueRouteId(value),null);assert.equal(isIssueRoute('#issue/invalid'),true);assert.equal(isIssueRoute('#orders'),false);});

test('delayed save cannot dismiss a newer editor or route',()=>{const first={id:issue},next={id};assert.equal(canDismissCompletedEditor(first,first,'#issue/a','#issue/a'),true);assert.equal(canDismissCompletedEditor(first,next,'#issue/a','#issue/a'),false);assert.equal(canDismissCompletedEditor(first,first,'#issue/a','#issue/b'),false);assert.equal(canDismissCompletedEditor(first,null,'#issue/a',''),false);});
