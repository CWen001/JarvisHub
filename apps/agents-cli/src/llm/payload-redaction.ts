const INLINE_MEDIA_DATA_PATTERN = /data:(?:image|video)\/[a-z0-9.+-]+(?:;[^,]*)?;base64,([a-z0-9+/=\r\n]+)/gi;

function redactInlineMediaDataFromString(value: string): string {
  return value.replace(INLINE_MEDIA_DATA_PATTERN, (match, base64: string) => {
    const commaIndex = match.indexOf(",");
    const prefix = commaIndex >= 0 ? match.slice(0, commaIndex + 1) : "";
    return `${prefix}[redacted base64Chars=${base64.replace(/[\r\n]/g, "").length}]`;
  });
}

export function redactInlineMediaData(value: unknown): unknown {
  if (typeof value === "string") return redactInlineMediaDataFromString(value);
  if (Array.isArray(value)) return value.map((item) => redactInlineMediaData(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactInlineMediaData(item)]),
  );
}
