/**
 * Cloud API request/response types (host: szwalkplay.com).
 *
 * Shapes are BEST-EFFORT, reverse-engineered from the obfuscated original
 * bundle (peq-bundle.js). Field names that were directly observed in the bundle
 * are treated as known; everything else is marked `// UNCERTAIN` and typed
 * permissively. The runtime parsers in `client.ts`/`endpoints.ts` are tolerant,
 * so an unexpected server shape degrades gracefully rather than throwing.
 *
 * Confirmed from the bundle:
 *  - Every call goes through one axios instance (`x3`) as method "post" with the
 *    body under a `data` key; the server replies with an envelope
 *    `{ code: number, msg: string, data: T }` where `code === 0` means success.
 *  - Auth header is `Authorization: <rawToken>` (NO "Bearer" prefix), plus a
 *    `client: "PC"` header and an optional `domain` header.
 *  - The internal EQ object is
 *    `{ eqType, tag, id, eqName(/eqNameCn/eqNameEn), freqs[], qs[], gains[],
 *       filterTypes[], offset }`
 *    where `offset` is the global pre-gain and `filterTypes` are numeric codes
 *    `{ PK:0, LP:1, HP:2, LS:3, HS:4 }`.
 */

/** Standard response envelope. `code === 0` ⇒ success. */
export interface ApiEnvelope<T> {
  code: number;
  msg?: string;
  /** Present on success; shape depends on the endpoint. */
  data?: T;
}

/** Numeric EQ filter-type codes used by the device/API. */
export const API_FILTER_TYPE = {
  PK: 0,
  LP: 1,
  HP: 2,
  LS: 3,
  HS: 4,
} as const;
export type ApiFilterTypeCode = (typeof API_FILTER_TYPE)[keyof typeof API_FILTER_TYPE];

/**
 * The cloud's EQ payload, as carried inside list items and as uploaded for a
 * shared/custom EQ. All numeric arrays are parallel (index i = band i).
 */
export interface ApiEqGraph {
  /** "pre" (preset) etc. — UNCERTAIN beyond the "pre" literal seen in bundle. */
  eqType?: string;
  tag?: number;
  id?: number;
  /** Display name (single). Some payloads split into eqNameCn / eqNameEn. */
  eqName?: string;
  eqNameCn?: string;
  eqNameEn?: string;
  /** Per-band center/corner frequency in Hz. */
  freqs: number[];
  /** Per-band Q factor. */
  qs: number[];
  /** Per-band gain in dB. */
  gains: number[];
  /** Per-band numeric filter-type code (see API_FILTER_TYPE). */
  filterTypes: number[];
  /** Global pre-gain / preamp in dB. */
  offset: number;
}

/* ------------------------------------------------------------------ */
/* EQ share / online list                                              */
/* ------------------------------------------------------------------ */

/** Request for queryUserEQShareInfoList — observed `{ pid, vid }`. */
export interface QueryEqShareListReq {
  pid?: number;
  vid?: number;
  /** UNCERTAIN — paging fields, included tolerantly. */
  pageNum?: number;
  pageSize?: number;
}

/**
 * One shared/online EQ list item. Confirmed fields from bundle:
 * id, name, img, content, tag, likes, isLike, collects, isCollect.
 * The actual band data may arrive inline (freqs/qs/gains/...) or be fetched
 * separately — both are modeled optionally.
 */
export interface EqShareItem extends Partial<ApiEqGraph> {
  id: number;
  /** Display name of the EQ. */
  name?: string;
  /** Preview graph image URL. */
  img?: string;
  /** Free-text description. */
  content?: string;
  /** Category/badge tag. */
  tag?: number;
  /** Like count. */
  likes?: number;
  /** 1 if the current user liked it. */
  isLike?: number;
  /** Collect (favorite) count. */
  collects?: number;
  /** 1 if the current user collected it. */
  isCollect?: number;
  /** Author display name — UNCERTAIN. */
  author?: string;
  [k: string]: unknown;
}

export type QueryEqShareListResp = EqShareItem[];

