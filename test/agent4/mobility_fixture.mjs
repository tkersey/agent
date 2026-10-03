// Test-only discovery/receipt values. No production custody or grants.
export const zeroDigest = Array(32).fill(0);
export const observation = (host, kernelSha256) => [host, zeroDigest, zeroDigest, 'fixture-policy', Array.from(Buffer.from(kernelSha256, 'hex'))];
export const placement = (host, moves, intent) => [[[], [[], { tag: 1, value: host }, { tag: 0, value: null }, 8n << 20n]], intent, 'fixture-shared', [moves, 3]];
export function resolution(input, currentHost, kernelSha256) {
  const constraint = input[1][1];
  const host = constraint.tag === 1 ? constraint.value : currentHost;
  if (!['A', 'B'].includes(host)) return { tag: 2, value: { tag: 0, value: null } };
  const observed = observation(host, kernelSha256);
  return host === currentHost ? { tag: 0, value: observed } : { tag: 1, value: [[observed, 'fixture', { tag: 1, value: 1n }, { tag: 1, value: 1n }, { tag: 1, value: 1n }, 'cost-v1']] };
}
