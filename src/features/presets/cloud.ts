/**
 * Cloud-backed preset hooks for the 在线 (online) and 我的分享 (my shares) tabs.
 *
 * The shared cloud-api layer (src/lib/api) is still a stub: it currently exports
 * only `API_BASE` / `WECHAT_APPID` / `api`, not data hooks. Per the cross-agent
 * contract these named hooks WILL appear there:
 *
 *     import { useOnlinePresets, useMyShares } from "@/lib/api";
 *
 * mapping onto the documented endpoints:
 *   - 在线   -> GET  /api/v3/eq/queryUserEQShareInfoList   (public share list)
 *   - 我的分享 -> GET  /api/v3/eq/queryUserEQShareInfoList?mine=1
 *   - 点赞   -> POST /api/v3/eq/{eqLike,eqCancelLike}
 *   - 收藏   -> POST /api/v3/eq/eqCollect
 *
 * Until the API agent ships those hooks we keep this self-contained: a thin
 * fetch layer against the same endpoints, wrapped in @tanstack/react-query.
 * When the real hooks land, swap the bodies of {@link useOnlinePresets} /
 * {@link useMyShares} for `return apiUseOnlinePresets()` — the return shape is
 * identical, so PresetPanel does not change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import {
  DEFAULT_BANDS,
  type EqBand,
  type EqBandType,
  type Preset,
  type PresetSource,
} from "@/lib/types";

/**
 * Raw share record as returned by /api/v3/eq/queryUserEQShareInfoList.
 * Field names mirror the original Vue app's payload; everything optional so a
 * partial/loose backend response still parses.
 */
export interface EqShareDTO {
  id?: number | string;
  shareId?: number | string;
  /** Display name / title of the shared EQ. */
  name?: string;
  title?: string;
  /** Author nickname. */
  nickname?: string;
  userName?: string;
  /** Like / collect counters. */
  likeCount?: number;
  collectCount?: number;
  liked?: boolean;
  /** Preamp in dB. */
  preamp?: number;
  preGain?: number;
  /** Bands, possibly serialized as a JSON string. */
  bands?: unknown;
  eqData?: unknown;
}

/** A cloud preset enriched with the social metadata the panel renders. */
export interface CloudPreset extends Preset {
  author?: string;
  likeCount: number;
  liked: boolean;
}

/** Common async resource shape returned by the cloud hooks. */
export interface CloudResource<T> {
  data: T;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const FALLBACK_BAND_TYPES: readonly EqBandType[] =
  DEFAULT_BANDS.map((b) => b.type);

function clampGain(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-10, Math.min(10, n));
}

function clampPreamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-16, Math.min(6, n));
}

/** Coerce one raw band entry into a valid EqBand at the given index. */
function coerceBand(raw: unknown, index: number): EqBand {
  const base = DEFAULT_BANDS[index] ?? DEFAULT_BANDS[DEFAULT_BANDS.length - 1];
  const r = (raw ?? {}) as Record<string, unknown>;
  const freq = Number(r.freq ?? r.frequency ?? base.freq);
  const q = Number(r.q ?? r.Q ?? base.q);
  const gain = clampGain(Number(r.gain ?? r.db ?? 0));
  const type = (r.type as EqBandType) ?? FALLBACK_BAND_TYPES[index] ?? "PK";
  const enabled = r.enabled === undefined ? true : Boolean(r.enabled);
  return {
    id: index,
    freq: Number.isFinite(freq) ? freq : base.freq,
    q: Number.isFinite(q) ? q : base.q,
    gain,
    type,
    enabled,
  };
}

/** Parse a (possibly stringified) bands payload into exactly 10 EqBands. */
function parseBands(input: unknown): EqBand[] {
  let arr: unknown = input;
  if (typeof input === "string") {
    try {
      arr = JSON.parse(input);
    } catch {
      arr = null;
    }
  }
  const src = Array.isArray(arr) ? arr : [];
  return DEFAULT_BANDS.map((_, i) => coerceBand(src[i], i));
}

/** Map a raw share DTO into a typed CloudPreset for the given source tab. */
export function mapShareToPreset(dto: EqShareDTO, source: PresetSource): CloudPreset {
  const id = String(dto.shareId ?? dto.id ?? cryptoRandomId());
  const name = dto.name ?? dto.title ?? "EQ";
  const author = dto.nickname ?? dto.userName;
  const preamp = clampPreamp(Number(dto.preamp ?? dto.preGain ?? 0));
  const bands = parseBands(dto.bands ?? dto.eqData);
  return {
    id,
    name,
    bands,
    preamp,
    source,
    author,
    likeCount: Number(dto.likeCount ?? 0) || 0,
    liked: Boolean(dto.liked),
  };
}

function cryptoRandomId(): string {
  return `cloud-${Math.random().toString(36).slice(2, 10)}`;
}

/** Pull the array out of the various envelope shapes the backend may use. */
function extractList(json: unknown): EqShareDTO[] {
  if (Array.isArray(json)) return json as EqShareDTO[];
  const obj = (json ?? {}) as Record<string, unknown>;
  const candidate = obj.data ?? obj.list ?? obj.records ?? obj.rows;
  if (Array.isArray(candidate)) return candidate as EqShareDTO[];
  const nested = (candidate ?? {}) as Record<string, unknown>;
  if (Array.isArray(nested.list)) return nested.list as EqShareDTO[];
  if (Array.isArray(nested.records)) return nested.records as EqShareDTO[];
  return [];
}

async function fetchShareList(mine: boolean, signal: AbortSignal): Promise<EqShareDTO[]> {
  const url = new URL("/api/v3/eq/queryUserEQShareInfoList", API_BASE);
  if (mine) url.searchParams.set("mine", "1");
  const res = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return extractList(await res.json());
}

/** Shared loader powering both cloud tabs. */
function useShareResource(mine: boolean): CloudResource<CloudPreset[]> {
  const source: PresetSource = mine ? "shared" : "online";
  const [data, setData] = useState<CloudPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchShareList(mine, ctrl.signal)
      .then((list) => {
        if (ctrl.signal.aborted) return;
        setData(list.map((d) => mapShareToPreset(d, source)));
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setData([]);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [mine, source, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, refetch };
}

/** 在线 tab: public shared EQ presets. */
export function useOnlinePresets(): CloudResource<CloudPreset[]> {
  return useShareResource(false);
}

/** 我的分享 tab: the current user's own shared EQ presets. */
export function useMyShares(): CloudResource<CloudPreset[]> {
  return useShareResource(true);
}

/**
 * Toggle a like on a shared preset.
 * Maps to POST /api/v3/eq/{eqLike,eqCancelLike}. Returns the new liked state;
 * resolves false (no-op) on network failure so the caller can revert.
 */
export async function toggleShareLike(shareId: string, liked: boolean): Promise<boolean> {
  const path = liked ? "/api/v3/eq/eqCancelLike" : "/api/v3/eq/eqLike";
  try {
    const res = await fetch(new URL(path, API_BASE).toString(), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id: shareId }),
    });
    if (!res.ok) return liked;
    return !liked;
  } catch {
    return liked;
  }
}
