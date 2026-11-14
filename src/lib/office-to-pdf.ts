import { estimateColorCoverage } from "@/lib/analysis";

export const WORD_EXTENSIONS = ["doc", "docx", "docm", "dot", "dotx", "dotm"] as const;
export const PPT_EXTENSIONS = [
  "ppt",
  "pptx",
  "pptm",
  "pot",
  "potx",
  "potm",
  "pps",
  "ppsx",
  "ppsm",
] as const;
export const OFFICE_EXTENSIONS = [...WORD_EXTENSIONS, ...PPT_EXTENSIONS] as const;

export function isOfficeFilename(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return (OFFICE_EXTENSIONS as readonly string[]).includes(extension);
}

export type OfficeConversionResult = {
  pdfFile: File;
  pages: number;
  colorCoverage: number[];
  previewUrls: string[];
};

const MAX_PAGES = 250;
const CONVERSION_DEADLINE_MS = 60_000;
// Capture pages at 2.5x (240 DPI) — sharp print output while staying well
// under mobile canvas limits and keeping conversion quick.
const CAPTURE_SCALE = 2.5;
const MAX_CAPTURE_DIMENSION = 2400;
const PREVIEW_WIDTH = 480;
const PDF_JPEG_QUALITY = 0.9;
const PREVIEW_JPEG_QUALITY = 0.75;

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const TIMEOUT_ERROR_NAME = "OfficeConversionTimeout";

function timeoutError(): Error {
  const error = new Error(
    "Conversion took too long. Split the document into smaller files and try again."
  );
  error.name = TIMEOUT_ERROR_NAME;
  return error;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), CONVERSION_DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function sniffSignature(file: File): Promise<"ole" | "zip" | "unknown"> {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (header.length >= 8 && OLE_SIGNATURE.every((byte, index) => header[index] === byte)) {
    return "ole";
  }
  if (header[0] === 0x50 && header[1] === 0x4b) {
    return "zip";
  }
  return "unknown";
}

function unsupportedFileError(): Error {
  return new Error(
    "This file could not be opened as a Word or PowerPoint document. Re-save it and try again."
  );
}

function legacyFormatError(extension: string): Error {
  if (extension === "doc" || extension === "dot") {
    return new Error(
      `This is an older Word 97-2003 (.${extension}) file. Open it in Word and save it as .docx, then upload it again.`
    );
  }
  if (extension === "ppt" || extension === "pot" || extension === "pps") {
    return new Error(
      `This is an older PowerPoint 97-2003 (.${extension}) file. Open it in PowerPoint and save it as .pptx, then upload it again.`
    );
  }
  return new Error(
    `This ${extension.toUpperCase()} file looks password-protected or saved in an old format. Remove the password (or open it and save it as a modern file), then upload it again.`
  );
}

