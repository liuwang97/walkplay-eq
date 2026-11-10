/**
 * Toolbar — the stage header row.
 *
 * Recreated pixel-faithfully from the Claude Design handoff
 * (`design-ref/project/WalkPlay EQ.dc.html`, lines 121-154) using INLINE STYLES.
 *
 * Layout (horizontal flex, align-items center, gap 14):
 *   [ title + bands badge ] [ master toggle ] [ flex spacer ]
 *   [ live FREQ|GAIN readout ] [ A/B segmented + copy ] [ reset ] [ more ]
 *
 * The overflow menu holds: update custom EQ, factory reset, microphone gain,
 * launch at startup.
 *
 * Takes no props — everything is read from the global EQ store.
 */

import type { CSSProperties } from "react";
import { toast } from "sonner";
import { MoreHorizontal, RefreshCw, Factory } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLang } from "@/i18n";
import { isTauri } from "@/lib/bridge";
import { useEqStore } from "@/lib/store";
import { fmtFreq, hexA, palette } from "@/lib/theme";
import { MIC_GAIN, type Preset } from "@/lib/types";

const MONO = "'JetBrains Mono', monospace";

const micStep: CSSProperties = {
  width: "22px",
  height: "22px",
  borderRadius: "6px",
  border: "1px solid rgba(28,32,58,0.12)",
  background: "#fff",
  cursor: "pointer",
  lineHeight: 1,
};

const TX = {
  equalizer: { zh: "均衡器", en: "Equalizer" },
  bands: { zh: "频段", en: "Bands" },
  masterOn: { zh: "均衡开启", en: "EQ On" },
  masterOff: { zh: "均衡关闭", en: "EQ Off" },
  freq: { zh: "FREQ", en: "FREQ" },
  gain: { zh: "GAIN", en: "GAIN" },
  reset: { zh: "重置", en: "Reset" },
  copy: { zh: "复制到另一槽", en: "Copy to other slot" },
  more: { zh: "更多操作", en: "More actions" },
  updateCustom: { zh: "更新自定义 EQ", en: "Update custom EQ" },
  factory: { zh: "恢复出厂设置", en: "Factory reset" },
  micGain: { zh: "麦克风增益", en: "Mic gain" },
  autostart: { zh: "开机自启动", en: "Launch at startup" },
  cleared: { zh: "已重置均衡器", en: "Equalizer cleared" },
  updateDone: { zh: "已更新自定义 EQ", en: "Custom EQ updated" },
  updateNoTarget: {
    zh: "请先在「自定义」里选择一个要更新的 EQ",
    en: "Select a custom EQ to update first",
  },
  factoryDone: { zh: "已恢复出厂设置", en: "Factory settings restored" },
} as const;

export default function Toolbar() {
  const lang = useLang();

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
  const resetToDefault = useEqStore((s) => s.resetToDefault);
  const autostart = useEqStore((s) => s.autostart);
  const micGain = useEqStore((s) => s.micGain);
  const setMicGain = useEqStore((s) => s.setMicGain);
  const setAutostart = useEqStore((s) => s.setAutostart);

  const C = palette(accent);

  const onUpdateCustom = () =>
    toast((updateCustom() ? TX.updateDone : TX.updateNoTarget)[lang]);
  const onFactoryReset = () => {
    resetToDefault();
    toast(TX.factoryDone[lang]);
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
    toast(TX.cleared[lang]);
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
          {bands.length} {TX.bands[lang]}
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
          <DropdownMenuItem variant="destructive" onSelect={onFactoryReset}>
            <Factory />
            {TX.factory[lang]}
          </DropdownMenuItem>
          {micGain !== null && (
            <>
              <DropdownMenuSeparator />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "14px",
                  padding: "6px 8px",
                  fontSize: "13px",
                }}
              >
                <span>{TX.micGain[lang]}</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button
                    type="button"
                    style={micStep}
                    disabled={micGain <= MIC_GAIN.min}
                    onClick={() => setMicGain(micGain - 1)}
                  >
                    −
                  </button>
                  <span style={{ minWidth: "48px", textAlign: "center", fontFamily: MONO }}>
                    {(micGain > 0 ? "+" : "") + micGain} dB
                  </span>
                  <button
                    type="button"
                    style={micStep}
                    disabled={micGain >= MIC_GAIN.max}
                    onClick={() => setMicGain(micGain + 1)}
                  >
                    +
                  </button>
                </span>
              </div>
            </>
          )}
          {isTauri() && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={autostart}
                onCheckedChange={(on) => void setAutostart(on)}
              >
                {TX.autostart[lang]}
              </DropdownMenuCheckboxItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
