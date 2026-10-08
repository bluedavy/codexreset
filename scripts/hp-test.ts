import {readFileSync} from 'node:fs';
import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
// Evaluate the actual inline formatter so tests cannot drift from the page.
const html=readFileSync('./public/index.html','utf8');
const source=html.match(/function health\(hits,k=5000,dead=false\)\{.*?\}(?=\nfunction age)/s)![0];
const health=new Function(source+';return health')() as (hits:number,k?:number,dead?:boolean)=>string;
describe('inline health formatter',()=>{
 it('starts at 100% and decreases across the supported range',()=>{
  assert.equal(health(0),'100%');let previous=101;
  for(let hits=0;hits<=100000;hits+=5000){const n=parseFloat(health(hits));assert(n>0);assert(n<previous);previous=n;}
 });
 it('never underflows to a zero display, even at maximum safe hit count',()=>{
  for(const hits of [1000000,10000000,Number.MAX_SAFE_INTEGER])assert.match(health(hits),/^[1-9].*%$/);
  assert.equal(health(0,5000,true),'0%');
 });
});
