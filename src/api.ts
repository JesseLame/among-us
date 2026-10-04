import { errors, type ErrorCode, type Lobby } from '../shared/protocol';

export async function request<T = { lobby: Lobby | null }>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
    });
  } catch { throw new Error('CONNECTION_ERROR'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'SERVER_ERROR');
  return data;
}

export function codeFor(error: unknown): ErrorCode {
  return error instanceof Error && errors.includes(error.message as ErrorCode) ? error.message as ErrorCode : 'SERVER_ERROR';
}

// randomUUID is HTTPS-only in some browsers; getRandomValues also works for LAN testing.
export function commandId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
