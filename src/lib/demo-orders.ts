export const DEMO_ORDERS_KEY = "campusprints:demo-orders";

export type DemoOrder = {
  id: string;
  deviceId?: string;
  customer: string;
  createdAt: string;
  status: "New" | "Printing" | "Ready" | "Completed";
  documents: { name: string; pages: number; selectedPages: number[]; copies: number }[];
  total: number;
  area: string;
  location: string;
  printMode: string;
  sides: string;
  stapling: string;
  binding: string;
};

export function readDemoOrders(): DemoOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DEMO_ORDERS_KEY) ?? "[]");
    return Array.isArray(value) ? value as DemoOrder[] : [];
  } catch {
    return [];
  }
}