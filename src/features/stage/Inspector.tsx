/**
 * Inspector — the per-band editor row beneath the instrument.
 *
 * Recreated pixel-faithfully from the Claude Design handoff
 * (`design-ref/project/WalkPlay EQ.dc.html`, lines 159-217) using INLINE STYLES.
 *
 * Layout (horizontal flex card, porcelain gradient, rounded 16, gap 18):
 *   [ band tile + label ] | [ Type seg ] [ Freq ± ] [ Q ± ] [ Gain ± ]
 *   [ flex spacer ] [ enable switch ]
 *
 * Takes no props — everything is read from the global EQ store. Operates on the
 * currently-selected band (`bands[selected]`); guarded against an undefined band.
 */

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { useEqStore } from "@/lib/store";
import { clamp, fmtFreq, palette, round05 } from "@/lib/theme";
import type { EqBandType } from "@/lib/types";

const MONO = "'JetBrains Mono', monospace";

type Lang = "zh" | "en";

const TX = {
  band: { zh: "频段", en: "Band" },
  type: { zh: "类型", en: "Type" },
  freq: { zh: "频率", en: "Freq" },
  q: { zh: "Q 值", en: "Q" },
  gain: { zh: "增益", en: "Gain" },
} as const;

const TYPE_NAMES: Record<Lang, Record<EqBandType, string>> = {
  zh: { PK: "峰值 Peaking", LS: "低架 Low Shelf", HS: "高架 High Shelf" },
  en: { PK: "Peaking", LS: "Low Shelf", HS: "High Shelf" },
};

const stepBtn: CSSProperties = {
  width: "26px",
  height: "26px",
  borderRadius: "7px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "#6b7184",
  fontSize: "17px",
  lineHeight: 1,
  display: "grid",
  placeItems: "center",
};

const stepperWell: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "2px",
  height: "32px",
  padding: "2px",
  background: "#fff",
  border: "1px solid rgba(28,32,58,0.10)",
  borderRadius: "9px",
};

const fieldLabel: CSSProperties = {
  fontSize: "10px",
  fontWeight: 600,
  letterSpacing: "0.04em",
  color: "#9098ab",
  textTransform: "uppercase",
};

