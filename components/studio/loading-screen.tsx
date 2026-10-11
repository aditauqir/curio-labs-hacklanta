import { Leap } from "loading-dev";

export function CurioLoadingScreen() {
  return (
    <main
      className="site-loading-screen"
      aria-label="Loading Curio Labs"
      style={{ display: "grid", minHeight: "100dvh", placeItems: "center", overflow: "hidden", background: "#f7f6f1", color: "#000" }}
    >
      <Leap size={96} color="#000" duration={900} />
    </main>
  );
}
