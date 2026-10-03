import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { decodeSchema, decodeValue, encodeValue } from '../../runtime/values.mjs';
import { requirement } from '../../runtime/mobility/policy.mjs';
import { schemas as mobilitySchemas } from '../../runtime/mobility/values.mjs';
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
const textContent=Buffer.from('alpha\nbeta gamma\ndelta epsilon zeta\nomega\n');
const subject=['fixture/story',[...createHash('sha256').update(textContent).digest()],BigInt(textContent.length)];
// Pure fixture values and contracts; the traveling image owns all control.
const mobility = {};
for (const name of ['task','report','read','text-reply','subject','inspection','integer','unit','resolve','resolution','relocate','relocation-reply']) {
  mobility[name] = await readFile(join(output, `mobility/${name}.schema`));
  await add(`mobility/${name}.bin`, 'schema', mobility[name]);
}
await add('mobility/program.bpi3', 'image');
await add('mobility/program-id.bin', 'synthetic-fixture');
await add('mobility/initial.args', 'initial-args', encodeValue(decodeSchema(mobility.integer), 123n));
examples.push({name:'mobility',image:'mobility/program.bpi3',initialArgs:'mobility/initial.args'});
const contract = (operation, input, result, role, subjectRef, scope, audience = null, subjectVersion = null) => requirement({
  operation, payloadSchema: mobility[input], resultSchema: mobility[result], role, subject: subjectRef, subjectVersion, scope, audience, trustDomain:'fixture',
});
const textVersion = Buffer.from(subject[1]).toString('hex');
const readRequirement = contract('agent.text.read-chunk.v1','read','text-reply','read',subject[0],'read',null,textVersion);
const presentRequirement = contract('agent.mobility.fixture.present.v1','inspection','unit','interaction','human-A','present','human-A');
const placement = (wanted,moves,intent) => [[wanted,[[],{tag:0,value:null},{tag:0,value:null},8n<<20n]],intent,'fixture-shared',[moves,3]];
await add('mobility/task-reply.bin','synthetic-fixture',encodeValue(decodeSchema(mobility.task),[123n,9001n,subject,placement([readRequirement],2,'inspect'),placement([presentRequirement],1,'present')]));
await add('mobility/subject-value.bin','synthetic-fixture',encodeValue(decodeSchema(mobility.subject),subject));
await add('mobility/unit-reply.bin','synthetic-fixture',new Uint8Array());
await add('mobility/story.txt','synthetic-fixture',textContent);
await add('mobility/cleanup.bin','synthetic-fixture',encodeValue(mobilitySchemas.requirements,[
  contract('agent.text.close.v1','subject','unit','cleanup',subject[0],'close',null,textVersion),
  contract('agent.mobility.fixture.child-cleanup.v1','integer','unit','cleanup','child','cleanup'),
]));
const approval = {};
for (const name of ['task','report','proposal','read','delivery','human','human-reply','identifier','integer','boolean']) {
  approval[name] = await readFile(join(output, `mobility-approval/${name}.schema`));
  await add(`mobility-approval/${name}.bin`, 'schema', approval[name]);
}
const approvalRequirement = (operation,input,result,role,subjectRef,scope,audience=null) => requirement({
  operation,payloadSchema:approval[input],resultSchema:approval[result],role,subject:subjectRef,subjectVersion:null,scope,audience,trustDomain:'fixture',
});
const approvalPlacement = (wanted,moves) => [[[wanted],[[],{tag:0,value:null},{tag:0,value:null},8n<<20n]],'fixture-write','shared',[moves,3]];
const originalDocument = Buffer.from('An isolated fixture.\n');
const proposal = [['document.txt',hash(originalDocument),'An approved replacement.\n','Replace the isolated fixture'],7n];
await add('mobility-approval/program.bpi3','image');
await add('mobility-approval/program-id.bin','synthetic-fixture');
await add('mobility-approval/document.txt','synthetic-fixture',originalDocument);
await add('mobility-approval/initial.args','initial-args',encodeValue(decodeSchema(approval.task),[9001n,proposal,
  approvalPlacement(approvalRequirement('agent.mobility.fixture.target-read.v1','proposal','read','read','fixture/document','read'),3),
  approvalPlacement(approvalRequirement('agent.interaction.exchange.v1.mobility.replace','human','human-reply','approval','human-A','approve','human-A'),2),
  approvalPlacement(approvalRequirement('agent.mobility.fixture.replace.v1','proposal','delivery','commit','fixture/document','replace'),1),
]));
examples.push({name:'mobility-approval',image:'mobility-approval/program.bpi3',initialArgs:'mobility-approval/initial.args'});
await add('text/tool.bmo1','component');
for(const name of ['subject','task','result','report'])await add(`text/${name}-schema.bin`,'schema');
await add('text/model-reply.bin','synthetic-fixture');
await add('text/story.txt','synthetic-fixture',textContent);
for(const name of ['standalone','agent']){
  const image=`text/${name}.bpi3`,initialArgs=`text/${name}.args`;
  const schema=decodeSchema(await readFile(join(output,`text/${name==='agent'?'task':'subject'}-schema.bin`)));
  await add(image,'image');await add(initialArgs,'initial-args',encodeValue(schema,name==='agent'?[subject,123n]:subject));
  examples.push({name:`text-${name}`,image,initialArgs});
}
for(const name of ['mid_review','clarify_first','human','model','rule','react']){
  const image=`review/${name}.bpi3`,initialArgs=`review/${name}.args`;
  await add(image,'image');await add(initialArgs,'initial-args');
  examples.push({name:`review-${name.replaceAll('_','-')}`,image,initialArgs});
}
await add('document/document.bpi3','image');
await add('document/document.args','initial-args');
examples.push({name:'document',image:'document/document.bpi3',initialArgs:'document/document.args'});
await add('document/consequence.bpi3','image');
await add('document/consequence.args','initial-args');
examples.push({name:'document-consequence',image:'document/consequence.bpi3',initialArgs:'document/consequence.args'});
// A typed, zero-work configuration example. Actual execution supplies a qualified
// runner, explicit allowances and operator-selected provider/target values.
const inquiryTask=decodeSchema(await readFile(join(output,'inquiry/task-schema.bin')));
const repositoryTask=decodeSchema(await readFile(join(output,'repository/task-schema.bin')));
await add('repository/task.args','initial-args',encodeValue(repositoryTask,
  [['Repair the admitted repository.','unconfigured-repository'],'unconfigured-model',0n,0]));
