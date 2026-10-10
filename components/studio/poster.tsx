"use client";

import { useMemo } from "react";
import type { DesignState } from "@/lib/design-types";
import { POSTER_HEIGHT, POSTER_WIDTH, buildPoster } from "@/lib/poster-layout";

/** Live poster built from real SVG elements, driven entirely by the design state. */
export function Poster({ design }: { design: DesignState }) {
  const { shapes, texts } = useMemo(() => buildPoster(design), [design]);

  return (
    <svg
      viewBox={`0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${design.projectName} poster, ${design.styleLabel} direction`}
      className="block h-full w-full"
    >
      <rect width={POSTER_WIDTH} height={POSTER_HEIGHT} fill={design.colors.background} />

      {shapes.map((shape) => {
        if (shape.kind === "rect") {
          return (
            <rect
              key={shape.id}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              fill={shape.fill ?? "none"}
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth}
              opacity={shape.opacity}
            />
          );
        }
        if (shape.kind === "circle") {
          return (
            <circle
              key={shape.id}
              cx={shape.cx}
              cy={shape.cy}
              r={shape.r}
              fill={shape.fill ?? "none"}
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth}
              opacity={shape.opacity}
            />
          );
        }
        return (
          <line
            key={shape.id}
            x1={shape.x1}
            y1={shape.y1}
            x2={shape.x2}
            y2={shape.y2}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            opacity={shape.opacity}
          />
        );
      })}

      {texts.map((item) => (
        <text
          key={item.id}
          x={item.x}
          y={item.y}
          textAnchor={item.anchor}
          fontSize={item.size}
          fontWeight={item.weight}
          fontStyle={item.italic ? "italic" : "normal"}
          fill={item.color}
          style={{
            fontFamily:
              item.font === "heading"
                ? design.typography.headingFont
                : design.typography.bodyFont,
            letterSpacing: item.tracking,
            whiteSpace: "pre",
          }}
        >
          {item.text}
        </text>
      ))}
    </svg>
  );
}
