"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import QRCode from "qrcode";
import { useSessionEmail } from "@/components/EmailGate";
import {
  pickRandomProduct,
  priceForPurchaseType,
  formatPrice,
  SUBSCRIPTION_FREQUENCIES,
  DEFAULT_SUBSCRIPTION_FREQUENCY,
  type Product,
  type PurchaseType,
  type SubscriptionFrequency,
} from "@/lib/products";

// Serve the ZXing wasm binary from our own /public instead of a CDN.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path,
  },
});

/** How often we grab a frame and look for barcodes (ms). */
const SCAN_INTERVAL = 120;

/** Same barcode re-read is ignored while it stays in view (ms). */
const RESCAN_COOLDOWN = 2500;

type ScannedItem = {
  id: string;
  code: string;
  name: string;
  image: string;
  price: number;
  purchaseType: PurchaseType;
  /** Re-ship interval in days - only meaningful when purchaseType is "subscription". */
  frequencyDays?: SubscriptionFrequency;
  format: string;
  scannedAt: number;
};

type Pending = {
  rawCode: string;
  format: string;
  product: Product;
  purchaseType: PurchaseType;
  frequencyDays: SubscriptionFrequency;
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

/** Keeps long product names from blowing out fixed-width list rows. */
function truncateName(name: string, max = 20) {
  return name.length > max ? `${name.slice(0, max).trimEnd()}…` : name;
}

export default function BarcodeScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const checkoutOpenRef = useRef(false);
  const email = useSessionEmail();

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
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orderRef, setOrderRef] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const setPending = useCallback((next: Pending | null) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);

  const showToast = useCallback((t: Toast) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(t);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);

  /** Opens the product confirmation popup for a freshly read code. */
  const openConfirmation = useCallback(
    (rawCode: string, format: string) => {
      if (pendingRef.current || checkoutOpenRef.current) return;
      const product = pickRandomProduct();
      setPending({
        rawCode,
        format,
        product,
        purchaseType: "one-time",
        frequencyDays: DEFAULT_SUBSCRIPTION_FREQUENCY,
      });
    },
    [setPending],
  );

  /** Camera detection hit - runs the cooldown check, then opens the popup. */
  const handleDetected = useCallback(
    (rawCode: string, format: string) => {
      const code = rawCode.trim();
      if (!code || pendingRef.current || checkoutOpenRef.current) return;

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
      openConfirmation(code, format);
    },
    [openConfirmation],
  );

  const setPurchaseType = useCallback(
    (type: PurchaseType) => {
      if (!pendingRef.current) return;
      setPending({ ...pendingRef.current, purchaseType: type });
    },
    [setPending],
  );

  const setFrequencyDays = useCallback(
    (days: SubscriptionFrequency) => {
      if (!pendingRef.current) return;
      setPending({ ...pendingRef.current, frequencyDays: days });
    },
    [setPending],
  );

  const confirmPending = useCallback(() => {
    const current = pendingRef.current;
    if (!current) return;
    const price = priceForPurchaseType(current.product, current.purchaseType);
    const isSubscription = current.purchaseType === "subscription";
    const newItem: ScannedItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      code: current.product.code,
      name: current.product.name,
      image: current.product.image,
      price,
      purchaseType: current.purchaseType,
      frequencyDays: isSubscription ? current.frequencyDays : undefined,
      format: current.format,
      scannedAt: Date.now(),
    };

    setItems((prev) => [newItem, ...prev]);
    playBeep();
    if (navigator.vibrate) navigator.vibrate(60);
    setFlash((f) => f + 1);
    showToast({
      kind: "success",
      message: `Added ${current.product.name} - ${
        isSubscription ? `Every ${current.frequencyDays} Days` : "One-Time"
      }`,
    });
    setPending(null);
  }, [setPending, showToast]);

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
        // pause detection while a popup or the checkout modal is open
        if (
          busy ||
          pendingRef.current ||
          checkoutOpenRef.current ||
          !detectorRef.current ||
          video.readyState < 2
        ) {
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

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((i) => i.id !== id));

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    openConfirmation(code, "manual");
    setManualCode("");
  };

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price, 0),
    [items],
  );

  const openCheckout = useCallback(() => {
    if (items.length === 0) return;
    checkoutOpenRef.current = true;
    setOrderRef(`GNC-${Date.now().toString(36).toUpperCase()}`);
    setCheckoutOpen(true);
  }, [items.length]);

  const closeCheckout = useCallback(() => {
    checkoutOpenRef.current = false;
    setCheckoutOpen(false);
  }, []);

  const resetOrder = useCallback(() => {
    setItems([]);
    checkoutOpenRef.current = false;
    setCheckoutOpen(false);
  }, []);

  // Generate the checkout QR code the customer shows to the cashier.
  useEffect(() => {
    if (!checkoutOpen || !orderRef || items.length === 0) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    const payload = JSON.stringify({
      ref: orderRef,
      email,
      subtotal,
      items: items.map((i) => ({
        code: i.code,
        name: i.name,
        price: i.price,
        type: i.purchaseType,
        frequencyDays: i.frequencyDays,
      })),
    });
    QRCode.toDataURL(payload, {
      margin: 1,
      width: 220,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [checkoutOpen, orderRef, items, subtotal, email]);

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

            {/* product confirmation popup */}
            {pending && (
              <div className="slide-in thin-scroll absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-black/90 px-5 py-5 text-center backdrop-blur-sm">
                <span className="rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand">
                  Item Found
                </span>

                <Image
                  src={pending.product.image}
                  alt={pending.product.name}
                  width={84}
                  height={105}
                  className="mt-3 h-24 w-auto drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]"
                />

                <h3
                  className="mt-3 max-w-xs font-display text-base font-semibold uppercase leading-snug tracking-wide text-white"
                  title={pending.product.name}
                >
                  {truncateName(pending.product.name)}
                </h3>
                <p className="mt-1 max-w-xs text-xs text-muted">
                  {pending.product.description}
                </p>

                <div className="mt-3 flex items-center gap-4">
                  <div className="text-left">
                    <p className="text-[10px] uppercase tracking-wider text-muted">
                      Product Code
                    </p>
                    <p className="font-mono text-sm font-medium text-white">
                      {pending.product.code}
                    </p>
                  </div>
                  <div className="h-8 w-px bg-line" />
                  <div className="text-left">
                    <p className="text-[10px] uppercase tracking-wider text-muted">
                      Price
                    </p>
                    <p className="font-display text-lg font-bold text-brand">
                      {formatPrice(
                        priceForPurchaseType(
                          pending.product,
                          pending.purchaseType,
                        ),
                      )}
                    </p>
                  </div>
                </div>

                {pending.product.subscriptionAvailable ? (
                  <div className="mt-4 grid w-full max-w-xs grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPurchaseType("one-time")}
                      className={`rounded-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition ${
                        pending.purchaseType === "one-time"
                          ? "border-brand bg-brand text-white"
                          : "border-line text-muted hover:border-brand hover:text-brand"
                      }`}
                    >
                      One-Time
                    </button>
                    <button
                      type="button"
                      onClick={() => setPurchaseType("subscription")}
                      className={`rounded-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition ${
                        pending.purchaseType === "subscription"
                          ? "border-brand bg-brand text-white"
                          : "border-line text-muted hover:border-brand hover:text-brand"
                      }`}
                    >
                      Subscribe &amp; Save
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 text-[11px] uppercase tracking-wider text-muted">
                    One-Time Purchase Only
                  </p>
                )}

                {pending.product.subscriptionAvailable &&
                  pending.purchaseType === "subscription" && (
                    <div className="mt-3 w-full max-w-xs text-left">
                      <label
                        htmlFor="frequency-select"
                        className="text-[10px] uppercase tracking-wider text-muted"
                      >
                        Deliver Every
                      </label>
                      <select
                        id="frequency-select"
                        value={pending.frequencyDays}
                        onChange={(e) =>
                          setFrequencyDays(
                            Number(e.target.value) as SubscriptionFrequency,
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                      >
                        {SUBSCRIPTION_FREQUENCIES.map((days) => (
                          <option key={days} value={days}>
                            {days} Days
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                <div className="mt-5 flex w-full max-w-xs gap-3">
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
                  Confirmed items will appear here
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {items.map((item, idx) => (
                  <li
                    key={item.id}
                    className="slide-in flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3"
                  >
                    <span className="font-display text-lg font-semibold text-brand">
                      {String(items.length - idx).padStart(2, "0")}
                    </span>
                    <div className="flex h-12 w-10 shrink-0 items-center justify-center rounded-md bg-black/40">
                      <Image
                        src={item.image}
                        alt={item.name}
                        width={40}
                        height={50}
                        className="h-11 w-auto"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p
                          className="truncate text-sm font-medium text-foreground"
                          title={item.name}
                        >
                          {truncateName(item.name)}
                        </p>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                            item.purchaseType === "subscription"
                              ? "bg-brand/15 text-brand"
                              : "border border-line text-muted"
                          }`}
                        >
                          {item.purchaseType === "subscription"
                            ? `Every ${item.frequencyDays} Days`
                            : "One-Time"}
                        </span>
                      </div>
                      <p className="text-[11px] uppercase tracking-wider text-muted">
                        <span className="font-mono normal-case">
                          {item.code}
                        </span>
                        {" · "}
                        {formatPrice(item.price)}
                      </p>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.name}`}
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
            {items.length > 0 && (
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="uppercase tracking-wider text-muted">
                  Subtotal
                </span>
                <span className="font-display text-sm font-semibold text-foreground">
                  {formatPrice(subtotal)}
                </span>
              </div>
            )}
            <button
              onClick={openCheckout}
              disabled={items.length === 0}
              className="w-full rounded-full bg-brand py-3.5 font-display text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted"
            >
              {items.length === 0
                ? "Scan a product to continue"
                : `Continue to Register (${items.length} item${items.length > 1 ? "s" : ""})`}
            </button>
          </div>
        </div>
      </section>

      {/* ============ Checkout / register popup ============ */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-4 py-8 backdrop-blur-sm">
          <div className="thin-scroll max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-6 text-center sm:p-8">
            <span className="inline-block rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand">
              Ready for Checkout
            </span>

            <h2 className="mt-4 font-display text-xl font-semibold uppercase tracking-wide text-foreground">
              Your Order
            </h2>

            <ul className="mt-4 space-y-2 text-left">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
                >
                  <div className="flex h-12 w-10 shrink-0 items-center justify-center rounded-md bg-black/40">
                    <Image
                      src={item.image}
                      alt={item.name}
                      width={40}
                      height={50}
                      className="h-11 w-auto"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground" title={item.name}>
                      {truncateName(item.name)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-muted">
                      {item.purchaseType === "subscription"
                        ? `Subscribe - Every ${item.frequencyDays} Days`
                        : "One-Time"}{" "}
                      &middot;{" "}
                      <span className="font-mono normal-case">{item.code}</span>
                    </p>
                  </div>
                  <span className="shrink-0 font-display font-semibold text-brand">
                    {formatPrice(item.price)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
              <span className="text-muted">Subtotal</span>
              <span className="font-display text-base font-semibold text-foreground">
                {formatPrice(subtotal)}
              </span>
            </div>

            <div className="mt-6 flex flex-col items-center gap-2">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- dynamic data: URL, not a static asset
                <img
                  src={qrDataUrl}
                  alt="Checkout QR code"
                  className="h-45 w-45 rounded-lg bg-white p-2"
                />
              ) : (
                <div className="h-45 w-45 animate-pulse rounded-lg bg-surface-2" />
              )}
              <p className="font-mono text-xs text-muted">{orderRef}</p>
              <p className="max-w-xs text-sm text-muted">
                Show this QR code to the cashier at checkout to complete your
                purchase.
              </p>
            </div>

            <button
              onClick={closeCheckout}
              className="mt-6 w-full rounded-full border border-line px-6 py-3 text-sm font-semibold text-muted transition hover:border-brand hover:text-brand"
            >
              Close
            </button>
            <button
              onClick={resetOrder}
              className="mt-3 w-full rounded-full px-6 py-3 text-sm font-semibold text-brand transition hover:bg-brand/10"
            >
              Reset Order
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
