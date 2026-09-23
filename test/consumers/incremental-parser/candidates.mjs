// Test-only implementations. Production proposers, validators and prompts do not import this file.
export const decodedFields = `
export const initial = () => ({ offset:0, fields:[], field:[], escape:null, started:false, status:'open' });
export function step(s, chunk, end) {
  const records=[];
  if(s.status!=='open') return {next_state:s,newly_completed_records:records,status:s.status,...(s.error?{error:s.error}:{})};
  const fail=(code,offset)=>{s.status='failed';s.error={code,offset};};
  for(const b of chunk){
    const offset=s.offset++;s.started=true;
    if(s.escape!==null){
      if(b===92||b===44)s.field.push(b);else if(b===110)s.field.push(10);else {fail('InvalidEscape',offset);break;}
      s.escape=null;
    }else if(b===92)s.escape=offset;
    else if(b===44){s.fields.push(s.field);s.field=[];}
    else if(b===10){s.fields.push(s.field);records.push(s.fields);s.fields=[];s.field=[];s.started=false;}
    else s.field.push(b);
  }
  if(end&&s.status==='open'){
    if(s.escape!==null)fail('DanglingEscape',s.escape);
    else if(s.started)fail('UnterminatedRecord',s.offset);
    else s.status='complete';
  }
  return {next_state:s,newly_completed_records:records,status:s.status,...(s.error?{error:s.error}:{})};
}`;

export const rawRecords = `
export function initial(){return {offset:0,pending:[],escape:false,status:'open'};}
function decode(record){
  const fields=[[]];let quoted=false;
  for(const b of record){
    if(quoted){fields.at(-1).push(b===110?10:b);quoted=false;}
    else if(b===92)quoted=true;
    else if(b===44)fields.push([]);
    else fields.at(-1).push(b);
  }
  return fields;
}
export function step(old,chunk,end){
  if(old.status!=='open')return {next_state:old,newly_completed_records:[],status:old.status,...(old.error?{error:old.error}:{})};
  const s={...old,pending:[...old.pending]}, records=[];
  for(const b of chunk){
    const at=s.offset++;
    if(s.escape){
      if(b!==92&&b!==44&&b!==110){s.status='failed';s.error={code:'InvalidEscape',offset:at};break;}
      s.pending.push(b);s.escape=false;
    }else if(b===10){records.push(decode(s.pending));s.pending=[];}
    else {s.pending.push(b);s.escape=b===92;}
  }
  if(end&&s.status==='open'){
    if(s.escape){s.status='failed';s.error={code:'DanglingEscape',offset:s.offset-1};}
    else if(s.pending.length){s.status='failed';s.error={code:'UnterminatedRecord',offset:s.offset};}
    else s.status='complete';
  }
  return {next_state:s,newly_completed_records:records,status:s.status,...(s.error?{error:s.error}:{})};
}`;
export const rejectAll = `export const initial=()=>({});export const step=s=>({next_state:s,newly_completed_records:[],status:'failed',error:{code:'InvalidEscape',offset:0}});`;
export const bufferUntilEOF = decodedFields.replace('const records=[];', 'const records=s.buffer??[];').replace('return {next_state:s,newly_completed_records:records,status:s.status,...(s.error?{error:s.error}:{})};\n}', "s.buffer=end?[]:records;return {next_state:s,newly_completed_records:end?records:[],status:s.status,...(s.error?{error:s.error}:{})};\n}");
export const wrongOffset = decodedFields.replace("fail('InvalidEscape',offset)", "fail('InvalidEscape',0)");
export const globalState = decodedFields.replace('export function step(s, chunk, end) {', 'let saved=initial(); export function step(ignored, chunk, end) {const s=saved;');
export const keepsHistory = decodedFields.replace('const offset=s.offset++;s.started=true;', 's.history=(s.history??[]);s.history.push(b);const offset=s.offset++;s.started=true;');
// Alternate task meaning; still test-only, never supplied to production prompts.
export const emitFinalRecord = decodedFields.replace("else if(s.started)fail('UnterminatedRecord',s.offset);",
  "else if(s.started){s.fields.push(s.field);records.push(s.fields);s.fields=[];s.field=[];s.started=false;s.status='complete';}");
// Fixed overhead is not accumulated completed-input history.
export const fixedTable = decodedFields.replace('offset:0,', "lookup:'x'.repeat(3072),offset:0,");
export const lazyTable = decodedFields.replace('const records=[];', "const records=[];if(!s.lookup)s.lookup='x'.repeat(3072);");
export const malformedRows = `export const initial=()=>({});export const step=s=>({next_state:s,newly_completed_records:'bad',status:'complete'});`;
