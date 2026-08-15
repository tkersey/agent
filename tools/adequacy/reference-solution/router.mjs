import { methodNotAllowed, notFound } from "./errors.mjs";
import { normalizeMethod } from "./methods.mjs";
import { compilePattern } from "./pattern.mjs";

function precedence(left, right) {
  return (
    right.compiled.staticSegmentCount - left.compiled.staticSegmentCount ||
    right.compiled.totalSegmentCount - left.compiled.totalSegmentCount ||
    left.order - right.order
  );
}

export class Router {
  #routes = [];

  add(method, pattern, handler) {
    const normalizedMethod = normalizeMethod(method);
    if (typeof handler !== "string" || handler.length === 0) {
      throw new TypeError("handler must be a non-empty string identifier");
    }
    if (
      this.#routes.some(
        (route) => route.method === normalizedMethod && route.pattern === pattern,
      )
    ) {
      throw new TypeError("duplicate method and pattern registration");
    }

    this.#routes.push({
      method: normalizedMethod,
      pattern,
      handler,
      compiled: compilePattern(pattern),
      order: this.#routes.length,
    });
    return this;
  }

  resolve(method, path) {
    const requestedMethod = normalizeMethod(method);
    const matching = [];
    for (const route of this.#routes) {
      const params = route.compiled.match(path);
      if (params !== null) matching.push({ ...route, params });
    }
    if (matching.length === 0) return notFound();

    let eligible = matching.filter((route) => route.method === requestedMethod);
    if (requestedMethod === "HEAD" && eligible.length === 0) {
      eligible = matching.filter((route) => route.method === "GET");
    }
    if (eligible.length === 0) {
      return methodNotAllowed(matching.map((route) => route.method));
    }

    const selected = eligible.sort(precedence)[0];
    return {
      kind: "match",
      requested_method: requestedMethod,
      selected_method: selected.method,
      handler: selected.handler,
      params: selected.params,
    };
  }
}
