import { deflateSync } from "node:zlib";

// Self-contained generators for the two binary demo kinds (image + PDF) so the
// seed ships real, sniffable bytes — a valid PNG and a valid one-page PDF — with
// no external asset files or image libraries. Text kinds (html/svg/md/json/csv/
// code) are plain strings and live in seed.ts.

// ── PNG ────────────────────────────────────────────────────────────────────
// Minimal truecolor-alpha (RGBA) PNG encoder: one IDAT, no scanline filtering.
// Enough to emit a legible bar chart the gallery previews as a real image.

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

type Rgb = [number, number, number];

// Encode an RGBA pixel buffer (row-major, width*height*4) as a PNG.
function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 10..12 = compression / filter / interlace = 0

  // Prefix each scanline with filter byte 0 (none).
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = new Uint8Array(deflateSync(raw));

  return concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

// A labelled-looking bar chart on a light card. Deterministic, so re-seeding
// produces byte-identical content.
export function barChartPng(values: number[]): Uint8Array {
  const width = 360;
  const height = 200;
  const bg: Rgb = [248, 250, 252];
  const axis: Rgb = [203, 213, 225];
  const bar: Rgb = [37, 99, 235];

  const rgba = new Uint8Array(width * height * 4);
  const set = (x: number, y: number, [r, g, b]: Rgb) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = (y * width + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  };

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, bg);

  const marginX = 32;
  const baseline = height - 28;
  const top = 24;
  const max = Math.max(...values, 1);
  const slot = (width - marginX * 2) / values.length;
  const barW = Math.floor(slot * 0.6);

  // Baseline axis.
  for (let x = marginX; x < width - marginX; x++) set(x, baseline, axis);

  values.forEach((value, index) => {
    const h = Math.round(((baseline - top) * value) / max);
    const x0 = Math.round(marginX + index * slot + (slot - barW) / 2);
    for (let x = x0; x < x0 + barW; x++) {
      for (let y = baseline - h; y < baseline; y++) set(x, y, bar);
    }
  });

  return encodePng(width, height, rgba);
}

// ── PDF ────────────────────────────────────────────────────────────────────
// A minimal, valid one-page PDF with byte-accurate cross-reference offsets, so
// the browser's native viewer renders it and `unpdf` can extract its text.

function pdfEscape(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

// `lines` render top-to-bottom in a single Helvetica text block.
export function simplePdf(lines: string[]): Uint8Array {
  const content = [
    "BT",
    "/F1 16 Tf",
    "72 720 Td",
    "20 TL",
    ...lines.flatMap((line) => [`(${pdfEscape(line)}) Tj`, "T*"]),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = body.length;
  const count = objects.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(body + xref + trailer);
}
