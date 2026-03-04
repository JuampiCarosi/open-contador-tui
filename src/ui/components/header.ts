import { TextRenderable, type RenderContext } from "@opentui/core";

export function createHeader(ctx: RenderContext, title: string, subtitle?: string): TextRenderable {
  return new TextRenderable(ctx, { content: subtitle ? `${title} - ${subtitle}` : title });
}