await add('repository/repair.bpi3','image');
for(const name of ['task-schema','result-schema','failure-schema'])await add(`repository/${name}.bin`,'schema');
examples.push({name:'repository-repair',image:'repository/repair.bpi3',initialArgs:'repository/task.args'});
const inquiryArgs=encodeValue(inquiryTask, [
  ['session.mjs','', '',await readFile(join(root,'test/consumers/inquiry/contract.txt'),'utf8'),
    'agent.session-occurrence.acceptance.v1',false,'unconfigured-target',0n],
  'unconfigured-model',0,0n,0n,true,0n,0n,false,1,
]);
await add('inquiry/task.args','initial-args',inquiryArgs);
for(const name of ['repair','repeated','react']){
  const image=`inquiry/${name}.bpi3`;
  await add(image,'image');
  examples.push({name:`inquiry-${name}`,image,initialArgs:'inquiry/task.args'});
}
for(const name of ['task-schema','outcome-schema'])await add(`inquiry/${name}.bin`,'schema');
await add('inquiry/contract.txt','contract',await readFile(join(root,'test/consumers/inquiry/contract.txt')));
const parserRoot='parser-construction';
for(const name of ['producer','consumer','consumer-alt','reference'])await add(`${parserRoot}/${name}.bmo1`,'component');
for(const name of ['input-schema','result-schema','model-schema','model-reply-schema'])await add(`${parserRoot}/${name}.bin`,'schema');
await add(`${parserRoot}/model-template.bin`,'synthetic-fixture');
const parserInput=decodeSchema(await readFile(join(output,`${parserRoot}/input-schema.bin`)));
const parserModel=decodeSchema(await readFile(join(output,`${parserRoot}/model-schema.bin`)));
const template=decodeValue(parserModel,await readFile(join(output,`${parserRoot}/model-template.bin`)));
// Zero allowance prevents this unconfigured example from requesting any leaf.
const parserArgs=encodeValue(parserInput,[
  ['0'.repeat(64),'0'.repeat(64),'0'.repeat(64),'0'.repeat(64),'agent.incremental-byte-parser/v1'],
  template,[],1n,0n,'parser.mjs',7n,false,false,{tag:0,value:null},
]);
await add(`${parserRoot}/task.args`,'initial-args',parserArgs);
await add(`${parserRoot}/program.bpi3`,'image');
examples.push({name:'parser-synthesis',image:`${parserRoot}/program.bpi3`,initialArgs:`${parserRoot}/task.args`});
for(const strategy of ['react','complete','alternate']){
 const image=`${parserRoot}/${strategy}.bpi3`;await add(image,'image');
 examples.push({name:`parser-${strategy}`,image,initialArgs:`${parserRoot}/task.args`});
}
for(const policy of ['first','last']){
  const image=`${parserRoot}/select-${policy}.bpi3`;await add(image,'image');
  examples.push({name:`parser-selection-${policy}`,image,initialArgs:`${parserRoot}/task.args`});
}
for(const name of ['twice','dispose_owned','exchange','yield_once']){
  const image=`dialogue/${name}.bpi3`,initialArgs=`dialogue/${name}.args.bin`;
  await add(image,'image');await add(initialArgs,'initial-args',new Uint8Array());
  examples.push({name:`dialogue-${name.replaceAll('_','-')}`,image,initialArgs});
}
await add('contracts.md','contract',await readFile(join(root,'conformance/agent4/contracts.md')));
await add('dialogue/reply-3.bin','synthetic-fixture',Buffer.from([3,0,0,0,0,0,0,0]));
await add('model-invocation-v3.md','contract',await readFile(join(root,'docs/model-invocation-v3.md')));
await add('prescribed-provider.json','synthetic-fixture',Buffer.from(JSON.stringify({
  status:'completed',error:null,output:[{type:'function_call',status:'completed',
    call_id:'synthetic-answer',name:'proposal',arguments:JSON.stringify({replacement:'A fixture revision.\n',score:9})}],
},null,2)+'\n'));
files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
examples.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
await writeFile(join(output,'inventory.json'),JSON.stringify({format:'agent4-use-inventory/v1',examples,files},null,2)+'\n');
