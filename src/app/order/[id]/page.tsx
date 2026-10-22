"use client";

import { Check, Copy, LoaderCircle, Star } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { readDemoOrders, type DemoOrder } from "@/lib/demo-orders";
import { formatNaira } from "@/lib/print";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const STEPS = [
  { key: "New", label: "Received", desc: "Your order is in the print queue" },
  { key: "Printing", label: "Printing", desc: "We're printing your pages now" },
  { key: "Ready", label: "Ready for pickup", desc: "Collect at your pickup spot" },
] as const;

const feedbackKey = (id: string) => `campusprints:order-feedback:${id}`;

type Feedback = { rating: number; message: string };

export default function OrderTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [message, setMessage] = useState("");
  const [savedFeedback, setSavedFeedback] = useState<Feedback | null>(null);

  const loadOrder = useCallback(async () => {
    const local = readDemoOrders().find((o) => o.id === id);
    if (local) {
      setOrder(local);
      setLoading(false);
      return;
    }
    if (supabase && isSupabaseConfigured) {
      try {
        const { data } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
        if (data) {
          setOrder({
            id: data.id,
            customer: data.customer_name,
            createdAt: data.created_at,
            status: data.status as DemoOrder["status"],
            documents: [],
            total: data.total_amount,
            area: data.pickup_area,
            location: data.pickup_location,
            printMode: data.print_mode,
            sides: data.sides,
            stapling: data.stapling,
            binding: data.binding,
          });
        }
      } catch {
        // ignore — fall through to not-found state
      }
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  // Live refresh: same-tab admin changes + storage events from other tabs.
  useEffect(() => {
    const refresh = () => {
      const found = readDemoOrders().find((o) => o.id === id);
      if (found) setOrder(found);
    };
    const interval = window.setInterval(refresh, 3000);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", refresh);
    };
  }, [id]);

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

  const stepIndex = order.status === "New" ? 0 : order.status === "Printing" ? 1 : 2;
  const heading =
    order.status === "Ready"
      ? "Your print is ready!"
      : order.status === "Printing"
        ? "We're printing your pages"
        : "You're officially in the queue";

  return (
    <main className="app-shell">
      <AppHeader compact />

      <div className="order-page">
        <div className="order-hero">
          <p className="welcome-eyebrow">ORDER STATUS</p>
          <h1 className="order-title">{heading}</h1>
          <div className="order-id-row">
            <span className="order-id">{order.id}</span>
            <button className="order-copy-btn" type="button" onClick={copyId}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        {/* Status stepper */}
        <div className="order-card">
          <div className="status-stepper">
            {STEPS.map((step, index) => (
              <div
                key={step.key}
                className={`status-step ${index < stepIndex ? "done" : ""} ${
                  index === stepIndex ? "current" : ""
                }`}
              >
                <div className="status-dot">{index <= stepIndex ? <Check size={14} /> : index + 1}</div>
                <div className="status-meta">
                  <strong>{step.label}</strong>
                  <span>{step.desc}</span>
                </div>
              </div>
            ))}
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
            <div className="order-doc-row" key={`${doc.name}-${index}`}>
              <span className="order-doc-name" title={doc.name}>
                {doc.name}
              </span>
              <span>
                {doc.pages}p × {doc.copies}
              </span>
            </div>
          ))}
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
      </div>
    </main>
  );
}
