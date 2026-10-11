import StudioLoader from "@/components/studio/studio-loader";

export default function AppPage() {
  // `/app` is the product entry point. A fresh direct visit starts at the
  // same home prompt as `/home`; the client marks the editor transition in
  // history so the canonical URL stays `/app` once the workspace is open.
  return <StudioLoader initialView="start" />;
}
