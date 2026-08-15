import { compilePattern } from "./pattern.mjs";
import { notFound } from "./errors.mjs";

export class Router {
  #routes = [];

  add(pattern, handler) {
    this.#routes.push({ compiled: compilePattern(pattern), handler });
    return this;
  }

  resolve(path) {
    for (const route of this.#routes) {
      const params = route.compiled.match(path);
      if (params !== null) {
        return { kind: "match", handler: route.handler, params };
      }
    }
    return notFound();
  }
}
