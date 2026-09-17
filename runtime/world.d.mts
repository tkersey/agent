/** The canonical World record remains authoritative; these types add no state. */
export type WorldOutcome = {
  readonly bytes: Uint8Array;
  readonly [key: string]: unknown;
} & (
  | { readonly kind: 'requested'; readonly state: Uint8Array | null; readonly request: Uint8Array }
  | { readonly kind: 'progressed' | 'yielded'; readonly state: Uint8Array | null }
  | { readonly kind: 'completed'; readonly value: Uint8Array }
  | { readonly kind: 'failed'; readonly value: Uint8Array; readonly cleanupFailures: readonly Uint8Array[]; readonly cancellation: WorldReason | null }
  | { readonly kind: 'cancelled'; readonly reason: WorldReason; readonly cleanupFailures: readonly Uint8Array[] }
  | { readonly kind: 'needs_capacity' }
);
export type WorldReason = { readonly kind: 'text'; readonly value: string } | { readonly kind: 'bytes'; readonly value: Uint8Array };
export type PendingView = { readonly authoritative: false } & (
  | { readonly kind: 'requested'; readonly classification: string;
      readonly request: Readonly<Record<string, unknown>>;
      readonly interaction?: Readonly<Record<string, unknown>> }
  | { readonly kind: Exclude<WorldOutcome['kind'], 'requested'> }
);
export interface WorldBridge {
  readonly identity: { readonly entrypoint: string; readonly kernelPath: string;
    readonly kernelSha256: string; readonly [key: string]: unknown };
  start(image: Uint8Array, initialArgs: Uint8Array): Promise<WorldOutcome>;
  resume(image: Uint8Array, state: Uint8Array, request: Uint8Array,
    canonicalReply: Uint8Array): Promise<WorldOutcome>;
  cancel(image: Uint8Array, state: Uint8Array, reason: string | Uint8Array): Promise<WorldOutcome>;
  continueExecution(image: Uint8Array, outcome: WorldOutcome | Uint8Array): Promise<WorldOutcome>;
  inspectPending(outcome: WorldOutcome | Uint8Array): Promise<PendingView>;
  decodeOutcome(bytes: Uint8Array): WorldOutcome;
}
export function loadWorldRuntime(options: {
  runtimePath: string;
  lockPath?: string;
  limits?: { input: number | bigint; working: number | bigint; output: number | bigint };
}): Promise<WorldBridge>;
