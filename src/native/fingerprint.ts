// Pure: no Capacitor, so UI modules and their tests can import it freely.

/** Bytes hashed from each end of the file. */
export const FINGERPRINT_EDGE_BYTES = 8192;

// FNV-1a, 32 bit. Not cryptographic: it only has to tell apart the handful
// of files on one desk, alongside the exact byte length.
function fnv1a(bytes: Uint8Array, start: number, end: number, seed: number): number {
  let hash = seed >>> 0;
  for (let i = start; i < end; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Identifies a file by its content: exact length plus a hash of its first and
 * last 8 KB. Cheap at any size (at most 16 KB is read) and computed from bytes
 * already in memory. Two different PDFs agreeing on length and on both ends
 * is not a case the desk needs to handle; two uris for one file is.
 */
export function fingerprintPdf(bytes: Uint8Array): string {
  const n = bytes.length;
  const headEnd = Math.min(n, FINGERPRINT_EDGE_BYTES);
  const tailStart = Math.max(headEnd, n - FINGERPRINT_EDGE_BYTES);
  const head = fnv1a(bytes, 0, headEnd, 0x811c9dc5);
  const tail = fnv1a(bytes, tailStart, n, head);
  return `${n}:${head.toString(16).padStart(8, '0')}${tail.toString(16).padStart(8, '0')}`;
}
