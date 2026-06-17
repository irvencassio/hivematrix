import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Closing card. Mirrors the TitleCard styling for a consistent bookend.
export const Outro: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0f1a20 0%, #16302a 100%)",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "Georgia, 'Iowan Old Style', serif",
      }}
    >
      <div
        style={{
          color: "#2f9b7a",
          fontSize: 100,
          fontWeight: 700,
          opacity,
          transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`,
          letterSpacing: -1,
        }}
      >
        {title}
      </div>
      <div style={{ color: "#d8e0dc", fontSize: 36, marginTop: 16, opacity }}>
        Made locally with HiveMatrix
      </div>
    </AbsoluteFill>
  );
};
