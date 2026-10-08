import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
await mkdir('qa',{recursive:true});let results=[];
const base={roundId:'qa-round',fans:0,hits:0,lastResetAt:'2026-10-07T03:35:09.000Z',sourceUrl:'https://x.com/thsottiaux/status/2107676072871600470',hpDecayK:5000};
for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[1440,900],[1920,1080]]){
 const page=await browser.newPage({viewport:{width,height}});let s={...base},batches=[],seen=new Set(),failure=false,hold=false;
 await page.route('**/api/state',async r=>r.fulfill({json:s}));
 await page.route('**/api/hit',async r=>{const b=r.request().postDataJSON();batches.push(b);if(failure){await r.fulfill({status:503,json:{error:'unavailable'}});return}if(hold)await new Promise(res=>setTimeout(res,200));if(!seen.has(b.batchId)){seen.add(b.batchId);s.hits+=b.hits;s.fans=1;}await r.fulfill({json:{...s,joined:s.fans===0}})});
 await page.goto('http://127.0.0.1:8787');await page.waitForFunction(()=>document.getElementById('fans').textContent==='0');
 const layout=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,title:document.querySelector('h1').getBoundingClientRect().toJSON(),card:document.getElementById('card').getBoundingClientRect().toJSON(),boss:document.getElementById('boss').getBoundingClientRect().toJSON(),footer:document.getElementById('last').getBoundingClientRect().toJSON()}));
 console.log(width,height,layout.scrollHeight);assert(layout.scrollWidth<=width);assert(layout.scrollHeight<=height);assert(layout.card.top>=layout.boss.bottom);assert(layout.footer.bottom<=height);
 await page.screenshot({path:`qa/${width}x${height}.png`});
 await page.evaluate(()=>{for(let i=0;i<45;i++)document.getElementById('card').click()});assert.equal(await page.locator('#hits').textContent(),'45');await page.waitForTimeout(3200);assert.equal(s.hits,45);assert.equal(s.fans,1);assert(batches.length<10);assert(batches.every(b=>b.hits<=50));
 if(width===390){failure=true;await page.evaluate(()=>document.getElementById('card').click());await page.waitForTimeout(1200);const failedId=batches.at(-1).batchId;failure=false;await page.waitForTimeout(1300);assert.equal(batches.at(-1).batchId,failedId);assert.equal(s.hits,46);
  s={...s,roundId:'qa-next',hits:0,fans:0};await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForTimeout(550);assert.equal(await page.locator('#hp').textContent(),'0%');assert.equal(await page.locator('#overlay').isVisible(),true);await page.waitForTimeout(2300);assert.equal(await page.locator('#hp').textContent(),'100%');assert.equal(await page.locator('#hits').textContent(),'0');
  s={...s,hits:60000};await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForTimeout(150);await page.screenshot({path:'qa/low-health.png'});
 }
 results.push({width,height,layout,hits:s.hits,networkBatches:batches.length});await page.close();
}
const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});await page.route('**/api/state',r=>r.fulfill({json:base}));await page.route('**/api/hit',r=>r.fulfill({json:{...base,hits:1,fans:1}}));await page.goto('http://127.0.0.1:8787');await page.locator('#card').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#hits').textContent(),'1');assert.equal(await page.locator('#boss').evaluate(e=>getComputedStyle(e).animationName),'none');await page.close();
await writeFile('qa/results.json',JSON.stringify(results,null,2));await browser.close();console.log('6 viewports passed; immediate tapping, batching, retry identity, reset transition, keyboard and reduced motion passed.');
