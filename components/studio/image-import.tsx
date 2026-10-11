"use client";

import Image from "next/image";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ImageImportError, type ImportedReference } from "@/lib/image-import-client";
import { FilePlusIcon } from "./icons";

function errorMessage(error: unknown) {
  if (!(error instanceof ImageImportError)) return "Image analysis failed. Try again.";
  if (error.code === "not_configured") return "Image analysis is not configured yet.";
  if (error.code === "too_large") return "Choose an image smaller than 8 MB.";
  if (error.code === "unsupported_type") return "Choose a PNG, JPG, GIF, or other image file.";
  return "Image analysis failed. Try again.";
}

export function ImageImportControl({
  onImport,
  result,
  compact = false,
  showSuggestions = false,
  onUseSuggestion,
  className = "",
}: {
  onImport: (file: File) => Promise<ImportedReference>;
  result: ImportedReference | null;
  compact?: boolean;
  showSuggestions?: boolean;
  onUseSuggestion?: (prompt: string) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function importFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, JPG, GIF, or other image file.");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await onImport(file);
    } catch (importError) {
      setError(errorMessage(importError));
    } finally {
      setBusy(false);
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void importFile(file);
  }

  return (
    <div
      className={`studio-image-import ${compact ? "is-compact" : ""} ${dragActive ? "is-drag-active" : ""} ${className}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleChange} />
      <button
        type="button"
        className="studio-image-import-button"
        aria-label="Import image"
        title="Import image"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        <FilePlusIcon />
        <span>Import image</span>
      </button>
      {busy ? <span className="studio-image-import-status" role="status">Analyzing image…</span> : null}
      {error ? <p className="studio-image-import-error" role="alert">{error}</p> : null}

      {result ? (
        <div className="studio-image-import-result">
          <Image
            src={result.previewUrl}
            alt={`Imported reference: ${result.filename}`}
            width={compact ? 44 : 72}
            height={compact ? 44 : 72}
            unoptimized
          />
          <div className="studio-image-import-copy">
            <span className="studio-image-import-filename">{result.filename}</span>
            {!compact ? <p>{result.summary}</p> : null}
          </div>
          {showSuggestions ? (
            <div className="studio-image-import-suggestions" aria-label="Image suggestions">
              {result.suggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => onUseSuggestion?.(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
