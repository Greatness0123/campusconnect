"use client";

import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  Download,
  FileText,
  Lock,
  Printer,
  RefreshCw,
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

type OrderFilter = "Active" | "New" | "Printing" | "Ready" | "Completed";

const TOKEN_KEY = "campusprints:ccadmin-token";

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

async function notifyNewOrder(title: string, body: string) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const options = {
      body,
      icon: "/icononly.png",
      badge: "/pwa-192.png",
      tag: "campusprints-new-order",
      data: { url: "/ccadmin" },
    };

    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }

    new Notification(title, options);
  } catch {
    // Notifications unavailable
  }
}

export default function AdminPage() {
  // --- Access gate (verified server-side; passphrase never in this bundle) ---
  const [authState, setAuthState] = useState<"checking" | "locked" | "unlocked">("checking");
  const [passphrase, setPassphrase] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // --- Notifications ---
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">("default");

  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [totalOrderCount, setTotalOrderCount] = useState<number | null>(null);
  const [orderLoadError, setOrderLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>("Active");
  const [newOrderAlert, setNewOrderAlert] = useState<string | null>(null);
  const [keepAliveLoading, setKeepAliveLoading] = useState(false);
  const [keepAliveStatus, setKeepAliveStatus] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Verify an existing session token against the server on mount.
  useEffect(() => {
    let cancelled = false;
    async function verify() {
      let token: string | null = null;
      try {
        token = sessionStorage.getItem(TOKEN_KEY);
      } catch {
        token = null;
      }
      if (!token) {
        if (!cancelled) setAuthState("locked");
        return;
      }
      try {
        const res = await fetch(`/api/ccadmin-auth?token=${encodeURIComponent(token)}`);
        const data = (await res.json()) as { valid?: boolean };
        if (cancelled) return;
        if (data.valid) {
          setAuthState("unlocked");
        } else {
          sessionStorage.removeItem(TOKEN_KEY);
          setAuthState("locked");
        }
      } catch {
        if (!cancelled) setAuthState("locked");
      }
    }
    void verify();
    return () => {
      cancelled = true;
    };
  }, []);

  // Track notification permission once unlocked.
  useEffect(() => {
    if (authState !== "unlocked") return;
    if (typeof Notification === "undefined") {
      setNotifPermission("unsupported");
      return;
    }
    setNotifPermission(Notification.permission);
  }, [authState]);

  async function submitPassphrase(event: React.FormEvent) {
    event.preventDefault();
    if (verifying) return;
    setVerifying(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/ccadmin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passphrase }),
      });
      const data = (await res.json()) as { ok?: boolean; token?: string; error?: string };
      if (data.ok && data.token) {
        sessionStorage.setItem(TOKEN_KEY, data.token);
        setPassphrase("");
        setAuthState("unlocked");
      } else {
        setAuthError(data.error || "Incorrect passphrase.");
      }
    } catch {
      setAuthError("Could not verify passphrase. Check your connection.");
    } finally {
      setVerifying(false);
    }
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
    } catch {
      // ignore
    }
  }

  const fetchOrders = useCallback(async () => {
    // 1. If Supabase is connected, fetch live orders from database
    if (supabase && isSupabaseConfigured) {
      try {
        const { data: dbOrders, error, count } = await supabase
          .from("orders")
          .select("*, order_documents(*)", { count: "exact" })
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (dbOrders) {
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
          setTotalOrderCount(count ?? dbOrders.length);
          setOrderLoadError(null);
          return;
        }
      } catch (err) {
        console.warn("Failed to fetch from Supabase:", err);
        setOrders([]);
        setTotalOrderCount(null);
        setOrderLoadError("Could not load orders from the database. Check the connection and try again.");
        return;
      }
    }

    // 2. Fallback to localStorage orders
    const demoOrders = readDemoOrders();
    setOrders(demoOrders);
    setTotalOrderCount(demoOrders.length);
    setOrderLoadError(null);
  }, []);

  // Load + subscribe to live orders only after the gate is unlocked.
  useEffect(() => {
    if (authState !== "unlocked") return;

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
            notifyNewOrder(
              "New print order",
              `Order ${newOrder.id} from ${newOrder.customer_name} just came in.`
            );
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
  }, [authState, fetchOrders]);

  async function changeStatus(id: string, status: DemoOrder["status"]) {
    setStatusError(null);
    if (supabase && isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from("orders")
          .update({ status })
          .eq("id", id)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("The order was not found in the database.");
        setOrders((current) =>
          current.map((order) => (order.id === id ? { ...order, status } : order))
        );
      } catch (err) {
        console.warn("Failed to update status in Supabase:", err);
        setStatusError(
          err instanceof Error ? `Status update failed: ${err.message}` : "Status update failed. Check the connection and try again."
        );
      }
      return;
    }

    const updated = orders.map((order) => (order.id === id ? { ...order, status } : order));
    setOrders(updated);
    localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify(updated));
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

  // --- Locked: password screen (no admin data is loaded or rendered) ---
  if (authState === "checking") {
    return (
      <main className="admin-shell">
        <AppHeader compact />
        <div className="auth-gate">
          <p className="setting-desc">Verifying access…</p>
        </div>
      </main>
    );
  }

  if (authState === "locked") {
    return (
      <main className="admin-shell">
        <AppHeader compact />
        <div className="auth-gate">
          <form className="auth-card" onSubmit={submitPassphrase}>
            <div className="auth-icon">
              <Lock size={20} />
            </div>
            <p className="welcome-eyebrow">RESTRICTED</p>
            <h1 className="auth-title">Operator Console</h1>
            <p className="auth-subtitle">Enter the operator passphrase to continue.</p>
            <input
              className="pill-input auth-input"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="Passphrase"
              autoFocus
            />
            {authError && <p className="auth-error">{authError}</p>}
            <button className="pill-button" type="submit" disabled={verifying || !passphrase}>
              {verifying ? "Verifying…" : "Unlock console"}
            </button>
            <Link className="auth-back" href="/">
              <ArrowLeft size={13} /> Back to student view
            </Link>
          </form>
        </div>
      </main>
    );
  }

  const activeOrders = orders.filter((order) => order.status !== "Completed");
  const visibleOrders = filter === "Active" ? activeOrders : orders.filter((o) => o.status === filter);
  const newCount = orders.filter((o) => o.status === "New").length;
  const printingCount = orders.filter((o) => o.status === "Printing").length;
  const readyCount = orders.filter((o) => o.status === "Ready").length;
  const totalRevenue = activeOrders.reduce((sum, order) => sum + (order.total || 0), 0);

  return (
    <main className="admin-shell">
      <AppHeader showOrders={false} />

      <div className="admin-container">
        {/* Header Row */}
        <div className="admin-header-row">
          <div>
            {/* <p className="welcome-eyebrow" style={{ margin: "0 0 6px" }}>
              CAMPUS PRINTS · PRINT OPERATOR CONSOLE
            </p> */}
            <h1>
              Print Queue
              <span className="admin-badge-count">{orders.length}</span>
            </h1>
            {/* <p className="setting-desc">
              Real-time incoming print requests and customer document fetching.
            </p> */}
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

        {/* Notification opt-in (admin only) */}
        {(notifPermission === "default" || notifPermission === "denied" || notifPermission === "unsupported") && (
          <div className="admin-alert" style={{ marginBottom: 18 }}>
            <BellRing size={18} />
            <div style={{ flex: 1 }}>
              <strong>Browser notifications</strong>
              <p>
                {notifPermission === "denied"
                  ? "Notifications are blocked. Allow them in your browser site settings to get new-order alerts."
                  : notifPermission === "unsupported"
                    ? "This browser does not support notifications."
                    : "Get an alert on this device whenever a new print order arrives. On iPhone or iPad, add the app to your Home Screen first."}
              </p>
            </div>
            {notifPermission === "default" && (
              <button className="admin-action-btn primary" type="button" onClick={enableNotifications}>
                <Bell size={13} /> Enable
              </button>
            )}
          </div>
        )}

        {/* Quick Stats */}
        <div className="admin-quick-stats">
          <div className="admin-stat-card highlight">
            <span className="stat-label">Total Orders</span>
            <span className="admin-stat-value">{totalOrderCount ?? "—"}</span>
            <span className="admin-stat-sub">
              {orderLoadError ? "Database unavailable" : isSupabaseConfigured ? "All database records" : "All local orders"}
            </span>
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

        {statusError && (
          <div className="admin-alert" role="alert" style={{ marginBottom: 18 }}>
            <AlertCircle size={16} />
            <p>{statusError}</p>
          </div>
        )}

        {orderLoadError && (
          <div className="admin-alert" role="alert" style={{ marginBottom: 18 }}>
            <AlertCircle size={16} />
            <p>{orderLoadError}</p>
          </div>
        )}

        {/* Supabase status notice */}
        {/* <section className="admin-alert" style={{ marginBottom: 20 }}>
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
        </section> */}

        {/* Filters */}
        <div className="admin-filters">
          {(["Active", "New", "Printing", "Ready", "Completed"] as const).map((item) => (
            <button
              key={item}
              className={`all-pages-pill ${filter === item ? "active" : ""}`}
              type="button"
              onClick={() => setFilter(item)}
            >
              {item}
              {item === "Active"
                ? ` (${activeOrders.length})`
                : ` (${orders.filter((o) => o.status === item).length})`}
            </button>
          ))}
        </div>

        {/* Orders Table */}
        <div className="admin-table-container">
          {visibleOrders.length === 0 ? (
            <div className="admin-empty">
              <FileText size={32} />
              <h2>No {filter === "Active" ? "active orders" : filter.toLowerCase()} in queue</h2>
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
                            <span className="admin-document-name">
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
                        <button
                          className="admin-action-btn primary"
                          type="button"
                          onClick={() => changeStatus(order.id, "Completed")}
                        >
                          <Check size={13} /> Mark Collected
                        </button>
                      )}
                      {order.status === "Completed" && (
                        <span className="admin-completed-action" style={{ fontSize: 12, color: "var(--success)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Check size={14} /> Completed
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
