import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  RotateCcwIcon,
  Share2Icon,
  SaveIcon,
  RefreshCwIcon,
  FactoryIcon,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEqStore } from "@/lib/store";
import { DEFAULT_EQ_STATE, type Preset } from "@/lib/types";
import { cn } from "@/lib/utils";

import { EqBandColumn } from "./EqBandColumn";

/** Preamp range. Mirrors `EqState.preamp` contract. */
const PREAMP_MIN = -16;
const PREAMP_MAX = 6;
const PREAMP_STEP = 0.5;

/**
 * The 10-band parametric EQ editor.
 *
 * A row of 10 vertical band faders (each with freq/Q/gain inputs, a PK/LS/HS
 * type selector and an enable toggle), a global preamp fader, and the action
 * toolbar. All state lives in `useEqStore`.
 */
export function EqPanel() {
  const { t } = useTranslation();

  const bands = useEqStore((s) => s.eq.bands);
  const preamp = useEqStore((s) => s.eq.preamp);
  const status = useEqStore((s) => s.status);
  const setBand = useEqStore((s) => s.setBand);
  const setPreamp = useEqStore((s) => s.setPreamp);
  const applyPreset = useEqStore((s) => s.applyPreset);
  const factoryReset = useEqStore((s) => s.factoryReset);

  const busy = status === "busy";

  /** 清除调整 — flatten gains/preamp back to a neutral curve (local only). */
  const handleClear = React.useCallback(() => {
    const flat: Preset = {
      id: "__flat__",
      name: "flat",
      source: "preset",
      preamp: 0,
      bands: DEFAULT_EQ_STATE.bands.map((b) => ({ ...b, gain: 0 })),
    };
    applyPreset(flat);
    toast.success(t("eq.toast.cleared"));
  }, [applyPreset, t]);

  /** 恢复出厂 — device-side factory reset (delegates to the bridge). */
  const handleFactoryReset = React.useCallback(async () => {
    try {
      await factoryReset();
      toast.success(t("eq.toast.factoryReset"));
    } catch (err) {
      toast.error(t("eq.toast.factoryResetFailed"), {
        description: String(err),
      });
    }
  }, [factoryReset, t]);

  // The cloud-backed actions (save / update / share) are owned by the
  // API + presets agents. We surface the buttons and feedback hooks here;
  // wiring lands when those modules expose their commands.
  const handleSaveCustom = React.useCallback(() => {
    toast.info(t("eq.toast.savePending"));
  }, [t]);

  const handleUpdateCustom = React.useCallback(() => {
    toast.info(t("eq.toast.updatePending"));
  }, [t]);

  const handleShare = React.useCallback(() => {
    toast.info(t("eq.toast.sharePending"));
  }, [t]);

  return (
    <Card className="border-white/5 bg-card/60 backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {t("eq.title")}
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {t("eq.bandsBadge", { count: bands.length })}
          </span>
        </CardTitle>
        <span className="text-[11px] capitalize text-muted-foreground">
          {t(`eq.status.${status}`, status)}
        </span>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Faders row: preamp + 10 bands */}
        <div className="flex items-stretch gap-3">
          {/* Preamp fader */}
          <div className="flex w-[66px] shrink-0 flex-col items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.04] px-1.5 py-2">
            <div className="flex flex-col items-center leading-tight">
              <span className="text-[10px] font-semibold tracking-wider text-primary/90">
                {t("eq.preamp")}
              </span>
              <span className="text-[11px] text-muted-foreground">dB</span>
            </div>
            <span
              className={cn(
                "h-4 text-[11px] font-mono font-semibold tabular-nums",
                preamp > 0.05 && "text-emerald-400",
                preamp < -0.05 && "text-amber-400",
                Math.abs(preamp) <= 0.05 && "text-muted-foreground"
              )}
            >
              {preamp > 0 ? "+" : ""}
              {preamp.toFixed(1)}
            </span>
            <Slider
              aria-label={t("eq.preamp")}
              orientation="vertical"
              className="h-40"
              min={PREAMP_MIN}
              max={PREAMP_MAX}
              step={PREAMP_STEP}
              value={[preamp]}
              onValueChange={(v) => setPreamp(v[0])}
            />
            <span className="text-center text-[9px] leading-tight text-muted-foreground">
              {PREAMP_MIN}…+{PREAMP_MAX}
            </span>
          </div>

          {/* Visual divider */}
          <div className="w-px self-stretch bg-white/10" aria-hidden />

          {/* Band columns (horizontally scrollable on narrow widths) */}
          <ScrollArea className="min-w-0 flex-1">
            <div className="flex gap-1.5 pb-2">
              {bands.map((band) => (
                <EqBandColumn key={band.id} band={band} onPatch={setBand} />
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>

        {/* Action toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
          <Button
            size="sm"
            variant="default"
            disabled={busy}
            onClick={handleSaveCustom}
          >
            <SaveIcon />
            {t("eq.actions.saveCustom")}
          </Button>

          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={handleUpdateCustom}
          >
            <RefreshCwIcon />
            {t("eq.actions.updateCustom")}
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={handleShare}
          >
            <Share2Icon />
            {t("eq.actions.share")}
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={handleClear}
                >
                  <RotateCcwIcon />
                  {t("eq.actions.clear")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("eq.actions.clearHint")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={handleFactoryReset}
                >
                  <FactoryIcon />
                  {t("eq.actions.factoryReset")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("eq.actions.factoryResetHint")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default EqPanel;
