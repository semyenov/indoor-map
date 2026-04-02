const MAX_REFERENCE_DIMENSION = 4096;

interface PreparedReferenceImage {
  url: string;
  naturalWidth: number;
  naturalHeight: number;
}

const blobFromCanvas = async (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode reference image"));
        return;
      }
      resolve(blob);
    }, type, quality);
  });

const loadImageElement = async (file: File) => {
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const prepareReferenceImage = async (
  file: File,
  maxDimension = MAX_REFERENCE_DIMENSION,
): Promise<PreparedReferenceImage> => {
  const source =
    typeof window.createImageBitmap === "function"
      ? await window.createImageBitmap(file)
      : await loadImageElement(file);

  const naturalWidth = source.width;
  const naturalHeight = source.height;
  const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    if ("close" in source && typeof source.close === "function") source.close();
    throw new Error("Failed to get canvas context");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);

  if ("close" in source && typeof source.close === "function") source.close();

  const type =
    file.type === "image/jpeg" || file.type === "image/webp"
      ? file.type
      : "image/png";
  const blob = await blobFromCanvas(canvas, type, type === "image/png" ? undefined : 0.9);

  return {
    url: URL.createObjectURL(blob),
    naturalWidth,
    naturalHeight,
  };
};
