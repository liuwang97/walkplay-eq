/**
 * Header connection controls: status indicator + connect / disconnect.
 *
 * Talks to the store, which delegates to the native HID bridge. The colored dot
 * mirrors `ConnStatus`; the button flips between Connect and Disconnect.
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PlugIcon, PlugZapIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { K } from "@/i18n/keys";
import type { TranslationKey } from "@/i18n/keys";
import { cn } from "@/lib/utils";
import { useEqStore } from "@/lib/store";
import type { ConnStatus } from "@/lib/types";

const DOT: Record<ConnStatus, string> = {
  disconnected: "bg-zinc-500",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-400",
  busy: "bg-sky-400 animate-pulse",
};

const STATUS_KEY: Record<ConnStatus, TranslationKey> = {
  disconnected: K.connection.disconnected,
  connecting: K.connection.connecting,
  connected: K.connection.connected,
  busy: K.common.loading,
};

export function ConnectionBar() {
  const { t } = useTranslation();
  const status = useEqStore((s) => s.status);
  const device = useEqStore((s) => s.device);
  const connect = useEqStore((s) => s.connect);
  const disconnect = useEqStore((s) => s.disconnect);
  const loadFromDevice = useEqStore((s) => s.loadFromDevice);

  const busy = status === "connecting" || status === "busy";
  const connected = status === "connected";

  const handleConnect = React.useCallback(async () => {
    try {
      await connect();
      await loadFromDevice().catch(() => {});
      toast.success(t(K.connection.connected));
    } catch (err) {
      toast.error(t(K.connection.deviceInitFailed), { description: String(err) });
    }
  }, [connect, loadFromDevice, t]);

  const handleDisconnect = React.useCallback(async () => {
    try {
      await disconnect();
      toast.message(t(K.connection.disconnected));
    } catch (err) {
      toast.error(String(err));
    }
  }, [disconnect, t]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className={cn("size-2.5 rounded-full", DOT[status])} aria-hidden />
        <div className="flex flex-col leading-tight">
          <span className="text-xs font-medium">{t(STATUS_KEY[status])}</span>
          {device && (
            <span className="max-w-[160px] truncate text-[10px] text-muted-foreground">
              {device.name}
            </span>
          )}
        </div>
      </div>

      {connected ? (
        <Button size="sm" variant="secondary" onClick={handleDisconnect}>
          <PlugIcon />
          {t(K.connection.disconnect)}
        </Button>
      ) : (
        <Button size="sm" onClick={handleConnect} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
          {t(K.connection.connect)}
        </Button>
      )}
    </div>
  );
}

export default ConnectionBar;
