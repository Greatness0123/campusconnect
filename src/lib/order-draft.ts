import type { ColorMode, LocationArea, Sides } from "./print";

export type DraftFile = {
  id: string;
  file: File;
  status: string;
  pages: number;
  colorCoverage: number[];
  previewUrls: string[];
  previewPage: number;
  pageSelection: string;
  copies: number;
  colorMode: ColorMode;
  sides: Sides;
  stapled: boolean;
  bound: boolean;
};

export type OrderDraft = {
  customer: string;
  deviceId: string;
  files: DraftFile[];
  area: LocationArea;
  location: string;
};

const STORAGE_KEY = "campusprints:order-draft";

// Serializable shape: real File objects are dropped (bytes can't go to JSON),
// kept as metadata so the file cards can be restored after a refresh.
type PersistedFile = Omit<DraftFile, "file" | "previewUrls"> & {
  fileName: string;
  fileType: string;
};
type PersistedDraft = Omit<OrderDraft, "files"> & { files: PersistedFile[] };

let draft: OrderDraft | null = null;
let hydratedFromStorage = false;

function isBrowser() {
  return typeof window !== "undefined";
}

function serialize(next: OrderDraft): PersistedDraft {
  return {
    ...next,
    files: next.files.map(({ file, previewUrls: _previewUrls, ...rest }) => ({
      ...rest,
      fileName: file.name,
      fileType: file.type,
    })),
  };
}

function persist(next: OrderDraft) {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(next)));
  } catch {
    // Quota / private mode — ignore, in-memory copy still works.
  }
}

function readPersisted(): OrderDraft | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDraft;
    if (!parsed || !Array.isArray(parsed.files)) return null;
    return {
      ...parsed,
      files: parsed.files.map(({ fileName, fileType, ...rest }) => ({
        ...rest,
        previewUrls: [],
        // Placeholder File (size 0) restores name/type for display.
        // Real bytes are only available in the in-memory copy of a live session,
        // so uploads skip size-0 placeholders after a refresh.
        file: new File([], fileName || "file", { type: fileType || "" }),
      })),
    };
  } catch {
    return null;
  }
}

export function setOrderDraft(next: OrderDraft | null) {
  draft = next;
  if (next) {
    hydratedFromStorage = true;
    persist(next);
  } else if (isBrowser()) {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export function getOrderDraft(): OrderDraft | null {
  if (draft) return draft;
  if (!hydratedFromStorage) {
    hydratedFromStorage = true;
    draft = readPersisted();
  }
  return draft;
}

export function clearOrderDraft() {
  draft = null;
  hydratedFromStorage = true;
  if (isBrowser()) {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
