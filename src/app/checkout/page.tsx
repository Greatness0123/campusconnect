"use client";

import {
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  Phone,
  Store,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { CustomSelect } from "@/components/custom-select";
import { DEMO_ORDERS_KEY, type DemoOrder, readDemoOrders } from "@/lib/demo-orders";
import {
  clearOrderDraft,
  getOrderDraft,
  type OrderDraft,
} from "@/lib/order-draft";
import {
  computeQuote,
  formatNaira,
  locationOptions,
  type LocationArea,
} from "@/lib/print";
import { isSupabaseConfigured, supabase, uploadOrderFile } from "@/lib/supabase";

export default function CheckoutPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState<LocationArea>("Uptown");
  const [location, setLocation] = useState(locationOptions.Uptown[0]);
  const [fulfilment, setFulfilment] = useState<"collection" | "delivery">("collection");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = getOrderDraft();
    if (!existing) {
      router.replace("/");
      return;
    }
    setDraft(existing);
    setArea(existing.area);
    setLocation(existing.location);
  }, [router]);

  const quote = useMemo(
    () => (draft ? computeQuote(draft.files) : null),
    [draft]
  );

  const areaOptions = Object.keys(locationOptions) as LocationArea[];

  async function placeOrder() {
    if (!draft || !quote || placing) return;
    if (!phone.trim()) {
      setError("Please enter a phone number so the print desk can reach you.");
      return;
    }
    setPlacing(true);
    setError(null);

    const orderId = `CP-${Date.now().toString().slice(-6)}`;
    const modes = new Set(draft.files.map((f) => f.colorMode));
    const printMode =
      modes.size > 1 ? "Mixed" : modes.has("keep") ? "Keep detected color" : "Black & white";

    const anyDuplex = draft.files.some((f) => f.sides === "duplex");
    const anyStapled = draft.files.some((f) => f.stapled);
    const anyBound = draft.files.some((f) => f.bound);

    const orderItem: DemoOrder = {
      id: orderId,
      deviceId: draft.deviceId,
      customer: draft.customer,
      createdAt: new Date().toISOString(),
      status: "New",
      documents: draft.files.map((file) => ({
        name: file.file.name,
        pages: file.pages,
        selectedPages: [],
        copies: file.copies,
      })),
      total: quote.total,
      area,
      location,
      printMode,
      sides: anyDuplex ? "Front & back" : "Single-sided",
      stapling: anyStapled ? "Stapled" : "No stapling",
      binding: anyBound ? "Binding added" : "No binding",
    };

    localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify([orderItem, ...readDemoOrders()]));

    if (supabase && isSupabaseConfigured) {
      try {
        await supabase.from("orders").insert({
          id: orderId,
          customer_name: draft.customer,
          device_id: draft.deviceId,
          status: "New",
          total_amount: quote.total,
          pickup_area: area,
          pickup_location: location,
          print_mode: printMode,
          sides: orderItem.sides,
          stapling: orderItem.stapling,
          binding: orderItem.binding,
          copies: draft.files[0]?.copies ?? 1,
        });

        for (const file of draft.files) {
          // Placeholder files restored after a refresh have size 0 — skip upload.
          const filePath = file.file.size > 0 ? await uploadOrderFile(orderId, file.file) : "";
          const colorCount = file.colorCoverage.filter((c) => c > 0.005).length;
          await supabase.from("order_documents").insert({
            order_id: orderId,
            file_name: file.file.name,
            file_path: filePath ?? "",
            file_size: file.file.size,
            total_pages: file.pages,
            color_pages: colorCount,
            bw_pages: file.pages - colorCount,
            selected_pages: file.pageSelection,
          });
        }
      } catch (err) {
        console.warn("Supabase order sync error:", err);
      }
    }

    setPlacing(false);
    clearOrderDraft();
    router.push(`/order/${orderId}`);
  }

  if (!draft || !quote) {
    return (
      <main className="app-shell">
        <AppHeader compact />
        <div className="checkout-loading">Loading your summary…</div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <AppHeader compact />

      <div className="checkout-page">
        <Link className="checkout-back" href="/">
          <ArrowLeft size={15} /> Edit order
        </Link>

        <div className="receipt-card">
          <div className="receipt-header">
            <h1>Your Print Summary</h1>
            <span className="receipt-tag">Quote</span>
          </div>

          <div className="receipt-meta">
            <div className="receipt-meta-row">
              <span>Customer</span>
              <strong>{draft.customer}</strong>
            </div>
            <div className="receipt-meta-row">
              <span>Documents</span>
              <strong>{draft.files.length}</strong>
            </div>
          </div>

          {/* Per-file breakdown */}
          <div className="receipt-files">
            {draft.files.map((file, index) => {
              const fq = quote.perFile[index];
              if (!fq) return null;
              return (
                <div className="receipt-file" key={file.id}>
                  <div className="receipt-file-head">
                    <span className="receipt-file-name" title={file.file.name}>
                      {file.file.name}
                    </span>
                    <span className="receipt-file-cost">{formatNaira(fq.totalCost)}</span>
                  </div>
                  <p className="receipt-file-detail">
                    {fq.selectedCount} {fq.selectedCount === 1 ? "page" : "pages"} per copy ·{" "}
                    {fq.copies} {fq.copies === 1 ? "copy" : "copies"} · {fq.printedPages} to print ·{" "}
                    {fq.sheets} {fq.sheets === 1 ? "sheet" : "sheets"}
                  </p>
                  <p className="receipt-file-detail">
                    {fq.bwPages} B&amp;W · {fq.lightColorPages} colour low · {fq.heavyColorPages}{" "}
                    colour high · printing {formatNaira(fq.printCost)}
                    {fq.bindingCost > 0 && ` · binding ${formatNaira(fq.bindingCost)}`}
                  </p>
                  <p className="receipt-file-detail muted">
                    {fq.sides === "single" ? "Single-sided" : "Front & back"}
                    {fq.stapled ? " · Stapled" : ""}
                    {fq.bound ? " · Bound" : ""}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Aggregate breakdown */}
          <div className="receipt-summary">
            <div className="receipt-row">
              <span>Pages to print</span>
              <strong>{quote.copyPages} page sides</strong>
            </div>
            <div className="receipt-row">
              <span>Physical sheets</span>
              <strong>{quote.physicalSheets} sheets</strong>
            </div>
            <div className="receipt-divider" />
            <div className="receipt-row">
              <span>B&amp;W pages</span>
              <strong>{quote.blackAndWhitePages}</strong>
            </div>
            <div className="receipt-row">
              <span>Colour under 50%</span>
              <strong>{quote.lightColorPages}</strong>
            </div>
            <div className="receipt-row">
              <span>Colour over 50%</span>
              <strong>{quote.heavyColorPages}</strong>
            </div>
            <div className="receipt-divider" />
            <div className="receipt-row">
              <span>Printing</span>
              <strong>{formatNaira(quote.printCost)}</strong>
            </div>
            <div className="receipt-row">
              <span>Stapling</span>
              <strong>{quote.anyStapled ? "FREE" : "—"}</strong>
            </div>
            <div className="receipt-row">
              <span>Binding</span>
              <strong>{quote.anyBound ? formatNaira(quote.finishingCost) : "No"}</strong>
            </div>
            <div className="receipt-row">
              <span>{fulfilment === "collection" ? "Pickup" : "Delivery"}</span>
              <strong>FREE</strong>
            </div>
            <div className="receipt-total">
              <span>Total</span>
              <strong>{formatNaira(quote.total)}</strong>
            </div>
          </div>
        </div>

        {/* Fulfilment method */}
        <div className="checkout-section">
          <h3 className="setting-title">How would you like to receive it?</h3>
          <div className="dual-cards-grid fulfilment-grid">
            <div
              className={`dual-card fulfilment-card ${fulfilment === "collection" ? "selected" : ""}`}
              onClick={() => setFulfilment("collection")}
            >
              <div className="fulfilment-icon">
                <Store size={18} />
              </div>
              <h4 className="dual-card-title">Collection</h4>
              <p className="dual-card-desc">FREE</p>
            </div>
            <div
              className={`dual-card fulfilment-card ${fulfilment === "delivery" ? "selected" : ""}`}
              onClick={() => setFulfilment("delivery")}
            >
              <div className="fulfilment-icon">
                <Truck size={18} />
              </div>
              <h4 className="dual-card-title">Delivery</h4>
              <p className="dual-card-desc">FREE</p>
            </div>
          </div>
        </div>

        {/* Pickup location */}
        <div className="checkout-section">
          <h3 className="setting-title">Pickup details</h3>
          <div className="checkout-field">
            <label htmlFor="co-area">Campus area</label>
            <CustomSelect
              id="co-area"
              value={area}
              onChange={(value) => {
                const next = value as LocationArea;
                setArea(next);
                setLocation(locationOptions[next][0]);
              }}
              options={areaOptions}
              maxHeight={200}
            />
          </div>
          <div className="checkout-field">
            <label htmlFor="co-spot">
              {fulfilment === "collection" ? "Pickup spot" : "Delivery spot"}
            </label>
            <CustomSelect
              id="co-spot"
              value={location}
              onChange={setLocation}
              options={locationOptions[area]}
              maxHeight={280}
            />
          </div>
          <div className="checkout-field">
            <label htmlFor="co-phone">Phone number</label>
            <div className="phone-input">
              <Phone size={16} />
              <input
                id="co-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="e.g. 0801 234 5678"
              />
            </div>
          </div>
        </div>

        {error && <p className="inline-alert checkout-error">{error}</p>}

        <button className="pill-button checkout-submit" type="button" disabled={placing} onClick={placeOrder}>
          {placing ? (
            <>
              <LoaderCircle className="spin" size={16} /> Sending…
            </>
          ) : (
            <>
              Ready to print? {formatNaira(quote.total)} <ArrowRight size={17} />
            </>
          )}
        </button>

        <p className="checkout-footnote">
          Payments are made on pickup — cash or transfer.
        </p>
      </div>
    </main>
  );
}
