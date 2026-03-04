import { BoxRenderable, TextRenderable, type RenderContext } from "@opentui/core";

export function createHeader(ctx: RenderContext, title: string, subtitle: string): BoxRenderable {
  const container = new BoxRenderable(ctx, {
    width: "100%",
    height: 4,
    border: true,
    paddingX: 1,
    justifyContent: "center",
  });

  container.add(
    new TextRenderable(ctx, {
      content: title,
      height: 1,
    }),
  );

  container.add(
    new TextRenderable(ctx, {
      content: subtitle,
      height: 1,
    }),
  );

  return container;
}
