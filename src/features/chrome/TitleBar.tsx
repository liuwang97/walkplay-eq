/**
 * Window title bar (porcelain chrome).
 *
 * Pixel-faithful port of the Claude Design handoff title bar
 * (`design-ref/project/WalkPlay EQ.dc.html`, lines 28-52), built with INLINE
 * styles to match the macOS-grade light UI exactly.
 *
 * Left   : macOS traffic lights (decorative) + accent brand mark + "WalkPlay".
 * Center : the "参数均衡器" / "Parametric EQ" subtitle.
 * Right  : a live connection status pill (mirrors ConnectionBar's connect /
 *          disconnect + toast behavior), the firmware dialog entry point, and a
 *          language toggle button.
 *
 * Connection logic and i18n keys are reused from `ConnectionBar` so behavior is
 * identical — only the presentation differs.
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getCurrentWindow } from "@tauri-apps/api/window";

import FirmwareDialog from "@/features/firmware/FirmwareDialog";
import { setLanguage } from "@/i18n";
import { K } from "@/i18n/keys";
import { isTauri } from "@/lib/bridge";
import { useEqStore } from "@/lib/store";
import { palette } from "@/lib/theme";

// macOS-style window controls: close (red), minimize (amber), maximize (green).
const TRAFFIC = [
  { color: "#ff5f57", ring: "#e0443b", action: "close" as const, glyph: "close" },
  { color: "#febc2e", ring: "#dfa123", action: "minimize" as const, glyph: "min" },
  { color: "#28c840", ring: "#1faa33", action: "maximize" as const, glyph: "max" },
];

/** Run a window-control action (no-op outside the Tauri shell). */
function windowAction(action: "close" | "minimize" | "maximize"): void {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  if (action === "close") void win.close(); // destroys the WebView; app stays in the tray
  else if (action === "minimize") void win.minimize();
  else void win.toggleMaximize();
}

export function TitleBar() {
  const { t, i18n } = useTranslation();
  const status = useEqStore((s) => s.status);
  const device = useEqStore((s) => s.device);
  const accent = useEqStore((s) => s.accent);
  const connect = useEqStore((s) => s.connect);
  const disconnect = useEqStore((s) => s.disconnect);
  const loadFromDevice = useEqStore((s) => s.loadFromDevice);

  const pal = palette(accent);
  const lang = i18n.language?.startsWith("en") ? "en" : "zh";
  const subtitle = lang === "en" ? "Parametric EQ" : "参数均衡器";

  const connected = status === "connected";
  const connecting = status === "connecting" || status === "busy";

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

  const onPillClick = React.useCallback(() => {
    if (connecting) return;
    if (connected) void handleDisconnect();
    else void handleConnect();
  }, [connected, connecting, handleConnect, handleDisconnect]);

  const toggleLang = React.useCallback(() => {
    void setLanguage(lang === "zh" ? "en" : "zh");
  }, [lang]);

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 52,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 18px",
        background: "linear-gradient(180deg, #fcfcfe 0%, #f4f5f9 100%)",
        borderBottom: "1px solid rgba(28,32,58,0.08)",
        fontFamily: "'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif",
        color: "#1b1f2e",
        userSelect: "none",
      }}
    >
      <style>
        {"@keyframes wpPulse{0%,100%{opacity:1}50%{opacity:0.45}}"}
      </style>

      {/* Traffic lights — real window controls (close / minimize / maximize) */}
      <TrafficLights />

      {/* Brand mark + wordmark */}
      <div
        data-tauri-drag-region
        style={{ display: "flex", alignItems: "center", gap: 9, marginLeft: 4 }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            display: "grid",
            placeItems: "center",
            background: pal.grad,
            boxShadow: `0 2px 6px -1px ${pal.shadow}`,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M4 14v-4M9 18V6M14 16V8M19 13v-2" />
          </svg>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em" }}>
          WalkPlay
        </span>
      </div>

      {/* Centered subtitle (also a drag handle) */}
      <div
        data-tauri-drag-region
        style={{
          flex: 1,
          textAlign: "center",
          fontSize: 12,
          fontWeight: 600,
          color: "#8a90a3",
          letterSpacing: "0.01em",
        }}
      >
        {subtitle}
      </div>

      {/* Right group */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ConnectionPill
          status={status}
          connected={connected}
          connecting={connecting}
          deviceName={device?.name}
          label={t(
            connected
              ? K.connection.connected
              : connecting
                ? K.connection.connecting
                : K.connection.disconnected,
          )}
          onClick={onPillClick}
        />

        {/* Firmware entry point — provides its own trigger button. */}
        <FirmwareDialog />

        {/* Language toggle */}
        <button
          type="button"
          onClick={toggleLang}
          title="语言 / Language"
          style={{
            height: 28,
            minWidth: 40,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid rgba(28,32,58,0.10)",
            background: "#fff",
            cursor: "pointer",
            fontSize: 11.5,
            fontWeight: 700,
            color: "#4a5061",
          }}
        >
          {lang === "zh" ? "中" : "EN"}
        </button>
      </div>
    </div>
  );
}

