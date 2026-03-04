import { BoxRenderable, createCliRenderer, type KeyEvent } from "@opentui/core";
import { createHomeScreen } from "./ui/screens/home-screen";

const renderer = await createCliRenderer({
  useMouse: false,
  exitOnCtrlC: true,
});

const rootView = new BoxRenderable(renderer, {
  width: "100%",
  height: "100%",
  flexDirection: "column",
  onKeyDown: (key: KeyEvent) => {
    if (key.name === "q") {
      renderer.destroy();
      process.exit(0);
    }
  },
});

rootView.focusable = true;
rootView.focus();
rootView.add(createHomeScreen(renderer));
renderer.root.add(rootView);
