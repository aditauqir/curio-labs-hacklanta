"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const FRAMES = [
  "/voice-keyframes/voice-key1.svg",
  "/voice-keyframes/voice-key-4.svg",
  "/voice-keyframes/voice-talk-key1.svg",
  "/voice-keyframes/voice-talk-2.svg",
  "/voice-keyframes/voice-talk-3.svg",
];
const MASCOT = "/voice-keyframes/voice-key1.svg";

export function VoiceKeyframes({ active }: { active: boolean }) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!active) return;

    let previous = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const chooseFrame = () => {
      let next = Math.floor(Math.random() * FRAMES.length);
      while (next === previous && FRAMES.length > 1) {
        next = Math.floor(Math.random() * FRAMES.length);
      }
      previous = next;
      setFrameIndex(next);
      timer = setTimeout(chooseFrame, 150 + Math.floor(Math.random() * 190));
    };

    timer = setTimeout(chooseFrame, 0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [active]);

  return (
    <span className={`voice-keyframes ${active ? "is-active" : ""}`} aria-hidden="true">
      {FRAMES.map((src, index) => (
        <Image
          key={src}
          src={src}
          alt=""
          width={42}
          height={42}
          className="voice-keyframe"
          style={{ opacity: index === (active ? frameIndex : 0) ? 1 : 0 }}
        />
      ))}
    </span>
  );
}

export function VoiceMascot({ className = "" }: { className?: string }) {
  return (
    <Image
      src={MASCOT}
      alt="Curio Labs mascot"
      width={112}
      height={112}
      className={`voice-mascot ${className}`.trim()}
      priority
    />
  );
}
