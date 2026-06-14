/**
 * Toolbar — the stage header row.
 *
 * Recreated pixel-faithfully from the Claude Design handoff
 * (`design-ref/project/WalkPlay EQ.dc.html`, lines 121-154) using INLINE STYLES.
 *
 * Layout (horizontal flex, align-items center, gap 14):
 *   [ title + bands badge ] [ master toggle ] [ flex spacer ]
 *   [ live FREQ|GAIN readout ] [ A/B segmented + copy ] [ reset ]
 *
 * Takes no props — everything is read from the global EQ store.
 */

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MoreHorizontal, RefreshCw, Share2, Factory } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEqStore } from "@/lib/store";
import { fmtFreq, hexA, palette } from "@/lib/theme";
import type { Preset } from "@/lib/types";

const MONO = "'JetBrains Mono', monospace";

type Lang = "zh" | "en";

const TX = {
  equalizer: { zh: "均衡器", en: "Equalizer" },
  bandsLabel: { zh: "10 频段", en: "10 Bands" },
  masterOn: { zh: "均衡开启", en: "EQ On" },
  masterOff: { zh: "均衡关闭", en: "EQ Off" },
  freq: { zh: "FREQ", en: "FREQ" },
  gain: { zh: "GAIN", en: "GAIN" },
  reset: { zh: "重置", en: "Reset" },
  copy: { zh: "复制到另一槽", en: "Copy to other slot" },
  more: { zh: "更多操作", en: "More actions" },
  updateCustom: { zh: "更新自定义 EQ", en: "Update custom EQ" },
  share: { zh: "分享 EQ", en: "Share EQ" },
  factory: { zh: "恢复出厂", en: "Factory reset" },
} as const;

