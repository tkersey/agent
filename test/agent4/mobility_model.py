# Specification v1.0 section 25; bounded single-transfer abstraction.
from collections import deque
from dataclasses import dataclass, replace

@dataclass(frozen=True)
class State:
    source: str = 'active'
    target: str = 'absent'
    offered: bool = False
    pending_effect: bool = False
    source_up: bool = True
    target_up: bool = True

def transitions(s, unsafe_timeout=False):
    def step(label, **changes):
        return label, replace(s, **changes)
    yield step('source crash/restart', source_up=not s.source_up)
    yield step('target crash/restart', target_up=not s.target_up)
    if s.source_up and s.source == 'active' and not s.offered:
        if not s.pending_effect:
            yield step('start source effect', pending_effect=True)
            yield step('durably freeze and publish offer', source='frozen', offered=True)
        else:
            yield step('reconcile and settle source effect', pending_effect=False)
    # Messages may be delayed, redelivered, or never delivered. An authenticated
    # offer is available only after durable source freeze; a refusal is permanent.
    if s.target_up and s.offered and s.target == 'absent':
        yield step('deliver offer: durable acceptance', target='accepted')
        yield step('deliver withdraw/reject: durable refusal', target='refused')
    if s.source_up and s.source == 'frozen':
        if s.target_up and s.target == 'accepted':
            yield step('receive accepted receipt', source='moved')
        if s.target_up and s.target == 'refused':
            yield step('receive refused receipt', source='active')
        if unsafe_timeout:
            yield step('UNSAFE: timeout reactivates source', source='active')

def violation(s):
    if s.source == 'active' and s.target == 'accepted':
        return 'two custodians'
    if s.offered and s.pending_effect:
        return 'offer while an external occurrence is unsettled'
    if s.source == 'moved' and s.target != 'accepted':
        return 'retirement without acceptance'
    return None

def explore(unsafe_timeout=False):
    start = State()
    queue = deque([start])
    predecessor = {start: None}
    while queue:
        state = queue.popleft()
        if violation(state):
            trace = []
            cursor = state
            while predecessor[cursor] is not None:
                previous, action = predecessor[cursor]
                trace.append(action)
                cursor = previous
            return len(predecessor), violation(state), list(reversed(trace))
        for action, successor in transitions(state, unsafe_timeout):
            if successor not in predecessor:
                predecessor[successor] = (state, action)
                queue.append(successor)
    return len(predecessor), None, []

if __name__ == '__main__':
    count, error, trace = explore()
    assert error is None, (error, trace)
    print(f'PASS: {count} reachable states in the one-transfer abstraction')
    _, error, trace = explore(unsafe_timeout=True)
    assert error == 'two custodians', (error, trace)
    print('Expected counterexample for timeout takeover:')
    print(' -> '.join(trace))
