# Incremental byte-record parser

Replace the supplied batch parser with a module exporting `initial()` and
`step(state, chunk, endOfInput)`. Chunks and fields are arrays of integers 0–255;
records are arrays of fields. `initial()` returns JSON-serializable ordinary state.
`step` returns `{next_state, newly_completed_records, status, error?}`. Status is
`open`, `complete`, or `failed`. Error is `{code, offset}`.

Literal LF terminates a record; comma separates fields. Backslash-backslash,
backslash-comma and backslash-n encode literal backslash, comma and LF. Every other
non-delimiter byte, including CR and non-UTF-8 bytes, is ordinary content. Empty
fields are valid; empty input has no records; LF alone is one empty field.

Unsupported escapes fail at the escaped byte's absolute offset. At final EOF,
a pending backslash fails as DanglingEscape at the backslash offset; any other
unfinished record fails as UnterminatedRecord at the end offset. Records completed
before an error remain observable. No later record may be emitted after failure.

Emit complete records in the call receiving their terminator. Empty non-final
chunks preserve lexical state. Finalization without error returns complete.
Calls after completion/failure return the same terminal status/error, unchanged
state, and no records. Each call runs in a fresh execution context with only the
previous serialized state. No module globals or process handles persist.

Completed input history must not accumulate in state. Unfinished fields/records
may legitimately grow. The evaluator measures returned serialized state rather
than trusting a self-reported count. The task does not prescribe an implementation
style or a particular patch. Candidate code cannot edit the evaluator or its
required checks.
