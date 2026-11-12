"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
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
import { QuotationModal } from "@/components/quotation-modal";
import { DEMO_ORDERS_KEY, type DemoOrder, readDemoOrders } from "@/lib/demo-orders";
import {
  clearOrderDraft,
  getOrderDraft,
  getPlacedOrderDraft,
  savePlacedOrderDraft,
  type OrderDraft,
} from "@/lib/order-draft";
import {
  computeQuote,
  deliveryEta,
  deliveryTiers,
  formatNaira,
  getHostelAccount,
  isNightRate,
  locationOptions,
  pricing,
  type Fulfilment,
  type LocationArea,
} from "@/lib/print";
import { useClock } from "@/lib/clock";
import { isSupabaseConfigured, supabase, uploadOrderFile } from "@/lib/supabase";

const LOCAL_ORDER_COUNTER_KEY = "campusprints:order-counter";
const ORDER_ID_MIN = 154; // next order starts at CP-000154

function getLocalOrderId() {
  const savedNumber = Number(localStorage.getItem(LOCAL_ORDER_COUNTER_KEY));
  let nextNumber = Number.isSafeInteger(savedNumber) && savedNumber >= ORDER_ID_MIN ? savedNumber : ORDER_ID_MIN;
  const existingIds = new Set(readDemoOrders().map((order) => order.id));
  let orderId = `CP-${String(nextNumber).padStart(6, "0")}`;

  while (existingIds.has(orderId)) {
    nextNumber += 1;
    orderId = `CP-${String(nextNumber).padStart(6, "0")}`;
  }

  localStorage.setItem(LOCAL_ORDER_COUNTER_KEY, String(nextNumber + 1));
  return orderId;
}

