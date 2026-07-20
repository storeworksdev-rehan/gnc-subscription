import Image from "next/image";
import BarcodeScanner from "@/components/BarcodeScanner";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ===== Header ===== */}
      <header className="border-b-2 border-brand bg-black">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Image
              src="/gnc-logo.png"
              alt="GNC - Live Well"
              width={112}
              height={63}
              priority
              className="h-12 w-auto"
            />
            <span className="hidden h-8 w-px bg-line sm:block" />
            <p className="hidden text-[11px] uppercase tracking-[0.2em] text-muted sm:block">
              Product Scanner
            </p>
          </div>
          <span className="hidden rounded-full border border-line px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted sm:block">
            In-Store Mode
          </span>
        </div>
      </header>

      {/* ===== Hero strip ===== */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <h1 className="font-display text-2xl font-semibold uppercase tracking-wide text-foreground sm:text-3xl">
            Scan Your <span className="text-brand">Products</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Scan one or more product barcodes. Each SKU is saved to your list,
            and when you&apos;re done you continue to GNC.com with all SKUs
            attached.
          </p>
        </div>
      </div>

      {/* ===== Main ===== */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <BarcodeScanner />
      </main>

      {/* ===== Footer ===== */}
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
            GNC SKU Scanner
          </p>
          <p className="text-[11px] text-muted/60">
            Camera runs locally. Nothing is uploaded.
          </p>
        </div>
      </footer>
    </div>
  );
}
