import { canonicalAllow } from "./methods.mjs";

export function notFound() {
  return { kind: "not_found" };
}

export function methodNotAllowed(allow) {
  return { kind: "method_not_allowed", allow: canonicalAllow(allow) };
}
