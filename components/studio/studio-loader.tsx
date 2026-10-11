"use client";

import dynamic from "next/dynamic";
import type { StudioView } from "./studio-workspace";
import { CurioLoadingScreen } from "./loading-screen";

// Curio Labs restores its project from LocalStorage on first render, so it must
// run only in the browser to avoid server/client hydration mismatches.
const StudioWorkspace = dynamic(() => import("./studio-workspace"), {
  ssr: false,
  loading: () => <CurioLoadingScreen />,
});

export default function StudioLoader({ initialView = "start" }: { initialView?: StudioView }) {
  return <StudioWorkspace initialView={initialView} />;
}