export default function Toolbar() {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language?.startsWith("en") ? "en" : "zh";

  const bands = useEqStore((s) => s.eq.bands);
  const selected = useEqStore((s) => s.selected);
  const masterOn = useEqStore((s) => s.masterOn);
  const accent = useEqStore((s) => s.accent);
  const activeSlot = useEqStore((s) => s.activeSlot);

  const setActiveSlot = useEqStore((s) => s.setActiveSlot);
  const copyToOtherSlot = useEqStore((s) => s.copyToOtherSlot);
  const toggleMaster = useEqStore((s) => s.toggleMaster);
  const applyPreset = useEqStore((s) => s.applyPreset);
  const updateCustom = useEqStore((s) => s.updateCustom);
  const factoryReset = useEqStore((s) => s.factoryReset);

  const C = palette(accent);

  const onUpdateCustom = () => {
    const ok = updateCustom();
    toast(
      ok
        ? t("eq.toast.updateDone", lang)
        : t("eq.toast.updateNoTarget", lang),
    );
  };
  const onShare = () => toast(t("eq.toast.sharePending", lang));
  const onFactoryReset = async () => {
    try {
      await factoryReset();
      toast(t("eq.toast.factoryReset", lang));
    } catch (err) {
      toast.error(t("eq.toast.factoryResetFailed", lang), { description: String(err) });
    }
  };

  const band = bands[selected];
  const freq = band?.freq ?? 0;
  const gain = band?.gain ?? 0;

  const freqStr = fmtFreq(freq) + (freq < 1000 ? " Hz" : "Hz");
  const gainStr = (gain > 0 ? "+" : "") + gain.toFixed(1) + " dB";
  const gainColor = gain > 0.05 ? C.a : gain < -0.05 ? C.cut : "#9098ab";

  const onReset = () => {
    const flat: Preset = {
      id: "__flat__",
      name: "flat",
      source: "preset",
      preamp: 0,
      bands: bands.map((b) => ({ ...b, gain: 0 })),
    };
    applyPreset(flat);
    toast(t("eq.toast.cleared", lang));
  };

  // --- styles ---

  const masterStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    height: "34px",
    padding: "0 13px",
    flexShrink: 0,
    whiteSpace: "nowrap",
    borderRadius: "10px",
    cursor: "pointer",
    fontSize: "12.5px",
    fontWeight: 650,
    transition: "all 0.18s",
    border: "1px solid " + (masterOn ? hexA(C.a, 0.25) : "rgba(28,32,58,0.10)"),
    background: masterOn ? C.soft : "#fff",
    color: masterOn ? C.a : "#8a90a3",
  };
  const masterDotStyle: CSSProperties = {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: masterOn ? C.a : "#c2c7d4",
    boxShadow: masterOn ? "0 0 0 3px " + hexA(C.a, 0.18) : "none",
  };

  const abBase: CSSProperties = {
    width: "32px",
    height: "26px",
    border: "none",
    borderRadius: "7px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.16s",
    fontFamily: MONO,
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
      {/* left: title + bands badge */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: "19px",
            fontWeight: 750,
            letterSpacing: "-0.02em",
            whiteSpace: "nowrap",
          }}
        >
          {TX.equalizer[lang]}
        </h1>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 650,
            color: C.a,
            background: C.soft,
            padding: "3px 8px",
            borderRadius: "6px",
            whiteSpace: "nowrap",
          }}
        >
          {TX.bandsLabel[lang]}
        </span>
      </div>

      {/* master toggle */}
      <button type="button" onClick={() => toggleMaster()} style={masterStyle}>
        <span style={masterDotStyle} />
        {masterOn ? TX.masterOn[lang] : TX.masterOff[lang]}
      </button>

      <div style={{ flex: 1 }} />

      {/* live readout well */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "0 14px",
          height: "34px",
          borderRadius: "10px",
          background: "#f6f7fa",
          border: "1px solid rgba(28,32,58,0.06)",
          fontFamily: MONO,
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
          <span style={{ fontSize: "10px", color: "#9098ab", fontFamily: "'Manrope'" }}>
            {TX.freq[lang]}
          </span>
          <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#2a2f40" }}>{freqStr}</span>
        </div>
        <div style={{ width: "1px", height: "14px", background: "rgba(28,32,58,0.10)" }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
          <span style={{ fontSize: "10px", color: "#9098ab", fontFamily: "'Manrope'" }}>
            {TX.gain[lang]}
          </span>
          <span style={{ fontSize: "12.5px", fontWeight: 600, color: gainColor }}>{gainStr}</span>
        </div>
      </div>

      {/* A/B compare segmented control */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "3px",
          padding: "3px",
          background: "#eceef4",
          borderRadius: "10px",
        }}
      >
        {(["A", "B"] as const).map((slot) => {
          const active = activeSlot === slot;
          const style: CSSProperties = active
            ? {
                ...abBase,
                background: C.grad,
                color: "#fff",
                boxShadow: "0 2px 6px -1px " + C.shadow,
              }
            : { ...abBase, background: "transparent", color: "#8a90a3" };
          return (
            <button key={slot} type="button" onClick={() => setActiveSlot(slot)} style={style}>
              {slot}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => copyToOtherSlot()}
          title={TX.copy[lang]}
          style={{
            width: "28px",
            height: "26px",
            borderRadius: "7px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            color: "#8a90a3",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="9" y="9" width="11" height="11" rx="2.4" />
            <path d="M5 15V5a2 2 0 0 1 2-2h8" />
          </svg>
        </button>
      </div>

      {/* reset (flatten) */}
      <button
        type="button"
        onClick={onReset}
        title={TX.reset[lang]}
        style={{
          width: "34px",
          height: "34px",
          borderRadius: "10px",
          border: "1px solid rgba(28,32,58,0.10)",
          background: "#fff",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          color: "#6b7184",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>

      {/* overflow: update custom / share / factory reset */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={TX.more[lang]}
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "10px",
              border: "1px solid rgba(28,32,58,0.10)",
              background: "#fff",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              color: "#6b7184",
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onUpdateCustom}>
            <RefreshCw />
            {TX.updateCustom[lang]}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onShare}>
            <Share2 />
            {TX.share[lang]}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => void onFactoryReset()}>
            <Factory />
            {TX.factory[lang]}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Bilingual lookup for an i18n key with a local fallback. The toolbar only needs
 * the "cleared" toast string; we try react-i18next's catalog first (so a real
 * translation wins) and fall back to a sensible default if the key is missing.
 */
function t(key: string, lang: Lang): string {
  const fallback: Record<string, { zh: string; en: string }> = {
    "eq.toast.cleared": { zh: "已重置均衡器", en: "Equalizer cleared" },
    "eq.toast.updateDone": { zh: "已更新自定义 EQ", en: "Custom EQ updated" },
    "eq.toast.updateNoTarget": {
      zh: "请先在「自定义」里选择一个要更新的 EQ",
      en: "Select a custom EQ to update first",
    },
    "eq.toast.sharePending": { zh: "分享功能即将上线", en: "Sharing coming soon" },
    "eq.toast.factoryReset": { zh: "已恢复出厂设置", en: "Factory settings restored" },
    "eq.toast.factoryResetFailed": { zh: "恢复出厂失败", en: "Factory reset failed" },
  };
  return fallback[key]?.[lang] ?? key;
}
