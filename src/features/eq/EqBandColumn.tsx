import * as React from "react";
import { useTranslation } from "react-i18next";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { EqBand, EqBandType } from "@/lib/types";

/** dB range of a single band's gain. Mirrors `EqBand.gain` contract. */
export const GAIN_MIN = -10;
export const GAIN_MAX = 10;
export const GAIN_STEP = 0.5;

const BAND_TYPES: EqBandType[] = ["PK", "LS", "HS"];

/** Format a Hz value compactly (e.g. 10000 -> "10k"). */
function formatFreq(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(hz);
}

/** Parse a possibly-empty numeric input, clamped to [min, max]; NaN -> fallback. */
function parseNum(raw: string, fallback: number, min: number, max: number): number {
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export interface EqBandColumnProps {
  band: EqBand;
  /** Patch this band in the store (partial). */
  onPatch: (id: number, patch: Partial<EqBand>) => void;
}

/**
 * A single vertical EQ band: gain fader + freq/Q/gain numeric inputs +
 * type selector + enable toggle. Fully controlled from the store.
 */
function EqBandColumnImpl({ band, onPatch }: EqBandColumnProps) {
  const { t } = useTranslation();
  const disabled = !band.enabled;

  // Local text buffers so the user can type intermediate values without the
  // store clobbering the field mid-edit; committed on blur / Enter.
  const [freqText, setFreqText] = React.useState(String(band.freq));
  const [qText, setQText] = React.useState(String(band.q));
  const [gainText, setGainText] = React.useState(String(band.gain));

  React.useEffect(() => setFreqText(String(band.freq)), [band.freq]);
  React.useEffect(() => setQText(String(band.q)), [band.q]);
  React.useEffect(() => setGainText(String(band.gain)), [band.gain]);

  const commitFreq = () =>
    onPatch(band.id, { freq: Math.round(parseNum(freqText, band.freq, 20, 24000)) });
  const commitQ = () =>
    onPatch(band.id, { q: Math.round(parseNum(qText, band.q, 0.1, 10) * 100) / 100 });
  const commitGain = () =>
    onPatch(band.id, {
      gain: Math.round(parseNum(gainText, band.gain, GAIN_MIN, GAIN_MAX) * 10) / 10,
    });

  const onKeyCommit =
    (commit: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        commit();
        e.currentTarget.blur();
      }
    };

  const boosted = band.gain > 0.05;
  const cut = band.gain < -0.05;

  return (
    <div
      data-band-id={band.id}
      className={cn(
        "flex w-[64px] shrink-0 flex-col items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-1.5 py-2 transition-opacity",
        disabled && "opacity-45"
      )}
    >
      {/* Band number + frequency caption */}
      <div className="flex flex-col items-center leading-tight">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">
          {t("eq.bandShort", { n: band.id + 1 })}
        </span>
        <span className="text-[11px] font-mono tabular-nums text-foreground/80">
          {formatFreq(band.freq)}
        </span>
      </div>

      {/* Gain readout */}
      <span
        className={cn(
          "h-4 text-[11px] font-mono font-semibold tabular-nums",
          boosted && "text-emerald-400",
          cut && "text-sky-400",
          !boosted && !cut && "text-muted-foreground"
        )}
      >
        {band.gain > 0 ? "+" : ""}
        {band.gain.toFixed(1)}
      </span>

      {/* Vertical gain fader */}
      <Slider
        aria-label={t("eq.gain")}
        orientation="vertical"
        className="h-40"
        min={GAIN_MIN}
        max={GAIN_MAX}
        step={GAIN_STEP}
        value={[band.gain]}
        disabled={disabled}
        onValueChange={(v) => onPatch(band.id, { gain: v[0] })}
      />

      {/* Numeric inputs: freq / Q / gain */}
      <div className="flex w-full flex-col gap-1">
        <label className="flex flex-col gap-0.5">
          <span className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">
            {t("eq.freqHz")}
          </span>
          <input
            type="number"
            inputMode="numeric"
            className="h-6 w-full rounded border border-input bg-transparent px-1 text-center text-[11px] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:opacity-50"
            value={freqText}
            disabled={disabled}
            onChange={(e) => setFreqText(e.target.value)}
            onBlur={commitFreq}
            onKeyDown={onKeyCommit(commitFreq)}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">
            {t("eq.q")}
          </span>
          <input
            type="number"
            inputMode="decimal"
            step={0.1}
            className="h-6 w-full rounded border border-input bg-transparent px-1 text-center text-[11px] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:opacity-50"
            value={qText}
            disabled={disabled}
            onChange={(e) => setQText(e.target.value)}
            onBlur={commitQ}
            onKeyDown={onKeyCommit(commitQ)}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">
            {t("eq.gainDb")}
          </span>
          <input
            type="number"
            inputMode="decimal"
            step={GAIN_STEP}
            className="h-6 w-full rounded border border-input bg-transparent px-1 text-center text-[11px] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:opacity-50"
            value={gainText}
            disabled={disabled}
            onChange={(e) => setGainText(e.target.value)}
            onBlur={commitGain}
            onKeyDown={onKeyCommit(commitGain)}
          />
        </label>
      </div>

      {/* Type selector */}
      <Select
        value={band.type}
        disabled={disabled}
        onValueChange={(v) => onPatch(band.id, { type: v as EqBandType })}
      >
        <SelectTrigger
          size="sm"
          aria-label={t("eq.type")}
          className="h-6 w-full justify-center px-1 text-[10px] font-semibold"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BAND_TYPES.map((bt) => (
            <SelectItem key={bt} value={bt} className="text-xs">
              {t(`eq.bandType.${bt}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Enable toggle */}
      <Switch
        size="sm"
        checked={band.enabled}
        aria-label={t("eq.enableBand")}
        onCheckedChange={(checked) => onPatch(band.id, { enabled: checked })}
      />
    </div>
  );
}

export const EqBandColumn = React.memo(EqBandColumnImpl);

export default EqBandColumn;