function conversionFailedError(): Error {
  return new Error(
    "This document could not be converted. It may be damaged — open it and re-save it, then try again."
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === TIMEOUT_ERROR_NAME;
}

function parseLengthToPx(value: string | null | undefined, defaultPx: number): number {
  if (!value) return defaultPx;
  const match = value.trim().match(/^([0-9.]+)\s*(mm|cm|in|pt|px)?$/i);
  if (!match) return defaultPx;
  const num = parseFloat(match[1]);
  if (!Number.isFinite(num) || num <= 0) return defaultPx;
  const unit = (match[2] ?? "px").toLowerCase();
  switch (unit) {
    case "mm":
      return (num * 96) / 25.4;
    case "cm":
      return (num * 96) / 2.54;
    case "in":
      return num * 96;
    case "pt":
      return (num * 96) / 72;
    case "px":
    default:
      return num;
  }
}

function isSectionEmpty(section: HTMLElement): boolean {
  if (section.querySelector("img, svg, canvas, audio, video")) return false;
  const tables = section.querySelectorAll("table");
  for (const table of Array.from(tables)) {
    if ((table.textContent ?? "").trim().length > 0) return false;
  }
  const text = (section.textContent ?? "").trim();
  return text.length === 0;
}

function createPageSection(template: HTMLElement, targetHeight: number): {
  section: HTMLElement;
  article: HTMLElement;
} {
  const pageSec = template.cloneNode(false) as HTMLElement;
  pageSec.style.height = `${targetHeight}px`;
  pageSec.style.minHeight = `${targetHeight}px`;
  pageSec.style.maxHeight = `${targetHeight}px`;
  pageSec.style.overflow = "hidden";
  pageSec.style.boxSizing = "border-box";
  pageSec.style.display = "flex";
  pageSec.style.flexFlow = "column nowrap";
  pageSec.style.position = "relative";

  const header = template.querySelector<HTMLElement>(":scope > header");
  if (header) {
    pageSec.appendChild(header.cloneNode(true));
  }

  const templateArticle = template.querySelector<HTMLElement>("article");
  const pageArticle = templateArticle
    ? (templateArticle.cloneNode(false) as HTMLElement)
    : document.createElement("article");
  pageArticle.style.overflow = "hidden";
  pageArticle.style.flex = "1 1 auto";
  pageSec.appendChild(pageArticle);

  const footer = template.querySelector<HTMLElement>(":scope > footer");
  if (footer) {
    pageSec.appendChild(footer.cloneNode(true));
  }

  return { section: pageSec, article: pageArticle };
}

function paginateOverflowingSection(
  section: HTMLElement,
  targetHeight: number,
  container: HTMLElement
): HTMLElement[] {
  const article = section.querySelector<HTMLElement>("article");
  if (!article || article.children.length === 0) {
    section.style.height = `${targetHeight}px`;
    section.style.overflow = "hidden";
    return [section];
  }

  const computed = window.getComputedStyle(section);
  const padTop = parseFloat(computed.paddingTop) || 0;
  const padBottom = parseFloat(computed.paddingBottom) || 0;
  const header = section.querySelector<HTMLElement>(":scope > header");
  const footer = section.querySelector<HTMLElement>(":scope > footer");
  const headerH = header ? header.getBoundingClientRect().height : 0;
  const footerH = footer ? footer.getBoundingClientRect().height : 0;
  const availableHeight = Math.max(
    150,
    targetHeight - padTop - padBottom - headerH - footerH
  );

  const queue: HTMLElement[] = Array.from(article.children) as HTMLElement[];
  const pages: HTMLElement[] = [];

  let current = createPageSection(section, targetHeight);
  container.insertBefore(current.section, section);
  pages.push(current.section);
  let currentUsedHeight = 0;

  while (queue.length > 0) {
    const item = queue.shift()!;
    current.article.appendChild(item);

    const rect = item.getBoundingClientRect();
    const style = window.getComputedStyle(item);
    const mt = parseFloat(style.marginTop) || 0;
    const mb = parseFloat(style.marginBottom) || 0;
    const itemH = rect.height + mt + mb;

    if (currentUsedHeight + itemH <= availableHeight) {
      currentUsedHeight += itemH;
      continue;
    }

    // Item does not fit on current page
    if (currentUsedHeight > 0) {
      current.article.removeChild(item);
      current = createPageSection(section, targetHeight);
      container.insertBefore(current.section, section);
      pages.push(current.section);
      currentUsedHeight = 0;
      queue.unshift(item);
      continue;
    }

    // We are on a fresh page and the single item is larger than availableHeight
    if (item.tagName === "TABLE") {
      const table = item as HTMLTableElement;
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr"));
      if (rows.length > 1) {
        current.article.removeChild(item);

        const table1 = table.cloneNode(false) as HTMLTableElement;
        const tbody1 = document.createElement("tbody");
        table1.appendChild(tbody1);
        current.article.appendChild(table1);

        let rowHeightSum = 0;
        let splitIdx = 0;
        for (let i = 0; i < rows.length; i++) {
          const rH = rows[i].getBoundingClientRect().height;
          if (rowHeightSum + rH > availableHeight && i > 0) {
            splitIdx = i;
            break;
          }
          tbody1.appendChild(rows[i]);
          rowHeightSum += rH;
        }

        if (splitIdx > 0 && splitIdx < rows.length) {
          const table2 = table.cloneNode(false) as HTMLTableElement;
          const tbody2 = document.createElement("tbody");
          table2.appendChild(tbody2);
          for (let i = splitIdx; i < rows.length; i++) {
            tbody2.appendChild(rows[i]);
          }
          queue.unshift(table2);
          current = createPageSection(section, targetHeight);
          container.insertBefore(current.section, section);
          pages.push(current.section);
          currentUsedHeight = 0;
          continue;
        }
      }
    } else if (item.tagName === "P" && item.childNodes.length > 1) {
      const children = Array.from(item.childNodes);
      current.article.removeChild(item);

      const p1 = item.cloneNode(false) as HTMLElement;
      current.article.appendChild(p1);

      const half = Math.ceil(children.length / 2);
      for (let i = 0; i < half; i++) {
        p1.appendChild(children[i]);
      }

      const p2 = item.cloneNode(false) as HTMLElement;
      for (let i = half; i < children.length; i++) {
        p2.appendChild(children[i]);
      }
      queue.unshift(p2);
      current = createPageSection(section, targetHeight);
      container.insertBefore(current.section, section);
      pages.push(current.section);
      currentUsedHeight = 0;
      continue;
    }

    // Indivisible item or already at limit, keep on current page and move on
    currentUsedHeight = availableHeight;
  }

  // Remove the original overflowing section from DOM
  section.remove();
  return pages;
}

async function renderDocxPages(
  arrayBuffer: ArrayBuffer,
  container: HTMLElement
): Promise<HTMLElement[]> {
  const { renderAsync } = await import("docx-preview");
  try {
    await withTimeout(
      renderAsync(arrayBuffer, container, container, {
        // Break pages where Word recorded its own pagination, plus any
        // explicit page/section breaks, so page counts match the document.
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        useBase64URL: true,
        renderChanges: false,
        renderComments: false,
      })
    );
  } catch (error) {
    if (isTimeoutError(error)) throw error;
    throw conversionFailedError();
  }

  const rawSections = Array.from(
    container.querySelectorAll<HTMLElement>(".docx-wrapper > section")
  );

  const paginatedSections: HTMLElement[] = [];
  for (const section of rawSections) {
    const targetHeight = parseLengthToPx(section.style.minHeight, 1122.5);
    const scrollHeight = section.scrollHeight;
    const rectHeight = section.getBoundingClientRect().height;
    const currentHeight = Math.max(scrollHeight, rectHeight);

    if (currentHeight > targetHeight * 1.08) {
      // Document or section has no page breaks and overflows standard page height:
      // Paginates content across discrete pages.
      const splitPages = paginateOverflowingSection(section, targetHeight, container);
      for (const p of splitPages) {
        paginatedSections.push(p);
      }
    } else {
      section.style.height = `${targetHeight}px`;
      section.style.minHeight = `${targetHeight}px`;
      section.style.maxHeight = `${targetHeight}px`;
      section.style.overflow = "hidden";
      section.style.boxSizing = "border-box";
      paginatedSections.push(section);
    }
  }

  // Prune phantom empty sections (e.g. trailing empty sections from page breaks at end of file)
  const validSections = paginatedSections.filter((sec) => !isSectionEmpty(sec));
  if (validSections.length > 0) {
    // Remove pruned sections from container
    for (const sec of paginatedSections) {
      if (isSectionEmpty(sec)) sec.remove();
    }
    return validSections;
  }

  // If every section was empty, keep at least one
  return paginatedSections.slice(0, 1);
}

async function renderPptxPages(
  arrayBuffer: ArrayBuffer,
  container: HTMLElement
): Promise<HTMLElement[]> {
  const [{ init }, JSZipModule] = await Promise.all([
    import("pptx-preview"),
    import("jszip"),
  ]);
  const JSZip = JSZipModule.default;

  // pptx-preview needs the target width up front, so read the native slide
  // size (EMU) from presentation.xml and pass it in CSS pixels.
  let slideWidthPx = 960;
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const presentationXml = await zip.file("ppt/presentation.xml")?.async("text");
    const slideSizeTag = presentationXml?.match(/<p:sldSz\b[^>]*>/)?.[0];
    const cx = Number(slideSizeTag?.match(/\bcx="(\d+)"/)?.[1] ?? 0);
    if (cx > 0) slideWidthPx = Math.round(cx / 9525);
  } catch {
    throw conversionFailedError();
  }

  const previewer = init(container, { width: slideWidthPx, mode: "list" });
  try {
    await withTimeout(previewer.preview(arrayBuffer));
  } catch (error) {
    if (isTimeoutError(error)) throw error;
    throw conversionFailedError();
  }
  return Array.from(
    container.querySelectorAll<HTMLElement>(".pptx-preview-slide-wrapper")
  );
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  // 1. Try standard toBlob with target quality
  let blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", PDF_JPEG_QUALITY)
  );
  if (blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  // 2. Retry toBlob with slightly reduced quality if memory pressure was high
  blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.8)
  );
  if (blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  // 3. Fallback to toDataURL (WebKit iOS quirk where toBlob fails but toDataURL succeeds)
  try {
    const dataUrl = canvas.toDataURL("image/jpeg", PDF_JPEG_QUALITY);
    if (dataUrl && dataUrl.length > 50 && !dataUrl.startsWith("data:,")) {
      return dataUrlToBytes(dataUrl);
    }
  } catch {
    // Continue to downscale fallback
  }

  // 4. Downscale fallback for iOS Safari devices with strict canvas area limits
  const maxDim = Math.max(canvas.width, canvas.height);
  if (maxDim > 1200) {
    const downscaleFactor = 1600 / maxDim;
    const safeCanvas = document.createElement("canvas");
    safeCanvas.width = Math.max(1, Math.round(canvas.width * downscaleFactor));
    safeCanvas.height = Math.max(1, Math.round(canvas.height * downscaleFactor));
    const safeCtx = safeCanvas.getContext("2d");
    if (safeCtx) {
      safeCtx.fillStyle = "#ffffff";
      safeCtx.fillRect(0, 0, safeCanvas.width, safeCanvas.height);
      safeCtx.drawImage(canvas, 0, 0, safeCanvas.width, safeCanvas.height);

      const safeBlob = await new Promise<Blob | null>((resolve) =>
        safeCanvas.toBlob(resolve, "image/jpeg", 0.85)
      );
      if (safeBlob) {
        safeCanvas.width = 0;
        safeCanvas.height = 0;
        return new Uint8Array(await safeBlob.arrayBuffer());
      }

      try {
        const safeDataUrl = safeCanvas.toDataURL("image/jpeg", 0.85);
        safeCanvas.width = 0;
        safeCanvas.height = 0;
        if (safeDataUrl && safeDataUrl.length > 50 && !safeDataUrl.startsWith("data:,")) {
          return dataUrlToBytes(safeDataUrl);
        }
      } catch {
        safeCanvas.width = 0;
        safeCanvas.height = 0;
      }
    }
  }

  throw new Error("Your browser could not render this page.");
}

