/**
 * A minimal, valid, N-page PDF built in memory (Story 5.2).
 *
 * Story 5.2's free tier caps a file at 25 pages, and the interesting cases are
 * 25 and 26 — which no committed fixture can cover without shipping two more
 * binaries, and which a mocked page count cannot cover at all: a test that stubs
 * `countPdfPages` proves the cap arithmetic and nothing about whether the number
 * was ever read from a real document.
 *
 * The bytes are a real PDF: catalog, page tree, one empty page object per page,
 * and a correct `xref` table so pdf.js takes its normal path rather than its
 * error-recovery one. Nothing is drawn — page *count* is what is under test, and
 * an empty page has no text layer, which also makes this useless as a conversion
 * fixture on purpose.
 *
 * Lives beside the binary fixtures rather than in a test file because both
 * `packages/core` and `apps/hub` need it, and two copies of a PDF writer is one
 * copy too many.
 */
// The return type is inferred rather than annotated `Uint8Array`: the encoder
// produces a `Uint8Array<ArrayBuffer>`, and widening it to `ArrayBufferLike` makes
// it unassignable to `BlobPart`, i.e. unusable in the `new File([...])` a route
// test needs.
export function syntheticPdf(pageCount: number) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(`syntheticPdf needs at least one page; got ${String(pageCount)}.`);
  }

  // Object 1 is the catalog, 2 the page tree, 3..n+2 the pages.
  const kids = Array.from({ length: pageCount }, (_, index) => `${3 + index} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [ ${kids} ] /Count ${pageCount} >>`,
    ...Array.from(
      { length: pageCount },
      () => '<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 200 200 ] >>',
    ),
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    // Byte offsets, and the header/objects are pure ASCII, so string length is
    // the byte offset. Keep it that way if this ever grows content streams.
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = body.length;
  const size = objects.length + 1;
  body += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}
