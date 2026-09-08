import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'../..');
const [directory,...extra]=process.argv.slice(2);
assert(directory && !extra.length,'usage: emit_inventory.mjs EMITTED_DIRECTORY');
const output=resolve(directory), files=[], examples=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function add(path,role,bytes){
  await mkdir(dirname(join(output,path)),{recursive:true});
  if(bytes!==undefined)await writeFile(join(output,path),bytes);
  const content=bytes??await readFile(join(output,path));
  files.push({path,role,sha256:hash(content)});
}
for(const name of ['mid_review','clarify_first','human','model','rule','react']){
  const image=`review/${name}.bpi2`,initialArgs=`review/${name}.args`;
  await add(image,'image');await add(initialArgs,'initial-args');
  examples.push({name:`review-${name.replaceAll('_','-')}`,image,initialArgs});
}
await add('document/document.bpi2','image');
await add('document/document.args','initial-args');
examples.push({name:'document',image:'document/document.bpi2',initialArgs:'document/document.args'});
for(const name of ['twice','dispose_owned','exchange']){
  const image=`dialogue/${name}.bpi2`,initialArgs=`dialogue/${name}.args.bin`;
  await add(image,'image');await add(initialArgs,'initial-args',new Uint8Array());
  examples.push({name:`dialogue-${name.replaceAll('_','-')}`,image,initialArgs});
}
await add('contracts.md','contract',await readFile(join(root,'conformance/agent4/contracts.md')));
await add('model-invocation-v3.md','contract',await readFile(join(root,'docs/model-invocation-v3.md')));
await add('prescribed-provider.json','synthetic-fixture',Buffer.from(JSON.stringify({
  status:'completed',error:null,output:[{type:'function_call',status:'completed',
    call_id:'synthetic-answer',name:'proposal',arguments:JSON.stringify({replacement:'A fixture revision.\n',score:9})}],
},null,2)+'\n'));
files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
examples.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
await writeFile(join(output,'inventory.json'),JSON.stringify({format:'agent4-use-inventory/v1',examples,files},null,2)+'\n');
