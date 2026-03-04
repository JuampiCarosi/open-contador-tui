import { BoxRenderable, TextRenderable, type KeyEvent, type RenderContext } from "@opentui/core";
import { createHeader } from "../components/header";
import { createNewInvoiceScreen } from "./new-invoice";

type MainView = "menu" | "new-invoice" | "drafts";

export function createHomeScreen(ctx: RenderContext): BoxRenderable {
  const screen = new BoxRenderable(ctx, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 1,
  });

  let currentView: MainView = "menu";
  let selectedMenuIndex = 0;

  const menuOptions = ["Nueva factura", "Borradores", "Salir"];
  const title = createHeader(ctx, "SOS Contador TUI", "Menú principal");
  const help = new TextRenderable(ctx, {
    content: "↑/↓ mover, Enter seleccionar, Escape volver.",
    height: 1,
  });
  const body = new BoxRenderable(ctx, {
    width: "100%",
    flexGrow: 1,
    onKeyDown: (key: KeyEvent) => handleKeyDown(key),
  });

  body.focusable = true;

  screen.add(title);
  screen.add(help);
  screen.add(body);

  function clearBody() {
    body.getChildren().forEach((child) => body.remove(child.id));
  }

  function renderMenu() {
    clearBody();

    const menuText = new TextRenderable(ctx, {
      content: menuOptions
        .map((option, index) => {
          const cursor = index === selectedMenuIndex ? "▸" : " ";
          return `${cursor} ${option}`;
        })
        .join("\n"),
      width: "100%",
      height: menuOptions.length,
    });

    const hint = new TextRenderable(ctx, {
      content: "Presiona Escape o selecciona 'Salir' para cerrar.",
      width: "100%",
      height: 1,
      marginTop: 1,
    });

    body.add(menuText);
    body.add(hint);
  }

  function renderDrafts() {
    clearBody();
    body.add(
      new TextRenderable(ctx, {
        content: "Borradores\n\nNo hay borradores guardados aún.\n\nEscape para volver al menú.",
        width: "100%",
      }),
    );
  }

  function openNewInvoice() {
    clearBody();
    const wizard = createNewInvoiceScreen(ctx, {
      onExit: () => {
        currentView = "menu";
        renderMenu();
      },
    });
    body.add(wizard);
    wizard.focus();
  }

  function handleKeyDown(key: KeyEvent) {
    if (currentView === "menu") {
      if (key.name === "up") {
        selectedMenuIndex = (selectedMenuIndex - 1 + menuOptions.length) % menuOptions.length;
        renderMenu();
      } else if (key.name === "down") {
        selectedMenuIndex = (selectedMenuIndex + 1) % menuOptions.length;
        renderMenu();
      } else if (key.name === "enter" || key.name === "return") {
        const option = menuOptions[selectedMenuIndex];
        if (option === "Nueva factura") {
          currentView = "new-invoice";
          openNewInvoice();
        } else if (option === "Borradores") {
          currentView = "drafts";
          renderDrafts();
        } else {
          process.exit(0);
        }
      } else if (key.name === "escape") {
        process.exit(0);
      }
      return;
    }

    if (currentView === "drafts" && key.name === "escape") {
      currentView = "menu";
      renderMenu();
    }
  }

  renderMenu();
  setTimeout(() => body.focus(), 0);

  return screen;
}
