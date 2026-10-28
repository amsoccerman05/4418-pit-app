import {test,expect} from '@playwright/test';import {setupRole,captureRole,type Role} from './role-fixture';import {navigate,emitAuth} from './offline-fixture';
for(const role of ['admin_lead','lead','student','readonly'] as Role[])test(`${role} battery controls and Scout work match literal role`,async({page},info)=>{
 const f=await setupRole(page,role);await navigate(page,'Batteries');await page.getByRole('button',{name:'Details & history',exact:true}).click();const dialog=page.getByRole('dialog');
 if(role==='readonly'){await expect(dialog.getByRole('button',{name:'Save battery activity'})).toHaveCount(0);}else{
 const select=dialog.getByLabel('Battery status',{exact:true});expect(await select.locator('option').allTextContents()).not.toContain('RETIRED');
 if(role==='student'){expect(await select.locator('option').allTextContents()).toEqual(['FLAGGED']);await expect(dialog).toContainText('You may record a measurement');}else await expect(select.locator('option[value="READY"]')).toHaveCount(1);
 }
 await expect(dialog.getByText('Edit battery details',{exact:true})).toHaveCount(0);await captureRole(page,info,`${role}-battery`);await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 await navigate(page,'Scouting');const capture=page.getByRole('button',{name:'New match report',exact:true});if(role==='readonly')await expect(capture).toBeDisabled();else await expect(capture).toBeEnabled();expect(f.writes()).toHaveLength(0);f.assertIsolated();
});
test('Admin Lead still requires a qualifying assigned competition position',async({page},info)=>{
 const f=await setupRole(page,'admin_lead',{canManage:false});await navigate(page,'Matches');await expect(page.getByRole('button',{name:'Add practice match',exact:true})).toHaveCount(0);
 f.context.can_manage=true;await page.getByRole('button',{name:'Refresh schedule',exact:true}).click();await expect(page.getByRole('button',{name:'Add practice match',exact:true})).toBeVisible();
 f.context.can_manage=false;await page.getByRole('button',{name:'Refresh schedule',exact:true}).click();await expect(page.getByRole('button',{name:'Add practice match',exact:true})).toHaveCount(0);await captureRole(page,info,'assignment-revoked');expect(f.writes()).toHaveLength(0);f.assertIsolated();
});
test('Lead to Student resets forbidden FLAGGED release but preserves measurements without autosave',async({page},info)=>{
 const f=await setupRole(page,'lead');await navigate(page,'Batteries');await page.getByRole('button',{name:'Details & history',exact:true}).click();const d=page.getByRole('dialog');
 await d.getByLabel('Battery status',{exact:true}).selectOption('READY');await d.getByLabel('Voltage (optional)',{exact:true}).fill('12.5');await d.getByLabel('Activity notes',{exact:true}).fill('My retained measurement');
 f.data.profiles[0].role='student';await page.evaluate(()=>(window as any).__offlineFixture.emitRealtime('profiles'));await expect(d.getByLabel('Battery status',{exact:true})).toHaveValue('FLAGGED');await expect(d.getByLabel('Voltage (optional)',{exact:true})).toHaveValue('12.5');await expect(d.getByLabel('Activity notes',{exact:true})).toHaveValue('My retained measurement');expect(f.writes()).toHaveLength(0);
 await captureRole(page,info,'demotion-retained-measurement');await d.getByRole('button',{name:'Save battery activity',exact:true}).click();await expect.poll(()=>f.count('rpc/pit_transition_battery')).toBe(1);expect(f.calls.find(c=>c.path==='rpc/pit_transition_battery')?.body.p).toMatchObject({status:'FLAGGED',voltage:12.5,notes:'My retained measurement'});f.assertIsolated();
});
test('Readonly retains issue view but cannot submit; permission restoration keeps in-memory draft',async({page},info)=>{
 const f=await setupRole(page,'admin_lead');await navigate(page,'Robot / Issues');await page.getByRole('button',{name:/Private pit repair/}).click();const d=page.getByRole('dialog',{name:'Issue #1',exact:true});await d.getByLabel('Title',{exact:true}).fill('Retained issue draft');
 f.data.profiles[0].role='readonly';await page.evaluate(()=>(window as any).__offlineFixture.emitRealtime('profiles'));await expect(d.getByRole('button',{name:'Save issue',exact:true})).toHaveCount(0);expect(f.writes()).toHaveLength(0);
 f.data.profiles[0].role='admin_lead';await page.evaluate(()=>(window as any).__offlineFixture.emitRealtime('profiles'));await expect(d.getByLabel('Title',{exact:true})).toHaveValue('Retained issue draft');await captureRole(page,info,'restored-issue-draft');expect(f.writes()).toHaveLength(0);
 await emitAuth(page,null);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('Retained issue draft')).toHaveCount(0);f.assertIsolated();
});
test('Student cannot act on retired battery and receives a clear explanation',async({page},info)=>{
 const f=await setupRole(page,'student',{status:'RETIRED'});await navigate(page,'Batteries');await page.getByRole('button',{name:'Details & history',exact:true}).click();const d=page.getByRole('dialog');await expect(d).toContainText('Only Mentors and Admins can restore');await expect(d.getByRole('button',{name:'Save battery activity'})).toHaveCount(0);await captureRole(page,info,'retired-readonly');f.assertIsolated();
});
