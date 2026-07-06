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
// Note: a residual DNS-rebinding (TOCTOU) window remains — full mitigation requires
// pinning the resolved IP into the socket, which global fetch doesn't expose; the
// write path is bearer-gated and single-team, so this is proportionate for v1.

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
  const addresses = isIP(hostname)
    ? [hostname]
    : await lookup(hostname, { all: true })
        .then((records) => records.map((r) => r.address))
        .catch(() => {
          throw new InvalidSourceUrlError(`cannot resolve host ${hostname}`);
        });

  if (addresses.length === 0) throw new InvalidSourceUrlError(`cannot resolve host ${hostname}`);
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
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isDisallowedV4(mapped[1]); // IPv4-mapped
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
  return false;
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
