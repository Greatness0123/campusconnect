export const DEMO_ORDERS_KEY = "campusprints:demo-orders";

import type { Fulfilment } from "./print";

export type DemoOrderStatus =
  | "New"
  | "Printing"
  | "Ready"
  | "Completed"
  | "Payment Not Received";

export type DemoOrderDocument = {
  name: string;
  pages: number;
  selectedPages: number[];
  copies: number;
  filePath?: string;
  colorMode?: string;
  sides?: string;
  stapling?: string;
  binding?: string;
  pageSelection?: string;
};

export type DemoOrder = {
  id: string;
  deviceId?: string;
  customer: string;
  phone?: string;
  createdAt: string;
  status: DemoOrderStatus;
  paymentNotReceived?: boolean;
  paymentReceiptPath?: string;
  fulfilment?: Fulfilment | "delivery";
  documents: DemoOrderDocument[];
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