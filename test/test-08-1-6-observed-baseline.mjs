import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{load}=require('./helpers/load-source.cjs');
const {inferJsonSchema,schemaCoverageReasons}=load('normalization/schemaInference');
const {captureRequestSafe,captureHash}=load('baseline/safeCapture');
test('typed primitives and intersection of observed presence remain faithful',()=>{
 const s=inferJsonSchema('application/json',JSON.stringify({id:1,enabled:true,ratio:2.5,code:'0012',deleted:null,items:[{a:1,b:2},{a:3}]}),false);
 assert.equal(s.properties.id.type,'integer');assert.equal(s.properties.enabled.type,'boolean');assert.equal(s.properties.deleted.type,'null');assert.equal(s.properties.code.type,'string');assert.equal(s.properties.ratio.type,'number');
 assert.deepEqual(s.properties.items.items['x-qagent-observed-required'],['a']);assert.equal(s['x-qagent-inference-version'],'qagent.structural-inference.v2');
});
test('sentinels and depth boundaries report partial coverage, never sentinel business types',()=>{
 const r=inferJsonSchema('application/json',JSON.stringify({protected:'[REDACTED]'}),false);assert.equal(r.properties.protected.type,'unknown');assert.ok(schemaCoverageReasons(r).length);
 const s=inferJsonSchema('application/json',JSON.stringify({_qagent:'[TRUNCATED]'}),true);assert.ok(schemaCoverageReasons(s).length);assert.equal(s.properties,undefined);
 let deep={id:1};for(let i=0;i<9;i++)deep={object:deep};assert.ok(schemaCoverageReasons(inferJsonSchema('application/json',JSON.stringify(deep),false)).includes('DEPTH_LIMIT'));
});
test('invalid dates are not contracted as valid calendar dates',()=>{
 assert.equal(inferJsonSchema('application/json',JSON.stringify({date:'0000-00-00'}),false).properties.date.format,undefined);
 assert.equal(inferJsonSchema('application/json',JSON.stringify({date:'2024-02-29'}),false).properties.date.format,'date');
});
test('request boundary preserves arrays/null and excludes secrets, with canonical fingerprint',async()=>{
 const r={query:{amount:'1.00'},pathParams:{},headers:{'content-type':'application/json'},body:{items:[1,true,null]}};assert.equal(captureRequestSafe(r),true);assert.equal(captureRequestSafe({...r,body:{password:'forbidden'}}),false);
 assert.equal(await captureHash(r),await captureHash({body:r.body,headers:r.headers,pathParams:{},query:r.query}));
});
