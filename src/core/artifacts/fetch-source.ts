import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DomainError } from "@/core/errors";
import { MAX_ARTIFACT_BYTES } from "@/lib/validation";
import { FileTooLargeError } from "./errors";

// SSRF-hardened fetch for publish_artifact's `sourceUrl` path (PLAN §4.1 / Decision
// Log 2026-07-06): the server streams bytes for binaries too large for the ~3 MB
// inline/base64 cutoff (Vercel's 4.5 MB request-body limit), up to the 25 MB
// artifact ceiling. Guards: https only, reject private/loopback/link-local/reserved
// hosts, cap redirects (re-validating each hop), and stream-enforce the size cap.
// Accepted residual risk — DNS-rebinding / TOCTOU: assertPublicHost validates the
// DNS-resolved IP, but global `fetch` then re-resolves the hostname independently,
// so a hostile DNS server could answer a public IP to the check and a private IP to
// the fetch. Closing it fully requires pinning the validated IP into the socket via
// a custom http.Agent (`lookup` override) — disproportionate for v1 because this
// path is bearer-gated and single-team (an attacker needs the admin token first).
// Tracked in the PLAN Decision Log with socket-level IP pinning as the future fix.

export class InvalidSourceUrlError extends DomainError {
  readonly code = "invalid_source_url";
  constructor(reason: string) {
    super(
      `sourceUrl rejected: ${reason}. Provide a public https URL to a file up to 25 MB, ` +
        "or pass inline data via `content` or `contentBase64`.",
    );
  }
}

const MAX_REDIRECTS = 3;

export type FetchedSource = { bytes: Uint8Array; contentType?: string; filename?: string };

export async function fetchSourceBytes(rawUrl: string): Promise<FetchedSource> {
  let url = parseHttpsUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);
    const res = await fetch(url, { redirect: "manual", headers: { accept: "*/*" } });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new InvalidSourceUrlError("redirect without a Location header");
      url = parseHttpsUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok) throw new InvalidSourceUrlError(`upstream responded ${res.status}`);

    return {
      bytes: await readCapped(res, MAX_ARTIFACT_BYTES),
      contentType: res.headers.get("content-type") ?? undefined,
      filename: filenameFromUrl(url),
    };
  }
  throw new InvalidSourceUrlError(`too many redirects (>${MAX_REDIRECTS})`);
}

function parseHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidSourceUrlError("not a valid URL");
  }
  if (url.protocol !== "https:") throw new InvalidSourceUrlError("only https URLs are allowed");
  return url;
}

async function assertPublicHost(hostname: string): Promise<void> {
  // URL.hostname wraps IPv6 literals in brackets ("[::1]"), which isIP() rejects —
  // strip them so an IPv6 literal is classified directly instead of falling through
  // to a DNS lookup of a bracketed string (which would only be blocked incidentally).
  const host = hostname.replace(/^\[(.+)\]$/, "$1");
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true })
        .then((records) => records.map((r) => r.address))
        .catch(() => {
          throw new InvalidSourceUrlError(`cannot resolve host ${host}`);
        });

  if (addresses.length === 0) throw new InvalidSourceUrlError(`cannot resolve host ${host}`);
  for (const address of addresses) {
    if (isDisallowedAddress(address)) {
      throw new InvalidSourceUrlError("host resolves to a private or reserved address");
    }
  }
}

function isDisallowedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isDisallowedV4(ip);
  if (family === 6) return isDisallowedV6(ip);
  return true; // unparseable → deny
}

function isDisallowedV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return true;
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isDisallowedV6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === "::1" || addr === "::") return true; // loopback, unspecified
  const embedded = embeddedV4(addr);
  if (embedded) return isDisallowedV4(embedded); // IPv4-mapped, classify the v4
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
  return false;
}

// Extract the embedded IPv4 from an IPv4-mapped IPv6 (::ffff:*), in either the
// dotted form (`::ffff:127.0.0.1`) or the hex form the URL parser normalizes to
// (`::ffff:7f00:1`). Without the hex case, a loopback/private target slips through.
function embeddedV4(v6: string): string | null {
  const tail = v6.match(/^::ffff:(.+)$/)?.[1];
  if (!tail) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return tail;
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex?.[1] || !hex[2]) return null;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) {
    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.length > max) throw new FileTooLargeError(buffer.length);
    return buffer;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new FileTooLargeError(total);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function filenameFromUrl(url: URL): string | undefined {
  const last = url.pathname.split("/").pop();
  return last && last.length > 0 ? decodeURIComponent(last) : undefined;
}
