import { BoxRenderable, createCliRenderer } from "@opentui/core";
import { createAppScreen } from "./ui/screens/app-screen";

const renderer = await createCliRenderer({ useMouse: false, exitOnCtrlC: true });

const rootView = new BoxRenderable(renderer, {
  width: "100%",
  height: "100%",
  backgroundColor: "#0d1117",
});

rootView.focusable = false;
rootView.add(createAppScreen(renderer));
renderer.root.add(rootView);
