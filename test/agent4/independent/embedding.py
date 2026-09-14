"""Run one canonical World Process v2 input through an independent WASM engine.

Usage: embedding.py KERNEL_PATH EXPECTED_SHA256 INPUT_PKI2_PATH

The caller authenticates the exact kernel and admits its full static ABI through
World before invoking this consumer. This consumer rechecks the digest and public
Wasmtime type metadata, transports input bytes, and detaches output bytes. It has
no application handlers or process interpreter and owns no process framing.
"""

import hashlib
import hmac
import re
import sys
from pathlib import Path

import wasmtime


PREFIX = "world_process_v2_"
SIGNATURES = {
    "abi_version": ((), ("i32",)),
    "prepare_input": (("i64",), ("i32",)),
    "input_ptr": ((), ("i32",)),
    "input_capacity": ((), ("i64",)),
    "execute": (("i64",), ("i32",)),
    "output_ptr": ((), ("i32",)),
    "output_len": ((), ("i64",)),
    "error_ptr": ((), ("i32",)),
    "error_len": ((), ("i64",)),
}


class AdmissionError(Exception):
    """An invalid module, invocation, or ABI response supplied no outcome."""


def inspect_types(module: wasmtime.Module) -> None:
    if module.imports:
        raise AdmissionError("World ABI requires an import-free module")
    exports = module.exports
    expected = {"memory", *(PREFIX + name for name in SIGNATURES)}
    if len(exports) != len(expected) or {entry.name for entry in exports} != expected:
        raise AdmissionError("World ABI export inventory mismatch")
    for entry in exports:
        kind = entry.type
        if entry.name == "memory":
            if not isinstance(kind, wasmtime.MemoryType) or kind.is_64 or kind.is_shared:
                raise AdmissionError("World ABI requires unshared wasm32 memory")
            if kind.page_size != 65536:
                raise AdmissionError("World ABI requires standard WASM memory pages")
            continue
        if not isinstance(kind, wasmtime.FuncType):
            raise AdmissionError(f"World ABI export is not a function: {entry.name}")
        signature = (tuple(map(str, kind.params)), tuple(map(str, kind.results)))
        if signature != SIGNATURES[entry.name.removeprefix(PREFIX)]:
            raise AdmissionError(f"World ABI signature mismatch: {entry.name}")


def bounded_range(memory: wasmtime.Memory, store: wasmtime.Store,
                  pointer: int, length: int) -> tuple[int, int]:
    size = memory.data_len(store)
    if pointer > size or length > size - pointer:
        raise AdmissionError("World ABI byte range exceeds current memory")
    return pointer, pointer + length


def invoke(kernel: bytes, request: bytes) -> bytes:
    engine = wasmtime.Engine()
    module = wasmtime.Module(engine, kernel)
    inspect_types(module)
    store = wasmtime.Store(engine)
    instance = wasmtime.Instance(store, module, [])
    exports = instance.exports(store)
    memory = exports["memory"]
    if not isinstance(memory, wasmtime.Memory):
        raise AdmissionError("World ABI memory instance mismatch")

    def call(name: str, *arguments: int) -> int:
        function = exports[PREFIX + name]
        if not isinstance(function, wasmtime.Func):
            raise AdmissionError("World ABI function instance mismatch")
        result = function(store, *arguments)
        if type(result) is not int:
            raise AdmissionError("World ABI returned a non-integer")
        return result

    def detached(name: str) -> bytes:
        # WASM integer results carry unsigned bit patterns. Reread current
        # memory after calls; no native memory view survives an invocation.
        pointer = call(name + "_ptr") & 0xFFFFFFFF
        length = call(name + "_len") & 0xFFFFFFFFFFFFFFFF
        begin, end = bounded_range(memory, store, pointer, length)
        output = bytes(memory.read(store, begin, end))
        if len(output) != length:
            raise AdmissionError("World ABI detached a truncated byte range")
        return output

    def rejected(stage: str) -> None:
        if call("output_len") & 0xFFFFFFFFFFFFFFFF:
            raise AdmissionError("World ABI rejection retained output bytes")
        diagnostic = detached("error")
        if not diagnostic:
            raise AdmissionError("World ABI rejection omitted its diagnostic")
        try:
            message = diagnostic.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise AdmissionError("World ABI diagnostic is not UTF-8") from error
        raise AdmissionError(f"World rejected {stage}: {message}")

    if call("abi_version") != 2:
        raise AdmissionError("expected World Process ABI version 2")
    prepared = call("prepare_input", len(request))
    if prepared == 2:
        rejected("preparation")
    if prepared not in (0, 1):
        raise AdmissionError("World ABI returned an invalid preparation status")
    if prepared == 0:
        pointer = call("input_ptr") & 0xFFFFFFFF
        capacity = call("input_capacity") & 0xFFFFFFFFFFFFFFFF
        bounded_range(memory, store, pointer, capacity)
        if len(request) > capacity:
            raise AdmissionError("World ABI prepared insufficient input capacity")
        if request and memory.write(store, request, pointer) != len(request):
            raise AdmissionError("World ABI input write was incomplete")
        executed = call("execute", len(request))
        if executed == 2:
            rejected("execution")
        if executed != 0:
            raise AdmissionError("World ABI returned an invalid execution status")
    outcome = detached("output")
    if not outcome:
        raise AdmissionError("World ABI success omitted its outcome")
    return outcome


def main(arguments: list[str]) -> int:
    if len(arguments) != 3:
        raise AdmissionError("usage: embedding.py KERNEL_PATH EXPECTED_SHA256 INPUT_PKI2_PATH")
    kernel_path, expected_digest, input_path = arguments
    if re.fullmatch(r"[0-9a-f]{64}", expected_digest) is None:
        raise AdmissionError("expected SHA-256 must be 64 lowercase hexadecimal characters")
    kernel = Path(kernel_path).read_bytes()
    actual_digest = hashlib.sha256(kernel).hexdigest()
    if not hmac.compare_digest(actual_digest, expected_digest):
        raise AdmissionError("kernel SHA-256 does not match the supplied identity")
    request = Path(input_path).read_bytes()
    if len(request) > 0xFFFFFFFF:
        raise AdmissionError("input length exceeds the WASM32 addressable range")
    outcome = invoke(kernel, request)
    sys.stdout.buffer.write(outcome)
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except (AdmissionError, OSError, wasmtime.WasmtimeError, wasmtime.Trap) as error:
        print(f"independent World embedding: {error}", file=sys.stderr)
        raise SystemExit(1) from None
