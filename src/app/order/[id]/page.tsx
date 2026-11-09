"use client";

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  LoaderCircle,
  Star,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { QuotationModal } from "@/components/quotation-modal";
import { ReceiptUploadModal } from "@/components/receipt-upload-modal";
import { readDemoOrders, type DemoOrder, type DemoOrderDocument } from "@/lib/demo-orders";
import { getPlacedOrderDraft } from "@/lib/order-draft";
import { formatNaira, type LocationArea } from "@/lib/print";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const STEPS = [
  { key: "New", label: "Received", desc: "Your order is in the print queue" },
  { key: "Printing", label: "Printing", desc: "We're printing your pages now" },
  { key: "Ready", label: "Ready for pickup", desc: "Collect at your pickup spot" },
  { key: "Completed", label: "Completed", desc: "Your order has been collected" },
] as const;

const feedbackKey = (id: string) => `campusprints:order-feedback:${id}`;

type Feedback = { rating: number; message: string };

export default function OrderTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [message, setMessage] = useState("");
  const [savedFeedback, setSavedFeedback] = useState<Feedback | null>(null);
  const [showQuotation, setShowQuotation] = useState(false);
  const [dismissedUnpaidModal, setDismissedUnpaidModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptUploaded, setReceiptUploaded] = useState(false);

