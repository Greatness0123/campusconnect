"use client";

import {
  AlertCircle,
  ArrowLeft,
  Bell,
  Check,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  Printer,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { DEMO_ORDERS_KEY, type DemoOrder, readDemoOrders } from "@/lib/demo-orders";
import {
  supabase,
  isSupabaseConfigured,
  getDocumentSignedUrl,
  type OrderRecord,
  type OrderDocumentRecord,
} from "@/lib/supabase";

type OrderFilter = "All" | "New" | "Printing" | "Ready" | "Completed";

function formatNaira(amount: number) {
  return `₦${Number(amount).toLocaleString("en-NG")}`;
}

// Simple browser audio chime for new incoming orders
function playAlertChime() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // Audio context may require interaction first
  }
}

export default function AdminPage() {
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [filter, setFilter] = useState<OrderFilter>("All");
  const [newOrderAlert, setNewOrderAlert] = useState<string | null>(null);
  const [keepAliveLoading, setKeepAliveLoading] = useState(false);
  const [keepAliveStatus, setKeepAliveStatus] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    // 1. If Supabase is connected, fetch live orders from database
    if (supabase && isSupabaseConfigured) {
      try {
        const { data: dbOrders, error } = await supabase
          .from("orders")
          .select("*, order_documents(*)")
          .order("created_at", { ascending: false });

        if (!error && dbOrders && dbOrders.length > 0) {
          const mapped: DemoOrder[] = dbOrders.map((o) => ({
            id: o.id,
            customer: o.customer_name,
            createdAt: o.created_at,
            status: o.status as DemoOrder["status"],
            total: o.total_amount,
            area: o.pickup_area,
            location: o.pickup_location,
            printMode: o.print_mode,
            sides: o.sides,
            stapling: o.stapling,
            binding: o.binding,
            documents: (o.order_documents || []).map((d: OrderDocumentRecord) => ({
              name: d.file_name,
              pages: d.total_pages,
              selectedPages: d.selected_pages === "all" ? [] : [1],
              copies: o.copies || 1,
              filePath: d.file_path,
            })),
          }));
          setOrders(mapped);
          return;
        }
      } catch (err) {
        console.warn("Failed to fetch from Supabase:", err);
      }
    }

    // 2. Fallback to localStorage orders
    setOrders(readDemoOrders());
  }, []);

  useEffect(() => {
    void fetchOrders();

    // Setup Supabase Realtime subscription
    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;
    if (supabase && isSupabaseConfigured) {
      channel = supabase
        .channel("admin-orders-stream")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "orders" },
          (payload) => {
            playAlertChime();
            const newOrder = payload.new as OrderRecord;
            setNewOrderAlert(`New order ${newOrder.id} from ${newOrder.customer_name}!`);
            void fetchOrders();
          }
        )
        .subscribe();
    }

    // Fallback polling every 4 seconds for local/demo storage
    const interval = window.setInterval(fetchOrders, 4000);
    window.addEventListener("storage", fetchOrders);

    return () => {
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
      window.clearInterval(interval);
      window.removeEventListener("storage", fetchOrders);
    };
  }, [fetchOrders]);

  async function changeStatus(id: string, status: DemoOrder["status"]) {
    // Update local state
    const updated = orders.map((o) => (o.id === id ? { ...o, status } : o));
    setOrders(updated);
    localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify(updated));

    // Update Supabase if active
    if (supabase && isSupabaseConfigured) {
      try {
        await supabase.from("orders").update({ status }).eq("id", id);
      } catch (err) {
        console.warn("Failed to update status in Supabase:", err);
      }
    }
  }

  async function fetchDocument(docName: string, filePath?: string) {
    if (!filePath || !supabase || !isSupabaseConfigured) {
      alert(`Document "${docName}" preview/download is available when Supabase Storage is configured.`);
      return;
    }

    setDownloadingId(filePath);
    const signedUrl = await getDocumentSignedUrl(filePath);
    setDownloadingId(null);

    if (signedUrl) {
      window.open(signedUrl, "_blank");
    } else {
      alert("Could not generate download URL for this document. It may have expired or not yet uploaded.");
    }
  }

  async function testKeepAlive() {
    setKeepAliveLoading(true);
    try {
      const res = await fetch("/api/keep-alive");
      const data = await res.json();
      setKeepAliveStatus(data.message || `Status: ${data.status}`);
    } catch {
      setKeepAliveStatus("Keep-alive ping failed. Check network.");
    } finally {
      setKeepAliveLoading(false);
    }
  }

  const visibleOrders = filter === "All" ? orders : orders.filter((o) => o.status === filter);
  const newCount = orders.filter((o) => o.status === "New").length;
  const printingCount = orders.filter((o) => o.status === "Printing").length;
  const readyCount = orders.filter((o) => o.status === "Ready").length;
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);

  return (
    <main className="admin-shell">
      <AppHeader />

      <div className="admin-container">
        {/* Header Row */}
        <div className="admin-header-row">
          <div>
            <p className="welcome-eyebrow" style={{ margin: "0 0 6px" }}>
              CAMPUS PRINTS · PRINT OPERATOR CONSOLE
            </p>
            <h1>
              Print Queue
              <span className="admin-badge-count">{orders.length}</span>
            </h1>
            <p className="setting-desc">
              Real-time incoming print requests and customer document fetching.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="admin-action-btn" type="button" onClick={testKeepAlive} disabled={keepAliveLoading}>
              <RefreshCw size={14} className={keepAliveLoading ? "spin" : ""} />
              {keepAliveLoading ? "Pinging…" : "Test Keep-Alive"}
            </button>
            <Link className="admin-action-btn primary" href="/">
              <ArrowLeft size={14} /> Student View
            </Link>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="admin-quick-stats">
          <div className="admin-stat-card highlight">
            <span className="stat-label">Total Orders</span>
            <span className="admin-stat-value">{orders.length}</span>
            <span className="admin-stat-sub">All time in queue</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">New</span>
            <span className="admin-stat-value">{newCount}</span>
            <span className="admin-stat-sub">Awaiting action</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">Printing</span>
            <span className="admin-stat-value">{printingCount}</span>
            <span className="admin-stat-sub">In progress</span>
          </div>
          <div className="admin-stat-card accent-success">
            <span className="stat-label">Ready</span>
            <span className="admin-stat-value">{readyCount}</span>
            <span className="admin-stat-sub">Awaiting pickup</span>
          </div>
        </div>

        {/* Real-time Order Alert Banner */}
        {newOrderAlert && (
          <div
            className="admin-alert"
            style={{
              borderColor: "var(--text)",
              background: "var(--surface-raised)",
              marginBottom: 18,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Bell size={18} />
              <strong style={{ margin: 0 }}>{newOrderAlert}</strong>
            </div>
            <button
              className="doc-close-btn"
              type="button"
              onClick={() => setNewOrderAlert(null)}
            >
              ×
            </button>
          </div>
        )}

        {/* Keep-Alive Status Message */}
        {keepAliveStatus && (
          <div className="admin-alert" style={{ marginBottom: 18 }}>
            <RefreshCw size={16} />
            <div>
              <strong>Keep-Alive System</strong>
              <p>{keepAliveStatus} (Scheduled 3x daily at 06:00, 14:00, 22:00 UTC)</p>
            </div>
          </div>
        )}

        {/* Supabase status notice */}
        <section
          className="admin-alert"
          style={{ marginBottom: 20 }}
        >
          <AlertCircle size={18} />
          <div>
            <strong>
              {isSupabaseConfigured ? "Supabase Live Synchronization Connected" : "Local Preview Queue Active"}
            </strong>
            <p>
              {isSupabaseConfigured
                ? "Listening for live orders and ready to fetch documents directly from Supabase Storage bucket."
                : "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local to enable remote database storage and real-time alerts."}
            </p>
          </div>
        </section>

        {/* Filters */}
        <div className="admin-filters">
          {(["All", "New", "Printing", "Ready"] as const).map((item) => (
            <button
              key={item}
              className={`all-pages-pill ${filter === item ? "active" : ""}`}
              style={{ height: 36, padding: "0 14px" }}
              type="button"
              onClick={() => setFilter(item)}
            >
              {item}
              {item === "All"
                ? ` (${orders.length})`
                : ` (${orders.filter((o) => o.status === item).length})`}
            </button>
          ))}
        </div>

        {/* Orders Table */}
        <div className="admin-table-container">
          {visibleOrders.length === 0 ? (
            <div className="admin-empty">
              <FileText size={32} />
              <h2>No {filter === "All" ? "orders" : filter.toLowerCase()} in queue</h2>
              <p>When students submit print requests, they will appear here instantly.</p>
            </div>
          ) : (
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Order / Time</th>
                  <th>Student &amp; Pickup</th>
                  <th>Documents to Print</th>
                  <th>Specifications</th>
                  <th>Estimate</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.id}</strong>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                        {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </small>
                    </td>
                    <td>
                      <strong>{order.customer}</strong>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                        {order.area} · {order.location}
                      </small>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 6 }}>
                        {order.documents.map((doc, idx) => (
                          <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <FileText size={14} />
                            <span>
                              {doc.name} ({doc.pages} pages × {doc.copies} copy)
                            </span>
                            {/* Fetch Document to Print button */}
                            <button
                              className="admin-action-btn"
                              style={{ height: 26, padding: "0 10px", fontSize: 11 }}
                              type="button"
                              onClick={() =>
                                fetchDocument(
                                  doc.name,
                                  (doc as unknown as { filePath?: string }).filePath
                                )
                              }
                              title="Fetch document file to print"
                            >
                              <Download size={12} />
                              {downloadingId === (doc as unknown as { filePath?: string }).filePath
                                ? "Fetching…"
                                : "Fetch"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div>{order.printMode}</div>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                        {order.sides} · {order.stapling} · {order.binding}
                      </small>
                    </td>
                    <td>
                      <strong>{formatNaira(order.total)}</strong>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                        Cash on pickup
                      </small>
                    </td>
                    <td>
                      <span className={`status-pill ${order.status}`}>{order.status}</span>
                    </td>
                    <td>
                      {order.status === "New" && (
                        <button
                          className="admin-action-btn primary"
                          type="button"
                          onClick={() => changeStatus(order.id, "Printing")}
                        >
                          <Printer size={13} /> Start Print
                        </button>
                      )}
                      {order.status === "Printing" && (
                        <button
                          className="admin-action-btn primary"
                          type="button"
                          onClick={() => changeStatus(order.id, "Ready")}
                        >
                          <Check size={13} /> Mark Ready
                        </button>
                      )}
                      {order.status === "Ready" && (
                        <span style={{ fontSize: 12, color: "var(--success)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Check size={14} />
                          Ready for pickup
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Revenue summary */}
        {orders.length > 0 && (
          <div style={{ marginTop: 16, textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
            Estimated queue value:{" "}
            <strong style={{ color: "var(--text)", fontSize: 14 }}>{formatNaira(totalRevenue)}</strong>
          </div>
        )}
      </div>
    </main>
  );
}