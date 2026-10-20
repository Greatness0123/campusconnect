import type { ColorMode, LocationArea } from "./print";

export type DraftFile = {
  id: string;
  file: File;
  status: string;
  pages: number;
  colorCoverage: number[];
  pageSelection: string;
  copies: number;
  colorMode: ColorMode;
};

export type OrderDraft = {
  customer: string;
  deviceId: string;
  files: DraftFile[];
  sides: "single" | "duplex";
  stapled: boolean;
  bound: boolean;
  area: LocationArea;
  location: string;
};

let draft: OrderDraft | null = null;

export function setOrderDraft(next: OrderDraft | null) {
  draft = next;
}

export function getOrderDraft(): OrderDraft | null {
  return draft;
}

export function clearOrderDraft() {
  draft = null;
}
