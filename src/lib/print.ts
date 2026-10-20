export type LocationArea = "Uptown" | "Middletown" | "Downtown";

export const locationOptions: Record<LocationArea, string[]> = {
  Uptown: [
    "Main Gate",
    "New Horizon",
    "Gym",
    "Marquee",
    "Bronze Annex 1",
    "Bronze Annex 2",
    "Uptown Classrooms",
    "Uptown Gazebos",
    "College of Applied Sciences",
    "ELT",
    "Uptown Labs",
    "Bread and Water Factory",
    "Field",
    "Senate Building",
    "Clinic",
    "Adenuga",
    "Wema",
    "Back of Wema",
    "Female Silver",
    "Male Silver 1",
    "Male Bronze",
  ],
  Middletown: [
    "Emerald 1",
    "Emerald 2",
    "Engineering Annex 1, 2, 3",
    "Hall B",
    "Emerald 3",
    "LT 1",
    "LT 2",
    "BUPF LT",
    "College of Engineering",
    "Hall D",
    "Colenvs Building",
    "Colmans Building",
  ],
  Downtown: ["Silver 2", "Silver 3", "New Hall Male", "New Hall Female", "JAC"],
};

export const pricing = {
  mono: 100,
  colorLight: 150,
  colorHeavy: 200,
  duplexMono: 70,
  duplexColor: 150,
  binding: 500,
};

export function parsePageSelection(input: string, pageCount: number) {
  const value = input.trim().toLowerCase();
  if (!value || value === "all") {
    return Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1);
  }

  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const first = Number(range[1]);
      const last = Number(range[2]);
      for (let page = Math.min(first, last); page <= Math.max(first, last); page += 1) {
        if (page >= 1 && page <= pageCount) pages.add(page);
      }
      continue;
    }
    const page = Number(part.trim());
    if (Number.isInteger(page) && page >= 1 && page <= pageCount) pages.add(page);
  }
  const result = [...pages].sort((left, right) => left - right);
  return result.length > 0
    ? result
    : Array.from({ length: Math.max(1, pageCount) }, (_, i) => i + 1);
}

export type ColorMode = "keep" | "mono";

export type QuoteFileInput = {
  id: string;
  status: string;
  pages: number;
  colorCoverage: number[];
  pageSelection: string;
  copies: number;
  colorMode: ColorMode;
};

export type FileQuote = {
  id: string;
  selectedCount: number;
  copies: number;
  printedPages: number;
  bwPages: number;
  lightColorPages: number;
  heavyColorPages: number;
  sheets: number;
  printCost: number;
  bindingCost: number;
  totalCost: number;
};

export type Quote = {
  blackAndWhitePages: number;
  lightColorPages: number;
  heavyColorPages: number;
  copyPages: number;
  physicalSheets: number;
  printCost: number;
  finishingCost: number;
  total: number;
  perFile: FileQuote[];
};

export function computeQuote(
  files: QuoteFileInput[],
  sides: "single" | "duplex",
  bound: boolean
): Quote {
  const monoRate = sides === "duplex" ? pricing.duplexMono : pricing.mono;
  const lightRate = sides === "duplex" ? pricing.duplexColor : pricing.colorLight;
  const heavyRate = sides === "duplex" ? pricing.duplexColor : pricing.colorHeavy;

  let blackAndWhitePages = 0;
  let lightColorPages = 0;
  let heavyColorPages = 0;
  let copyPages = 0;
  let printCost = 0;
  let finishingCost = 0;
  const perFile: FileQuote[] = [];

  for (const file of files) {
    if (file.status !== "ready") continue;
    const selected = parsePageSelection(file.pageSelection, file.pages);
    const copies = Math.max(1, file.copies);

    let fileBw = 0;
    let fileLight = 0;
    let fileHeavy = 0;
    for (const pageNumber of selected) {
      const coverage = file.colorCoverage[pageNumber - 1] ?? 0;
      if (file.colorMode === "keep" && coverage > 0.005) {
        if (coverage >= 0.5) fileHeavy += 1;
        else fileLight += 1;
      } else {
        fileBw += 1;
      }
    }

    const bwTotal = fileBw * copies;
    const lightTotal = fileLight * copies;
    const heavyTotal = fileHeavy * copies;
    const printedPages = selected.length * copies;
    const sheets = sides === "duplex" ? Math.ceil(printedPages / 2) : printedPages;
    const filePrintCost = bwTotal * monoRate + lightTotal * lightRate + heavyTotal * heavyRate;
    const fileBindingCost = bound ? copies * pricing.binding : 0;

    blackAndWhitePages += bwTotal;
    lightColorPages += lightTotal;
    heavyColorPages += heavyTotal;
    copyPages += printedPages;
    printCost += filePrintCost;
    finishingCost += fileBindingCost;

    perFile.push({
      id: file.id,
      selectedCount: selected.length,
      copies,
      printedPages,
      bwPages: bwTotal,
      lightColorPages: lightTotal,
      heavyColorPages: heavyTotal,
      sheets,
      printCost: filePrintCost,
      bindingCost: fileBindingCost,
      totalCost: filePrintCost + fileBindingCost,
    });
  }

  const physicalSheets =
    sides === "duplex" ? Math.ceil(copyPages / 2) : copyPages;

  return {
    blackAndWhitePages,
    lightColorPages,
    heavyColorPages,
    copyPages,
    physicalSheets,
    printCost,
    finishingCost,
    total: printCost + finishingCost,
    perFile,
  };
}

export function formatNaira(amount: number) {
  return `₦${Number(amount).toLocaleString("en-NG")}`;
}
