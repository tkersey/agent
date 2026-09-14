/** The canonical World record remains authoritative; these types add no state. */
export type WorldOutcome = {
  readonly bytes: Uint8Array;
  readonly [key: string]: unknown;
} & (
  | { readonly kind: 'Requested'; readonly state: Uint8Array; readonly request: Uint8Array }
  | { readonly kind: 'Progressed' | 'Yielded'; readonly state: Uint8Array }
  | { readonly kind: 'Completed'; readonly value: Uint8Array }
  | { readonly kind: 'Failed'; readonly value: Uint8Array; readonly cleanupFailures: readonly unknown[] }
  | { readonly kind: 'Cancelled'; readonly reason: string | Uint8Array; readonly cleanupFailures: readonly unknown[] }
  | { readonly kind: 'NeedsCapacity' }
);
export type PendingView = { readonly authoritative: false } & (
  | { readonly kind: 'Requested'; readonly classification: string;
      readonly request: Readonly<Record<string, unknown>>;
      readonly interaction?: Readonly<Record<string, unknown>> }
  | { readonly kind: Exclude<WorldOutcome['kind'], 'Requested'> }
);
export interface WorldBridge {
  readonly identity: { readonly entrypoint: string; readonly kernelPath: string;
    readonly kernelSha256: string; readonly [key: string]: unknown };
  start(image: Uint8Array, initialArgs: Uint8Array): Promise<WorldOutcome>;
  resume(image: Uint8Array, state: Uint8Array, request: Uint8Array,
    canonicalReply: Uint8Array): Promise<WorldOutcome>;
  cancel(image: Uint8Array, state: Uint8Array, reason: string | Uint8Array): Promise<WorldOutcome>;
  inspectPending(outcome: WorldOutcome | Uint8Array): PendingView;
  decodeOutcome(bytes: Uint8Array): WorldOutcome;
}
export function loadWorldRuntime(options: {
  runtimePath: string;
  lockPath?: string;
}): Promise<WorldBridge>;
