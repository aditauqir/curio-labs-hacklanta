"use client";

import { useEffect, useRef, useState } from "react";
import type { DesignState } from "@/lib/design-types";
import { getReferenceLook } from "@/lib/reference-looks";
import { renderLookPlate } from "@/lib/look-render";

/**
 * Object URL of the screened plate for the design's reference look, or null for a flat
 * design. While a new plate renders, the previous one stays on screen.
 */
export function useLookPlate(design: DesignState) {
  const { lookId } = design;
  const { background, foreground, accent } = design.colors;
  const { alignment } = design.layout;
  const hasLook = Boolean(getReferenceLook(lookId));
  const [url, setUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  useEffect(() => {
    if (!hasLook) return;
    let cancelled = false;
    renderLookPlate({ lookId, colors: { background, foreground, accent }, layout: { alignment } })
      .then((canvas) => new Promise<Blob | null>((resolve) => (canvas ? canvas.toBlob(resolve) : resolve(null))))
      .then((blob) => {
        if (cancelled || !blob) return;
        const next = URL.createObjectURL(blob);
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = next;
        setUrl(next);
      })
      .catch(() => undefined); // A missing texture leaves the flat background in place.
    return () => {
      cancelled = true;
    };
  }, [hasLook, lookId, background, foreground, accent, alignment]);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );

  return hasLook ? url : null;
}
