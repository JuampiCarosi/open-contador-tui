import { BoxRenderable, TextRenderable, type RenderContext } from "@opentui/core";

export function createNewInvoiceScreen(ctx: RenderContext): BoxRenderable {
  const box = new BoxRenderable(ctx, { width: "100%", height: "100%" });
  box.add(
    new TextRenderable(ctx, {
      content: "Pantalla reemplazada por createAppScreen().",
    }),
  );
  return box;
}
