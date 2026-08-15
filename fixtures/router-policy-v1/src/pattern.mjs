function splitPath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) {
    throw new TypeError("path pattern must start with /");
  }
  return value === "/" ? [] : value.slice(1).split("/");
}

export function compilePattern(pattern) {
  const segments = splitPath(pattern);
  const names = new Set();
  let staticSegmentCount = 0;

  const compiled = segments.map((segment) => {
    if (!segment.startsWith(":")) {
      staticSegmentCount += 1;
      return { kind: "static", value: segment };
    }

    const name = segment.slice(1);
    if (name.length === 0 || names.has(name)) {
      throw new TypeError("parameter names must be non-empty and unique");
    }
    names.add(name);
    return { kind: "parameter", name };
  });

  return {
    staticSegmentCount,
    totalSegmentCount: compiled.length,
    match(path) {
      let pathSegments;
      try {
        pathSegments = splitPath(path);
      } catch {
        return null;
      }
      if (pathSegments.length !== compiled.length) return null;

      const params = {};
      for (let index = 0; index < compiled.length; index += 1) {
        const expected = compiled[index];
        const actual = pathSegments[index];
        if (expected.kind === "static") {
          if (expected.value !== actual) return null;
          continue;
        }
        try {
          params[expected.name] = decodeURIComponent(actual);
        } catch {
          return null;
        }
      }
      return params;
    },
  };
}
