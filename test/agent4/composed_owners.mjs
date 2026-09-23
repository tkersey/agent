import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyRuntime} from '../../tools/agent4/dependencies.mjs';
const runtime=verifyRuntime(resolve(process.argv[2]));
const {Kernel,decodeOutcome,decodeRequest,encodeResult}=await import(pathToFileURL(runtime.entrypoint));
const bytes=await readFile(runtime.kernelPath),image=await readFile('zig-out/agent4/composed-owners.bpi3');
let instanceId=1n;
const fresh=()=>Kernel.create({bytes,expectedSha256:runtime.kernelSha256,instanceId:instanceId++});
let k=await fresh(),p=k.prepare(image),s=k.start(p,new Uint8Array());k.releasePrepared(p);
let control='none',value=new Uint8Array(),transfers=0;
const cleanup=[];
for(let i=0;;i++){
 assert.ok(i<128);
 const out=decodeOutcome(k.drive(s,{control,value,quantum:7,checkpoint:true}));
 if(out.kind==='completed'){
  assert.equal(out.value.length,0);assert.deepEqual(cleanup,[2n,1n]);
  k.close(s);assert.equal(k.usage().workingLive,0n);break;
 }
 if(out.kind==='requested'){
  const request=await decodeRequest(out.request);
  assert.equal(request.semanticIdentity,'composed/cleanup');
  cleanup.push(new DataView(request.payload.buffer,request.payload.byteOffset,8).getBigUint64(0,true));
  control='reply';value=await encodeResult(out.request,new Uint8Array());
 }else{assert.equal(out.kind,'progressed');control='none';value=new Uint8Array();}
 assert.deepEqual(k.checkpoint(s,{transfer:true}),out.state);
 k=await fresh();p=k.prepare(image);s=k.restore(p,out.state);k.releasePrepared(p);transfers++;
}
console.log(JSON.stringify({imageBytes:image.length,transfers,cleanup:cleanup.map(String),kernel:runtime.kernelSha256}));
