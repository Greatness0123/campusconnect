"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { readDemoOrders, type DemoOrder } from "@/lib/demo-orders";
import { formatNaira } from "@/lib/print";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export default function OrdersPage() {
  const [deviceId, setDeviceId] = useState("");
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    if (!deviceId) return;
    const localOrders = readDemoOrders().filter((order) => order.deviceId === deviceId);
    const merged = new Map(localOrders.map((order) => [order.id, order]));

    if (supabase && isSupabaseConfigured) {
      try {
        const { data } = await supabase
          .from("orders")
          .select("*, order_documents(*)")
          .eq("device_id", deviceId)
          .order("created_at", { ascending: false });

        for (const order of data ?? []) {
          merged.set(order.id, {
            id: order.id,
            deviceId: order.device_id,
            customer: order.customer_name,
            createdAt: order.created_at,
            status: order.status as DemoOrder["status"],
            documents: (order.order_documents ?? []).map((document) => ({
              name: document.file_name,
              pages: document.total_pages,
              selectedPages: [],
              copies: order.copies || 1,
            })),
            total: Number(order.total_amount),
            area: order.pickup_area,
            location: order.pickup_location,
            printMode: order.print_mode,
            sides: order.sides,
            stapling: order.stapling,
            binding: order.binding,
          });
        }
      } catch (error) {
        console.warn("Failed to load device orders:", error);
      }
    }

    setOrders(Array.from(merged.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    ));
    setLoading(false);
  }, [deviceId]);

  useEffect(() => {
    try {
      setDeviceId(localStorage.getItem("campusprints:device-session") ?? "");
    } catch {
      setDeviceId("");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!deviceId) {
      setLoading(false);
      return;
    }
    void loadOrders();
    const interval = window.setInterval(loadOrders, 8000);
    return () => window.clearInterval(interval);
  }, [deviceId, loadOrders]);

  return (
    <main className="app-shell">
      <AppHeader compact />
      <div className="order-page">
        <div className="orders-heading">
          <div>
            <p className="welcome-eyebrow">YOUR PRINTS</p>
            <h1 className="order-title">Order history</h1>
          </div>
          <Link className="order-home-link" href="/">New print</Link>
        </div>

        {loading ? (
          <div className="order-card">Loading your orders…</div>
        ) : orders.length === 0 ? (
          <div className="order-card orders-empty">
            <h2>No orders yet</h2>
            <p>Your submitted print orders will appear here with live status updates.</p>
            <Link className="pill-button" href="/">Start a print</Link>
          </div>
        ) : (
          <div className="orders-list">
            {orders.map((order) => (
              <article className="order-card order-history-item" key={order.id}>
                <div className="order-history-top">
                  <div className="order-history-id">
                    <strong>{order.id}</strong>
                    <span>{new Date(order.createdAt).toLocaleString()}</span>
                  </div>
                  <span className={`status-pill ${order.status}`}>{order.status}</span>
                </div>
                <div className="order-history-detail">
                  <span>{order.documents.length} documents</span>
                  <span>{order.area} · {order.location}</span>
                  <strong>{formatNaira(order.total)}</strong>
                </div>
                <Link className="admin-action-btn" href={`/order/${order.id}`}>
                  Track order
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}