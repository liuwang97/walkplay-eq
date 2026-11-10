import * as React from "react";

import { Toaster } from "@/components/ui/sonner";

import TitleBar from "@/features/chrome/TitleBar";
import Switcher from "@/features/switcher/Switcher";
import Toolbar from "@/features/stage/Toolbar";
import Instrument from "@/features/instrument/Instrument";
import Inspector from "@/features/stage/Inspector";

import { useEqStore } from "@/lib/store";

/**
 * The WalkPlay EQ editor — a macOS-grade "porcelain" instrument.
 *
 * Window chrome (TitleBar) on top; below, the switcher sidebar (304px) and the
 * stage: a toolbar, the integrated curve+fader instrument, and the band
 * inspector. All state lives in `useEqStore`; styling is ported from the Claude
 * Design handoff (`design-ref/`).
 */
export default function App() {
  const init = useEqStore((s) => s.init);

  // Wire the store to the backend for as long as the window lives.
  React.useEffect(() => {
    let teardown: (() => void) | undefined;
    let cancelled = false;
    void init().then((fn) => {
      if (cancelled) fn();
      else teardown = fn;
    });
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [init]);

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden"
      style={{ background: "#ffffff", color: "#1b1f2e" }}
    >
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <Switcher />

        {/* Stage */}
        <main
          className="wp-scroll flex min-w-0 flex-1 flex-col overflow-y-auto"
          style={{ padding: "22px 26px", gap: "16px" }}
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
