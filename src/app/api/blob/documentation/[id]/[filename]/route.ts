import { get } from '@vercel/blob';
import { handler, idParam } from '@/lib/api';
import { HttpError, loadQuery } from '@/lib/store';

/**
 * Streams a Documentation-tab screenshot back from the private Blob store.
 * `<img src="/api/blob/documentation/<id>/<filename>">` hits this route with
 * the viewer's session cookie, so it's gated by loadQuery's existing
 * visibility rule (private → owner only; public → any signed-in user) —
 * the same access control as the query text itself, never a bare public URL.
 */
const FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/i;

export const GET = handler(async (_req, user, params) => {
  const id = idParam(params);
  const filename = params.filename ?? '';
  if (!FILENAME_RE.test(filename)) throw new HttpError(400, 'Bad image path');
  await loadQuery(id, user); // throws 404/403 per the usual visibility rule

  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(503, 'Image storage is not configured.');
  const blob = await get(`documentation/query-${id}/${filename}`, { access: 'private' });
  if (!blob || blob.statusCode !== 200) throw new HttpError(404, 'Image not found');

  return new Response(blob.stream, {
    headers: {
      'content-type': blob.blob.contentType,
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
});
