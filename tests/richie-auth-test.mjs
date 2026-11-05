import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {connect,withLock,SERVER} from '../src/core/robinhood.mjs';
const auth={clientId:'test',refresh:'refresh',tokenEndpoint:'https://token.invalid/token'};
const DENY='client id not allowed: <missing>';
// initFails / toolFails: how many denials in a row before that kind of call succeeds (Infinity: always).
function fixture({initFails=1,toolFails=0,status=403}={}) {
 let tokens=0,initializes=0,tools=0;const seen=[];
 const fetcher=async(url,opts)=>{
  if(url!==SERVER){tokens++;return Response.json({access_token:'access'+tokens,refresh_token:'refresh'+tokens,expires_in:900});}
  const body=JSON.parse(opts.body);seen.push([body.method,opts.headers.Authorization]);
  if(body.method==='initialize'){initializes++;if(initializes<=initFails)return new Response(DENY,{status,headers:{'x-request-id':'req'+initializes}});
   return Response.json({jsonrpc:'2.0',id:body.id,result:{}});}
  if(body.method==='tools/call'){tools++;if(tools<=toolFails)return new Response(DENY,{status});}
  if(body.id===undefined)return new Response(null,{status:202});
  return Response.json({jsonrpc:'2.0',id:body.id,result:{tools:[],content:[{text:'ok'}]}});
 };
 return {fetcher,seen,stats:()=>({tokens,initializes,tools})};
}
const opts=(f,extra={})=>{const logs=[],waits=[];return {logs,waits,o:{readAuth:async()=>auth,writeAuth:async()=>{},fetcher:f.fetcher,lock:null,
 log:e=>logs.push(e),pause:async ms=>waits.push(ms),readOnly:n=>n.startsWith('get_'),...extra}};};

test('a setup denial waits and resends with the same token, which recovers without a new token',async()=>{
 const f=fixture();const {o,logs,waits}=opts(f);await connect(o);
 assert.deepEqual(f.stats(),{tokens:1,initializes:2,tools:0});assert.deepEqual(waits,[15000]);
 assert.equal(f.seen[0][1],f.seen[1][1]);
 const r=logs.find(l=>l.event==='rh_reply');
 assert.equal(r.phase,'initialize');assert.equal(r.status,403);assert.equal(r['x-request-id'],'req1');assert.ok(r.tokenAgeMs>=0);
 assert.ok(!JSON.stringify(logs).includes('access1'),'the token is never logged');
});
test('a persistent setup denial stops after one wait and one new token',async()=>{
 const f=fixture({initFails:Infinity});const {o,waits}=opts(f);
 await assert.rejects(connect(o),/403/);assert.deepEqual(f.stats(),{tokens:2,initializes:3,tools:0});assert.equal(waits.length,1);
});
test('a 401 denial: same token after a wait, then one new token',async()=>{
 const f=fixture({initFails:Infinity,status:401});const {o}=opts(f);
 await assert.rejects(connect(o),/401/);assert.deepEqual(f.stats(),{tokens:2,initializes:3,tools:0});
});
test('a look-only tool denial is waited out and resent once',async()=>{
 const f=fixture({initFails:0,toolFails:1});const {o,waits,logs}=opts(f);const c=await connect(o);
 assert.equal(await c.call('get_crypto_quotes',{}),'ok');assert.equal(f.stats().tools,2);assert.deepEqual(waits,[15000]);
 assert.equal(logs.find(l=>l.event==='rh_reply').phase,'get_crypto_quotes');
});
test('an order denial is never repeated',async()=>{
 const f=fixture({initFails:0,toolFails:Infinity});const {o,waits}=opts(f);const c=await connect(o);
 await assert.rejects(c.call('place_equity_order',{}),/403/);assert.equal(f.stats().tools,1);assert.equal(f.stats().tokens,1);assert.deepEqual(waits,[]);
});
test('every refresh re-reads the newest refresh token and saves a rotated one',async()=>{
 const f=fixture({initFails:0});let stored={...auth,refresh:'from-other-process'};const sent=[];
 const fetcher=async(url,o)=>{if(url!==SERVER)sent.push(new URLSearchParams(o.body).get('refresh_token'));return f.fetcher(url,o);};
 const {o,logs}=opts(f,{fetcher,readAuth:async()=>stored,writeAuth:async a=>{stored=a;}});await connect(o);
 assert.deepEqual(sent,['from-other-process']);assert.equal(stored.refresh,'refresh1');
 assert.deepEqual(logs.find(l=>l.event==='rh_refresh'),{event:'rh_refresh',rotated:true,expiresIn:900});
});
test('the refresh lock lets one process in at a time and clears a stale lock',async()=>{
 const dir=join(await mkdtemp(join(tmpdir(),'rh-lock-')),'lock');let inside=0,most=0;
 const job=()=>withLock(dir,async()=>{inside++;most=Math.max(most,inside);await new Promise(r=>setTimeout(r,20));inside--;},{pause:ms=>new Promise(r=>setTimeout(r,5))});
 await Promise.all([job(),job(),job()]);assert.equal(most,1);
 await mkdir(dir);const old=new Date(Date.now()-120000);await utimes(dir,old,old);
 assert.equal(await withLock(dir,async()=>'got in'),'got in');
 await mkdir(dir);await assert.rejects(withLock(dir,async()=>{},{waitMs:30,pause:ms=>new Promise(r=>setTimeout(r,ms))}),/lock busy/);
});
