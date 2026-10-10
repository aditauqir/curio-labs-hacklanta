"use client";

import dynamic from "next/dynamic";

// Curio Labs restores its project from LocalStorage on first render, so it must
// run only in the browser to avoid server/client hydration mismatches.
const StudioWorkspace = dynamic(() => import("./studio-workspace"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center text-sm text-muted">
      Loading Curio Labs...
    </div>
  ),
});

export default function StudioLoader() {
  return <StudioWorkspace />;
}
