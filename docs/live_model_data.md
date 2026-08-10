# Live model data

The explicit live proof sends only the controlled fixture repository to the
OpenAI Responses API. It never targets a personal, work, or source repository.
Before the first request the harness prints the data boundary and requires an
interactive `yes` confirmation.

Each request contains the static Agent instructions, action catalog, fixture
goal, counters, phase, and bounded observation history. Repository contents are
untrusted prompt data. The request sends no OpenAI tools and sets `store: false`
and `background: false`; it supplies neither conversation state nor a previous
response ID.

`OPENAI_API_KEY` and `OPENAI_MODEL` enter receiver context only. The API key is
never an EffectRequest, Machine value, host-store value, diagnostic, or public
receipt field. The public receipt records model identities, token counts, and
hashed response IDs but excludes prompts, repository bytes, raw model output,
approval input, and credentials.

When a provider failure does not expose redacted usage claims, the failed-attempt
receipt sets aggregate token counts to `null`, retains any prior successful calls
under `known_*_tokens`, and records `provider_usage_complete: false`. It never
represents unavailable billable usage as zero.

`store: false` is not a zero-retention claim. Provider abuse-monitoring and
account-level data controls may still apply. Use this lane only with the
checked-in fixture data.

The model proposes exactly one typed Action per call. It cannot execute tools,
grant approval, or mutate files. The receiver displays the exact digest-bound
replacement and accepts only:

```text
approve <first-12-hex-of-request-id>
```

Any other input denies the mutation.
