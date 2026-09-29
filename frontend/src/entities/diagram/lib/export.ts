export interface Size {
  width: number;
  height: number;
}

/** Intrinsic size from the viewBox (Mermaid uses width="100%"), falling back to width/height attributes. */
export function svgSize(svg: string): Size {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(root);
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  const attr = (name: string) => Number.parseFloat(new RegExp(`\\b${name}\\s*=\\s*["']([\\d.]+)(?:px)?["']`, "i").exec(root)?.[1] ?? "");
  const width = attr("width");
  const height = attr("height");
  return width > 0 && height > 0 ? { width, height } : { width: 800, height: 600 };
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function fileName(title: string, extension: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "diagram";
  return `${slug}.${extension}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadSvg(svg: string, title: string): void {
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), fileName(title, "svg"));
}

/**
 * Rasterises the SVG at 2x. Browsers refuse to export a canvas tainted by SVGs that embed HTML
 * (Mermaid's foreignObject labels), so this rejects in that case and callers fall back to SVG.
 */
export async function svgToPng(svg: string): Promise<Blob> {
  const { width, height } = svgSize(svg);
  const image = new Image();
  image.decoding = "async";
  image.src = svgDataUrl(svg);
  await image.decode();

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))), "image/png"),
  );
}
