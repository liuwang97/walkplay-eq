import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { Loader2, Inbox, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { K } from "@/i18n/keys";
import { useEqStore } from "@/lib/store";
import type { Preset } from "@/lib/types";

import { BUILTIN_FALLBACK_LABELS, BUILTIN_PRESETS } from "./builtins";
import {
  toggleShareLike,
  useMyShares,
  useOnlinePresets,
  type CloudPreset,
  type CloudResource,
} from "./cloud";
import { PresetRow } from "./PresetRow";

/** Resolve a preset's human label (i18n key for built-ins, literal otherwise). */
function presetLabel(p: Preset, t: TFunction): string {
  if (p.source === "preset") {
    return t(p.name, { defaultValue: BUILTIN_FALLBACK_LABELS[p.name] ?? p.name });
  }
  return p.name;
}

/** Empty-state placeholder shared by every tab. */
function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Inbox className="size-6 opacity-60" />
      <span>{label}</span>
    </div>
  );
}

/** A scrollable, fixed-height list body so the four tabs stay the same size. */
function ListBody({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea className="h-[360px] pr-3">
      <div className="flex flex-col gap-2">{children}</div>
    </ScrollArea>
  );
}

export function PresetPanel() {
  const { t } = useTranslation();
  const applyPreset = useEqStore((s) => s.applyPreset);
  const storePresets = useEqStore((s) => s.presets);

  // 自定义: locally-saved presets live in the store, tagged source "custom".
  const customPresets = useMemo(
    () => storePresets.filter((p) => p.source === "custom"),
    [storePresets],
  );

  const online = useOnlinePresets();
  const shares = useMyShares();

  const handleUse = (preset: Preset) => {
    applyPreset(preset);
    toast.success(
      t(K.preset.toast.applied, {
        defaultValue: "已应用「{{name}}」",
        name: presetLabel(preset, t),
      }),
    );
  };

  const handleLike = (resource: CloudResource<CloudPreset[]>) => (preset: CloudPreset) => {
    void toggleShareLike(preset.id, preset.liked).then((newLiked) => {
      if (newLiked !== preset.liked) resource.refetch();
    });
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>{t(K.preset.title, { defaultValue: "预设" })}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <Tabs defaultValue="builtin" className="h-full">
          <TabsList className="w-full">
            <TabsTrigger value="builtin">
              {t(K.preset.tab.builtin, { defaultValue: "预设" })}
            </TabsTrigger>
            <TabsTrigger value="custom">
              {t(K.preset.tab.custom, { defaultValue: "自定义" })}
            </TabsTrigger>
            <TabsTrigger value="online">
              {t(K.preset.tab.online, { defaultValue: "在线" })}
            </TabsTrigger>
            <TabsTrigger value="shared">
              {t(K.preset.tab.shared, { defaultValue: "我的分享" })}
            </TabsTrigger>
          </TabsList>

          {/* 预设 — built-in */}
          <TabsContent value="builtin">
            <ListBody>
              {BUILTIN_PRESETS.map((p) => (
                <PresetRow key={p.id} preset={p} onUse={handleUse} />
              ))}
            </ListBody>
          </TabsContent>

          {/* 自定义 — custom-local */}
          <TabsContent value="custom">
            <ListBody>
              {customPresets.length === 0 ? (
                <EmptyState
                  label={t(K.preset.empty.custom, {
                    defaultValue: "暂无自定义预设，调好后可保存到此处",
                  })}
                />
              ) : (
                customPresets.map((p) => (
                  <PresetRow key={p.id} preset={p} onUse={handleUse} />
                ))
              )}
            </ListBody>
          </TabsContent>

          {/* 在线 — online */}
          <TabsContent value="online">
            <CloudTab
              resource={online}
              onUse={handleUse}
              onLike={handleLike(online)}
              emptyLabel={t(K.preset.empty.online, { defaultValue: "暂无在线分享" })}
              errorLabel={t(K.preset.error.load, { defaultValue: "加载失败" })}
            />
          </TabsContent>

          {/* 我的分享 — my shares */}
          <TabsContent value="shared">
            <CloudTab
              resource={shares}
              onUse={handleUse}
              onLike={handleLike(shares)}
              emptyLabel={t(K.preset.empty.shared, { defaultValue: "你还没有分享过 EQ" })}
              errorLabel={t(K.preset.error.load, { defaultValue: "加载失败" })}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface CloudTabProps {
  resource: CloudResource<CloudPreset[]>;
  onUse: (preset: Preset) => void;
  onLike: (preset: CloudPreset) => void;
  emptyLabel: string;
  errorLabel: string;
}

/** Shared rendering for the two cloud-backed tabs (loading/error/empty/list). */
function CloudTab({ resource, onUse, onLike, emptyLabel, errorLabel }: CloudTabProps) {
  const { t } = useTranslation();
  const { data, loading, error, refetch } = resource;

  if (loading) {
    return (
      <ListBody>
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t(K.preset.loading, { defaultValue: "加载中…" })}
        </div>
      </ListBody>
    );
  }

  if (error) {
    return (
      <ListBody>
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
          <span>{errorLabel}</span>
          <Button type="button" variant="outline" size="sm" onClick={refetch}>
            <RotateCw />
            {t(K.preset.action.retry, { defaultValue: "重试" })}
          </Button>
        </div>
      </ListBody>
    );
  }

  if (data.length === 0) {
    return (
      <ListBody>
        <EmptyState label={emptyLabel} />
      </ListBody>
    );
  }

  return (
    <ListBody>
      {data.map((p) => (
        <PresetRow key={p.id} preset={p} onUse={onUse} onLike={onLike} />
      ))}
    </ListBody>
  );
}

export default PresetPanel;
