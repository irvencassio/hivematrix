import React from "react";
import { Composition } from "remotion";
import { TitleCard } from "./TitleCard";

// Compositions the renderer can target by id. The first real how-to template
// will live alongside this proof composition.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="TitleCard"
      component={TitleCard}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ title: "HiveMatrix", subtitle: "video factory — render proof" }}
    />
  );
};
