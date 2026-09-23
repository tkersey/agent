import {createParserKernel} from '../../runtime/parser_kernel.mjs';
// The guest has reciprocal waiting contexts; the embedding owns its work allowance.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyRuntime} from '../../tools/agent4/dependencies.mjs';
import {decodeSchema,decodeValue,encodeValue} from '../../runtime/values.mjs';
const runtime=verifyRuntime(resolve(process.argv[2]));
const {Kernel,decodeOutcome}=await import(pathToFileURL(runtime.entrypoint));
const read=name=>readFile('zig-out/agent4/parser-construction/'+name);
const image=await read('circular.bpi3'),schema=decodeSchema(await read('input-schema.bin'));
const model=decodeValue(decodeSchema(await read('model-schema.bin')),await read('model-template.bin'));
const input=[['0'.repeat(64),'0'.repeat(64),'0'.repeat(64),'0'.repeat(64),'agent.incremental-byte-parser/v1'],model,[],17n,2n,'parser.mjs',7n,false,false,{tag:0,value:null}];
const bytes=await readFile(runtime.kernelPath);let identity=1n;
const fresh=()=>createParserKernel(Kernel, {bytes,expectedSha256:runtime.kernelSha256,instanceId:identity++});
let k=await fresh(),p=k.prepare(image),s=k.start(p,encodeValue(schema,input));k.releasePrepared(p);
let checkpoint;
const allowance={quanta:8,quantum:97};
for(let n=0;n<allowance.quanta;n++){
 const out=decodeOutcome(k.drive(s,{quantum:allowance.quantum,checkpoint:true}));
 assert.equal(out.kind,'progressed','a circular demand must not manufacture evidence or an answer');
 checkpoint=k.checkpoint(s,{transfer:true});assert.deepEqual(checkpoint,out.state);assert.equal(k.usage().workingLive,0n);
 k=await fresh();p=k.prepare(image);s=k.restore(p,out.state);k.releasePrepared(p);
}
// This is the embedding's unresolved stop, not an authored error or divergence proof.
const report={status:'unresolved',reason:'work-allowance',spent:allowance.quanta,stateBytes:checkpoint.length,models:0,tools:0};
let out=decodeOutcome(k.drive(s,{control:'cancel_text',value:'circular work allowance exhausted',quantum:97,checkpoint:true}));
for(let n=0;out.kind==='progressed';n++){
 assert(n<128);assert.deepEqual(k.checkpoint(s,{transfer:true}),out.state);k=await fresh();p=k.prepare(image);s=k.restore(p,out.state);k.releasePrepared(p);
 out=decodeOutcome(k.drive(s,{quantum:97,checkpoint:true}));
}
assert.equal(out.kind,'cancelled');k.close(s);assert.equal(k.usage().workingLive,0n);
console.log(JSON.stringify({imageBytes:image.length,allowance,report,cancelled:true,kernel:runtime.kernelSha256}));
