import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TitleCard } from "./TitleCard";

export type Word = { word: string; start: number; end: number };
export type NarratedProps = {
  audioFile: string;        // file in video/public/
  words: Word[];            // whisper word timings (relative to narration start)
  title: string;
  durationInSeconds: number;
};

const FPS = 30;
const INTRO = 45; // 1.5s branded intro before narration

// Karaoke-style captions: a rolling window of recent words, current word lit.
const Captions: React.FC<{ words: Word[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  let active = -1;
  for (let i = 0; i < words.length; i++) {
    if (t >= words[i].start) active = i;
    else break;
  }
  if (active < 0) return null;

  const start = Math.max(0, active - 6);
  const windowed = words.slice(start, active + 1);
  return (
    <div style={{ position: "absolute", bottom: 96, left: 0, right: 0, textAlign: "center", padding: "0 140px" }}>
      <span
        style={{
          fontFamily: "Georgia, 'Iowan Old Style', serif",
          fontSize: 56,
          lineHeight: 1.35,
          background: "rgba(12, 20, 26, 0.74)",
          padding: "12px 24px",
          borderRadius: 16,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        {windowed.map((w, i) => (
          <span key={i} style={{ color: start + i === active ? "#43d6a6" : "#ffffff" }}>
            {" "}{w.word}
          </span>
        ))}
      </span>
    </div>
  );
};

export const Narrated: React.FC<NarratedProps> = ({ audioFile, words, title }) => {
  return (
    <AbsoluteFill style={{ background: "linear-gradient(135deg, #0f1a20 0%, #16302a 100%)" }}>
      <Sequence durationInFrames={INTRO}>
        <TitleCard title={title} subtitle="" />
      </Sequence>
      <Sequence from={INTRO}>
        <Audio src={staticFile(audioFile)} />
        {/* Screen-recording / b-roll slot goes here later; branded background for now. */}
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <div style={{ color: "#2f9b7a", fontFamily: "Georgia, serif", fontSize: 44, opacity: 0.4 }}>
            {title}
          </div>
        </AbsoluteFill>
        <Captions words={words} />
      </Sequence>
    </AbsoluteFill>
  );
};

export const calculateNarratedMetadata = ({ props }: { props: NarratedProps }) => ({
  fps: FPS,
  durationInFrames: INTRO + Math.ceil((props.durationInSeconds + 0.6) * FPS),
});
