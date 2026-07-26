export type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`.trim();
    try {
      const body = await response.json() as { error?: string };
      if (body?.error) message = body.error;
    } catch { /* keep status message */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
