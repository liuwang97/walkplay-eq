/**
 * Instrument — the integrated EQ instrument (master preamp + curve + fader rail).
 *
 * Ported pixel-faithfully from the Claude Design handoff (`design-ref/`,
 * `buildInstrument(C)`), using inline styles to match the porcelain light UI.
 *
 * Layout: a horizontal flex row of
 *   1. Master preamp card (left, 92px) — vertical fader, range [-16, +6].
 *   2. Right column (flex:1) — curve card (SVG response + draggable nodes) on top
 *      of a fader rail card (one fader per band).
 *
 * Interaction is window-level pointer drag (node / gain / preamp), mirroring the
 * design JS. A local `view` state eases toward the store's actual gains/preamp via
 * requestAnimationFrame so preset changes morph smoothly; drags snap instantly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useEqStore } from "@/lib/store";
import {
  palette,
  hexA,
  INSTR_W,
  INSTR_H,
  freqToX,
  xToFreq,
  dbToY,
  fmtFreq,
  clamp,
  round1,
  round05,
} from "@/lib/theme";
import { computeMagnitudeResponse, makeFreqAxis } from "@/features/curve/dsp";
import type { EqState, EqBand } from "@/lib/types";

const W = INSTR_W;
const H = INSTR_H;

/** Local-only displayed EQ values that ease toward the store. */
interface ViewState {
  gains: number[];
  preamp: number;
}

/** y -> dB inverse using the same span as theme.dbToY. */
function yToDbLocal(y: number): number {
  return ((H / 2 - y) / (H / 2 - 22)) * 15;
}

type DragKind = "node" | "gain" | "preamp";
interface DragState {
  type: DragKind;
  id: number;
  rect: DOMRect;
}

