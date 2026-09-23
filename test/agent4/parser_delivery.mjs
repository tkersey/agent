import {createParserKernel} from '../../runtime/parser_kernel.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createParserDelivery} from '../../runtime/parser_delivery.mjs';
import {parserContract} from '../../runtime/parser_oracle.mjs';
import {decodeSchema,encodeValue,decodeValue} from '../../runtime/values.mjs';
const [entry,kernelPath]=process.argv.slice(2);
const world=await import(pathToFileURL(resolve(entry)));
const bytes=new Uint8Array(await readFile(kernelPath)),hash=x=>createHash('sha256').update(x).digest('hex');
const image=new Uint8Array(await readFile('zig-out/agent4/parser-delivery/program.bin'));
const inputSchema=decodeSchema(await readFile('zig-out/agent4/parser-delivery/input-schema.bin'));
const resultSchema=decodeSchema(await readFile('zig-out/agent4/parser-delivery/result-schema.bin'));
const area=await mkdtemp(join(tmpdir(),'parser-delivery-'));
const results=[];
try {
 for(const mode of ['artifact','approved','declined','wrong-principal','amended','changed-before-read','changed-during-approval']) {
  const original='batch reference target\n',replacement='proposed replacement\n';
  await writeFile(join(area,'parser.mjs'),original);
  const proposal=[['parser.mjs',hash(original),replacement,'Finite parser acceptance passed'],7n,
    [hash(original),'b'.repeat(64),'c'.repeat(64),'d'.repeat(64),parserContract],2n,[true,536,536,true,'']];
  const files=await createParserDelivery({root:area});
  let input={image,initialArgs:encodeValue(inputSchema,[proposal,mode!=='artifact'])};
  let reads=0,questions=0,writes=0,output;
  for(let round=0;round<10;round++) {
   const k=await createParserKernel(world.Kernel, {bytes,expectedSha256:hash(bytes)});
   const out=world.decodeOutcome(k.invoke(world.encodeInput(input)));
   if(out.kind==='completed'){output=decodeValue(resultSchema,out.value);break;}
   assert.equal(out.kind,'requested');
   const request=await world.decodeRequest(out.request);
   const value=decodeValue(decodeSchema(request.payloadSchema),request.payload);let reply;
   if(request.semanticIdentity==='agent.parser.target-read.v1') {
    reads++;assert.deepEqual(value,proposal);
    if(mode==='changed-before-read')await writeFile(join(area,'parser.mjs'),'external change\n');
    reply=await files.read(value);
   } else if(request.semanticIdentity==='agent.approval.issue.v1.parser.replace') {
    assert.deepEqual(value,proposal);reply=23n;
   } else if(request.semanticIdentity==='agent.interaction.exchange.v1.parser.replace') {
    questions++;assert.deepEqual(value[3],[23n,proposal]);
    if(mode==='changed-during-approval')await writeFile(join(area,'parser.mjs'),'external change\n');
    const amended=structuredClone(proposal);amended[0][2]='unvalidated amendment';
    const decision=mode==='declined'?{tag:1,value:'declined'}:mode==='amended'?{tag:2,value:amended}:{tag:0,value:null};
    reply={tag:0,value:[value[3],mode==='wrong-principal'?8n:7n,decision]};
   } else if(request.semanticIdentity==='agent.parser.replace.v1') {
    writes++;assert.deepEqual(value,proposal);reply=await files.replace(value);
   } else throw Error(request.semanticIdentity);
   input={image,state:out.state,control:'reply',value:await world.encodeResult(out.request,encodeValue(decodeSchema(request.resumeSchema),reply))};
  }
  assert.ok(output);const content=await readFile(join(area,'parser.mjs'),'utf8');
  if(mode==='approved'){assert.equal(output.tag,0);assert.equal(output.value.tag,0);assert.equal(content,replacement);assert.equal(writes,1);}
  else if(mode==='artifact'){assert.equal(output.tag,4);assert.equal(content,original);assert.equal(questions,0);}
  else if(mode==='changed-before-read'){assert.equal(output.tag,5);assert.equal(questions,0);assert.equal(writes,0);}
  else if(mode==='changed-during-approval'){assert.equal(output.tag,0);assert.equal(output.value.tag,1);assert.equal(content,'external change\n');}
  else {assert.equal(writes,0);assert.equal(content,original);assert.equal(output.tag,mode==='declined'?1:3);}
  results.push({mode,reads,questions,writes,result:output.tag});
 }
 console.log(JSON.stringify({imageBytes:image.length,results}));
} finally {await rm(area,{recursive:true,force:true});}
