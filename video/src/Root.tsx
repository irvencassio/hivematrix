import React from "react";
import { Composition } from "remotion";
import { TitleCard } from "./TitleCard";
import { Narrated, calculateNarratedMetadata } from "./Narrated";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TitleCard"
        component={TitleCard}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "HiveMatrix", subtitle: "video factory" }}
      />
      <Composition
        id="Narrated"
        component={Narrated}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        calculateMetadata={calculateNarratedMetadata}
        defaultProps={{ audioFile: "narration.wav", words: [], title: "HiveMatrix", durationInSeconds: 8 }}
      />
    </>
  );
};
