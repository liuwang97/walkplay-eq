/**
 * Firmware upgrade dialog.
 *
 * Drives the native Rust firmware flow:
 *   - `fw_check`   -> resolve current/latest version + download URL
 *   - `fw_upgrade` -> download + (dry-run by default) flash
 *   - `fw-progress` event -> live phase/percent
 *
 * The flash is brick-safety gated on the Rust side: this dialog requests a
 * dry-run unless the user explicitly ticks "confirm flash" (and even then the
 * Rust writer stays a null sink until a live HID writer is wired in — see
 * src-tauri/src/firmware.rs).
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CpuIcon, DownloadIcon, Loader2Icon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { K } from "@/i18n/keys";
import * as bridge from "@/lib/bridge";
import type { FirmwareCheck, FwProgress } from "@/lib/bridge";
import { useEqStore } from "@/lib/store";

export function FirmwareDialog() {
  const { t } = useTranslation();
  const device = useEqStore((s) => s.device);

  const [open, setOpen] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [check, setCheck] = React.useState<FirmwareCheck | null>(null);
  const [progress, setProgress] = React.useState<FwProgress | null>(null);
  const [running, setRunning] = React.useState(false);
  const [confirmFlash, setConfirmFlash] = React.useState(false);

  // Subscribe to fw-progress while the dialog is open.
  React.useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | undefined;
    void bridge.onFwProgress((p) => setProgress(p)).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [open]);

  const runCheck = React.useCallback(async () => {
    if (!device) return;
    setChecking(true);
    setCheck(null);
    try {
      const res = await bridge.fwCheck(device.vid, device.pid);
      setCheck(res);
    } catch (err) {
      toast.error(t(K.firmware.getInfoFailed), { description: String(err) });
    } finally {
      setChecking(false);
    }
  }, [device, t]);

  // Auto-check when the dialog opens with a device connected.
  React.useEffect(() => {
    if (open && device) void runCheck();
  }, [open, device, runCheck]);

  const runUpgrade = React.useCallback(async () => {
    if (!check?.url) return;
    setRunning(true);
    setProgress(null);
    try {
      const res = await bridge.fwUpgrade(check.url, confirmFlash);
      if (res.success) {
        toast.success(t(K.firmware.upgradeComplete), { description: res.message });
      } else {
        toast.warning(res.message);
      }
    } catch (err) {
      toast.error(t(K.common.failed), { description: String(err) });
    } finally {
      setRunning(false);
    }
  }, [check, confirmFlash, t]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* Porcelain icon button — settings/firmware entry in the title bar. */}
        <button
          type="button"
          disabled={!device}
          title={t(K.firmware.upgrade)}
          aria-label={t(K.firmware.upgrade)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid rgba(28,32,58,0.10)",
            background: "#fff",
            display: "grid",
            placeItems: "center",
            cursor: device ? "pointer" : "not-allowed",
            color: "#6b7184",
            opacity: device ? 1 : 0.45,
          }}
        >
          <CpuIcon style={{ width: 15, height: 15 }} />
        </button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-md gap-4 border-[rgba(28,32,58,0.08)] bg-white text-[#1b1f2e] shadow-[0_30px_70px_-24px_rgba(28,32,58,0.4)]"
        style={{ fontFamily: "'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif" }}
      >
        <DialogHeader>
          <DialogTitle className="text-[#1b1f2e]">{t(K.firmware.title)}</DialogTitle>
          <DialogDescription className="text-[#8a90a3]">
            {t(K.firmware.doNotDisconnect)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          {checking && (
            <div className="flex items-center gap-2 text-[#8a90a3]">
              <Loader2Icon className="size-4 animate-spin" />
              {t(K.firmware.loadingFirmware)}
            </div>
          )}

          {check && (
            <div className="flex flex-col gap-1 rounded-[12px] border border-[rgba(28,32,58,0.07)] bg-[#fafbfd] p-3">
              <Row label={t(K.firmware.currentVersion)} value={check.current} />
              <Row label={t(K.firmware.latestVersion)} value={check.latest ?? "—"} />
              <Row
                label={t(K.firmware.upgrade)}
                value={
                  check.updateAvailable
                    ? t(K.common.yes)
                    : t(K.common.no)
                }
              />
            </div>
          )}

          {progress && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs text-[#8a90a3]">
                <span className="capitalize">{progress.phase}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[rgba(28,32,58,0.08)]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progress.percent}%`,
                    background: "linear-gradient(135deg, #2f6bff, #6a4cff)",
                  }}
                />
              </div>
              <span className="truncate text-[11px] text-[#8a90a3]">
                {progress.message}
                {progress.dry_run ? " (dry run)" : ""}
              </span>
            </div>
          )}

          <label className="flex items-center justify-between rounded-[12px] border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2">
            <span className="text-xs font-medium text-amber-700">
              {t(K.firmware.startUpgrade)} ({t(K.errors.confirmContinue)})
            </span>
            <Switch checked={confirmFlash} onCheckedChange={setConfirmFlash} />
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={runCheck}
            disabled={checking || running}
            className="text-[#4a5061] hover:bg-[rgba(28,32,58,0.05)]"
          >
            {t(K.firmware.checkVersion)}
          </Button>
          <Button
            size="sm"
            onClick={runUpgrade}
            disabled={running || !check?.url}
            className="border-0 text-white shadow-[0_2px_8px_-2px_rgba(47,107,255,0.5)] hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #2f6bff, #6a4cff)" }}
          >
            {running ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
            {running ? t(K.firmware.upgrading) : t(K.firmware.startUpgrade)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[#8a90a3]">{label}</span>
      <span className="font-mono tabular-nums text-[#1b1f2e]">{value}</span>
    </div>
  );
}

export default FirmwareDialog;
