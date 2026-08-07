import sanitizeHtml from 'sanitize-html';

/**
 * Sanitizes rich-text documentation HTML before it's ever persisted.
 *
 * This is the actual security boundary (not client-side cleanup): every
 * write path into `queries.documentation` must run content through here,
 * since it's later rendered with dangerouslySetInnerHTML. Uploaded images
 * are referenced by our own same-origin proxy path (/api/blob/...), which
 * carries no scheme and passes the allowlist below untouched; no data:
 * URIs, no javascript: hrefs, no inline style/script/event-handler
 * attributes are permitted either way.
 */
export function sanitizeDocumentationHtml(html: string): string {
  return sanitizeHtml(html ?? '', {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'img'],
    allowedAttributes: {
      a: ['href'],
      img: ['src', 'alt'],
    },
    allowedSchemesByTag: {
      a: ['https', 'mailto'],
      img: ['https'],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
    // Anything not in allowedTags is unwrapped (text kept, tag dropped) rather
    // than removed outright, so pasted rich text degrades to plain text.
    disallowedTagsMode: 'discard',
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    enforceHtmlBoundary: true,
  }).trim();
}