export default function Inspector() {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language?.startsWith("en") ? "en" : "zh";

  const bands = useEqStore((s) => s.eq.bands);
  const selected = useEqStore((s) => s.selected);
  const accent = useEqStore((s) => s.accent);
  const setBand = useEqStore((s) => s.setBand);

  const C = palette(accent);
  const b = bands[selected];

  // Guard: nothing selected / band missing — render nothing rather than crash.
  if (!b) return null;

  const id = b.id;
  const numStr = selected + 1 < 10 ? "0" + (selected + 1) : "" + (selected + 1);
  const freqStr = fmtFreq(b.freq) + (b.freq < 1000 ? " Hz" : "Hz");
  const qStr = b.q.toFixed(2);
  const gainStr = (b.gain > 0 ? "+" : "") + b.gain.toFixed(1) + " dB";
  const gainColor = b.gain > 0.05 ? C.a : b.gain < -0.05 ? C.cut : "#9098ab";

  const freqUp = () => setBand(id, { freq: clamp(Math.round(b.freq * 1.08), 20, 20000) });
  const freqDown = () => setBand(id, { freq: clamp(Math.round(b.freq / 1.08), 20, 20000) });
  const qUp = () => setBand(id, { q: clamp(Math.round((b.q + 0.1) * 100) / 100, 0.1, 10) });
  const qDown = () => setBand(id, { q: clamp(Math.round((b.q - 0.1) * 100) / 100, 0.1, 10) });
  const gainUp = () => setBand(id, { gain: clamp(round05(b.gain + 0.5), -10, 10) });
  const gainDown = () => setBand(id, { gain: clamp(round05(b.gain - 0.5), -10, 10) });
  const toggleEnabled = () => setBand(id, { enabled: !b.enabled });

  const typeBase: CSSProperties = {
    width: "38px",
    height: "26px",
    border: "none",
    borderRadius: "7px",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.16s",
  };

  const enableStyle: CSSProperties = {
    position: "relative",
    width: "46px",
    height: "27px",
    borderRadius: "99px",
    border: "none",
    cursor: "pointer",
    padding: 0,
    transition: "background 0.2s",
    background: b.enabled ? C.grad : "#d3d7e0",
    boxShadow: b.enabled
      ? "0 2px 8px -2px " + C.shadow
      : "inset 0 1px 2px rgba(28,32,58,0.12)",
  };
  const enableKnob: CSSProperties = {
    position: "absolute",
    top: "3px",
    left: b.enabled ? "22px" : "3px",
    width: "21px",
    height: "21px",
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 1px 3px rgba(28,32,58,0.3)",
    transition: "left 0.2s cubic-bezier(0.4,0,0.2,1)",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "18px",
        padding: "14px 18px",
        borderRadius: "16px",
        background: "linear-gradient(180deg, #fafbfd, #f5f6fa)",
        border: "1px solid rgba(28,32,58,0.07)",
      }}
    >
      {/* band tile + label */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div
          style={{
            width: "38px",
            height: "38px",
            borderRadius: "11px",
            display: "grid",
            placeItems: "center",
            background: C.grad,
            color: "#fff",
            fontSize: "14px",
            fontWeight: 750,
            boxShadow: "0 4px 10px -3px " + C.shadow,
            fontFamily: MONO,
          }}
        >
          {numStr}
        </div>
        <div>
          <div style={{ fontSize: "13.5px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            {TX.band[lang]} {numStr}
          </div>
          <div style={{ fontSize: "11px", color: "#9098ab", fontWeight: 500 }}>
            {TYPE_NAMES[lang][b.type]}
          </div>
        </div>
      </div>

      <div style={{ width: "1px", height: "38px", background: "rgba(28,32,58,0.09)" }} />

      {/* type segmented */}
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        <span style={fieldLabel}>{TX.type[lang]}</span>
        <div
          style={{
            display: "flex",
            gap: "3px",
            padding: "3px",
            background: "#eceef4",
            borderRadius: "9px",
          }}
        >
          {(["PK", "LS", "HS"] as const).map((tp) => {
            const active = b.type === tp;
            const style: CSSProperties = active
              ? {
                  ...typeBase,
                  background: "#fff",
                  color: C.ink,
                  boxShadow: "0 1px 3px rgba(28,32,58,0.12), 0 0 0 0.5px rgba(28,32,58,0.04)",
                }
              : { ...typeBase, background: "transparent", color: "#8a90a3" };
            return (
              <button key={tp} type="button" onClick={() => setBand(id, { type: tp })} style={style}>
                {tp}
              </button>
            );
          })}
        </div>
      </div>

      {/* freq stepper */}
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        <span style={fieldLabel}>{TX.freq[lang]}</span>
        <div style={stepperWell}>
          <button type="button" onClick={freqDown} style={stepBtn}>
            −
          </button>
          <span
            style={{
              minWidth: "58px",
              textAlign: "center",
              fontSize: "13px",
              fontWeight: 650,
              fontFamily: MONO,
              color: "#2a2f40",
            }}
          >
            {freqStr}
          </span>
          <button type="button" onClick={freqUp} style={stepBtn}>
            +
          </button>
        </div>
      </div>

      {/* Q stepper */}
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        <span style={fieldLabel}>{TX.q[lang]}</span>
        <div style={stepperWell}>
          <button type="button" onClick={qDown} style={stepBtn}>
            −
          </button>
          <span
            style={{
              minWidth: "42px",
              textAlign: "center",
              fontSize: "13px",
              fontWeight: 650,
              fontFamily: MONO,
              color: "#2a2f40",
            }}
          >
            {qStr}
          </span>
          <button type="button" onClick={qUp} style={stepBtn}>
            +
          </button>
        </div>
      </div>

      {/* gain stepper */}
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        <span style={fieldLabel}>{TX.gain[lang]}</span>
        <div style={stepperWell}>
          <button type="button" onClick={gainDown} style={stepBtn}>
            −
          </button>
          <span
            style={{
              minWidth: "62px",
              whiteSpace: "nowrap",
              textAlign: "center",
              fontSize: "13px",
              fontWeight: 650,
              fontFamily: MONO,
              color: gainColor,
            }}
          >
            {gainStr}
          </span>
          <button type="button" onClick={gainUp} style={stepBtn}>
            +
          </button>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* enable toggle */}
      <button type="button" onClick={toggleEnabled} style={enableStyle} aria-pressed={b.enabled}>
        <span style={enableKnob} />
      </button>
    </div>
  );
}
