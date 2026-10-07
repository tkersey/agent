"""Validate emitted schemas and captured protocol values with an independent validator."""
import json
import sys

from jsonschema import Draft202012Validator, ValidationError, validators
from referencing import Registry, Resource


def utf8_bytes(validator, maximum, instance, schema):
    if isinstance(instance, str):
        try:
            size = len(instance.encode("utf-8"))
        except UnicodeEncodeError:
            yield ValidationError("invalid Unicode scalar value")
            return
        if size > maximum:
            yield ValidationError("UTF-8 byte limit exceeded")


def local_references(value):
    if isinstance(value, dict):
        if "$ref" in value and not value["$ref"].startswith("#/$defs/"):
            raise ValueError("non-local schema reference")
        for child in value.values():
            local_references(child)
    elif isinstance(value, list):
        for child in value:
            local_references(child)


raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
if len(raw) > 8 * 1024 * 1024:
    raise ValueError("schema qualification input exceeds bound")
packet = json.loads(raw)
schema = packet["schema"]
local_references(schema)
Draft202012Validator.check_schema(schema)
registry = Registry().with_resource(schema["$id"], Resource.from_contents(schema))
Validator = validators.extend(Draft202012Validator, {"x-max-utf8-bytes": utf8_bytes})
for index, case in enumerate(packet["cases"]):
    definition = case["definition"]
    if definition not in schema["$defs"]:
        raise ValueError(f"missing definition: {definition}")
    validator = Validator({**schema, "$ref": f"#/$defs/{definition}"}, registry=registry)
    errors = list(validator.iter_errors(case["value"]))
    if bool(errors) == case.get("accept", True):
        detail = errors[0].message if errors else "unexpected acceptance"
        raise AssertionError(f"case {index} {definition}: {detail}")
print(f"native protocol schemas: {len(packet['cases'])} cases passed")
