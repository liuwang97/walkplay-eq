/**
 * Typed endpoint functions for the szwalkplay cloud API.
 *
 * Each function maps to one observed endpoint from the original bundle. Paths,
 * methods (all POST unless noted) and the request body field names were read
 * out of `peq-bundle.js`; response shapes are best-effort (see ./types.ts).
 *
 * Endpoints come in two families in the bundle: bare (`/api/v3/eq/...`) and an
 * "adc" variant (`/api/v3/adc/eq/...`). The adc variant is used by the
 * accessory/ADC product line. We default to the v3 paths and expose the adc
 * paths as constants so callers can switch when needed.
 */

import { post, upload } from "./client";
import { setToken } from "./auth";
import type {
  CheckFirmwareReq,
  CommentItem,
  CommentLikeReq,
  CommentSubmitReq,
  CommentsListReq,
  EqIdReq,
  EqShareItem,
  EqWatchingReq,
  FirmwareInfo,
  FirmwareListReq,
  LoginByVCodeReq,
  LoginResult,
  QueryEqShareListReq,
  ReportType,
  ShareEqGraphReq,
  UpdateUserCustomEqReq,
  UploadGraphResp,
  UserDetail,
  WxPcLoginReq,
} from "./types";

/** Canonical endpoint paths (kept in one place for clarity / overrides). */
export const PATHS = {
  // EQ (bare v3)
  queryUserEQShareInfoList: "/api/v3/eq/queryUserEQShareInfoList",
  eqLike: "/api/v3/eq/eqLike",
  eqCancelLike: "/api/v3/eq/eqCancelLike",
  getReportType: "/api/v3/eq/getReportType",
  watching: "/api/v3/eq/watching",
  // EQ (adc v3)
  adcQueryUserEQShareInfoList: "/api/v3/adc/eq/queryUserEQShareInfoList",
  eqCollect: "/api/v3/adc/eq/eqCollect",
  updateUserCustomEQ: "/api/v3/adc/eq/updateUserCustomEQ",
  uploadEqShareGraph: "/api/v3/adc/eq/upload/eqShareGraph",
  // Common / firmware (v3-1)
  checkFirmwareVersion: "/api/v3-1/common/checkFirmwareVersion",
  getFirmwareInfoListByPidAndVid: "/api/v3-1/common/getFirmwareInfoListByPidAndVid",
  // Comments
  commentsList: "/api/v3/comments/list",
  commentsLike: "/api/v3/comments/like",
  commentsSubmit: "/api/v3/comments/submit",
  // User / auth
  loginByVCodePC: "/api/v3/user/loginByVCodePC",
  wxPcLogin: "/api/v3/user/wxPcLogin",
  getUserDetail: "/api/v3/user/getUserDetail",
  changeEmail: "/api/v3/user/changeEmail",
  saveUserDetail: "/api/v3/user/saveUserDetail",
} as const;

