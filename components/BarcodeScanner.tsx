"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";

// Serve the ZXing wasm binary from our own /public instead of a CDN.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path,
  },
});

const GNC_PRODUCT_URL = "https://www.gnc.com/testosterone-booster/619400.html";

/** How often we grab a frame and look for barcodes (ms). */
const SCAN_INTERVAL = 120;

/** Same barcode re-read is ignored while it stays in view (ms). */
const RESCAN_COOLDOWN = 2500;

type ScannedItem = {
  code: string;
  format: string;
  scannedAt: number;
};

type Pending = {
  code: string;
  format: string;
};

type Toast = {
  kind: "success" | "warn";
  message: string;
};

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 1400;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable - non-critical */
  }
}

function formatLabel(format: string) {
  return format.replace(/_/g, "-").toUpperCase();
}

export default function BarcodeScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemsRef = useRef<ScannedItem[]>([]);
  const pendingRef = useRef<Pending | null>(null);

  const [items, setItems] = useState<ScannedItem[]>([]);
  const [pending, setPendingState] = useState<Pending | null>(null);
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [flash, setFlash] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [manualCode, setManualCode] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const setPending = useCallback((next: Pending | null) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);

  const showToast = useCallback((t: Toast) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(t);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);

  /** Actually saves an item to the list - runs after the user confirms. */
  const commitItem = useCallback(
    (rawCode: string, format: string) => {
      const code = rawCode.trim();
      if (!code) return;

      let added = false;
      setItems((prev) => {
        if (prev.some((i) => i.code === code)) return prev;
        added = true;
        return [{ code, format, scannedAt: Date.now() }, ...prev];
      });

      if (added) {
        playBeep();
        if (navigator.vibrate) navigator.vibrate(60);
        setFlash((f) => f + 1);
        showToast({ kind: "success", message: `Added ${code} to your list` });
      } else {
        showToast({ kind: "warn", message: `${code} already in the list` });
      }
    },
    [showToast],
  );

  /** Camera detection hit - ask the user to confirm before adding it. */
  const handleDetected = useCallback((rawCode: string, format: string) => {
    const code = rawCode.trim();
    if (!code || pendingRef.current) return;

    const now = Date.now();
    if (
      lastScanRef.current.code === code &&
      now - lastScanRef.current.at < RESCAN_COOLDOWN
    ) {
      // sliding window: while the same barcode stays in view, keep quiet
      lastScanRef.current.at = now;
      return;
    }
    lastScanRef.current = { code, at: now };

    if (itemsRef.current.some((i) => i.code === code)) {
      showToast({ kind: "warn", message: `${code} already in the list` });
      return;
    }

    setPending({ code, format });
  }, [setPending, showToast]);

  const confirmPending = useCallback(() => {
    const current = pendingRef.current;
    if (!current) return;
    commitItem(current.code, current.format);
    setPending(null);
  }, [commitItem, setPending]);

  const cancelPending = useCallback(() => {
    // restart the cooldown so the same barcode doesn't instantly re-prompt
    lastScanRef.current.at = Date.now();
    setPending(null);
  }, [setPending]);

  // Keyboard shortcuts while the confirmation popup is open.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") confirmPending();
      if (e.key === "Escape") cancelPending();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, confirmPending, cancelPending]);

  const stopScanning = useCallback(() => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  const startScanning = useCallback(async () => {
    const video = videoRef.current;
    if (scanning || starting || !video) return;
    setStarting(true);
    setCameraError(null);
    try {
      detectorRef.current ??= new BarcodeDetector({
        formats: [
          "ean_13",
          "ean_8",
          "upc_a",
          "upc_e",
          "code_128",
          "code_39",
          "itf",
          "qr_code",
        ],
      });

      // High resolution + continuous focus helps a lot with 1D barcodes.
      const videoConstraints: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "environment" } };
      videoConstraints.width = { ideal: 1920 };
      videoConstraints.height = { ideal: 1080 };
      (videoConstraints as { advanced?: Record<string, string>[] }).advanced = [
        { focusMode: "continuous" },
      ];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      let busy = false;
      scanTimerRef.current = setInterval(async () => {
        // pause detection entirely while a confirmation popup is open
        if (busy || pendingRef.current || !detectorRef.current || video.readyState < 2) {
          return;
        }
        busy = true;
        try {
          const barcodes = await detectorRef.current.detect(video);
          const first = barcodes[0];
          if (first) handleDetected(first.rawValue, first.format);
        } catch {
          /* frame not ready - skip it */
        } finally {
          busy = false;
        }
      }, SCAN_INTERVAL);

      setScanning(true);

      const found = await navigator.mediaDevices
        .enumerateDevices()
        .catch(() => [] as MediaDeviceInfo[]);
      setDevices(found.filter((d) => d.kind === "videoinput"));
    } catch (err) {
      stopScanning();
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access and try again."
          : "Could not start the camera. Check that a camera is connected and not in use.";
      setCameraError(msg);
    } finally {
      setStarting(false);
    }
  }, [handleDetected, deviceId, scanning, starting, stopScanning]);

  const switchDevice = useCallback(
    (id: string) => {
      setDeviceId(id);
      if (streamRef.current) {
        stopScanning();
        // restart on next tick with the new device
        setTimeout(() => void startScanning(), 50);
      }
    },
    [startScanning, stopScanning],
  );

  useEffect(() => stopScanning, [stopScanning]);

  const removeItem = (code: string) =>
    setItems((prev) => prev.filter((i) => i.code !== code));

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    commitItem(manualCode, "manual");
    setManualCode("");
  };

  const redirectUrl = useMemo(() => {
    if (items.length === 0) return GNC_PRODUCT_URL;
    const url = new URL(GNC_PRODUCT_URL);
    url.searchParams.set(
      "skus",
      items
        .map((i) => i.code)
        .reverse()
        .join(","),
    );
    return url.toString();
  }, [items]);

  const handleContinue = () => {
    if (items.length === 0) return;
    setRedirecting(true);
    stopScanning();
    window.location.href = redirectUrl;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* ============ Scanner panel ============ */}
      <section className="lg:col-span-3">
        <div className="rounded-2xl border border-line bg-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-foreground">
              Barcode Scanner
            </h2>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                pending
                  ? "bg-amber-400/15 text-amber-300"
                  : scanning
                    ? "bg-brand/15 text-brand"
                    : "bg-surface-2 text-muted"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  pending
                    ? "bg-amber-300 pulse-dot"
                    : scanning
                      ? "bg-brand pulse-dot"
                      : "bg-muted"
                }`}
              />
              {pending ? "Confirm" : scanning ? "Live" : "Idle"}
            </span>
          </div>

          {/* viewport */}
          <div className="relative aspect-[4/3] w-full bg-black sm:aspect-video">
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              muted
              playsInline
            />

            {/* capture flash overlay: keyed so the animation re-runs per scan
                without ever remounting the video element */}
            {flash > 0 && (
              <span
                key={flash}
                className="capture-flash pointer-events-none absolute inset-0 z-10"
              />
            )}

            {/* corner brackets */}
            <div className="pointer-events-none absolute inset-0 m-[9%]">
              <span className="absolute left-0 top-0 h-8 w-8 border-l-[3px] border-t-[3px] border-brand" />
              <span className="absolute right-0 top-0 h-8 w-8 border-r-[3px] border-t-[3px] border-brand" />
              <span className="absolute bottom-0 left-0 h-8 w-8 border-b-[3px] border-l-[3px] border-brand" />
              <span className="absolute bottom-0 right-0 h-8 w-8 border-b-[3px] border-r-[3px] border-brand" />
              {scanning && !pending && (
                <span className="laser absolute left-[4%] right-[4%] h-[2px] rounded-full bg-brand" />
              )}
            </div>

            {/* idle / error overlay */}
            {!scanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 px-6 text-center">
                <svg
                  className="h-12 w-12 text-brand"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                  <path d="M7 8v8M10 8v8M13 8v5M16 8v8" strokeLinecap="round" />
                </svg>
                {cameraError ? (
                  <p className="max-w-sm text-sm text-red-300">{cameraError}</p>
                ) : (
                  <p className="max-w-sm text-sm text-muted">
                    Point your camera at a product barcode. You&apos;ll be asked
                    to confirm each item before it&apos;s added.
                  </p>
                )}
                <button
                  onClick={() => void startScanning()}
                  disabled={starting}
                  className="rounded-full bg-brand px-8 py-3 font-display text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-brand-dark disabled:opacity-50"
                >
                  {starting ? "Starting..." : "Start Scanning"}
                </button>
              </div>
            )}

            {/* confirmation popup */}
            {pending && (
              <div className="slide-in absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-black/85 px-6 text-center backdrop-blur-sm">
                <span className="rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand">
                  Barcode Detected
                </span>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/15">
                  <svg
                    className="h-8 w-8 text-brand"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                    <path d="M7 8v8M10 8v8M13 8v5M16 8v8" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <p className="break-all font-mono text-xl font-semibold text-white">
                    {pending.code}
                  </p>
                  <p className="mt-1 text-[11px] uppercase tracking-wider text-muted">
                    {formatLabel(pending.format)}
                  </p>
                </div>
                <p className="max-w-xs text-sm text-muted">
                  Add this item to your scan list?
                </p>
                <div className="flex w-full max-w-xs gap-3">
                  <button
                    onClick={cancelPending}
                    className="flex-1 rounded-full border border-line px-4 py-3 text-sm font-semibold text-muted transition hover:border-brand hover:text-brand"
                  >
                    Rescan
                  </button>
                  <button
                    onClick={confirmPending}
                    autoFocus
                    className="flex-1 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark"
                  >
                    Add Item
                  </button>
                </div>
              </div>
            )}

            {/* toast */}
            {toast && (
              <div
                className={`slide-in absolute left-1/2 top-4 -translate-x-1/2 z-30 rounded-full px-4 py-2 text-xs font-semibold shadow-lg ${
                  toast.kind === "success"
                    ? "bg-brand text-white"
                    : "bg-surface-2 text-amber-300 border border-line"
                }`}
              >
                {toast.message}
              </div>
            )}
          </div>

          {/* controls */}
          <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center">
            {devices.length > 1 && (
              <select
                value={deviceId}
                onChange={(e) => switchDevice(e.target.value)}
                className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
              >
                <option value="">Default camera</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
            {scanning && (
              <button
                onClick={stopScanning}
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted transition hover:border-brand hover:text-brand"
              >
                Stop camera
              </button>
            )}

            <form
              onSubmit={handleManualAdd}
              className="flex flex-1 gap-2 sm:justify-end"
            >
              <input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Type a SKU / barcode manually"
                className="w-full min-w-0 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-brand sm:max-w-xs"
              />
              <button
                type="submit"
                disabled={!manualCode.trim()}
                className="shrink-0 rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand"
              >
                Add
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ============ Scanned list panel ============ */}
      <section className="lg:col-span-2">
        <div className="flex h-full flex-col rounded-2xl border border-line bg-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-foreground">
              Scanned Items
            </h2>
            <div className="flex items-center gap-3">
              {items.length > 0 && (
                <button
                  onClick={() => setItems([])}
                  className="text-xs text-muted transition hover:text-brand"
                >
                  Clear all
                </button>
              )}
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-2 text-xs font-bold text-white">
                {items.length}
              </span>
            </div>
          </div>

          <div className="thin-scroll flex-1 overflow-y-auto px-3 py-3 lg:max-h-[420px]">
            {items.length === 0 ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm text-muted">No barcodes yet</p>
                <p className="text-xs text-muted/60">
                  Confirmed SKUs will appear here
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {items.map((item, idx) => (
                  <li
                    key={item.code}
                    className="slide-in flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3"
                  >
                    <span className="font-display text-lg font-semibold text-brand">
                      {String(items.length - idx).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-medium text-foreground">
                        {item.code}
                      </p>
                      <p className="text-[11px] uppercase tracking-wider text-muted">
                        {formatLabel(item.format)}{" "}
                        {new Date(item.scannedAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <button
                      onClick={() => removeItem(item.code)}
                      aria-label={`Remove ${item.code}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-brand/15 hover:text-brand"
                    >
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* CTA */}
          <div className="border-t border-line px-5 py-4">
            <button
              onClick={handleContinue}
              disabled={items.length === 0 || redirecting}
              className="w-full rounded-full bg-brand py-3.5 font-display text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted"
            >
              {redirecting
                ? "Redirecting..."
                : items.length === 0
                  ? "Scan a product to continue"
                  : `Continue to GNC (${items.length} SKU${items.length > 1 ? "s" : ""})`}
            </button>
            {items.length > 0 && (
              <p className="mt-3 break-all text-center font-mono text-[10px] leading-relaxed text-muted/70">
                {redirectUrl}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