function enrichOrderDocuments(order: DemoOrder): DemoOrder {
  const placedDraft = getPlacedOrderDraft(order.id);
  const enrichedDocs = order.documents.map((doc, idx) => {
    const draftFile =
      placedDraft?.files.find((f) => f.file?.name === doc.name) ||
      placedDraft?.files[idx];

    const colorMode =
      doc.colorMode ||
      (draftFile?.colorMode
        ? draftFile.colorMode === "keep"
          ? "Colour"
          : "Black & white"
        : undefined);

    const sides =
      doc.sides ||
      (draftFile?.sides
        ? draftFile.sides === "duplex"
          ? "Front & back"
          : "Single-sided"
        : undefined);

    const stapling =
      doc.stapling ||
      (draftFile?.stapled !== undefined
        ? draftFile.stapled
          ? "Stapled"
          : "No stapling"
        : undefined);

    const binding =
      doc.binding ||
      (draftFile?.bound !== undefined
        ? draftFile.bound
          ? "Binding added"
          : "No binding"
        : undefined);

    const pageSelection =
      doc.pageSelection ||
      (draftFile?.pageSelection && draftFile.pageSelection !== "all"
        ? draftFile.pageSelection
        : undefined);

    const copies = doc.copies || draftFile?.copies || 1;

    return {
      ...doc,
      colorMode,
      sides,
      stapling,
      binding,
      pageSelection,
      copies,
    };
  });

  return { ...order, documents: enrichedDocs };
}

  const loadOrder = useCallback(async () => {
    if (supabase && isSupabaseConfigured) {
      try {
        const { data } = await supabase
          .from("orders")
          .select("*, order_documents(*)")
          .eq("id", id)
          .maybeSingle();
        if (data) {
          const isUnpaid = data.status === "Payment Not Received";
          const rawDocs = (data.order_documents ?? []).map((document: {
            file_name: string;
            total_pages: number;
            selected_pages?: string;
            color_pages?: number;
          }) => {
            let parsedSpec: Partial<DemoOrderDocument> = {};
            if (document.selected_pages && document.selected_pages.startsWith("{")) {
              try {
                const parsed = JSON.parse(document.selected_pages);
                parsedSpec = {
                  colorMode: parsed.colorMode,
                  sides: parsed.sides,
                  stapling: parsed.stapling,
                  binding: parsed.binding,
                  pageSelection: parsed.selection,
                  copies: parsed.copies,
                };
              } catch {
                // ignore
              }
            }

            return {
              name: document.file_name,
              pages: document.total_pages,
              selectedPages: [],
              copies: parsedSpec.copies || data.copies || 1,
              colorMode: parsedSpec.colorMode || ((document.color_pages ?? 0) > 0 ? "Colour" : "Black & white"),
              sides: parsedSpec.sides || data.sides,
              stapling: parsedSpec.stapling || data.stapling,
              binding: parsedSpec.binding || data.binding,
              pageSelection: parsedSpec.pageSelection || (document.selected_pages !== "all" ? document.selected_pages : undefined),
            };
          });

          setOrder(
            enrichOrderDocuments({
              id: data.id,
              customer: data.customer_name,
              createdAt: data.created_at,
              status: data.status as DemoOrder["status"],
              paymentNotReceived: isUnpaid,
              documents: rawDocs,
              total: data.total_amount,
              area: data.pickup_area,
              location: data.pickup_location,
              printMode: data.print_mode,
              sides: data.sides,
              stapling: data.stapling,
              binding: data.binding,
            })
          );
          setLoading(false);
          return;
        }
      } catch {
        // Fall back to the local order if the network is unavailable.
      }
    }
    const local = readDemoOrders().find((o) => o.id === id) ?? null;
    if (local && (local.status === "Payment Not Received" || local.paymentNotReceived)) {
      local.paymentNotReceived = true;
    }
    setOrder(local ? enrichOrderDocuments(local) : null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  // Poll the authoritative order so tracking works without Realtime delivery.
  useEffect(() => {
    const refresh = () => void loadOrder();
    const interval = window.setInterval(refresh, 5000);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [loadOrder]);

  // Live refresh: Supabase realtime row updates.
  useEffect(() => {
    const client = supabase;
    if (!client || !isSupabaseConfigured) return;
    const channel = client
      .channel(`order-status-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${id}` },
        () => {
          void loadOrder();
        }
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [id, loadOrder]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(feedbackKey(id));
      if (raw) {
        const fb = JSON.parse(raw) as Feedback;
        setSavedFeedback(fb);
        setRating(fb.rating);
        setMessage(fb.message);
      }
    } catch {
      // ignore
    }
  }, [id]);

  function copyId() {
    void navigator.clipboard?.writeText(id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  function saveFeedback(event: React.FormEvent) {
    event.preventDefault();
    if (rating < 1) return;
    const fb = { rating, message: message.trim() };
    try {
      localStorage.setItem(feedbackKey(id), JSON.stringify(fb));
    } catch {
      // ignore
    }
    setSavedFeedback(fb);
  }

  if (loading) {
    return (
      <main className="app-shell">
        <AppHeader compact />
        <div className="order-loading">
          <LoaderCircle className="spin" size={18} /> Finding your order…
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="app-shell">
        <AppHeader compact />
        <div className="order-page">
          <div className="order-card order-missing">
            <h1>Order not found</h1>
            <p className="setting-desc">
              We couldn&apos;t find <strong>{id}</strong> on this device. Try refreshing, or contact
              the print desk with your order id.
            </p>
            <Link className="pill-button" href="/">
              Start a new print
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const isPaymentNotReceived =
    order.status === "Payment Not Received" || Boolean(order.paymentNotReceived);

  const stepIndex =
    order.status === "New"
      ? 0
      : order.status === "Printing"
      ? 1
      : order.status === "Ready"
      ? 2
      : order.status === "Completed"
      ? 3
      : 0;

  const heading = isPaymentNotReceived
    ? "Payment not received"
    : order.status === "Completed"
    ? "Order completed"
    : order.status === "Ready"
    ? "Your print is ready!"
    : order.status === "Printing"
    ? "We're printing your pages"
    : "You're officially smart";

  return (
    <main className="app-shell">
      <AppHeader compact />

      <div className="order-page">
        {/* Payment not received banner */}
        {isPaymentNotReceived && (
          <div className="order-unpaid-banner">
            <AlertTriangle size={18} />
            <div className="order-unpaid-text">
              <strong>Payment not received</strong>
              <span>The print operator flagged this order as unpaid. Please verify your transfer.</span>
              {!receiptUploaded ? (
                <button
                  type="button"
                  className="receipt-already-paid-link"
                  onClick={() => setShowReceiptModal(true)}
                >
                  Already paid? Click here to upload your receipt
                </button>
              ) : (
                <span className="receipt-sent-confirm">
                  <Check size={12} /> Receipt sent — awaiting operator verification
                </span>
              )}
            </div>
            <button
              type="button"
              className="admin-action-btn primary"
              onClick={() => router.push(`/checkout?orderId=${order.id}`)}
            >
              Return to payment
            </button>
          </div>
        )}

        <div className="order-hero">
          <p className="welcome-eyebrow">ORDER STATUS</p>
          <h1 className="order-title">{heading}</h1>
          <div className="order-id-row">
            <span className="order-id">{order.id}</span>
            <button className="order-copy-btn" type="button" onClick={copyId}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className="order-copy-btn order-quote-btn"
              type="button"
              onClick={() => setShowQuotation(true)}
              title="Download official quotation preview"
            >
              <Download size={13} />
              Quotation
            </button>
          </div>
        </div>

        {/* Status stepper */}
        <div className="order-card">
          <div className="status-stepper">
            {STEPS.map((step, index) => {
              const isCompleted = order.status === "Completed";
              const isDone = isCompleted ? true : index < stepIndex;
              const isCurrent = !isCompleted && index === stepIndex && !isPaymentNotReceived;
              return (
                <div
                  key={step.key}
                  className={`status-step ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}`}
                >
                  <div className="status-dot">{isDone || isCurrent ? <Check size={14} /> : index + 1}</div>
                  <div className="status-meta">
                    <strong>{step.label}</strong>
                    <span>{step.desc}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Order summary */}
        <div className="order-card">
          <div className="order-summary-row">
            <span>Total</span>
            <strong>{formatNaira(order.total)}</strong>
          </div>
          <div className="order-summary-row">
            <span>Documents</span>
            <strong>
              {order.documents.length} · {order.printMode}
            </strong>
          </div>
          <div className="order-summary-row">
            <span>Pickup</span>
            <strong>
              {order.area} · {order.location}
            </strong>
          </div>
          <div className="order-summary-row">
            <span>Specs</span>
            <strong>
              {order.sides} · {order.stapling} · {order.binding}
            </strong>
          </div>
          {order.documents.map((doc, index) => (
            <div className="order-doc-row" key={`${doc.name}-${index}`} style={{ flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                <span className="order-doc-name" title={doc.name}>
                  {order.documents.length > 1 && (
                    <span style={{ color: "var(--accent, #6366f1)", fontSize: 11, fontWeight: 700, marginRight: 6 }}>
                      #{index + 1}
                    </span>
                  )}
                  {doc.name}
                </span>
                <span>
                  {doc.pages}p × {doc.copies}
                </span>
              </div>
              {(doc.colorMode || doc.sides || doc.stapling || doc.binding) && (
                <small style={{ color: "var(--muted)", fontSize: 11 }}>
                  {[
                    doc.colorMode,
                    doc.sides,
                    doc.stapling,
                    doc.binding,
                    doc.pageSelection && doc.pageSelection !== "all" ? `Pages: ${doc.pageSelection}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              )}
            </div>
          ))}

          {/* Persistent memory return to payment row — hidden once collected */}
          {order.status !== "Completed" && (
          <div className="order-return-payment-box">
            <div className="order-return-payment-info">
              <strong>Need to make or verify payment?</strong>
              <small>Your order specifications and account details are saved in memory.</small>
            </div>
            <button
              type="button"
              className="admin-action-btn"
              onClick={() => router.push(`/checkout?orderId=${order.id}`)}
            >
              <ArrowLeft size={13} /> Return to payment
            </button>
          </div>
          )}
        </div>

        {/* Feedback */}
        <div className="order-card">
          <h3 className="setting-title">How did we do?</h3>
          {savedFeedback ? (
            <div className="feedback-thanks">
              <Check size={14} /> Thanks for the feedback{savedFeedback.message ? "!" : "!"}
            </div>
          ) : (
            <form className="feedback-form" onSubmit={saveFeedback}>
              <div className="feedback-stars">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    className={`star-btn ${value <= (hoverRating || rating) ? "active" : ""}`}
                    type="button"
                    aria-label={`${value} star${value === 1 ? "" : "s"}`}
                    onClick={() => setRating(value)}
                    onMouseEnter={() => setHoverRating(value)}
                    onMouseLeave={() => setHoverRating(0)}
                  >
                    <Star size={22} fill={value <= (hoverRating || rating) ? "currentColor" : "none"} />
                  </button>
                ))}
              </div>
              <textarea
                className="feedback-textarea"
                value={message}
                maxLength={400}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Anything we should know? (optional)"
              />
              <button className="pill-button" type="submit" disabled={rating < 1}>
                Send feedback
              </button>
            </form>
          )}
        </div>

        <Link className="order-home-link" href="/">
          Print something else
        </Link>

        {/* Quotation preview & download modal */}
        <QuotationModal
          isOpen={showQuotation}
          onClose={() => setShowQuotation(false)}
          orderId={order.id}
          customer={order.customer}
          phone={order.phone}
          area={order.area as LocationArea}
          location={order.location}
          fulfilment={order.fulfilment}
          date={order.createdAt}
          documents={order.documents}
          total={order.total}
          printMode={order.printMode}
          sides={order.sides}
          stapling={order.stapling}
          binding={order.binding}
        />

        {/* Responsive bottom half-modal: Payment Not Received */}
        {isPaymentNotReceived && !dismissedUnpaidModal && (
          <div className="bottom-modal-backdrop" onClick={() => setDismissedUnpaidModal(true)}>
            <div className="bottom-half-modal" onClick={(e) => e.stopPropagation()}>
              <div className="bottom-modal-handle" />
              <div className="bottom-modal-head">
                <div className="bottom-modal-badge">
                  <AlertTriangle size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <h3>Payment not received</h3>
                  <small>Operator Alert · {order.id}</small>
                </div>
                <button
                  type="button"
                  className="doc-close-btn"
                  onClick={() => setDismissedUnpaidModal(true)}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="bottom-modal-msg">
                Payment has not been received for your print order yet. Return to the payment page to verify the hostel account details and complete your transfer?
              </p>

              <div className="bottom-modal-buttons">
                <button
                  type="button"
                  className="pill-button bottom-modal-primary-btn"
                  onClick={() => router.push(`/checkout?orderId=${order.id}`)}
                >
                  Return to the payment page
                </button>
                <button
                  type="button"
                  className="pill-button pill-button-outline"
                  onClick={() => setDismissedUnpaidModal(true)}
                >
                  I&apos;ve already sent it / Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Receipt upload modal */}
      {showReceiptModal && (
        <ReceiptUploadModal
          orderId={order.id}
          onClose={() => setShowReceiptModal(false)}
          onUploaded={() => {
            setReceiptUploaded(true);
            setShowReceiptModal(false);
          }}
        />
      )}
    </main>
  );
}
