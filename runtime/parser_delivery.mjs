// Fixture-scoped file leaves; the Program owns acceptance, approval and ordering.
import assert from 'node:assert/strict';
import {createRepositoryDelivery} from './repository_delivery.mjs';
import {contractFor} from './parser_oracle.mjs';
export async function createParserDelivery({root,eofPolicy='strict'}) {
  const parserContract=contractFor(eofPolicy);
  const files=await createRepositoryDelivery({root});
  function admit(value) {
    if(!Array.isArray(value)||value.length!==5)throw new TypeError('parser proposal');
    const [request,principal,subject,version,assessment]=value;
    if(!Array.isArray(request)||request.length!==4||request[0]!=='parser.mjs'||
      !Array.isArray(subject)||subject.length!==5||typeof version!=='bigint'||version<1n||
      !Array.isArray(assessment)||assessment.length!==5)throw new TypeError('parser proposal fields');
    assert.equal(request[1],subject[0]);assert.equal(subject[4],parserContract);
    assert.equal(assessment[0],true);assert.equal(assessment[1],assessment[2]);
    assert.ok(assessment[1]>0);assert.equal(assessment[3],true);
    return structuredClone(value);
  }
  return Object.freeze({
    async read(value) {
      const proposal=admit(value),result=await files.read(proposal.slice(0,2));
      return result.tag===0?{tag:0,value:proposal}:result;
    },
    async replace(value) {const proposal=admit(value);return files.replace(proposal.slice(0,2));},
  });
}
