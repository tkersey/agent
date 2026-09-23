// Frozen-artifact evaluation only. This command has no model or delivery adapter.
import {isUtf8} from 'node:buffer';
import {readRegular} from '../tools/agent4/dependencies.mjs';
import {createParserExecutor,evaluationDisposition} from './parser_executor.mjs';
import {isMain} from './cli.mjs';
export function evaluationOptions(args) {
  const result={split:'heldout',eofPolicy:'strict'},seen=new Set();
  const fields=new Map([['--candidate','candidate'],['--split','split'],['--eof-policy','eofPolicy']]);
  for(let i=0;i<args.length;i++) {
    const name=args[i],field=fields.get(name);
    if(!field||seen.has(name)||!args[i+1]||args[i+1].startsWith('--'))throw new TypeError('unknown, repeated or missing evaluation option');
    seen.add(name);result[field]=args[++i];
  }
  if(!result.candidate||!['development','heldout'].includes(result.split)||!['strict','emit'].includes(result.eofPolicy))
    throw new TypeError('candidate, evaluation split or EOF policy');
  return result;
}
export async function evaluateCandidateFile(options) {
  const bytes=readRegular(options.candidate,8192);
  if(!isUtf8(bytes))throw new TypeError('candidate must be UTF-8 source');
  const executor=await createParserExecutor({evaluation:options.split,eofPolicy:options.eofPolicy});
  if(executor.kind!=='qualified')return {format:'agent-parser-evaluation/v1',status:'unavailable',capability:executor};
  const result=await executor.validate(bytes.toString('utf8'));
  const disposition=evaluationDisposition(result),first=disposition.first;
  return {format:'agent-parser-evaluation/v1',status:disposition.status,
    sourceDigest:result.sourceDigest,runner:result.runner,contract:result.acceptanceContract,
    evaluation:result.evaluation,executed:result.executed,required:result.required,
    retention:result.retention.map(({name,passed,baseline,peak,growth,maximumGrowth})=>({name,passed,baseline,peak,growth,maximumGrowth})),
    firstFailure:first?{name:first.name,kind:first.kind,failures:first.failures}:null,metrics:executor.metrics()};
}
if(isMain(import.meta)) {
  try {
    const result=await evaluateCandidateFile(evaluationOptions(process.argv.slice(2)));
    console.log(JSON.stringify(result));process.exitCode=result.status==='accepted'?0:result.status==='rejected'?1:2;
  }catch(error){console.error(error.message);process.exitCode=2;}
}
