/**
 * ResponseCurve — dark-themed EQ frequency-response chart (uPlot).
 *
 * Renders the combined magnitude response (dB) of the live PEQ over the
 * 20 Hz .. 20 kHz log axis, with a log frequency grid and a dB grid. The
 * underlying math lives in ./dsp; the memoized data comes from
 * ./useResponseCurve so it can be reused elsewhere.
 */

import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EqState } from "@/lib/types";
import { F_MAX, F_MIN } from "./dsp";
import { useResponseCurve } from "./useResponseCurve";

/** Major log-frequency gridlines / tick labels. */
const FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

function fmtHz(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

/** Read a resolved CSS color from a hidden probe so uPlot gets concrete rgb(). */
function cssColor(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const probe = document.createElement("span");
  probe.style.color = `var(${varName})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c || fallback;
}

export interface ResponseCurveProps {
  /** Optional EQ override; defaults to the live store EQ. */
  eq?: EqState;
  /** Chart height in px. */
  height?: number;
  /** Symmetric dB span for the y-axis (clamped to fit the curve). */
  dbRange?: number;
}

export function ResponseCurve({ eq, height = 220, dbRange = 12 }: ResponseCurveProps) {
  const { freqs, mags, minDb, maxDb } = useResponseCurve(eq);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  // Live y-range read by uPlot's range callback (which overrides setScale).
  const yScaleRef = useRef<{ min: number; max: number }>({ min: -dbRange, max: dbRange });

  // uPlot wants plain number[] aligned series: [xs, ys].
  const data = useMemo<uPlot.AlignedData>(() => {
    const xs = Array.from(freqs);
    const ys = Array.from(mags);
    return [xs, ys];
  }, [freqs, mags]);

  // Auto y-range: at least ±dbRange, expanded to contain the curve with padding.
  const yScale = useMemo(() => {
    const pad = 2;
    const hi = Math.max(dbRange, Math.ceil(maxDb + pad));
    const lo = Math.min(-dbRange, Math.floor(minDb - pad));
    return { min: lo, max: hi };
  }, [minDb, maxDb, dbRange]);

  // Build the plot once; resize + setData on updates.
  useEffect(() => {
    if (!wrapRef.current) return;

    const axisStroke = cssColor("--muted-foreground", "#888");
    const gridStroke = cssColor("--border", "rgba(255,255,255,0.1)");
    const lineStroke = cssColor("--chart-1", "#7c9cff");
    const fillStroke = "rgba(124,156,255,0.12)";

    yScaleRef.current = yScale;
    const width = wrapRef.current.clientWidth || 480;

    const opts: uPlot.Options = {
      width,
      height,
      padding: [12, 12, 0, 0],
      cursor: { show: true, drag: { x: false, y: false } },
      legend: { show: false },
      scales: {
        x: {
          distr: 3, // log scale
          min: F_MIN,
          max: F_MAX,
        },
        y: {
          range: () => [yScaleRef.current.min, yScaleRef.current.max],
        },
      },
      axes: [
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
          font: "11px ui-sans-serif, system-ui, sans-serif",
          splits: () => FREQ_TICKS,
          values: (_u, splits) => splits.map((v) => fmtHz(v)),
        },
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
          font: "11px ui-sans-serif, system-ui, sans-serif",
          size: 40,
          values: (_u, splits) => splits.map((v) => `${v}`),
        },
      ],
      series: [
        {},
        {
          stroke: lineStroke,
          width: 2,
          fill: fillStroke,
          points: { show: false },
          spanGaps: true,
        },
      ],
    };

    const plot = new uPlot(opts, data, wrapRef.current);
    plotRef.current = plot;

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(120, Math.floor(e.contentRect.width));
        plot.setSize({ width: w, height });
      }
    });
    ro.observe(wrapRef.current);

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // Rebuild on height change only; data/scale handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // Push new data + y-range without rebuilding the plot.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    yScaleRef.current = yScale;
    // setData(data, true) re-runs the scale range callback, applying yScaleRef.
    plot.setData(data, true);
  }, [data, yScale]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Response</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={wrapRef} className="w-full" style={{ height }} />
      </CardContent>
    </Card>
  );
}

export default ResponseCurve;