/** Live connection status pill. Green when connected, amber connecting, gray (clickable) when disconnected. */
function ConnectionPill({
  status,
  connected,
  connecting,
  deviceName,
  label,
  onClick,
}: {
  status: string;
  connected: boolean;
  connecting: boolean;
  deviceName?: string;
  label: string;
  onClick: () => void;
}) {
  // Color tokens per state.
  const tone = connected
    ? {
        bg: "rgba(40,200,64,0.10)",
        border: "rgba(40,200,64,0.22)",
        dot: "#28c840",
        dotRing: "0 0 0 3px rgba(40,200,64,0.18)",
        text: "#1d9e36",
      }
    : connecting
      ? {
          bg: "rgba(224,138,47,0.10)",
          border: "rgba(224,138,47,0.24)",
          dot: "#e08a2f",
          dotRing: "0 0 0 3px rgba(224,138,47,0.16)",
          text: "#c0741f",
        }
      : {
          bg: "rgba(28,32,58,0.05)",
          border: "rgba(28,32,58,0.12)",
          dot: "#9098ab",
          dotRing: "0 0 0 3px rgba(28,32,58,0.06)",
          text: "#6b7184",
        };

  // Disabled (non-interactive) only while connecting; otherwise click to toggle.
  const interactive = !connecting;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      title={label}
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        height: 28,
        padding: "0 11px 0 9px",
        borderRadius: 8,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        cursor: interactive ? "pointer" : "default",
        font: "inherit",
        maxWidth: 220,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          flexShrink: 0,
          borderRadius: "50%",
          background: tone.dot,
          boxShadow: tone.dotRing,
          animation: status === "connecting" || status === "busy" ? "wpPulse 1.2s ease-in-out infinite" : undefined,
        }}
      />
      <span
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: tone.text,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {connected && deviceName && (
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 500,
            color: "#1d9e36",
            opacity: 0.72,
            maxWidth: 110,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {deviceName}
        </span>
      )}
    </button>
  );
}

/**
 * macOS-style traffic lights wired to real window controls. The close/min/max
 * glyphs fade in when the cluster is hovered (matching macOS).
 */
function TrafficLights() {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 8 }}
    >
      {TRAFFIC.map((c) => (
        <button
          key={c.action}
          type="button"
          aria-label={c.action}
          title={c.action}
          onClick={() => windowAction(c.action)}
          style={{
            width: 12,
            height: 12,
            padding: 0,
            border: "none",
            borderRadius: "50%",
            background: c.color,
            boxShadow: `inset 0 0 0 0.5px ${c.ring}`,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            lineHeight: 0,
          }}
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 12 12"
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth="1.4"
            strokeLinecap="round"
            style={{ opacity: hover ? 1 : 0, transition: "opacity 0.12s" }}
          >
            {c.glyph === "close" && <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" />}
            {c.glyph === "min" && <path d="M3 6h6" />}
            {c.glyph === "max" && <path d="M3.5 3.5h5v5h-5z" />}
          </svg>
        </button>
      ))}
    </div>
  );
}

export default TitleBar;