export default function CheckoutPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState<LocationArea>("Uptown");
  const [location, setLocation] = useState(locationOptions.Uptown[0]);
  const [fulfilment, setFulfilment] = useState<Fulfilment>("collection");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQuotation, setShowQuotation] = useState(false);
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [existingOrderId, setExistingOrderId] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);

  useEffect(() => {
    const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const requestedOrderId = urlParams?.get("orderId");
    if (requestedOrderId) {
      setExistingOrderId(requestedOrderId);

      // Look up live status so we can show "Completed" state if already collected
      async function fetchStatus() {
        if (supabase && isSupabaseConfigured) {
          try {
            const { data } = await supabase
              .from("orders")
              .select("status")
              .eq("id", requestedOrderId)
              .maybeSingle();
            if (data?.status) setOrderStatus(data.status as string);
            return;
          } catch { /* fall through to local */ }
        }
        // Fallback: localStorage demo orders
        const local = readDemoOrders().find((o) => o.id === requestedOrderId);
        if (local) setOrderStatus(local.status);
      }
      void fetchStatus();
    }

    const existing = getOrderDraft() || getPlacedOrderDraft(requestedOrderId || undefined);
    if (!existing) {
      router.replace("/");
      return;
    }
    setDraft(existing);
    setArea(existing.area);
    setLocation(existing.location);
    if (existing.fulfilment) {
      setFulfilment(existing.fulfilment);
    }
    if (existing.phone) {
      setPhone(existing.phone);
    } else {
      const savedPhone = localStorage.getItem("campusprints:last-phone");
      if (savedPhone) setPhone(savedPhone);
    }
  }, [router]);

  const now = useClock();
  const nightRate = isNightRate(now);
  const quote = useMemo(
    () => (draft ? computeQuote(draft.files, nightRate) : null),
    [draft, nightRate]
  );

  const deliveryCharge = fulfilment === "collection" ? 0 : deliveryTiers[fulfilment].fee;
  const grandTotal = (quote?.total ?? 0) + deliveryCharge;

  const areaOptions = Object.keys(locationOptions) as LocationArea[];
  const activeAccount = getHostelAccount(area, location);
  const isReadyForPayment = Boolean(location && phone.trim().length >= 7);

  function copyAccountNumber() {
    void navigator.clipboard?.writeText(activeAccount.accountNumber).then(() => {
      setCopiedAccount(true);
      window.setTimeout(() => setCopiedAccount(false), 1600);
    });
  }

  async function placeOrder() {
    if (!draft || !quote || placing) return;
    if (!phone.trim()) {
      setError("Please enter a phone number so the print desk can reach you.");
      return;
    }
    setPlacing(true);
    setError(null);
    localStorage.setItem("campusprints:last-phone", phone.trim());

    // If student returned from an existing order to re-confirm payment
    if (existingOrderId) {
      const placedOrders = readDemoOrders();
      const updatedOrders = placedOrders.map((o) =>
        o.id === existingOrderId
          ? { ...o, status: "New" as DemoOrder["status"], paymentNotReceived: false, phone: phone.trim() }
          : o
      );
      localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify(updatedOrders));

      if (supabase && isSupabaseConfigured) {
        try {
          await supabase
            .from("orders")
            .update({ status: "New" })
            .eq("id", existingOrderId);
        } catch {
          // ignore
        }
      }

      savePlacedOrderDraft(existingOrderId, {
        ...draft,
        phone: phone.trim(),
        area,
        location,
        fulfilment,
        orderId: existingOrderId,
      });

      setPlacing(false);
      router.replace(`/order/${existingOrderId}`);
      return;
    }

    if (supabase && isSupabaseConfigured && draft.files.some((file) => file.file.size === 0)) {
      setError("A document is no longer available after refresh. Go back, remove it, and upload the original file again.");
      setPlacing(false);
      return;
    }

    let orderId: string;
    try {
      if (supabase && isSupabaseConfigured) {
        const { data, error: idError } = await supabase.rpc("next_order_id");
        if (idError || typeof data !== "string" || !data) {
          throw new Error("Could not generate an order number. Please try again.");
        }
        orderId = data;
      } else {
        orderId = getLocalOrderId();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate an order number. Please try again.");
      setPlacing(false);
      return;
    }

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
      phone: phone.trim(),
      createdAt: new Date().toISOString(),
      status: "New",
      fulfilment,
      documents: draft.files.map((file) => ({
        name: file.file.name,
        pages: file.pages,
        selectedPages: [],
        copies: file.copies,
        colorMode: file.colorMode === "keep" ? "Colour" : "Black & white",
        sides: file.sides === "duplex" ? "Front & back" : "Single-sided",
        stapling: file.stapled ? "Stapled" : "No stapling",
        binding: file.bound ? "Binding added" : "No binding",
        pageSelection: file.pageSelection || "all",
      })),
      total: grandTotal,
      area,
      location,
      printMode,
      sides: anyDuplex ? "Front & back" : "Single-sided",
      stapling: anyStapled ? "Stapled" : "No stapling",
      binding: anyBound ? "Binding added" : "No binding",
    };

    if (supabase && isSupabaseConfigured) {
      try {
        const documents = [];
        for (const file of draft.files) {
          const filePath = await uploadOrderFile(orderId, file.file);
          if (!filePath) {
            throw new Error(`Could not upload "${file.file.name}". Check the connection and try again.`);
          }
          documents.push({
            order_id: orderId,
            file_name: file.file.name,
            file_path: filePath,
            file_size: file.file.size,
            total_pages: file.pages,
            color_pages: file.colorCoverage.filter((coverage) => coverage > 0.005).length,
            bw_pages: file.pages - file.colorCoverage.filter((coverage) => coverage > 0.005).length,
            selected_pages: JSON.stringify({
              selection: file.pageSelection || "all",
              colorMode: file.colorMode === "keep" ? "Colour" : "Black & white",
              sides: file.sides === "duplex" ? "Front & back" : "Single-sided",
              stapling: file.stapled ? "Stapled" : "No stapling",
              binding: file.bound ? "Binding added" : "No binding",
              copies: file.copies,
            }),
          });
        }

        const { error: orderError } = await supabase.from("orders").insert({
          id: orderId,
          customer_name: phone.trim() ? `${draft.customer} (${phone.trim()})` : draft.customer,
          device_id: draft.deviceId,
          status: "New",
          total_amount: grandTotal,
          pickup_area: area,
          pickup_location: location,
          print_mode: printMode,
          sides: orderItem.sides,
          stapling: orderItem.stapling,
          binding: orderItem.binding,
          copies: draft.files[0]?.copies ?? 1,
          delivery_option: fulfilment === "collection" ? null : fulfilment,
          delivery_fee: deliveryCharge,
        });
        if (orderError) throw orderError;

        const { error: documentsError } = await supabase.from("order_documents").insert(documents);
        if (documentsError) throw documentsError;
      } catch (err) {
        console.warn("Supabase order sync error:", err);
        setError(err instanceof Error ? err.message : "Could not save the order. Please try again.");
        setPlacing(false);
        return;
      }
    } else {
      localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify([orderItem, ...readDemoOrders()]));
    }

    savePlacedOrderDraft(orderId, {
      ...draft,
      phone: phone.trim(),
      area,
      location,
      fulfilment,
      orderId,
    });

    setPlacing(false);
    clearOrderDraft();
    router.replace(`/order/${orderId}`);
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
            <div>
              <h1>Your Print Summary</h1>
              <span className="receipt-tag">Quote</span>
            </div>
            <button
              type="button"
              className="receipt-download-btn"
              onClick={() => setShowQuotation(true)}
              title="Download official quotation preview"
            >
              <Download size={14} />
              <span>Download quotation</span>
            </button>
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
            {nightRate && (
              <div className="receipt-row">
                <span>Night rates (10pm–6am)</span>
                <strong>
                  B&amp;W {formatNaira(pricing.monoNight)}/pg · duplex{" "}
                  {formatNaira(pricing.duplexMonoNight)}/pg
                </strong>
              </div>
            )}
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
              <span>
                {fulfilment === "collection"
                  ? "Pickup"
                  : `Delivery · ${deliveryTiers[fulfilment].label}`}
              </span>
              <strong>{deliveryCharge === 0 ? "FREE" : formatNaira(deliveryCharge)}</strong>
            </div>
            <div className="receipt-total">
              <span>Total</span>
              <strong>{formatNaira(grandTotal)}</strong>
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
              <p className="dual-card-desc">FREE · pick up at the desk</p>
            </div>

            <div
              className={`dual-card fulfilment-card delivery-group ${
                fulfilment !== "collection" ? "selected" : ""
              }`}
            >
              <div className="fulfilment-icon">
                <Truck size={18} />
              </div>
              <h4 className="dual-card-title">Delivery</h4>
              <div className="delivery-options">
                <button
                  type="button"
                  className={`delivery-option ${fulfilment === "standard" ? "selected" : ""}`}
                  onClick={() => setFulfilment("standard")}
                >
                  <span className="delivery-option-name">
                    Standard
                    <small>{deliveryEta("standard")}</small>
                  </span>
                  <strong
                    className={`delivery-option-price ${
                      deliveryTiers.standard.fee === 0 ? "free" : ""
                    }`}
                  >
                    {deliveryTiers.standard.fee === 0
                      ? "FREE"
                      : formatNaira(deliveryTiers.standard.fee)}
                  </strong>
                </button>
                <button
                  type="button"
                  className={`delivery-option ${fulfilment === "express" ? "selected" : ""}`}
                  onClick={() => setFulfilment("express")}
                >
                  <span className="delivery-option-name">
                    Express
                    <small>{deliveryEta("express")}</small>
                  </span>
                  <strong
                    className={`delivery-option-price ${
                      deliveryTiers.express.fee === 0 ? "free" : ""
                    }`}
                  >
                    {deliveryTiers.express.fee === 0
                      ? "FREE"
                      : formatNaira(deliveryTiers.express.fee)}
                  </strong>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Pickup location */}
        <div className="checkout-section">
          <h3 className="setting-title">
            {fulfilment === "collection" ? "Pickup details" : "Delivery details"}
          </h3>
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
              {fulfilment === "collection" ? "Pickup spot / Hostel" : "Delivery spot / Hostel"}
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

        {/* Account Details Box (appears when hostel is picked & phone number entered) */}
        {isReadyForPayment && orderStatus !== "Completed" && (
          <div className="checkout-section account-details-section">
            <div className="account-details-header">
              <h3 className="setting-title">Payment Account Details</h3>
              <span className="account-badge">{activeAccount.badge}</span>
            </div>
            <p className="setting-desc" style={{ marginTop: 2, marginBottom: 14 }}>
              Make a direct transfer to the account below for your hostel before confirming.
            </p>

            <div className="account-cards-container">
              {/* Bank card */}
              <div className="account-info-card">
                <span className="account-info-label">Bank</span>
                <strong className="account-info-value">{activeAccount.bank}</strong>
              </div>

              {/* Account name card */}
              <div className="account-info-card">
                <span className="account-info-label">Account name</span>
                <strong className="account-info-value">{activeAccount.accountName}</strong>
              </div>

              {/* Account number card with copy button */}
              <div className="account-info-card account-number-card">
                <div className="account-info-left">
                  <span className="account-info-label">Account number</span>
                  <strong className="account-info-value account-number-val">
                    {activeAccount.accountNumber}
                  </strong>
                </div>
                <button
                  type="button"
                  className="account-copy-btn"
                  onClick={copyAccountNumber}
                  aria-label="Copy account number"
                  title="Copy account number"
                >
                  {copiedAccount ? <Check size={18} /> : <Copy size={18} />}
                  <span className="copy-label">{copiedAccount ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {error && <p className="inline-alert checkout-error">{error}</p>}

        {orderStatus === "Completed" ? (
          /* ── Order already collected — show banner, block re-submission ── */
          <div className="checkout-completed-banner">
            <div className="checkout-completed-icon">
              <Check size={22} />
            </div>
            <div className="checkout-completed-text">
              <strong>Order completed</strong>
              <span>This order has already been collected. No further action is needed.</span>
            </div>
            <Link className="admin-action-btn primary" href={`/order/${existingOrderId}`}>
              View order →
            </Link>
          </div>
        ) : (
          <>
            <button
              className={`pill-button checkout-submit ${isReadyForPayment ? "paid-btn" : ""}`}
              type="button"
              disabled={placing}
              onClick={placeOrder}
            >
              {placing ? (
                <>
                  <LoaderCircle className="spin" size={16} /> Processing…
                </>
              ) : isReadyForPayment ? (
                <>
                  <Check size={17} /> I have paid · {formatNaira(grandTotal)} <ArrowRight size={17} />
                </>
              ) : (
                <>
                  Ready to print? {formatNaira(grandTotal)} <ArrowRight size={17} />
                </>
              )}
            </button>

            <p className="checkout-footnote">
              {isReadyForPayment
                ? "Once you've made your bank transfer, tap 'I have paid' to send your order into the print queue."
                : "Select your hostel and enter your phone number to reveal transfer account details."}
            </p>
          </>
        )}

        {/* Quotation preview & download modal */}
        <QuotationModal
          isOpen={showQuotation}
          onClose={() => setShowQuotation(false)}
          orderId={existingOrderId || "CP-QUOTE"}
          customer={draft.customer}
          phone={phone}
          area={area}
          location={location}
          fulfilment={fulfilment}
          quote={quote}
          total={grandTotal}
          sides={quote.anyDuplex ? "Front & back" : "Single-sided"}
          stapling={quote.anyStapled ? "Stapled" : undefined}
          binding={quote.anyBound ? "Spiral bound" : undefined}
        />
      </div>
    </main>
  );
}
