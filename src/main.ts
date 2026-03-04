import { BoxRenderable, createCliRenderer, type KeyEvent } from "@opentui/core";
import { createAppScreen } from "./ui/screens/app-screen";

const renderer = await createCliRenderer({ useMouse: false, exitOnCtrlC: true });

const rootView = new BoxRenderable(renderer, {
  width: "100%",
  height: "100%",
  onKeyDown: (key: KeyEvent) => {
    if (key.name === "q" && (key.ctrl || key.meta)) {
      renderer.destroy();
      process.exit(0);
    }
  },
});

rootView.focusable = true;
rootView.focus();
rootView.add(createAppScreen(renderer));
renderer.root.add(rootView);
