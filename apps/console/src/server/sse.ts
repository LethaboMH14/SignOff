/** Server-sent events. The browser reconnects by itself and sends the last id it saw, so no event is shown twice. */

/** Tells the browser to wait two seconds before it reconnects. */
export const SSE_RETRY_LINE = 'retry: 2000\n\n';

export function sseEvent(name: string, id: number | null, data: unknown): string {
  const lines: string[] = [];
  if (id !== null) {
    lines.push(`id: ${String(id)}`);
  }
  lines.push(`event: ${name}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join('\n')}\n\n`;
}
