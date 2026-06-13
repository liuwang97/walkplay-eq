/**
 * Low-level fetch wrapper for the szwalkplay cloud API.
 *
 * Mirrors the original axios instance behaviour observed in the bundle:
 *  - All non-upload calls are POST with a JSON body and respond with the
 *    envelope `{ code, msg, data }`; `code === 0` means success.
 *  - The token (when present) is sent as a RAW `Authorization` header — there
 *    is no "Bearer " prefix in the original app.
 *  - A `client: "PC"` header is always sent; `domain` is sent when known.
 *
 * The wrapper is deliberately tolerant: callers get the unwrapped `data` on
 * success and a typed `ApiError` (carrying `code`/`msg`) otherwise.
 */

import { getToken } from "./auth";
import type { ApiEnvelope } from "./types";

/** Base host for the cloud API. Configurable in one place. */
export const API_BASE = "https://www.szwalkplay.com";

/** WeChat open-platform appid used for the PC QR login flow. */
export const WECHAT_APPID = "wxe47113686c57e28d";

/** Optional `domain` header value (original app reads it from window config). */
let domainHeader: string | null = null;
export function setDomainHeader(domain: string | null): void {
  domainHeader = domain;
}

/** Error thrown when the server returns a non-zero `code` or a transport error. */
export class ApiError extends Error {
  readonly code: number;
  readonly httpStatus?: number;
  constructor(message: string, code: number, httpStatus?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    client: "PC",
    ...extra,
  };
  const token = getToken();
  if (token) headers.Authorization = token;
  if (domainHeader) headers.domain = domainHeader;
  return headers;
}

function joinUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Parse a fetch Response as the standard envelope and return its `data`.
 * Tolerant: a body that is already the payload (no `code` field) is returned
 * as-is; a missing `data` on success resolves to `undefined`.
 */
async function unwrap<T>(res: Response): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, -1, res.status);
    }
    // Non-JSON success (rare) — nothing meaningful to return.
    return undefined as unknown as T;
  }

  if (body && typeof body === "object" && "code" in body) {
    const env = body as ApiEnvelope<T>;
    if (env.code === 0) {
      return env.data as T;
    }
    throw new ApiError(env.msg ?? `API error (code ${env.code})`, env.code, res.status);
  }

  // No envelope — treat the raw body as the payload (tolerant fallback).
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status}`, -1, res.status);
  }
  return body as T;
}

export interface RequestOptions {
  /** Override HTTP method (defaults to POST, matching the original app). */
  method?: "GET" | "POST";
  /** AbortSignal for React Query cancellation. */
  signal?: AbortSignal;
  /** Extra headers. */
  headers?: Record<string, string>;
}

/**
 * Core request. `body` is JSON-encoded under the wire as `data` is the field
 * the original app posts — but the server actually receives the body object
 * directly (axios `data` = the request body), so we send `body` as the JSON
 * root. (Confirmed: bundle passes `data: <obj>` to axios, which serializes the
 * object as the body root.)
 */
export async function request<T>(
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const method = opts.method ?? "POST";
  const init: RequestInit = {
    method,
    headers: buildHeaders(opts.headers),
    signal: opts.signal,
  };
  if (method !== "GET" && body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(joinUrl(path), init);
  return unwrap<T>(res);
}

/** POST helper (the common case). */
export function post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>(path, body, { ...opts, method: "POST" });
}

/** GET helper. */
export function get<T>(path: string, opts?: RequestOptions): Promise<T> {
  return request<T>(path, undefined, { ...opts, method: "GET" });
}

/**
 * Multipart upload (used by eqShareGraph image upload). Returns unwrapped data.
 * The `Content-Type` is left to the browser so the multipart boundary is set.
 */
export async function upload<T>(
  path: string,
  form: FormData,
  opts: RequestOptions = {},
): Promise<T> {
  const headers = buildHeaders(opts.headers);
  // Let fetch set the multipart Content-Type (with boundary).
  delete headers["Content-Type"];
  const res = await fetch(joinUrl(path), {
    method: "POST",
    headers,
    body: form,
    signal: opts.signal,
  });
  return unwrap<T>(res);
}
