import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyRuntime} from '../../tools/agent4/dependencies.mjs';
import {execFileSync} from 'node:child_process';
const [runtimePath='.agent4-recursive-integrated/out/world-runtime',nativeTool,peerPath,browserTools]=process.argv.slice(2);
const runtime=verifyRuntime(resolve(runtimePath));
const {Kernel,decodeOutcome,decodeRequest,encodeResult,encodeInput}=await import(pathToFileURL(runtime.entrypoint));
const bytes=await readFile(runtime.kernelPath);let identity=1n;
const peer=peerPath?await(await import(pathToFileURL(resolve(peerPath)))).wasmtimePeer(runtime.kernelPath,runtime.kernelSha256):null;
const browser=browserTools?await(await import('./recursive_browser.mjs')).browserPeer({worldEntry:runtime.entrypoint,kernelPath:runtime.kernelPath,tools:browserTools,engine:'chromium',sha256:runtime.kernelSha256}):null;
const results=[];
try {
for(const [mode,minimize,candidates,chosen]of [['link',false,[2n,5n],5n],['link',true,[2n,5n],2n],['pure',false,[2n,5n],5n],['invalid',false,[2n,5n],null],['link',false,[],null],['link',false,[2n],null],['link',false,[10n,11n],11n],['link',true,[0n,5n],null]]){
 const area=await mkdtemp(join(tmpdir(),'selection-completion-')),target=join(area,'result');
 try{
 const image=new Uint8Array(await readFile(`zig-out/agent4/selection/${mode}.bpi3`));
 const input=new Uint8Array(2+candidates.length*8);input[0]=Number(minimize);input[1]=candidates.length;candidates.forEach((n,i)=>new DataView(input.buffer).setBigUint64(2+i*8,n,true));
 const fresh=()=>Kernel.create({bytes,expectedSha256:runtime.kernelSha256,instanceId:identity++});
 let k=await fresh(),p=k.prepare(image),s=k.start(p,input);k.releasePrepared(p);
 let control='none',value=new Uint8Array(),reads=[],writes=0,transfers=0,result;
 for(let i=0;;i++){
  assert.ok(i<512);const invocation={image,state:k.checkpoint(s),control,value,quantum:23};
  const node=k.drive(s,{control,value,quantum:23,checkpoint:true});let returned=node;
  if(peer){const command=encodeInput(invocation),native=new Uint8Array(execFileSync(nativeTool,['invoke'],{input:command,maxBuffer:16<<20})),independent=(await peer.call('invoke',{bytes:command})).bytes;assert.deepEqual(node,native);assert.deepEqual(independent,native);const choices=[node,native,independent];if(browser){const worker=await browser.invoke(invocation);assert.deepEqual(worker,native);choices.unshift(worker);}returned=choices[i%choices.length];}
  const out=decodeOutcome(returned);
  if(out.kind==='completed') {result=out.value;k.close(s);assert.equal(k.usage().workingLive,0n);break;}
  if(out.kind==='requested'){
   const request=await decodeRequest(out.request);const n=new DataView(request.payload.buffer,request.payload.byteOffset,8).getBigUint64(0,true);let reply;
   if(request.semanticIdentity==='selection/square'){
    assert.equal(writes,0);await assert.rejects(stat(target),{code:'ENOENT'});reads.push(n);
    reply=new Uint8Array(8);new DataView(reply.buffer).setBigUint64(0,n*n,true);
   }else{
    assert.equal(request.semanticIdentity,'selection/complete');assert.equal(n,chosen);assert.equal(writes,0);
    assert.deepEqual(reads,mode==='pure'?[]:candidates);await writeFile(target,n.toString(),{flag:'wx'});writes++;reply=new Uint8Array();
   }
   control='reply';value=await encodeResult(out.request,reply);
  }else{assert.equal(out.kind,'progressed');control='none';value=new Uint8Array();}
  assert.deepEqual(k.checkpoint(s,{transfer:true}),out.state);k=await fresh();p=k.prepare(image);s=k.restore(p,out.state);k.releasePrepared(p);transfers++;
 }
 if(chosen===null){assert.equal(result[0],1);assert.equal(result[1],candidates.length);assert.equal(writes,0);if(candidates[0]===0n)assert.equal(result[10],0);}
 else{assert.equal(result[0],0);assert.equal(new DataView(result.buffer,result.byteOffset+1,8).getBigUint64(0,true),chosen);assert.equal(result[9],1);const expected=chosen*chosen+chosen+5n;assert.equal(new DataView(result.buffer,result.byteOffset+10,8).getBigUint64(0,true),minimize?100n-expected:expected);assert.equal(writes,1);assert.equal(await readFile(target,'utf8'),chosen.toString());}
 assert.deepEqual(reads,mode==='pure'?[]:candidates);
 results.push({mode,minimize,candidates:candidates.map(String),selected:chosen?.toString()??null,reads:reads.map(String),writes,transfers,imageBytes:image.length});
 }finally{await rm(area,{recursive:true,force:true});}
}
console.log(JSON.stringify({results,independent:!!peer,browser:browser?.identity,workersDestroyed:browser?.workersDestroyed}));
}finally{if(browser)await browser.close();if(peer)await peer.close();}