export default function Instrument() {
  const bands = useEqStore((s) => s.eq.bands);
  const preamp = useEqStore((s) => s.eq.preamp);
  const selected = useEqStore((s) => s.selected);
  const masterOn = useEqStore((s) => s.masterOn);
  const accent = useEqStore((s) => s.accent);
  const setBand = useEqStore((s) => s.setBand);
  const setPreamp = useEqStore((s) => s.setPreamp);
  const setSelected = useEqStore((s) => s.setSelected);

  const C = palette(accent);

  // --- local "view" that eases toward the store ----------------------------
  const [view, setView] = useState<ViewState>(() => ({
    gains: bands.map((b) => b.gain),
    preamp,
  }));

  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef<number | null>(null);
  const fbRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest target (store) values, read inside the rAF tick without re-subscribing.
  const targetRef = useRef<{ gains: number[]; preamp: number }>({
    gains: bands.map((b) => b.gain),
    preamp,
  });
  targetRef.current = { gains: bands.map((b) => b.gain), preamp };

  const tick = useCallback(() => {
    setView((v) => {
      const t = targetRef.current;
      let done = true;
      const gains = v.gains.map((g, i) => {
        const tg = t.gains[i] ?? 0;
        const d = tg - g;
        if (Math.abs(d) > 0.02) {
          done = false;
          return g + d * 0.26;
        }
        return tg;
      });
      let np = v.preamp;
      const dp = t.preamp - v.preamp;
      if (Math.abs(dp) > 0.02) {
        done = false;
        np = v.preamp + dp * 0.26;
      } else {
        np = t.preamp;
      }
      rafRef.current = done ? null : requestAnimationFrame(tick);
      return { gains, preamp: np };
    });
  }, []);

  const startAnim = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
    if (fbRef.current) clearTimeout(fbRef.current);
    fbRef.current = setTimeout(() => {
      const t = targetRef.current;
      setView({ gains: t.gains.slice(), preamp: t.preamp });
    }, 520);
  }, [tick]);

  // When the store's gains/preamp change: snap instantly while dragging,
  // otherwise animate the view toward the new target.
  const gainsKey = bands.map((b) => b.gain).join(",");
  useEffect(() => {
    if (dragRef.current) {
      // Drag: reflect the edited band(s) instantly, no easing.
      setView({ gains: targetRef.current.gains.slice(), preamp: targetRef.current.preamp });
    } else {
      startAnim();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gainsKey, preamp]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (fbRef.current) clearTimeout(fbRef.current);
    };
  }, []);

  // --- pointer drag (window-level) -----------------------------------------
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const r = d.rect;
      if (d.type === "node") {
        const x = ((e.clientX - r.left) / r.width) * W;
        const y = ((e.clientY - r.top) / r.height) * H;
        const gain = clamp(round1(yToDbLocal(y)), -10, 10);
        const freq = clamp(Math.round(xToFreq(clamp(x, 0, W))), 20, 20000);
        setBand(d.id, { gain, freq });
      } else if (d.type === "gain") {
        const ratio = clamp((e.clientY - r.top) / r.height, 0, 1);
        setBand(d.id, { gain: clamp(round05(10 - ratio * 20), -10, 10) });
      } else if (d.type === "preamp") {
        const ratio = clamp((e.clientY - r.top) / r.height, 0, 1);
        setPreamp(clamp(round05(6 - ratio * 22), -16, 6));
      }
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setDragging(false);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [setBand, setPreamp]);

  const nodeDown = (i: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    dragRef.current = { type: "node", id: i, rect: svg.getBoundingClientRect() };
    setDragging(true);
    setSelected(i);
  };
  const gainDown = (i: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    dragRef.current = { type: "gain", id: i, rect: r };
    setDragging(true);
    setSelected(i);
    const ratio = clamp((e.clientY - r.top) / r.height, 0, 1);
    setBand(i, { gain: clamp(round05(10 - ratio * 20), -10, 10) });
  };
  const preampDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    dragRef.current = { type: "preamp", id: -1, rect: r };
    setDragging(true);
    const ratio = clamp((e.clientY - r.top) / r.height, 0, 1);
    setPreamp(clamp(round05(6 - ratio * 22), -16, 6));
  };

  // --- displayed bands (real freq/type/enabled, view gains) -----------------
  const on = masterOn;
  const viewBands: EqBand[] = bands.map((b, i) => ({
    ...b,
    gain: view.gains[i] ?? b.gain,
  }));
  const viewPreamp = view.preamp;

  // --- live curve via DSP ---------------------------------------------------
  const freqAxis = makeFreqAxis(220);
  const tempEq: EqState = { bands: viewBands, preamp: viewPreamp };
  const mags = computeMagnitudeResponse(tempEq, freqAxis);

  const lineParts: string[] = [];
  const fillParts: string[] = [];
  for (let i = 0; i < freqAxis.length; i++) {
    const db = on ? mags[i] : 0;
    const x = ((i / (freqAxis.length - 1)) * W);
    const y = clamp(dbToY(db), 2, H - 2);
    lineParts.push((i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1));
    fillParts.push("L" + x.toFixed(1) + " " + y.toFixed(1));
  }
  const linePath = lineParts.join(" ");
  const fillPath = "M0 " + H + " " + fillParts.join(" ") + " L" + W + " " + H + " Z";

  // --- grid -----------------------------------------------------------------
  const gridEls: React.ReactNode[] = [];
  [-12, -6, 0, 6, 12].forEach((db) => {
    const y = dbToY(db);
    gridEls.push(
      <line
        key={"hg" + db}
        x1={0}
        x2={W}
        y1={y}
        y2={y}
        stroke={db === 0 ? "rgba(28,32,58,0.16)" : "rgba(28,32,58,0.07)"}
        strokeWidth={db === 0 ? 1.2 : 1}
        strokeDasharray={db === 0 ? undefined : "2 4"}
      />,
    );
    gridEls.push(
      <text
        key={"ht" + db}
        x={6}
        y={y - 4}
        fontSize={9.5}
        fill="#a8aec0"
        fontFamily="'JetBrains Mono', monospace"
      >
        {(db > 0 ? "+" : "") + db}
      </text>,
    );
  });
  [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach((f) => {
    const x = freqToX(f);
    gridEls.push(
      <line
        key={"vg" + f}
        x1={x}
        x2={x}
        y1={0}
        y2={H}
        stroke="rgba(28,32,58,0.05)"
        strokeWidth={1}
      />,
    );
    gridEls.push(
      <text
        key={"vt" + f}
        x={clamp(x, 12, W - 14)}
        y={H - 6}
        fontSize={9.5}
        fill="#a8aec0"
        textAnchor="middle"
        fontFamily="'JetBrains Mono', monospace"
      >
        {fmtFreq(f)}
      </text>,
    );
  });

  // --- tethers + Q halo + nodes --------------------------------------------
  const tetherEls: React.ReactNode[] = [];
  viewBands.forEach((b, i) => {
    const x = freqToX(b.freq);
    const y = dbToY(b.gain);
    const isSel = i === selected;
    tetherEls.push(
      <line
        key={"te" + i}
        x1={x}
        x2={x}
        y1={y}
        y2={H}
        stroke={isSel ? hexA(C.a, 0.32) : "rgba(28,32,58,0.10)"}
        strokeWidth={isSel ? 1.4 : 1}
        strokeDasharray={isSel ? undefined : "1 4"}
      />,
    );
  });

  const nodeEls: React.ReactNode[] = [];
  const selB = viewBands[selected];
  if (selB && on && selB.enabled) {
    const x = freqToX(selB.freq);
    const y = dbToY(selB.gain);
    const hw = clamp(150 / selB.q, 16, 240);
    nodeEls.push(
      <ellipse
        key="halo"
        cx={x}
        cy={y}
        rx={hw}
        ry={16}
        fill={hexA(C.a, 0.1)}
        stroke={hexA(C.a, 0.22)}
        strokeWidth={1}
      />,
    );
  }
  viewBands.forEach((b, i) => {
    const x = freqToX(b.freq);
    const y = dbToY(b.gain);
    const isSel = i === selected;
    const dim = on && !b.enabled;
    nodeEls.push(
      <circle
        key={"hit" + i}
        cx={x}
        cy={y}
        r={17}
        fill="transparent"
        style={{ cursor: "grab", touchAction: "none" }}
        onPointerDown={nodeDown(i)}
      />,
    );
    nodeEls.push(
      <circle
        key={"nd" + i}
        cx={x}
        cy={y}
        r={isSel ? 8 : 6}
        fill={dim ? "#fff" : isSel ? C.a : "#fff"}
        stroke={dim ? "rgba(28,32,58,0.25)" : C.a}
        strokeWidth={isSel ? 2.4 : 2}
        style={{
          pointerEvents: "none",
          filter: isSel
            ? "drop-shadow(0 2px 5px " + hexA(C.a, 0.5) + ")"
            : "drop-shadow(0 1px 2px rgba(28,32,58,0.2))",
          transition: dragging ? "none" : "r 0.15s ease",
        }}
      />,
    );
    if (isSel) {
      nodeEls.push(
        <circle
          key={"ndc" + i}
          cx={x}
          cy={y}
          r={2.4}
          fill="#fff"
          style={{ pointerEvents: "none" }}
        />,
      );
    }
  });

  // --- curve card -----------------------------------------------------------
  const curveCard = (
    <div
      style={{
        height: H + "px",
        borderRadius: "16px",
        background: "linear-gradient(180deg,#fcfcfe,#f7f8fb)",
        border: "1px solid rgba(28,32,58,0.07)",
        boxShadow: "0 1px 2px rgba(28,32,58,0.04), inset 0 1px 0 rgba(255,255,255,0.7)",
        padding: "6px 6px 0",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={"0 0 " + W + " " + H}
        width="100%"
        height={H}
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id="wpStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={C.a} />
            <stop offset="100%" stopColor={C.d} />
          </linearGradient>
          <linearGradient id="wpFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hexA(C.a, 0.2)} />
            <stop offset="100%" stopColor={hexA(C.a, 0.0)} />
          </linearGradient>
        </defs>
        {gridEls}
        <path
          d={fillPath}
          fill="url(#wpFill)"
          style={{ opacity: on ? 1 : 0.25, transition: "opacity 0.3s" }}
        />
        <path
          d={linePath}
          fill="none"
          stroke="url(#wpStroke)"
          strokeWidth={2.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ opacity: on ? 1 : 0.3, transition: "opacity 0.3s" }}
        />
        {tetherEls}
        {nodeEls}
      </svg>
    </div>
  );

  // --- fader rail -----------------------------------------------------------
  const railH = 152;
  const trackH = 86;
  const railChildren = viewBands.map((b, i) => {
    const isSel = i === selected;
    const dim = on && !b.enabled;
    const ratio = (10 - b.gain) / 20; // 0 = top
    const handleTop = ratio * trackH;
    const zeroTop = 0.5 * trackH;
    const boost = b.gain > 0.05;
    const cut = b.gain < -0.05;
    const segTop = Math.min(handleTop, zeroTop);
    const segH = Math.abs(handleTop - zeroTop);
    const idxLabel = i + 1 < 10 ? "0" + (i + 1) : "" + (i + 1);
    return (
      <div
        key={"fc" + i}
        style={{
          flex: "1 1 0",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "5px",
          opacity: dim ? 0.4 : 1,
          transition: dragging ? "none" : "opacity 0.2s",
        }}
      >
        <span
          style={{
            height: "13px",
            lineHeight: "13px",
            fontSize: "10.5px",
            fontWeight: 600,
            whiteSpace: "nowrap",
            fontFamily: "'JetBrains Mono', monospace",
            color: boost ? C.a : cut ? "#7c8398" : "#aab0c0",
          }}
        >
          {isSel || boost || cut ? (b.gain > 0 ? "+" : "") + b.gain.toFixed(1) : ""}
        </span>
        <div
          onPointerDown={gainDown(i)}
          style={{
            position: "relative",
            width: "7px",
            height: trackH + "px",
            borderRadius: "99px",
            background: "#e6e8f0",
            cursor: "ns-resize",
            touchAction: "none",
            boxShadow: "inset 0 1px 2px rgba(28,32,58,0.10)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: zeroTop - 0.5 + "px",
              height: "1px",
              background: "rgba(28,32,58,0.18)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: segTop + "px",
              height: segH + "px",
              borderRadius: "99px",
              background: boost
                ? "linear-gradient(180deg," + C.a + "," + C.d + ")"
                : "rgba(124,131,152,0.5)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: handleTop + "px",
              width: isSel ? "20px" : "16px",
              height: isSel ? "20px" : "16px",
              transform: "translate(-50%,-50%)",
              borderRadius: "50%",
              background: "#fff",
              border: "2px solid " + (isSel ? C.a : "rgba(28,32,58,0.22)"),
              boxShadow: isSel
                ? "0 2px 8px " + hexA(C.a, 0.45)
                : "0 1px 3px rgba(28,32,58,0.22)",
              cursor: "grab",
              transition: dragging ? "none" : "width 0.12s, height 0.12s",
            }}
          />
        </div>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            color: isSel ? C.a : "#aab0c0",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {idxLabel}
        </span>
        <span
          style={{
            fontSize: "8.5px",
            color: "#b4bac8",
            fontFamily: "'JetBrains Mono', monospace",
            marginTop: "-3px",
          }}
        >
          {fmtFreq(b.freq)}
        </span>
      </div>
    );
  });
  const railCard = (
    <div
      style={{
        height: railH + "px",
        borderRadius: "16px",
        background: "linear-gradient(180deg,#fcfcfe,#f6f7fa)",
        border: "1px solid rgba(28,32,58,0.07)",
        display: "flex",
        alignItems: "flex-start",
        padding: "8px 14px 10px",
        gap: "4px",
        overflow: "hidden",
      }}
    >
      {railChildren}
    </div>
  );

  const rightCol = (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      {curveCard}
      {railCard}
    </div>
  );

  // --- master preamp --------------------------------------------------------
  const pTrackH = 300;
  const pRatio = (6 - viewPreamp) / 22;
  const pHandle = pRatio * pTrackH;
  const pZero = ((6 - 0) / 22) * pTrackH;
  const pBoost = viewPreamp > 0.05;
  const pCut = viewPreamp < -0.05;
  const pSegTop = Math.min(pHandle, pZero);
  const pSegH = Math.abs(pHandle - pZero);
  const master = (
    <div
      style={{
        width: "92px",
        flexShrink: 0,
        borderRadius: "16px",
        background: "linear-gradient(180deg,#fcfcfe,#f5f6fa)",
        border: "1px solid " + hexA(C.a, 0.18),
        boxShadow: "0 1px 2px rgba(28,32,58,0.04)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "14px 0 12px",
      }}
    >
      <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", color: C.a }}>
        PREAMP
      </span>
      <span
        style={{
          fontSize: "13px",
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          color: pBoost ? C.a : pCut ? "#7c8398" : "#9098ab",
          margin: "6px 0 10px",
        }}
      >
        {(viewPreamp > 0 ? "+" : "") + viewPreamp.toFixed(1)}
      </span>
      <div
        onPointerDown={preampDown}
        style={{
          position: "relative",
          width: "8px",
          height: pTrackH + "px",
          borderRadius: "99px",
          background: "#e6e8f0",
          cursor: "ns-resize",
          touchAction: "none",
          boxShadow: "inset 0 1px 2px rgba(28,32,58,0.10)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: pZero - 0.5 + "px",
            height: "1px",
            background: "rgba(28,32,58,0.18)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: pSegTop + "px",
            height: pSegH + "px",
            borderRadius: "99px",
            background: pBoost
              ? "linear-gradient(180deg," + C.a + "," + C.d + ")"
              : "rgba(124,131,152,0.5)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: pHandle + "px",
            width: "22px",
            height: "22px",
            transform: "translate(-50%,-50%)",
            borderRadius: "50%",
            background: "#fff",
            border: "2px solid " + C.a,
            boxShadow: "0 2px 8px " + hexA(C.a, 0.4),
            cursor: "grab",
            transition: dragging ? "none" : "top 0.05s linear",
          }}
        />
      </div>
      <span
        style={{
          fontSize: "9px",
          color: "#b4bac8",
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: "8px",
        }}
      >
        +6 · −16
      </span>
      <span style={{ fontSize: "10px", color: "#9098ab", marginTop: "2px" }}>dB</span>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: "16px", alignItems: "stretch" }}>
      {master}
      {rightCol}
    </div>
  );
}
