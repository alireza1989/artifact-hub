import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

// Share tokens (PLAN §3.3): `<linkId>.<signature>` where the signature is an
// HMAC-SHA256 over `<linkId>.<expiresAtMs>`, binding the token to its own expiry.
// The DB stores only sha256(token) (never the token), so a DB leak can't
// reconstruct a live token, and tokens are unforgeable without SHARE_LINK_SECRET.

function computeSignature(linkId: string, expiresAtMs: number): string {
  return createHmac("sha256", getEnv().SHARE_LINK_SECRET)
    .update(`${linkId}.${expiresAtMs}`)
    .digest("base64url");
}

export function signToken(linkId: string, expiresAtMs: number): string {
  return `${linkId}.${computeSignature(linkId, expiresAtMs)}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type ParsedToken = { linkId: string; signature: string };

export function parseToken(token: string): ParsedToken | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return null;
  return { linkId: token.slice(0, dot), signature: token.slice(dot + 1) };
}

// Constant-time comparison of the recomputed signature against the presented one,
// using the DB-sourced expiry (CLAUDE.md: constant-time token comparison).
export function verifySignature(linkId: string, expiresAtMs: number, signature: string): boolean {
  const expected = Buffer.from(computeSignature(linkId, expiresAtMs));
  const presented = Buffer.from(signature);
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}