/** Like / cancel-like / collect a shared EQ — observed `{ eqId }`. */
export interface EqIdReq {
  eqId: number;
}

/** watching ping — observed `{ id, mark: "try" | "use" }`. */
export interface EqWatchingReq {
  id: number;
  mark: "try" | "use";
}

/** updateUserCustomEQ — the full graph object is sent as the body. UNCERTAIN. */
export type UpdateUserCustomEqReq = ApiEqGraph & {
  id?: number;
  [k: string]: unknown;
};

/** getReportType — opaque list of report categories. */
export type ReportType = {
  id?: number;
  name?: string;
  [k: string]: unknown;
};

/* ------------------------------------------------------------------ */
/* eqShareGraph upload                                                  */
/* ------------------------------------------------------------------ */

/** Response of the image upload step — observed `data.url`. */
export interface UploadGraphResp {
  url: string;
}

/**
 * The share-create body sent AFTER the image upload. The bundle injects the
 * uploaded `img` url onto the EQ object then posts it. UNCERTAIN superset.
 */
export type ShareEqGraphReq = ApiEqGraph & {
  img?: string;
  content?: string;
  tag?: number;
  [k: string]: unknown;
};

/* ------------------------------------------------------------------ */
/* Firmware                                                            */
/* ------------------------------------------------------------------ */

/** checkFirmwareVersion request — UNCERTAIN; vid/pid + current version. */
export interface CheckFirmwareReq {
  vid: number;
  pid: number;
  firmwareVersion?: string;
  [k: string]: unknown;
}

/** A firmware record. Confirmed: forceUpdate, firmwareVersion, md5. */
export interface FirmwareInfo {
  vid?: number;
  pid?: number;
  firmwareVersion?: string;
  /** 1/true ⇒ update is mandatory. */
  forceUpdate?: number | boolean;
  md5?: string;
  /** Download URL — UNCERTAIN field name. */
  fileUrl?: string;
  url?: string;
  updateContent?: string;
  [k: string]: unknown;
}

/** getFirmwareInfoListByPidAndVid request — observed `{ pid, vid }`. */
export interface FirmwareListReq {
  pid: number;
  vid: number;
}

export type FirmwareListResp = FirmwareInfo[];

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

/** comments/list — observed `{ eqId, pageNum, pageSize }`. */
export interface CommentsListReq {
  eqId: number;
  pageNum?: number;
  pageSize?: number;
}

/** A single comment. Field names UNCERTAIN beyond id/content/likes. */
export interface CommentItem {
  id: number;
  content?: string;
  likes?: number;
  isLike?: number;
  /** Author display name — UNCERTAIN. */
  nickname?: string;
  avatar?: string;
  createTime?: string;
  [k: string]: unknown;
}

export type CommentsListResp = CommentItem[];

/** comments/like — observed `{ commentId, batchId }`. */
export interface CommentLikeReq {
  commentId: number;
  /** Server-side grouping id seen in bundle. UNCERTAIN semantics. */
  batchId?: number;
}

/** comments/submit — UNCERTAIN; eqId + content at minimum. */
export interface CommentSubmitReq {
  eqId: number;
  content: string;
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* User / auth                                                         */
/* ------------------------------------------------------------------ */

/** loginByVCodePC — observed `{ email, vcode, lang }`. */
export interface LoginByVCodeReq {
  email: string;
  vcode: string;
  /** "en" | "cn" — observed. */
  lang?: "en" | "cn";
}

/** wxPcLogin — observed `{ code }` (the WeChat OAuth code from the QR scan). */
export interface WxPcLoginReq {
  code: string;
}

/**
 * Successful login payload. Confirmed: `LoginAccessToken` (note the casing).
 * The rest of the user fields are UNCERTAIN.
 */
export interface LoginResult {
  LoginAccessToken: string;
  [k: string]: unknown;
}

/** getUserDetail response. UNCERTAIN beyond id/email/nickname. */
export interface UserDetail {
  id?: number;
  email?: string;
  nickname?: string;
  avatar?: string;
  [k: string]: unknown;
}
