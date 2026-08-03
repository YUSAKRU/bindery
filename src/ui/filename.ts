/** Characters illegal in a filename on Android/SAF and in Capacitor Filesystem paths. */
const ILLEGAL = /[/\\:*?"<>|]/g;

/**
 * Normalizes user-entered text into a single safe path SEGMENT — never a path.
 * Strips path separators and reserved characters, collapses leading dots so a
 * name can never resolve to `.`/`..`, and trims surrounding whitespace.
 * Returns '' when nothing usable remains; callers must treat '' as invalid.
 */
export function safeFileName(raw: string, options?: { ensurePdf?: boolean }): string {
  const ensurePdf = options?.ensurePdf ?? false;
  const name = raw.trim().replace(ILLEGAL, '_').replace(/^\.+/, '_').trim();

  if (!name || /^[._\s]*$/.test(name)) return '';

  if (ensurePdf && !/\.pdf$/i.test(name)) {
    return `${name}.pdf`;
  }
  return name;
}

/** Same, but strips a trailing `.pdf` — for name inputs that display without the extension. */
export function safeBaseName(raw: string): string {
  return safeFileName(raw, { ensurePdf: false }).replace(/\.pdf$/i, '');
}
