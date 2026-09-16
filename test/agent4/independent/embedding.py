"""Run one canonical World ABI 3 input through an independent WASM engine.

Usage: embedding.py KERNEL_PATH EXPECTED_SHA256 INPUT_PKI3_PATH

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


PREFIX = "world_"
SIGNATURES = {
    "abi_version": ((), ("i32",)), "initialize": (("i64",), ("i32",)),
    "set_limits": (("i64",) * 4, ("i32",)), "prepare_input": (("i64",) * 2, ("i32",)),
    "input_ptr": ((), ("i32",)), "input_capacity": ((), ("i64",)),
    "output_ptr": ((), ("i32",)), "output_len": ((), ("i64",)),
    "error_ptr": ((), ("i32",)), "error_len": ((), ("i64",)),
    "prepared_handle": ((), ("i64",)), "session_handle": ((), ("i64",)),
    "working_live": ((), ("i64",)), "working_peak": ((), ("i64",)),
    "invoke": (("i64",) * 2, ("i32",)), "prepare": (("i64",) * 2, ("i32",)),
    "release_prepared": (("i64",) * 2, ("i32",)), "start": (("i64",) * 3, ("i32",)),
    "restore": (("i64",) * 3, ("i32",)),
    "drive": (("i64", "i64", "i32", "i32", "i64", "i32", "i64"), ("i32",)),
    "checkpoint": (("i64", "i64", "i32"), ("i32",)), "close": (("i64",) * 2, ("i32",)),
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


def reject_start(code: bytes) -> None:
    if code[:8] != b"\0asm\x01\0\0\0":
        raise AdmissionError("invalid WASM header")
    cursor = 8
    while cursor < len(code):
        section = code[cursor]
        cursor += 1
        if section == 8:
            raise AdmissionError("WASM start function is forbidden")
        size = 0
        for shift in range(0, 35, 7):
            if cursor == len(code):
                raise AdmissionError("truncated WASM section")
            byte = code[cursor]
            cursor += 1
            if shift == 28 and byte > 15:
                raise AdmissionError("invalid WASM section length")
            size |= (byte & 127) << shift
            if not byte & 128:
                break
        else:
            raise AdmissionError("invalid WASM section length")
        if size > len(code) - cursor:
            raise AdmissionError("truncated WASM section")
        cursor += size


def invoke(kernel: bytes, request: bytes) -> bytes:
    reject_start(kernel)
    config = wasmtime.Config()
    config.wasm_threads = False
    config.wasm_memory64 = False
    config.wasm_gc = False
    config.wasm_exceptions = False
    config.wasm_tail_call = False
    config.wasm_relaxed_simd = False
    config.wasm_simd = False
    engine = wasmtime.Engine(config)
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

    if call("abi_version") != 3:
        raise AdmissionError("expected World ABI version 3")
    if call("initialize", 1) != 0:
        raise AdmissionError("World initialization failed")
    prepared = call("prepare_input", 1, len(request))
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
        executed = call("invoke", 1, len(request))
        if executed == 2:
            rejected("execution")
        if executed not in (0, 1):
            raise AdmissionError("World ABI returned an invalid execution status")
    outcome = detached("output")
    if not outcome:
        raise AdmissionError("World ABI success omitted its outcome")
    return outcome


def main(arguments: list[str]) -> int:
    if len(arguments) != 3:
        raise AdmissionError("usage: embedding.py KERNEL_PATH EXPECTED_SHA256 INPUT_PKI3_PATH")
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
