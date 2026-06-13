import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AudioLinesIcon, LanguagesIcon, SlidersHorizontalIcon } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

import { EqPanel } from "@/features/eq/EqPanel";
import { ResponseCurve } from "@/features/curve/ResponseCurve";
import { PresetPanel } from "@/features/presets/PresetPanel";
import { ConnectionBar } from "@/features/connection/ConnectionBar";
import { FirmwareDialog } from "@/features/firmware/FirmwareDialog";

import { queryClient } from "@/lib/api/queryClient";
import { useEqStore } from "@/lib/store";
import { K } from "@/i18n/keys";
import { getLanguage, setLanguage } from "@/i18n";
import "@/i18n";

/** Left brand / navigation rail. */
function BrandRail() {
  const { t } = useTranslation();
  return (
    <aside className="hidden w-16 shrink-0 flex-col items-center gap-6 border-r border-white/5 bg-card/40 py-5 lg:flex">
      <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <AudioLinesIcon className="size-5" />
      </div>
      <nav className="flex flex-col items-center gap-2">
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
          title={t(K.eq.title)}
        >
          <SlidersHorizontalIcon className="size-5" />
        </button>
      </nav>
    </aside>
  );
}

/** Language toggle (zh <-> en). */
function LanguageToggle() {
  const { i18n } = useTranslation();
  const lang = (i18n.language?.startsWith("en") ? "en" : "zh") as "zh" | "en";
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void setLanguage(lang === "zh" ? "en" : "zh")}
      title="语言 / Language"
    >
      <LanguagesIcon />
      {lang === "zh" ? "中" : "EN"}
    </Button>
  );
}

function Dashboard() {
  const { t } = useTranslation();
  const init = useEqStore((s) => s.init);

  // Wire the native event bridge (conn-status / apply-preset) + seed the tray.
  React.useEffect(() => {
    let teardown: (() => void) | undefined;
    void init().then((fn) => {
      teardown = fn;
    });
    // Restore persisted language on mount.
    void getLanguage();
    return () => teardown?.();
  }, [init]);

  return (
    <div className="dark flex min-h-screen bg-background text-foreground">
      <BrandRail />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-white/5 bg-card/30 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight">
              {t(K.common.appName)}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ConnectionBar />
            <FirmwareDialog />
            <LanguageToggle />
          </div>
        </header>

        {/* Body */}
        <main className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Left: EQ band row on top, frequency curve below. */}
            <div className="flex min-w-0 flex-col gap-4">
              <EqPanel />
              <ResponseCurve />
            </div>
            {/* Right: preset panel. */}
            <PresetPanel />
          </div>
        </main>
      </div>

      <Toaster position="bottom-right" />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <Dashboard />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
