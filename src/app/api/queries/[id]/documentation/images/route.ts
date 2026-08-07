import { randomUUID } from 'crypto';
import { put } from '@vercel/blob';
import { handler, json, idParam } from '@/lib/api';
import { isCuratorOrAdmin } from '@/lib/auth';
import { HttpError, loadQuery } from '@/lib/store';

/**
 * Uploads a screenshot for a query's Documentation tab to Vercel Blob.
 * Stored with `access: 'private'` (the provisioned store is private, and
 * screenshots of support emails are exactly the kind of content that
 * shouldn't be reachable by anyone with the URL) — returns our own proxy
 * path instead of the blob's storage URL; see
 * src/app/api/blob/documentation/[id]/[filename]/route.ts for the read side.
 *
 * Gated the same as saveQueryDocumentation: curators/admins only, regardless
 * of query ownership or public/private status.
 */
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MAX_BYTES = 8 * 1024 * 1024;

export const POST = handler(async (req, user, params) => {
  const id = idParam(params);
  await loadQuery(id, user); // throws 404/403 per the usual visibility rule
  if (!isCuratorOrAdmin(user)) throw new HttpError(403, 'Only curators/admins can edit documentation.');

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new HttpError(503, 'Image storage is not configured (BLOB_READ_WRITE_TOKEN unset) — see .env.example.');
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'No file provided');
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) throw new HttpError(400, 'Only PNG, JPEG, GIF, or WEBP images are allowed.');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'Image too large (max 8 MB).');

  const filename = `${randomUUID()}.${ext}`;
  await put(`documentation/query-${id}/${filename}`, file, {
    access: 'private',
    contentType: file.type,
    addRandomSuffix: false,
  });
  return json({ url: `/api/blob/documentation/${id}/${filename}` }, 201);
});
