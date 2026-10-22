import assert from 'node:assert/strict';
import test from 'node:test';
import {createFluencyAssessmentJobs} from '../gateway/fluency-assessment-jobs.mjs';
import {encryptFluencySession} from '../gateway/student-identity-netlify-adapter.mjs';
const secret='fictional-proof-secret-at-least-32-characters';
const attemptId='11111111-1111-4111-8111-111111111111';
const assignmentId='22222222-2222-4222-8222-222222222222';
const now=Date.now();
const session={studentId:'33333333-3333-4333-8333-333333333333',enrollmentId:'44444444-4444-4444-8444-444444444444',schoolYear:'9999',classCode:'FIC',seatNumber:1,gradeLevel:8,version:1,expiresAt:Math.floor(now/1000)+7200};
const cookie=s=>`fluency_session=${encryptFluencySession(s,secret)}`;
function memoryStore(){
 const items=new Map();let etag=0;
 return {items,async get(k){return structuredClone(items.get(k)?.data??null)},async getWithMetadata(k){return structuredClone(items.get(k)??null)},async setJSON(k,data,opts={}){
  if((opts.onlyIfNew&&items.has(k))||(opts.onlyIfMatch&&items.get(k)?.etag!==opts.onlyIfMatch))return {modified:false};
  items.set(k,{data:structuredClone(data),etag:String(++etag)});return {modified:true};
 },async delete(k){items.delete(k)},async list({prefix}){return {blobs:[...items.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))}}};
}
function audio(){const n=32000;const b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i/8)*4000),44+i*2);return new Blob([b],{type:'audio/wav'});}
function post(){const f=new FormData();for(const[k,v]of Object.entries({attemptId,assignmentId,unitId:'B3U3',round:'1'}))f.set(k,v);f.set('audio',audio(),'round.wav');return new Request('https://fluency.invalid/api/fluency/assess',{method:'POST',headers:{cookie:cookie(session)},body:f});}
function poll(s=session){return new Request(`https://fluency.invalid/api/fluency/assess?attemptId=${attemptId}`,{headers:{cookie:cookie(s)}});}
function fixture(assess){const store=memoryStore();const dispatched=[];let clock=now;
 const jobs=createFluencyAssessmentJobs({getEnvironment:()=>({FLUENCY_SESSION_SECRET:secret,IDENTITY_GATEWAY_HMAC_SECRET_CURRENT:secret}),getStore:()=>store,now:()=>clock,assess,fetchImpl:async(url,options)=>{dispatched.push(new Request(url,{method:'POST',headers:options.headers,body:options.body}));return new Response(null,{status:202})}});
 return {...jobs,store,dispatched,advance:ms=>{clock+=ms}};
}
test('slow background assessment returns 202 immediately, survives duplicate submission, and deletes the upload',async()=>{
 let release;let assessments=0;const blocked=new Promise(r=>{release=r});
 const f=fixture(async request=>{assessments++;assert.equal((await request.formData()).get('attemptId'),attemptId);await blocked;return Response.json({assessment:{transcript:'Hello class'},round:1});});
 assert.equal((await f.submit(post())).status,202);
 assert.equal((await f.submit(post())).status,202);assert.equal(f.dispatched.length,1);
 const work=f.worker(f.dispatched[0].clone());await new Promise(r=>setTimeout(r,5));
 assert.equal((await f.submit(poll())).status,202);
 await f.worker(f.dispatched[0].clone());assert.equal(assessments,1);
 release();await work;
 const result=await f.submit(poll());assert.equal(result.status,200);assert.equal((await result.json()).assessment.transcript,'Hello class');
 assert.equal([...f.store.items.keys()].some(k=>k.startsWith('input/')),false);
 assert.equal((await f.submit(post())).status,200);assert.equal(assessments,1);
});
test('another enrollment cannot read the result, and an unsigned worker cannot invoke paid assessment',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json({assessment:{}})});
 await f.submit(post());
 assert.equal((await f.submit(poll({...session,enrollmentId:'55555555-5555-4555-8555-555555555555'}))).status,404);
 const b=await f.dispatched[0].clone().json();b.proof='A'.repeat(64);
 assert.equal((await f.worker(new Request(f.dispatched[0].url,{method:'POST',body:JSON.stringify(b)}))).status,401);assert.equal(calls,0);
 assert.equal((await f.submit(new Request('https://fluency.invalid/api/fluency/assess?attemptId='+attemptId))).status,401);
});
test('a provider failure preserves its error, removes audio, and permits retry with the same attempt ID',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return calls===1?Response.json({error:'temporary provider failure'},{status:503}):Response.json({assessment:{transcript:'Recovered'}})});
 await f.submit(post());await f.worker(f.dispatched[0].clone());assert.equal((await f.submit(poll())).status,503);
 assert.equal([...f.store.items.keys()].some(k=>k.startsWith('input/')),false);
 assert.equal((await f.submit(post())).status,202);assert.equal(f.dispatched.length,2);
 await f.worker(f.dispatched[1].clone());assert.equal((await f.submit(poll())).status,200);assert.equal(calls,2);
});
test('unprocessed expired uploads and results are removed',async()=>{
 const f=fixture(async()=>Response.json({assessment:{}}));await f.submit(post());f.advance(61*60_000);
 assert.equal((await f.submit(poll())).status,410);assert.equal(f.store.items.size,0);
});
