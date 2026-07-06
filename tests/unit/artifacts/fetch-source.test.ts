import { afterEach, describe, expect, it, vi } from "vitest";

// Mock DNS so we can drive "hostname resolves to a private IP" without real lookups.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import { FileTooLargeError } from "@/core/artifacts/errors";
import { fetchSourceBytes, InvalidSourceUrlError } from "@/core/artifacts/fetch-source";
import { sniffArtifact } from "@/core/artifacts/sniff";

const mockedLookup = vi.mocked(lookup);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function stubFetch(impl: (url: URL) => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL | string) => Promise.resolve(impl(new URL(String(input))))),
  );
}

// ── (1) https-only ────────────────────────────────────────────────────────────
describe("SSRF: scheme enforcement", () => {
  it.each([
    "http://example.com/x",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "gopher://x/",
  ])("rejects non-https scheme %s", async (url) => {
    await expect(fetchSourceBytes(url)).rejects.toBeInstanceOf(InvalidSourceUrlError);
    await expect(fetchSourceBytes(url)).rejects.toThrow(/only https/i);
  });
});

// ── (2)+(3) IP classifier: private v4, loopback, link-local, metadata, v6 ───────
// IP literals short-circuit the DNS lookup and are classified directly — no fetch.
describe("SSRF: private / reserved IP rejection (literal hosts)", () => {
  it.each([
    ["private 10/8", "https://10.0.0.5/f"],
    ["private 172.16/12", "https://172.16.9.9/f"],
    ["private 192.168/16", "https://192.168.1.1/f"],
    ["loopback 127/8", "https://127.0.0.1/f"],
    ["this-network 0/8", "https://0.0.0.0/f"],
    ["CGNAT 100.64/10", "https://100.64.0.1/f"],
    ["cloud metadata IP", "https://169.254.169.254/latest/meta-data/"],
    ["link-local 169.254/16", "https://169.254.10.10/f"],
    ["IPv6 loopback ::1", "https://[::1]/f"],
    ["IPv6 link-local fe80::/10", "https://[fe80::1]/f"],
    ["IPv6 ULA fc00::/7", "https://[fc00::1]/f"],
    ["IPv4-mapped IPv6 -> loopback", "https://[::ffff:127.0.0.1]/f"],
  ])("rejects %s", async (_label, url) => {
    await expect(fetchSourceBytes(url)).rejects.toThrow(/private or reserved/i);
  });

  it("does NOT over-block a public IP literal (control)", async () => {
    stubFetch(
      () => new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const result = await fetchSourceBytes("https://93.184.216.34/f");
    expect(new TextDecoder().decode(result.bytes)).toBe("hello");
  });
});

// ── (4) DNS rebinding: hostname string looks public, resolves to a private IP ───
describe("SSRF: DNS-resolved-IP validation (not the hostname string)", () => {
  it("rejects a public-looking hostname that resolves to a private IP", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);
    stubFetch(() => new Response("secret", { status: 200 }));
    await expect(fetchSourceBytes("https://totally-legit.example.com/f")).rejects.toThrow(
      /private or reserved/i,
    );
    expect(fetch).not.toHaveBeenCalled(); // rejected before any request left the box
  });

  it("rejects when ANY resolved address is private (multi-record)", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as never);
    await expect(fetchSourceBytes("https://mixed.example.com/f")).rejects.toThrow(
      /private or reserved/i,
    );
  });
});

// ── (5) redirect re-validation + cap ───────────────────────────────────────────
describe("SSRF: redirect handling", () => {
  it("re-validates redirect targets and rejects a redirect to a private IP", async () => {
    stubFetch((url) => {
      if (url.hostname === "93.184.216.34") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/" },
        });
      }
      return new Response("should not reach", { status: 200 });
    });
    await expect(fetchSourceBytes("https://93.184.216.34/start")).rejects.toThrow(
      /private or reserved/i,
    );
  });

  it("enforces the redirect cap", async () => {
    // Always redirect to another public IP literal so each hop passes host checks.
    stubFetch(
      () =>
        new Response(null, { status: 302, headers: { location: "https://93.184.216.34/next" } }),
    );
    await expect(fetchSourceBytes("https://93.184.216.34/start")).rejects.toThrow(
      /too many redirects/i,
    );
  });

  it("rejects a redirect to a non-https scheme", async () => {
    stubFetch(
      () => new Response(null, { status: 302, headers: { location: "http://93.184.216.34/next" } }),
    );
    await expect(fetchSourceBytes("https://93.184.216.34/start")).rejects.toThrow(/only https/i);
  });
});

// ── (6) streamed size ceiling (abort mid-stream, not buffer-then-check) ─────────
describe("SSRF: streamed 25 MB ceiling", () => {
  it("aborts mid-stream once the ceiling is exceeded", async () => {
    let cancelled = false;
    let chunksPulled = 0;
    const TEN_MB = 10 * 1024 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksPulled++;
        controller.enqueue(new Uint8Array(TEN_MB)); // 10 + 10 + 10 = 30 MB > 25 MB
      },
      cancel() {
        cancelled = true;
      },
    });
    stubFetch(() => new Response(stream, { status: 200 }));

    await expect(fetchSourceBytes("https://93.184.216.34/big")).rejects.toBeInstanceOf(
      FileTooLargeError,
    );
    expect(cancelled).toBe(true); // stream was cancelled, i.e. not drained fully
    expect(chunksPulled).toBeLessThan(5); // aborted early, not buffered-then-checked
  });

  it("returns bytes for an under-limit download", async () => {
    stubFetch(() => new Response("small-body", { status: 200 }));
    const result = await fetchSourceBytes("https://93.184.216.34/ok");
    expect(new TextDecoder().decode(result.bytes)).toBe("small-body");
  });
});

// ── (7) MIME sniffed from bytes, not the remote Content-Type header ─────────────
// fetchSourceBytes surfaces the remote Content-Type only as a *hint*; sniffArtifact
// (which publish_artifact runs on the fetched bytes) overrides a lying header.
describe("SSRF: remote Content-Type is not trusted", () => {
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  ]);

  it("carries the remote Content-Type only as a hint (declaredContentType)", async () => {
    stubFetch(() => new Response(PNG, { status: 200, headers: { "content-type": "text/html" } }));
    const fetched = await fetchSourceBytes("https://93.184.216.34/image");
    expect(fetched.contentType).toBe("text/html"); // hint, passed to the sniffer
    // …but the sniffer, run on the bytes, ignores that lie and detects PNG:
    const sniffed = await sniffArtifact({
      bytes: fetched.bytes,
      declaredContentType: fetched.contentType,
    });
    expect(sniffed).toEqual({ contentType: "image/png", kind: "image" });
  });

  it("sniffs HTML structure over a lying application/json Content-Type", async () => {
    const sniffed = await sniffArtifact({
      bytes: new TextEncoder().encode("<!DOCTYPE html><html></html>"),
      declaredContentType: "application/json",
    });
    expect(sniffed.kind).toBe("html");
  });
});
