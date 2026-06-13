import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Heart, Pause, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { K } from "@/i18n/keys";
import type { Preset, PresetSource } from "@/lib/types";

import { auditionEngine } from "./audition";
import { BUILTIN_FALLBACK_LABELS } from "./builtins";
import type { CloudPreset } from "./cloud";

/** Map a preset source to its badge variant + i18n label key. */
const SOURCE_META: Record<
  PresetSource,
  { variant: "default" | "secondary" | "outline"; key: string }
> = {
  preset: { variant: "default", key: K.preset.tab.builtin },
  custom: { variant: "secondary", key: K.preset.tab.custom },
  online: { variant: "outline", key: K.preset.tab.online },
  shared: { variant: "outline", key: K.preset.tab.shared },
};

/** Subscribe to the audition engine's "current preset id" via external store. */
function useAuditioningId(): string | null {
  return useSyncExternalStore(
    (cb) => auditionEngine.subscribe(() => cb()),
    () => auditionEngine.currentId,
    () => null,
  );
}

export interface PresetRowProps {
  preset: Preset | CloudPreset;
  /** Apply this preset to the live EQ (store.applyPreset). */
  onUse: (preset: Preset) => void;
  /** Optional like toggle, only meaningful for cloud presets. */
  onLike?: (preset: CloudPreset) => void;
}

function isCloudPreset(p: Preset | CloudPreset): p is CloudPreset {
  return (p as CloudPreset).likeCount !== undefined;
}

/** A single preset list row: name + badge, 试听 (audition) and 使用 (use). */
export function PresetRow({ preset, onUse, onLike }: PresetRowProps) {
  const { t } = useTranslation();
  const auditioningId = useAuditioningId();
  const isAuditioning = auditioningId === preset.id;

  // Built-in names are i18n keys with a zh fallback; cloud/custom are literals.
  const displayName =
    preset.source === "preset"
      ? t(preset.name, { defaultValue: BUILTIN_FALLBACK_LABELS[preset.name] ?? preset.name })
      : preset.name;

  const meta = SOURCE_META[preset.source];
  const cloud = isCloudPreset(preset) ? preset : null;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{displayName}</span>
          <Badge variant={meta.variant} className="shrink-0">
            {t(meta.key, { defaultValue: preset.source })}
          </Badge>
          {/* meta.key is one of K.presets.* — resolves via the i18n bundle. */}
        </div>
        {cloud && (cloud.author || cloud.likeCount > 0) && (
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {cloud.author && <span className="truncate">{cloud.author}</span>}
            {cloud.likeCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Heart className="size-3" /> {cloud.likeCount}
              </span>
            )}
          </div>
        )}
      </div>

      {cloud && onLike && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={cloud.liked}
          aria-label={t(K.preset.action.like, { defaultValue: "点赞" })}
          onClick={() => onLike(cloud)}
        >
          <Heart className={cloud.liked ? "fill-current text-red-500" : ""} />
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void auditionEngine.toggle(preset)}
      >
        {isAuditioning ? <Pause /> : <Play />}
        {isAuditioning
          ? t(K.preset.action.stop, { defaultValue: "停止" })
          : t(K.preset.action.audition, { defaultValue: "试听" })}
      </Button>

      <Button type="button" size="sm" onClick={() => onUse(preset)}>
        {t(K.preset.action.use, { defaultValue: "使用" })}
      </Button>
    </div>
  );
}

export default PresetRow;
