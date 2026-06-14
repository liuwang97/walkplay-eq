/**
 * Switcher — the left-rail preset browser (porcelain redesign).
 *
 * Hand-styled (inline) to match the Claude Design handoff pixel-for-pixel
 * (see design-ref/project/WalkPlay EQ.dc.html, the <aside> sidebar). Preserves
 * the full preset feature set from the old PresetPanel/PresetRow:
 *   - 4 tabs: 预设 / 自定义 / 在线 / 我的分享 (builtin / custom / online / shares)
 *   - apply (applyPreset), audition toggle (auditionEngine), rename/delete
 *     for custom presets, like for cloud presets, and "save current as preset".
 *
 * Only shadcn Dialog + Input are reused (for the rename affordance); everything
 * else is hand-styled to keep the porcelain look exact.
 */

import {
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BUILTIN_FALLBACK_LABELS } from "@/features/presets/builtins";
import { auditionEngine } from "@/features/presets/audition";
import {
  toggleShareLike,
  useMyShares,
  useOnlinePresets,
  type CloudPreset,
  type CloudResource,
} from "@/features/presets/cloud";
import { useEqStore } from "@/lib/store";
import { hexA, palette, thumbPath } from "@/lib/theme";
import type { EqState, Preset } from "@/lib/types";

// ---------------------------------------------------------------------------
// i18n strings (local, bilingual) — mirrors the design handoff's TX table.
// ---------------------------------------------------------------------------

type Lang = "zh" | "en";

const TX = {
  zh: {
    deviceFallback: "WP‑T02 解码耳放",
    switcher: "切换器",
    tabPreset: "预设",
    tabCustom: "自定义",
    tabOnline: "在线",
    tabShared: "我的分享",
    saveCurrent: "保存当前为预设",
    audition: "试听",
    stop: "停止",
    rename: "重命名",
    delete: "删除",
    like: "点赞",
    renameTitle: "重命名预设",
    renamePlaceholder: "输入预设名称",
    cancel: "取消",
    confirm: "确定",
    loading: "加载中…",
    retry: "重试",
    errLoad: "加载失败",
    emptyCustom: "暂无自定义预设，调好后可保存到此处",
    emptyOnline: "暂无在线分享",
    emptyShared: "你还没有分享过 EQ",
    countSuffix: " 个",
    saved: "已保存为自定义预设",
  },
  en: {
    deviceFallback: "WP‑T02 DAC/Amp",
    switcher: "Switcher",
    tabPreset: "Presets",
    tabCustom: "Custom",
    tabOnline: "Online",
    tabShared: "My Shares",
    saveCurrent: "Save current as preset",
    audition: "Audition",
    stop: "Stop",
    rename: "Rename",
    delete: "Delete",
    like: "Like",
    renameTitle: "Rename preset",
    renamePlaceholder: "Enter preset name",
    cancel: "Cancel",
    confirm: "Confirm",
    loading: "Loading…",
    retry: "Retry",
    errLoad: "Failed to load",
    emptyCustom: "No custom presets yet — save one after tuning",
    emptyOnline: "No online shares yet",
    emptyShared: "You haven't shared any EQ yet",
    countSuffix: "",
    saved: "Saved as custom preset",
  },
} as const;

type TabKey = "preset" | "custom" | "online" | "shared";

// ---------------------------------------------------------------------------
// Small inline-styled primitives
// ---------------------------------------------------------------------------

const INK = "#232838";
const META = "#969db0";
const MUTED = "#9098ab";
const CARD_BORDER = "rgba(28,32,58,0.07)";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

/** A square ghost icon button used for per-card controls. */
function GhostIconButton({
  title,
  onClick,
  active,
  accent,
  danger,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  accent: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const color = active
    ? accent
    : danger && hover
      ? "#e0484d"
      : hover
        ? "#4a5061"
        : "#9aa0b2";
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 26,
        height: 26,
        flexShrink: 0,
        borderRadius: 7,
        border: "none",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        color,
        background: hover ? "rgba(28,32,58,0.06)" : "transparent",
        transition: "background 0.14s, color 0.14s",
      }}
    >
      {children}
    </button>
  );
}

// --- icons (inline svg, 14px) ---
const Ico = {
  play: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  pause: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ),
  pencil: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  ),
  heart: (filled: boolean) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  ),
};

function isCloudPreset(p: Preset | CloudPreset): p is CloudPreset {
  return (p as CloudPreset).likeCount !== undefined;
}

