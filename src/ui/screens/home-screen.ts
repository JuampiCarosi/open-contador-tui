import { BoxRenderable, TextRenderable, type RenderContext } from "@opentui/core";

export function createHomeScreen(ctx: RenderContext): BoxRenderable {
  const box = new BoxRenderable(ctx, { width: "100%", height: "100%" });
  box.add(new TextRenderable(ctx, { content: "Usar createAppScreen()." }));
  return box;
}
