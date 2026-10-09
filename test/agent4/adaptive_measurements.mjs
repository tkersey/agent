// Bounded offline layout comparison over the actually captured workload.
// Alternative prompt layouts are not dispatched or called behaviorally qualified.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {observe, visibleProjection, commonPrefix, markers} from '../../runtime/adaptive/observations.mjs';
import {parse, canonical} from '../../runtime/adaptive/json.mjs';
import {hash} from '../../runtime/adaptive/codec.mjs';

export function measureAdaptive(ctx, rows, resources = {}) {
  rows.sort((left, right) => Number(ctx.codec.decode('AdaptivePrepared', left.prepared).request.plan.watermark -
    ctx.codec.decode('AdaptivePrepared', right.prepared).request.plan.watermark));
  let prior = null;
  const calls = rows.map(row => {
    const measured = observe(ctx.codec, row.prepared, row.captured, {previous: prior, requestMilliseconds: row.request_ms ?? null});
    prior = row.prepared; assert(measured.newly_marked_positions.length <= 2, 'bounded new cache-write selections'); return measured;
  });
  const bodies = ctx.catalog.skills.map(skill => ({id: skill.id, body: Buffer.from(ctx.object(skill.instructions)).toString('utf8')}));
  const textMessage = text => ({role: 'developer', content: [{type: 'input_text', text}]});
  const layouts = {projected: [], eager: [], naive: []};
  for (const row of rows) {
    const prepared = ctx.codec.decode('AdaptivePrepared', row.prepared), request = prepared.request;
    const body = parse(prepared.body, 256 * 1024);
    assert.equal(hash(canonical(body)), hash(prepared.body));
    const retained = body.input.filter(item => !(item.role === 'developer' && item.content?.length === 1 &&
      bodies.some(skill => item.content[0]?.text === skill.body)));
    layouts.projected.push(body);
    layouts.eager.push({...body, input: [retained[0], ...bodies.map(skill => textMessage(skill.body)), ...retained.slice(1)]});
    const current = request.plan.skills.filter(skill => skill.residency === 'resident' || skill.active)
      .map(skill => bodies.find(entry => entry.id === skill.skill_id).body);
    layouts.naive.push({...body, input: [retained[0], ...(current.length ? [textMessage(`Current skill instructions:\n${current.join('\n')}`)] : []), ...retained.slice(1)]});
  }
  const comparison = Object.entries(layouts).map(([name, inputs]) => {
    let prior = null, common = 0;
    const sizes = inputs.map((body, index) => {
      assert.deepEqual(body.tool_choice, layouts.projected[index].tool_choice, 'same request-time action offers');
      const visible = visibleProjection(body); common += commonPrefix(prior, visible); prior = visible; return canonical(body).length;
    });
    return {policy: name, recorded_requests: inputs.length, additional_inferences: 0, request_bytes: sizes,
      total_request_bytes: sizes.reduce((sum, n) => sum + n, 0), summed_local_visible_prefix_bytes: common,
      actual_execution: name === 'projected' ? 'controlled fixture' : 'not executed',
      hard_eviction: name === 'eager' ? 'fails by retaining all approved skill bodies' : name === 'projected' ? 'qualified by task trace' : 'body exclusion only; altered prompt behavior unqualified',
      cache_hits: null, billed_cost: null};
  });
  const transientIndices = rows.flatMap((row, index) => ctx.codec.decode('AdaptivePrepared', row.prepared).request.plan.skills.some(skill => skill.residency === 'transient' && skill.active) ? [index] : []);
  assert(transientIndices.length >= 2 && transientIndices.at(-1) < rows.length - 1, 'repeat transient use before physical unload');
  const transientIndex = transientIndices[0];
  const transient = layouts.projected[transientIndex], active = ctx.codec.decode('AdaptivePrepared', rows[transientIndex].prepared).request.plan.skills.find(skill => skill.residency === 'transient' && skill.active);
  const transientBody = bodies.find(skill => skill.id === active.skill_id).body;
  const transientPosition = transient.input.findIndex(item => item.content?.some(part => part.text === transientBody));
  assert(transientPosition >= 0);
  for (const index of transientIndices) {
    const body = layouts.projected[index];
    const position = body.input.findIndex(item => item.content?.some(part => part.text === transientBody));
    assert(position >= 0 && markers(body).every(path => Number(path.match(/^input\[(\d+)\]/)[1]) < position), 'transient body follows every selected write boundary');
  }
  assert(calls[transientIndices[1]].local_visible_prefix_bytes < visibleProjection(layouts.projected[transientIndex]).length,
    'reinjecting transient material after new history does not preserve the old whole-request prefix');
  const containsText = value => typeof value === 'string' ? value.includes(transientBody) : value && typeof value === 'object' ? Object.values(value).some(containsText) : false;
  assert(!containsText(layouts.projected[transientIndices.at(-1) + 1]), 'next inference physically excludes the unloaded transient body');
  const report = {format: 'adaptive-observations/v1', source_head: process.env.GITHUB_SHA ?? null,
    qualification: 'controlled offline workload; no live provider or cache measurements',
    comparison_scope: 'same recorded provider/work/control workload and callable sets; alternative prompt layouts are rendering counterfactuals, not proof of equal model behavior',
    prewarm_requests: 0, compaction_requests: 0, physical_model_attempts: rows.length, calls, comparison, resources};
  if (process.env.AGENT4_BUILD_PREFIX) {
    const output = join(process.env.AGENT4_BUILD_PREFIX, 'adaptive-use-archive'); mkdirSync(output, {recursive: true});
    writeFileSync(join(output, 'adaptive-observations.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
