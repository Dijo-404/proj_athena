export function parseToolArguments(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs !== "string") return rawArgs;
  try {
    return JSON.parse(rawArgs);
  } catch {
    return { __parse_error: true, __raw: rawArgs };
  }
}
