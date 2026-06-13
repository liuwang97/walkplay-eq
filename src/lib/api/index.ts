/**
 * Cloud API client (host: szwalkplay.com), reused as-is from the original app.
 *
 * STUB: the API agent implements the fetch wrappers for:
 *   /api/v3/eq/{eqLike,eqCancelLike,queryUserEQShareInfoList,eqCollect,getReportType,watching}
 *   /api/v3/eq/upload/eqShareGraph
 *   /api/v3/adc/eq/updateUserCustomEQ
 *   /api/v3-1/common/{checkFirmwareVersion,getFirmwareInfoListByPidAndVid}
 *   /api/v3/comments/{list,like,submit}
 *   /api/v3/user/{loginByVCodePC,wxPcLogin,getUserDetail,changeEmail,saveUserDetail}
 * Auth: WeChat QR (appid=wxe47113686c57e28d) + email vcode.
 */

/** Base host for the cloud API. */
export const API_BASE = "https://szwalkplay.com";

/** WeChat open-platform appid used for the PC QR login flow. */
export const WECHAT_APPID = "wxe47113686c57e28d";

/** Placeholder so the module has a value export and type-checks cleanly. */
export const api = {
  base: API_BASE,
} as const;
