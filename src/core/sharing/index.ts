// core/sharing — HMAC share-link create/verify/revoke (PLAN §3.3). Framework-free;
// consumed by the MCP tools now and the Phase-3 share viewer + management UI.
export { type CreatedShareLink, createShareLink } from "./create";
export { ShareLinkNotFoundError } from "./errors";
export {
  listAllShareLinks,
  listShareLinks,
  type PlatformShareLink,
  type PlatformShareLinkPage,
  type ShareLinkSummary,
} from "./links";
export { type RevokeResult, revokeShareLink } from "./revoke";
export { hashToken, parseToken, signToken, verifySignature } from "./token";
export {
  type ShareVerifyResult,
  type VerifyShareTokenOptions,
  verifyShareToken,
} from "./verify";
