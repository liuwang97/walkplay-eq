import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Heart, MoreVertical, Pause, Pencil, Play, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
  /** Optional rename, only wired for custom presets. */
  onRename?: (preset: Preset, name: string) => void;
  /** Optional delete, only wired for custom presets. */
  onDelete?: (preset: Preset) => void;
}

function isCloudPreset(p: Preset | CloudPreset): p is CloudPreset {
  return (p as CloudPreset).likeCount !== undefined;
}

/** A single preset list row: name + badge, 试听 (audition) and 使用 (use). */
export function PresetRow({ preset, onUse, onLike, onRename, onDelete }: PresetRowProps) {
  const { t } = useTranslation();
  const auditioningId = useAuditioningId();
  const isAuditioning = auditioningId === preset.id;

  // Rename dialog (custom presets only). Seeded with the current name on open.
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const manageable = (onRename || onDelete) && !isCloudPreset(preset);

  const submitRename = () => {
    const next = renameValue.trim();
    if (next && next !== preset.name) onRename?.(preset as Preset, next);
    setRenameOpen(false);
  };

  // Built-in names are i18n keys with a zh fallback; cloud/custom are literals.
  const displayName =
    preset.source === "preset"
      ? t(preset.name, { defaultValue: BUILTIN_FALLBACK_LABELS[preset.name] ?? preset.name })
      : preset.name;

  const meta = SOURCE_META[preset.source];
  const cloud = isCloudPreset(preset) ? preset : null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2">
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
          className="shrink-0"
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
        size="icon-sm"
        className="shrink-0"
        aria-label={
          isAuditioning
            ? t(K.preset.action.stop, { defaultValue: "停止" })
            : t(K.preset.action.audition, { defaultValue: "试听" })
        }
        title={
          isAuditioning
            ? t(K.preset.action.stop, { defaultValue: "停止" })
            : t(K.preset.action.audition, { defaultValue: "试听" })
        }
        onClick={() => void auditionEngine.toggle(preset)}
      >
        {isAuditioning ? <Pause /> : <Play />}
      </Button>

      <Button type="button" size="sm" className="shrink-0" onClick={() => onUse(preset)}>
        {t(K.preset.action.use, { defaultValue: "使用" })}
      </Button>

      {manageable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label={t(K.preset.action.more, { defaultValue: "更多" })}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onRename && (
              <DropdownMenuItem
                onSelect={() => {
                  setRenameValue(preset.name);
                  setRenameOpen(true);
                }}
              >
                <Pencil />
                {t(K.preset.action.rename, { defaultValue: "重命名" })}
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onDelete(preset as Preset)}
              >
                <Trash2 />
                {t(K.preset.action.delete, { defaultValue: "删除" })}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t(K.preset.rename.title, { defaultValue: "重命名预设" })}</DialogTitle>
            <DialogDescription className="sr-only">
              {t(K.preset.rename.title, { defaultValue: "重命名预设" })}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
            }}
            placeholder={t(K.preset.rename.placeholder, { defaultValue: "输入预设名称" })}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
              {t(K.preset.rename.cancel, { defaultValue: "取消" })}
            </Button>
            <Button type="button" onClick={submitRename} disabled={!renameValue.trim()}>
              {t(K.preset.rename.confirm, { defaultValue: "确定" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PresetRow;