/** Subscribe to the audition engine's current preset id. */
function useAuditioningId(): string | null {
  return useSyncExternalStore(
    (cb) => auditionEngine.subscribe(() => cb()),
    () => auditionEngine.currentId,
    () => null,
  );
}

// ---------------------------------------------------------------------------
// Preset card
// ---------------------------------------------------------------------------

interface PresetCardProps {
  preset: Preset | CloudPreset;
  displayName: string;
  active: boolean;
  accent: ReturnType<typeof palette>;
  auditioningId: string | null;
  tx: (typeof TX)[Lang];
  onApply: (p: Preset) => void;
  onRename?: (p: Preset) => void;
  onDelete?: (p: Preset) => void;
  onLike?: (p: CloudPreset) => void;
}

function PresetCard({
  preset,
  displayName,
  active,
  accent,
  auditioningId,
  tx,
  onApply,
  onRename,
  onDelete,
  onLike,
}: PresetCardProps) {
  const [hover, setHover] = useState(false);
  const cloud = isCloudPreset(preset) ? preset : null;
  const isAuditioning = auditioningId === preset.id;

  // Meta line: cloud -> "author ♥ likes"; local -> "+0 dB pre".
  let meta: string;
  if (cloud) {
    const author = cloud.author ?? "";
    meta = `${author}${author ? "  " : ""}♥ ${cloud.likeCount.toLocaleString()}`;
  } else {
    const p = preset.preamp;
    const sign = p > 0 ? "+" : p < 0 ? "−" : "";
    meta = `${sign}${Math.abs(Math.round(p))} dB pre`;
  }

  const eqState: EqState = { bands: preset.bands, preamp: preset.preamp };
  const thumb = useMemo(() => thumbPath(eqState, 108, 34), [preset]);
  const thumbColor = active ? accent.a : "rgba(28,32,58,0.32)";

  const cardStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    textAlign: "left",
    padding: "11px 12px",
    borderRadius: 13,
    cursor: "pointer",
    background: "#fff",
    border: active ? `1.5px solid ${accent.a}` : `1px solid ${CARD_BORDER}`,
    boxShadow: active
      ? `0 8px 20px -10px ${hexA(accent.a, 0.5)}`
      : hover
        ? "0 4px 12px -6px rgba(28,32,58,0.18)"
        : "0 1px 2px rgba(28,32,58,0.04)",
    transition: "all 0.16s",
    position: "relative",
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onApply(preset)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onApply(preset);
        }
      }}
      style={cardStyle}
    >
      {/* name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 650,
            color: INK,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {displayName}
        </div>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 500,
            color: META,
            marginTop: 2,
            fontFamily: MONO,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {meta}
        </div>
      </div>

      {/* per-card controls (appear on hover / when active / when auditioning) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexShrink: 0,
          opacity: hover || isAuditioning || active ? 1 : 0,
          transition: "opacity 0.14s",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {cloud && onLike && (
          <GhostIconButton
            title={tx.like}
            accent="#e0484d"
            active={cloud.liked}
            onClick={() => onLike(cloud)}
          >
            {Ico.heart(cloud.liked)}
          </GhostIconButton>
        )}
        <GhostIconButton
          title={isAuditioning ? tx.stop : tx.audition}
          accent={accent.a}
          active={isAuditioning}
          onClick={() => void auditionEngine.toggle(preset)}
        >
          {isAuditioning ? Ico.pause : Ico.play}
        </GhostIconButton>
        {onRename && !cloud && (
          <GhostIconButton title={tx.rename} accent={accent.a} onClick={() => onRename(preset as Preset)}>
            {Ico.pencil}
          </GhostIconButton>
        )}
        {onDelete && !cloud && (
          <GhostIconButton title={tx.delete} accent={accent.a} danger onClick={() => onDelete(preset as Preset)}>
            {Ico.trash}
          </GhostIconButton>
        )}
      </div>

      {/* mini-curve thumbnail */}
      <svg viewBox="0 0 108 34" width="64" height="22" style={{ flexShrink: 0, overflow: "visible" }}>
        <line x1="0" y1="17" x2="108" y2="17" stroke="rgba(28,32,58,0.10)" strokeWidth="1" />
        <path
          d={thumb}
          fill="none"
          stroke={thumbColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* active check badge */}
      <div
        style={{
          width: 20,
          height: 20,
          flexShrink: 0,
          borderRadius: "50%",
          display: active ? "grid" : "none",
          placeItems: "center",
          background: accent.grad,
          boxShadow: `0 2px 6px -1px ${accent.shadow}`,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List states (loading / error / empty)
// ---------------------------------------------------------------------------

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "44px 12px",
        fontSize: 12,
        color: MUTED,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function Spinner({ accent }: { accent: string }) {
  return (
    <>
      <style>{"@keyframes wpSpin{to{transform:rotate(360deg)}}"}</style>
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: `2px solid ${hexA(accent, 0.2)}`,
          borderTopColor: accent,
          animation: "wpSpin 0.7s linear infinite",
          display: "inline-block",
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Switcher (default export)
// ---------------------------------------------------------------------------

export default function Switcher() {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language?.startsWith("en") ? "en" : "zh";
  const tx = TX[lang];

  const presets = useEqStore((s) => s.presets);
  const currentPresetId = useEqStore((s) => s.currentPresetId);
  const device = useEqStore((s) => s.device);
  const accentKey = useEqStore((s) => s.accent);
  const applyPreset = useEqStore((s) => s.applyPreset);
  const saveAsCustom = useEqStore((s) => s.saveAsCustom);
  const renameCustom = useEqStore((s) => s.renameCustom);
  const deleteCustom = useEqStore((s) => s.deleteCustom);

  const accent = useMemo(() => palette(accentKey), [accentKey]);
  const auditioningId = useAuditioningId();

  const [tab, setTab] = useState<TabKey>("preset");

  const online = useOnlinePresets();
  const shares = useMyShares();

  const builtin = useMemo(() => presets.filter((p) => p.source === "preset"), [presets]);
  const custom = useMemo(() => presets.filter((p) => p.source === "custom"), [presets]);

  // Rename dialog state (custom presets only).
  const [renameTarget, setRenameTarget] = useState<Preset | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // --- label resolution: builtins carry an i18n key with a zh fallback. ---
  const labelOf = (p: Preset | CloudPreset): string => {
    if (p.source === "preset") {
      return i18n.t(p.name, { defaultValue: BUILTIN_FALLBACK_LABELS[p.name] ?? p.name });
    }
    return p.name;
  };

  // --- handlers ---
  const handleApply = (p: Preset) => applyPreset(p);

  const handleSave = () => {
    saveAsCustom();
    toast.success(tx.saved);
  };

  const openRename = (p: Preset) => {
    setRenameValue(p.name);
    setRenameTarget(p);
  };

  const submitRename = () => {
    const next = renameValue.trim();
    if (renameTarget && next && next !== renameTarget.name) {
      renameCustom(renameTarget.id, next);
    }
    setRenameTarget(null);
  };

  const handleDelete = (p: Preset) => deleteCustom(p.id);

  const makeLike = (resource: CloudResource<CloudPreset[]>) => (p: CloudPreset) => {
    void toggleShareLike(p.id, p.liked).then((newLiked) => {
      if (newLiked !== p.liked) resource.refetch();
    });
  };

  // --- which list is shown + its count ---
  const localList = tab === "preset" ? builtin : tab === "custom" ? custom : null;
  const cloudResource = tab === "online" ? online : tab === "shared" ? shares : null;
  const count =
    tab === "preset"
      ? builtin.length
      : tab === "custom"
        ? custom.length
        : cloudResource
          ? cloudResource.data.length
          : 0;

  const deviceName = device?.name ?? tx.deviceFallback;

  // --- tab segmented control ---
  const tabs: [TabKey, string][] = [
    ["preset", tx.tabPreset],
    ["custom", tx.tabCustom],
    ["online", tx.tabOnline],
    ["shared", tx.tabShared],
  ];
  const tabBase: CSSProperties = {
    flex: 1,
    height: 30,
    border: "none",
    borderRadius: 8,
    fontSize: 11.5,
    fontWeight: 650,
    cursor: "pointer",
    transition: "all 0.18s",
    whiteSpace: "nowrap",
    padding: "0 2px",
  };

  return (
    <aside
      style={{
        width: 304,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(180deg, #fafbfd 0%, #f6f7fa 100%)",
        borderRight: "1px solid rgba(28,32,58,0.08)",
        fontFamily: "'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      {/* Device card */}
      <div style={{ padding: "16px 16px 14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 13,
            borderRadius: 14,
            background: "#fff",
            border: `1px solid ${CARD_BORDER}`,
            boxShadow: "0 6px 16px -10px rgba(28,32,58,0.28)",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 11,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(160deg, #f3f5fb, #e7eaf3)",
              border: "1px solid rgba(28,32,58,0.06)",
              color: accent.a,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M3 12a9 9 0 0 1 18 0" />
              <rect x="2" y="12" width="5" height="8" rx="2.2" />
              <rect x="17" y="12" width="5" height="8" rx="2.2" />
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "#1b1f2e",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {deviceName}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: MONO,
                  color: accent.a,
                  background: accent.soft,
                  padding: "1px 6px",
                  borderRadius: 5,
                }}
              >
                384k · 32bit
              </span>
              <span style={{ fontSize: 11, color: MUTED }}>USB‑DAC</span>
            </div>
          </div>
        </div>
      </div>

      {/* Switcher header + tabs */}
      <div style={{ padding: "2px 16px 10px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            padding: "0 2px 9px",
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.02em", color: "#2a2f40" }}>
            {tx.switcher}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>
            {count}
            {tx.countSuffix}
          </span>
        </div>
        <div style={{ display: "flex", gap: 3, padding: 3, background: "#eceef4", borderRadius: 11 }}>
          {tabs.map(([k, label]) => {
            const activeTab = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                style={
                  activeTab
                    ? {
                        ...tabBase,
                        background: "#fff",
                        color: accent.ink,
                        boxShadow: "0 1px 3px rgba(28,32,58,0.12), 0 0 0 0.5px rgba(28,32,58,0.04)",
                      }
                    : { ...tabBase, background: "transparent", color: "#8a90a3" }
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preset list */}
      <div
        className="wp-scroll"
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 12px 12px" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {/* local tabs */}
          {localList &&
            (localList.length === 0 && tab === "custom" ? (
              <CenterNote>{tx.emptyCustom}</CenterNote>
            ) : (
              localList.map((p) => (
                <PresetCard
                  key={p.id}
                  preset={p}
                  displayName={labelOf(p)}
                  active={currentPresetId === p.id}
                  accent={accent}
                  auditioningId={auditioningId}
                  tx={tx}
                  onApply={handleApply}
                  onRename={tab === "custom" ? openRename : undefined}
                  onDelete={tab === "custom" ? handleDelete : undefined}
                />
              ))
            ))}

          {/* cloud tabs */}
          {cloudResource &&
            (cloudResource.loading ? (
              <CenterNote>
                <Spinner accent={accent.a} />
                {tx.loading}
              </CenterNote>
            ) : cloudResource.error ? (
              <CenterNote>
                <span>{tx.errLoad}</span>
                <button
                  type="button"
                  onClick={cloudResource.refetch}
                  style={{
                    height: 30,
                    padding: "0 14px",
                    borderRadius: 9,
                    border: "1px solid rgba(28,32,58,0.12)",
                    background: "#fff",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#4a5061",
                  }}
                >
                  {tx.retry}
                </button>
              </CenterNote>
            ) : cloudResource.data.length === 0 ? (
              <CenterNote>{tab === "online" ? tx.emptyOnline : tx.emptyShared}</CenterNote>
            ) : (
              cloudResource.data.map((p) => (
                <PresetCard
                  key={p.id}
                  preset={p}
                  displayName={labelOf(p)}
                  active={currentPresetId === p.id}
                  accent={accent}
                  auditioningId={auditioningId}
                  tx={tx}
                  onApply={handleApply}
                  onLike={makeLike(cloudResource)}
                />
              ))
            ))}
        </div>
      </div>

      {/* Save current */}
      <div style={{ padding: "12px 16px 16px", borderTop: `1px solid ${CARD_BORDER}` }}>
        <button
          type="button"
          onClick={handleSave}
          style={{
            width: "100%",
            height: 40,
            borderRadius: 11,
            border: "1px dashed rgba(28,32,58,0.18)",
            background: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontSize: 12.5,
            fontWeight: 650,
            color: "#4a5061",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {tx.saveCurrent}
        </button>
      </div>

      {/* Rename dialog (shadcn) */}
      <Dialog open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{tx.renameTitle}</DialogTitle>
            <DialogDescription className="sr-only">{tx.renameTitle}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
            }}
            placeholder={tx.renamePlaceholder}
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRenameTarget(null)}
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 9,
                border: "1px solid rgba(28,32,58,0.12)",
                background: "#fff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: "#4a5061",
              }}
            >
              {tx.cancel}
            </button>
            <button
              type="button"
              onClick={submitRename}
              disabled={!renameValue.trim()}
              style={{
                height: 36,
                padding: "0 16px",
                borderRadius: 9,
                border: "none",
                background: accent.grad,
                color: "#fff",
                cursor: renameValue.trim() ? "pointer" : "not-allowed",
                opacity: renameValue.trim() ? 1 : 0.5,
                fontSize: 13,
                fontWeight: 650,
              }}
            >
              {tx.confirm}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
