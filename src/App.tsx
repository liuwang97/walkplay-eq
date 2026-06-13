import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { EqPanel } from "@/features/eq/EqPanel";
import { ResponseCurve } from "@/features/curve/ResponseCurve";
import { PresetPanel } from "@/features/presets/PresetPanel";
import { useEqStore } from "@/lib/store";
import "@/i18n";

const queryClient = new QueryClient();

function App() {
  const status = useEqStore((s) => s.status);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="dark min-h-screen bg-background text-foreground">
          <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
            <header className="flex items-center justify-between">
              <h1 className="text-lg font-semibold">Walkplay EQ</h1>
              <span className="text-xs text-muted-foreground capitalize">{status}</span>
            </header>
            <main className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="flex flex-col gap-4 lg:col-span-2">
                <ResponseCurve />
                <EqPanel />
              </div>
              <PresetPanel />
            </main>
          </div>
          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