export async function convertOfficeToPdf(
  file: File,
  onProgress?: (message: string) => void
): Promise<OfficeConversionResult> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  const signature = await sniffSignature(file);
  if (signature === "ole") throw legacyFormatError(extension);
  if (signature !== "zip") throw unsupportedFileError();

  const startedAt = Date.now();
  const checkDeadline = () => {
    if (Date.now() - startedAt > CONVERSION_DEADLINE_MS) throw timeoutError();
  };

  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;opacity:0;pointer-events:none;z-index:-9999;overflow:hidden;";
  document.body.appendChild(container);

  try {
    onProgress?.("Reading document structure…");
    const arrayBuffer = await file.arrayBuffer();

    const isWord = (WORD_EXTENSIONS as readonly string[]).includes(extension);
    const pageElements = isWord
      ? await renderDocxPages(arrayBuffer, container)
      : await renderPptxPages(arrayBuffer, container);

    if (pageElements.length === 0) throw unsupportedFileError();
    if (pageElements.length > MAX_PAGES) {
      throw new Error(
        `This preview supports up to ${MAX_PAGES} pages at a time. Split the document into smaller files.`
      );
    }

    const [{ domToCanvas }, { PDFDocument }] = await Promise.all([
      import("modern-screenshot"),
      import("pdf-lib"),
    ]);

    const pdfDoc = await PDFDocument.create();
    const colorCoverage: number[] = [];
    const previewUrls: string[] = [];
    const total = pageElements.length;

    for (let index = 0; index < total; index += 1) {
      checkDeadline();
      onProgress?.(`Converting to PDF… (page ${index + 1} of ${total})`);

      const element = pageElements[index];
      const rect = element.getBoundingClientRect();
      const cssWidth = Math.max(1, rect.width);
      const cssHeight = Math.max(1, rect.height);

      const scale = Math.min(
        CAPTURE_SCALE,
        MAX_CAPTURE_DIMENSION / Math.max(cssWidth, cssHeight)
      );

      const canvas = await domToCanvas(element, {
        scale,
        maximumCanvasSize: MAX_CAPTURE_DIMENSION,
        backgroundColor: "#ffffff",
      });

      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = Math.max(1, Math.min(PREVIEW_WIDTH, canvas.width));
      previewCanvas.height = Math.max(
        1,
        Math.round((canvas.height / Math.max(1, canvas.width)) * previewCanvas.width)
      );
      const previewContext = previewCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!previewContext) throw new Error("Your browser could not prepare a preview.");
      previewContext.fillStyle = "#ffffff";
      previewContext.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      previewContext.drawImage(
        canvas,
        0,
        0,
        previewCanvas.width,
        previewCanvas.height
      );

      colorCoverage.push(
        estimateColorCoverage(
          previewContext.getImageData(
            0,
            0,
            previewCanvas.width,
            previewCanvas.height
          ).data
        )
      );
      previewUrls.push(
        previewCanvas.toDataURL("image/jpeg", PREVIEW_JPEG_QUALITY)
      );

      const jpegBytes = await canvasToJpegBytes(canvas);
      const image = await pdfDoc.embedJpg(jpegBytes);
      const pageWidth = cssWidth * 0.75;
      const pageHeight = cssHeight * 0.75;
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });

      // Release page buffers immediately — a 250-page document must never
      // hold every full-resolution canvas in memory at once.
      previewCanvas.width = 0;
      previewCanvas.height = 0;
      canvas.width = 0;
      canvas.height = 0;

      // Yield briefly to the browser event loop so WebKit/mobile GC can reclaim graphics memory
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    onProgress?.("Building print-ready PDF…");
    const pdfBytes = await pdfDoc.save();
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const pdfFile = new File([new Uint8Array(pdfBytes)], `${baseName}.pdf`, {
      type: "application/pdf",
    });

    return { pdfFile, pages: total, colorCoverage, previewUrls };
  } finally {
    container.remove();
  }
}
