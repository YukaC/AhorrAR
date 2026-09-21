/**
 * Shared product-image extraction (V11). og:image → twitter:image → first
 * meaningful <img>. Generic, regex-only, best-effort, never throws.
 */

import { absoluteUrl } from '../../normalize/url.ts';

function cleanCandidate(src: string): string | null {
  const value = src.replace(/\s+/g, '').trim();
  if (value.length === 0) return null;
  if (/^data:/i.test(value)) return null;
  if (/\.(svg|gif|ico)(\?|#|$)/i.test(value)) return null;
  if (/spacer|pixel|tracking|1x1/i.test(value)) return null;
  return value;
}

function resolve(src: string, pageUrl?: string): string | null {
  if (src.startsWith('//')) src = `https:${src}`;
  const absolute = pageUrl === undefined ? src : absoluteUrl(pageUrl, src);
  return absolute === null ? null : absolute;
}

/** Picks a candidate URL, keeping the longest descriptor (fuller product photo). */
function pick(candidates: string[], pageUrl?: string): string | null {
  for (const c of candidates.sort((a, b) => b.length - a.length)) {
    const url = resolve(c, pageUrl);
    if (url !== null) return url;
  }
  return null;
}

export function extractImage(content: string, pageUrl?: string): string | null {
  const meta = /<meta[^>]*(?:property|name)=(?:"og:image"|"og:image:secure_url"|"twitter:image")[^>]*content="([^"]+)"/i.exec(
    content,
  );
  if (meta !== null) {
    const direct = cleanCandidate(meta[1]!);
    if (direct !== null) return resolve(direct, pageUrl);
  }

  const candidates: string[] = [];
  for (const m of content.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const srcMatch = /\bsrc="([^"]+)"/i.exec(tag);
    if (srcMatch === null) continue;
    const src = cleanCandidate(srcMatch[1]!);
    if (src === null) continue;
    if (/\bclass="[^"]*(icon|emoji|qrcode|logo|badge|payment|flag)/i.test(tag)) continue;
    if (/\b(?:width|height)="\d{1,2}"/.test(tag)) continue;
    if (/style="[^"]*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(tag)) continue;
    candidates.push(src);
  }
  return pick(candidates, pageUrl);
}