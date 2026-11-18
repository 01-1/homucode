import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 64 / 21;
  return (
    <Svg
      accessibilityLabel="Homu"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 64 21"
    >
      <ThemedPath
        d="M2 2v16m0-8h11m0-8v16m5-6a5 5 0 1 0 10 0 5 5 0 1 0-10 0m15-5v11m0-7a4 4 0 0 1 8 0v7m0-7a4 4 0 0 1 8 0v7m5-11v7a4 4 0 0 0 8 0m0-7v11"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
