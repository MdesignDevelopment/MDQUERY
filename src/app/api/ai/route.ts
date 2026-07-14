import { handler } from '@/lib/api';
import { fallbackResponse, providerConfigured, streamChat, type AiMode } from '@/lib/ai';
import { HttpError } from '@/lib/store';

/**
 * AI Query Copilot endpoint (§2.3). Runs server-side so no key reaches the
 * browser. Only receives the open query's text + the instruction — never any
 * schema context (none exists anywhere in this platform).
 */
export const POST = handler(async (req) => {
  const { mode, body, instruction } = await req.json();
  if (!['edit', 'explain', 'review'].includes(mode)) throw new HttpError(400, 'Bad mode');
  const text = String(body ?? '');
  if (text.length > 100_000) throw new HttpError(413, 'Query too large for the copilot.');

  if (!providerConfigured()) {
    return new Response(fallbackResponse(mode as AiMode, text, String(instruction ?? '')), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-ai-source': 'fallback' },
    });
  }
  try {
    const stream = await streamChat(mode as AiMode, text, String(instruction ?? ''));
    return new Response(stream, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-ai-source': 'provider' },
    });
  } catch (e) {
    return new Response(`AI provider error: ${(e as Error).message}\n\nFalling back to static analysis:\n\n${fallbackResponse(mode as AiMode, text, String(instruction ?? ''))}`, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-ai-source': 'fallback-error' },
    });
  }
});
