import { randomUUID } from 'crypto';
import { put } from '@vercel/blob';
import { handler, json, idParam } from '@/lib/api';
import { HttpError, loadQuery } from '@/lib/store';

/**
 * Uploads a screenshot for a query's Documentation tab to Vercel Blob.
 * Stored with `access: 'private'` (the provisioned store is private, and
 * screenshots of support emails are exactly the kind of content that
 * shouldn't be reachable by anyone with the URL) — returns our own proxy
 * path instead of the blob's storage URL; see
 * src/app/api/blob/documentation/[id]/[filename]/route.ts for the read side.
 *
 * Gated by the exact same edit permission as the query body itself (private
 * owner, or curator/admin for public entries) — documentation isn't yet
 * part of the public "propose edit" review flow, so only direct-edit
 * holders can attach images (§ README v1 scoping).
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
  const q = await loadQuery(id, user);
  const editable = !q.is_public ? q.owner_id === user.id : (user.role === 'curator' || user.role === 'admin');
  if (!editable) throw new HttpError(403, 'You do not have edit access to this query.');

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
