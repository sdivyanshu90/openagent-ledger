const sensitiveKey =
  /authorization|cookie|password|secret|token|api[-_]?key|credit[-_]?card/i;
const bearer = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(bearer, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redact(child),
      ]),
    );
  }
  return value;
}
