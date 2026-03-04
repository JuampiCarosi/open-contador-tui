import { BoxRenderable, TextRenderable, type RenderContext } from "@opentui/core";
import { createHeader } from "../components/header";

export function createHomeScreen(ctx: RenderContext): BoxRenderable {
  const screen = new BoxRenderable(ctx, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 1,
  });

  screen.add(createHeader(ctx, "SOS Contador TUI", "Panel inicial en OpenTUI + Bun"));

  screen.add(
    new TextRenderable(ctx, {
      content: "Estructura base creada. Próximo paso: integrar listado real de facturas.",
      width: "100%",
      height: 1,
    }),
  );

  screen.add(
    new TextRenderable(ctx, {
      content: "Presiona q para salir.",
      width: "100%",
      height: 1,
    }),
  );

  return screen;
}
