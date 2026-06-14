import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

import TitleBar from "@/features/chrome/TitleBar";
import Switcher from "@/features/switcher/Switcher";
import Toolbar from "@/features/stage/Toolbar";
import Instrument from "@/features/instrument/Instrument";
import Inspector from "@/features/stage/Inspector";

import { queryClient } from "@/lib/api/queryClient";
import { useEqStore } from "@/lib/store";
import { getLanguage } from "@/i18n";
import "@/i18n";

/**
 * The redesigned WalkPlay EQ — a macOS-grade "porcelain" instrument.
 *
 * Window chrome (TitleBar) on top; below, the switcher sidebar (304px) and the
 * stage: a toolbar, the integrated curve+fader instrument, and the band
 * inspector. All state lives in `useEqStore`; styling is ported from the Claude
 * Design handoff (`design-ref/`).
 */
function Dashboard() {
  const init = useEqStore((s) => s.init);

  // Wire the native event bridge (conn-status / apply-preset) + seed the tray,
  // and start the auto-connect poller.
  React.useEffect(() => {
    let teardown: (() => void) | undefined;
    void init().then((fn) => {
      teardown = fn;
    });
    void getLanguage(); // restore persisted language on mount
    return () => teardown?.();
  }, [init]);

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden"
      style={{
        background: "#ffffff",
        color: "#1b1f2e",
        fontFamily: "'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <Switcher />

        {/* Stage */}
        <main
          className="wp-scroll flex min-w-0 flex-1 flex-col overflow-y-auto"
          style={{ padding: "22px 26px", gap: "16px", background: "#ffffff" }}
        >
          <Toolbar />
          <Instrument />
          <Inspector />
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
