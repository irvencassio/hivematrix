import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// A branded animated title card — proves the toolchain renders, and is the seed
// of the how-to template's intro/outro.
export const TitleCard: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200 } });
  const titleOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  const subOpacity = interpolate(frame, [20, 38], [0, 1], { extrapolateRight: "clamp" });

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
          fontSize: 120,
          fontWeight: 700,
          opacity: titleOpacity,
          transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
          letterSpacing: -2,
        }}
      >
        {title}
      </div>
      <div style={{ color: "#d8e0dc", fontSize: 44, marginTop: 18, opacity: subOpacity }}>
        {subtitle}
      </div>
    </AbsoluteFill>
  );
};
