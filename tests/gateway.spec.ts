import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`direct signed-out login stays on Pit without protected-content flash ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});let flash=false;page.on('console',m=>{if(m.text()==='private-content-flash')flash=true;});await page.addInitScript(()=>new MutationObserver(()=>{if(document.querySelector('.suite-header,.sidebar,.system-card,.page-heading'))console.log('private-content-flash');}).observe(document,{childList:true,subtree:true}));
 await page.route('**/src/client.ts',r=>r.fulfill({contentType:'application/javascript',body: `
 export const configured=true;export const configError='';export const supabase={auth:{
 onAuthStateChange(cb){queueMicrotask(()=>cb('INITIAL_SESSION',null));return {data:{subscription:{unsubscribe(){}}}}},
 async signInWithPassword(credentials){window.loginAttempt=credentials;return {error:{message:'Invalid login credentials'}};}
 }};`}));
 await page.goto('/#protected');await expect(page.getByRole('heading',{name:'Competition Operations sign in'})).toBeVisible();
 await expect(page).toHaveURL(/\/#protected$/);expect(flash).toBe(false);await expect(page.locator('.suite-header,.sidebar')).toHaveCount(0);
 await page.getByLabel('Team account email').fill('scout@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveText('Invalid login credentials');await expect(page).toHaveURL(/\/#protected$/);
 expect(await page.evaluate(()=>(window as any).loginAttempt.email)).toBe('scout@example.test');
});
