/**
 * Cloud API client (host: www.szwalkplay.com), reused as-is from the original
 * app. Public barrel — import everything from `@/lib/api`.
 *
 * Layout:
 *   client.ts      — fetch wrapper, envelope parsing, ApiError, API_BASE
 *   auth.ts        — in-memory token holder + pluggable persisted loader/saver
 *   types.ts       — request/response TS types (best-effort, marked UNCERTAIN)
 *   mappers.ts     — Preset/EqState <-> ApiEqGraph mapping
 *   endpoints.ts   — typed functions for every endpoint
 *   hooks.ts       — @tanstack/react-query hooks
 *   queryClient.ts — shared QueryClient + query keys
 *
 * Covered endpoints:
 *   /api/v3/eq/{eqLike,eqCancelLike,queryUserEQShareInfoList,getReportType,watching}
 *   /api/v3/adc/eq/{eqCollect,updateUserCustomEQ,upload/eqShareGraph}
 *   /api/v3-1/common/{checkFirmwareVersion,getFirmwareInfoListByPidAndVid}
 *   /api/v3/comments/{list,like,submit}
 *   /api/v3/user/{loginByVCodePC,wxPcLogin,getUserDetail}
 * Auth: WeChat QR (appid=wxe47113686c57e28d) + email vcode.
 */

export { API_BASE, WECHAT_APPID, ApiError, setDomainHeader } from "./client";
export * from "./auth";
export * from "./types";
export * from "./mappers";
export * from "./endpoints";
export * from "./queryClient";
export * from "./hooks";

import { API_BASE } from "./client";

/** Back-compat value export (kept for existing imports). */
export const api = {
  base: API_BASE,
} as const;
