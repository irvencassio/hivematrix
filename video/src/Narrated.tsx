import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { TitleCard } from "./TitleCard";
import { Outro } from "./Outro";

export type Word = { word: string; start: number; end: number };
export type NarratedProps = {
  audioFile: string;        // narration, in video/public/
  words: Word[];            // whisper word timings (relative to narration start)
  title: string;
  durationInSeconds: number;
  screenFile?: string;      // optional screen-recording footage in video/public/
  musicFile?: string;       // optional background music in video/public/
};

const FPS = 30;
const INTRO = 45;   // 1.5s
const OUTRO = 60;   // 2s
const TRANS = 15;   // 0.5s crossfades (overlap adjacent sequences)

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

// The narrated body: audio (+ optional music bed) over screen footage or a
// branded background, with captions and a small brand watermark.
const Main: React.FC<NarratedProps> = ({ audioFile, words, title, screenFile, musicFile }) => {
  return (
    <AbsoluteFill style={{ background: "linear-gradient(135deg, #0f1a20 0%, #16302a 100%)" }}>
      <Audio src={staticFile(audioFile)} />
      {musicFile ? <Audio src={staticFile(musicFile)} volume={0.07} loop /> : null}
      {screenFile ? (
        <AbsoluteFill style={{ backgroundColor: "#0b1116", justifyContent: "center", alignItems: "center" }}>
          <OffthreadVideo src={staticFile(screenFile)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <div style={{ color: "#2f9b7a", fontFamily: "Georgia, serif", fontSize: 44, opacity: 0.4 }}>{title}</div>
        </AbsoluteFill>
      )}
      <div style={{ position: "absolute", top: 40, right: 56, color: "#9fd9c6", fontFamily: "Georgia, serif", fontSize: 26, opacity: 0.5 }}>
        {title}
      </div>
      <Captions words={words} />
    </AbsoluteFill>
  );
};

export const Narrated: React.FC<NarratedProps> = (props) => {
  const mainFrames = Math.ceil((props.durationInSeconds + 0.4) * FPS);
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b1116" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={INTRO}>
          <TitleCard title={props.title} subtitle="" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition timing={linearTiming({ durationInFrames: TRANS })} presentation={fade()} />
        <TransitionSeries.Sequence durationInFrames={mainFrames}>
          <Main {...props} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition timing={linearTiming({ durationInFrames: TRANS })} presentation={fade()} />
        <TransitionSeries.Sequence durationInFrames={OUTRO}>
          <Outro title={props.title} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};

export const calculateNarratedMetadata = ({ props }: { props: NarratedProps }) => ({
  fps: FPS,
  // Transitions overlap adjacent sequences, so subtract them from the total.
  durationInFrames: INTRO + Math.ceil((props.durationInSeconds + 0.4) * FPS) + OUTRO - 2 * TRANS,
});
