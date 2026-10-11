export type ImageAnalysis = {
  summary: string;
  suggestions: string[];
  prompt: string;
};

export type ImportedReference = ImageAnalysis & {
  filename: string;
  previewUrl: string;
};

export class ImageImportError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export async function analyzeImage(file: File): Promise<ImageAnalysis> {
  const form = new FormData();
  form.append("image", file, file.name || "reference-image");

  const response = await fetch("/api/image-import", { method: "POST", body: form });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ImageImportError(response.status, body?.error ?? "request_failed");
  }

  const json = (await response.json()) as Partial<ImageAnalysis> | null;
  const suggestions = Array.isArray(json?.suggestions)
    ? json.suggestions.filter((item): item is string => typeof item === "string").slice(0, 3)
    : [];
  if (
    typeof json?.summary !== "string" ||
    typeof json?.prompt !== "string" ||
    suggestions.length !== 3
  ) {
    throw new ImageImportError(502, "invalid_response");
  }

  return { summary: json.summary, prompt: json.prompt, suggestions };
}
