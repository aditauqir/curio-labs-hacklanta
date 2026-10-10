"use client";

import Image from "next/image";

const FRAMES = [
  "/voice-keyframes/voice-key-4.svg",
  "/voice-keyframes/voice-talk-key1.svg",
  "/voice-keyframes/voice-talk-2.svg",
  "/voice-keyframes/voice-talk-3.svg",
];
const MASCOT = "/voice-keyframes/voice-key1.svg";

export function VoiceKeyframes({ active }: { active: boolean }) {
  return (
    <span className={`voice-keyframes ${active ? "is-active" : ""}`} aria-hidden="true">
      <Image
        src={MASCOT}
        alt=""
        width={42}
        height={42}
        className="voice-keyframe voice-keyframe-static"
      />
      {FRAMES.map((src) => (
        <Image key={src} src={src} alt="" width={42} height={42} className="voice-keyframe" />
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
      className={className}
      priority
    />
  );
}