/** Normalize a list response that may be `T[]`, `{ list: T[] }`, or null. */
function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["list", "records", "items", "rows", "data"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* EQ: online / shared list + reactions                                */
/* ------------------------------------------------------------------ */

/** List online / shared EQs (observed body `{ pid, vid }`). */
export async function queryUserEQShareInfoList(
  req: QueryEqShareListReq,
  opts?: { signal?: AbortSignal; adc?: boolean },
): Promise<EqShareItem[]> {
  const path = opts?.adc ? PATHS.adcQueryUserEQShareInfoList : PATHS.queryUserEQShareInfoList;
  const data = await post<unknown>(path, req, { signal: opts?.signal });
  return asList<EqShareItem>(data);
}

/** Like a shared EQ. */
export function eqLike(req: EqIdReq, opts?: { signal?: AbortSignal }): Promise<unknown> {
  return post<unknown>(PATHS.eqLike, req, opts);
}

/** Cancel a like on a shared EQ. */
export function eqCancelLike(req: EqIdReq, opts?: { signal?: AbortSignal }): Promise<unknown> {
  return post<unknown>(PATHS.eqCancelLike, req, opts);
}

/** Collect (favorite) a shared EQ. */
export function eqCollect(req: EqIdReq, opts?: { signal?: AbortSignal }): Promise<unknown> {
  return post<unknown>(PATHS.eqCollect, req, opts);
}

/** Send a "watching" usage ping (`{ id, mark: "try" | "use" }`). */
export function eqWatching(req: EqWatchingReq, opts?: { signal?: AbortSignal }): Promise<unknown> {
  return post<unknown>(PATHS.watching, req, opts);
}

/** Fetch the list of report categories. */
export async function getReportType(opts?: { signal?: AbortSignal }): Promise<ReportType[]> {
  const data = await post<unknown>(PATHS.getReportType, {}, opts);
  return asList<ReportType>(data);
}

/* ------------------------------------------------------------------ */
/* EQ: custom + share upload                                           */
/* ------------------------------------------------------------------ */

/** Update the user's custom EQ (the full graph object is the body). */
export function updateUserCustomEQ(
  req: UpdateUserCustomEqReq,
  opts?: { signal?: AbortSignal },
): Promise<unknown> {
  return post<unknown>(PATHS.updateUserCustomEQ, req, opts);
}

/**
 * Two-step share: (1) upload the preview graph image, returning its URL, then
 * (2) post the EQ graph (with `img` set) to create the share.
 *
 * Step (1) is multipart; pass the image as a Blob/File. Returns the created
 * share's raw response.
 */
export async function uploadEqShareGraphImage(
  file: Blob,
  opts?: { signal?: AbortSignal; fileFieldName?: string },
): Promise<UploadGraphResp> {
  const form = new FormData();
  form.append(opts?.fileFieldName ?? "file", file);
  const data = await upload<UploadGraphResp>(PATHS.uploadEqShareGraph, form, {
    signal: opts?.signal,
  });
  return data;
}

/**
 * Create the share record from an EQ graph. Typically called after
 * `uploadEqShareGraphImage` (set `req.img = uploadResp.url`). The original app
 * reuses the upload path for the create POST as well.
 */
export function shareEqGraph(
  req: ShareEqGraphReq,
  opts?: { signal?: AbortSignal },
): Promise<unknown> {
  return post<unknown>(PATHS.uploadEqShareGraph, req, opts);
}

/* ------------------------------------------------------------------ */
/* Firmware                                                            */
/* ------------------------------------------------------------------ */

/** Check whether a firmware update is available (body shape UNCERTAIN). */
export function checkFirmwareVersion(
  req: CheckFirmwareReq,
  opts?: { signal?: AbortSignal },
): Promise<FirmwareInfo | null> {
  return post<FirmwareInfo | null>(PATHS.checkFirmwareVersion, req, opts);
}

/** Fetch the firmware list for a (vid, pid) — observed body `{ pid, vid }`. */
export async function getFirmwareInfoListByPidAndVid(
  vid: number,
  pid: number,
  opts?: { signal?: AbortSignal },
): Promise<FirmwareInfo[]> {
  const req: FirmwareListReq = { pid, vid };
  const data = await post<unknown>(PATHS.getFirmwareInfoListByPidAndVid, req, opts);
  return asList<FirmwareInfo>(data);
}

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

/** List comments for an EQ (observed body `{ eqId, pageNum, pageSize }`). */
export async function commentsList(
  req: CommentsListReq,
  opts?: { signal?: AbortSignal },
): Promise<CommentItem[]> {
  const body: CommentsListReq = { pageNum: 1, pageSize: 999, ...req };
  const data = await post<unknown>(PATHS.commentsList, body, opts);
  return asList<CommentItem>(data);
}

/** Like a comment (observed body `{ commentId, batchId }`). */
export function commentLike(
  req: CommentLikeReq,
  opts?: { signal?: AbortSignal },
): Promise<unknown> {
  return post<unknown>(PATHS.commentsLike, req, opts);
}

/** Submit a comment (body UNCERTAIN; `{ eqId, content }` minimum). */
export function commentSubmit(
  req: CommentSubmitReq,
  opts?: { signal?: AbortSignal },
): Promise<unknown> {
  return post<unknown>(PATHS.commentsSubmit, req, opts);
}

/* ------------------------------------------------------------------ */
/* User / auth                                                         */
/* ------------------------------------------------------------------ */

/**
 * Email + verification-code login (observed body `{ email, vcode, lang }`).
 * On success the returned `LoginAccessToken` is stored via the auth holder.
 */
export async function loginByVCodePC(req: LoginByVCodeReq): Promise<LoginResult> {
  const body: LoginByVCodeReq = { lang: "en", ...req };
  const data = await post<LoginResult>(PATHS.loginByVCodePC, body);
  if (data?.LoginAccessToken) setToken(data.LoginAccessToken);
  return data;
}

/**
 * Complete the WeChat PC QR login by exchanging the scanned OAuth `code`
 * (observed body `{ code }`). On success the token is stored.
 */
export async function wxPcLogin(req: WxPcLoginReq): Promise<LoginResult> {
  const data = await post<LoginResult>(PATHS.wxPcLogin, req);
  if (data?.LoginAccessToken) setToken(data.LoginAccessToken);
  return data;
}

/**
 * Build the WeChat Open-Platform QR-login URL for the PC flow. The original app
 * uses appid `wxe47113686c57e28d` and a random `state` it later checks against
 * the redirect. The actual rendering (iframe / qrcode image) is the UI agent's
 * job; this just assembles the authorize URL + state.
 */
export function buildWxQrLogin(redirectUri: string, state?: string): {
  url: string;
  state: string;
} {
  const st = state ?? Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    appid: "wxe47113686c57e28d",
    scope: "snsapi_login",
    response_type: "code",
    redirect_uri: redirectUri,
    state: st,
  });
  return {
    url: `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`,
    state: st,
  };
}

/** Fetch the current user's detail (no body). */
export function getUserDetail(opts?: { signal?: AbortSignal }): Promise<UserDetail | null> {
  return post<UserDetail | null>(PATHS.getUserDetail, {}, opts);
}
