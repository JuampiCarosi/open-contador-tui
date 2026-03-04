import { BoxRenderable, TextRenderable, type KeyEvent, type RenderContext } from "@opentui/core";
import { createHeader } from "../components/header";
import { createInvoiceDraftStore } from "../state/invoice-draft";

interface NewInvoiceScreenOptions {
  onExit: () => void;
}

type EditableField = {
  key: string;
  label: string;
  value: () => string;
  setValue: (value: string) => void;
};

export function createNewInvoiceScreen(
  ctx: RenderContext,
  options: NewInvoiceScreenOptions,
): BoxRenderable {
  const store = createInvoiceDraftStore();
  let selectedIndex = 0;
  let isEditing = false;
  let statusMessage = "Completa los datos y avanza con Enter.";

  const screen = new BoxRenderable(ctx, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 1,
    onKeyDown: (key: KeyEvent) => {
      handleKeyDown(key);
    },
  });

  screen.focusable = true;

  const title = createHeader(ctx, "Nueva factura", "Wizard (1/4)");
  const helpText = new TextRenderable(ctx, { content: "", height: 1 });
  const content = new TextRenderable(ctx, { content: "", flexGrow: 1 });
  const summaryBox = new BoxRenderable(ctx, { height: 6, border: true, paddingX: 1 });
  const summary = new TextRenderable(ctx, { content: "" });
  const status = new TextRenderable(ctx, { content: "", height: 1 });

  summaryBox.add(summary);

  screen.add(title);
  screen.add(helpText);
  screen.add(content);
  screen.add(summaryBox);
  screen.add(status);

  function getCurrentFields(): EditableField[] {
    const state = store.getState();

    if (state.currentStep === 1) {
      return [
        {
          key: "nombre",
          label: "Nombre",
          value: () => state.client.nombre,
          setValue: (value) => store.updateClient({ nombre: value }),
        },
        {
          key: "identificacion",
          label: "Identificación",
          value: () => state.client.identificacion,
          setValue: (value) => store.updateClient({ identificacion: value }),
        },
        {
          key: "email",
          label: "Email",
          value: () => state.client.email,
          setValue: (value) => store.updateClient({ email: value }),
        },
        {
          key: "action-next",
          label: "Continuar al paso 2",
          value: () => "",
          setValue: () => undefined,
        },
      ];
    }

    if (state.currentStep === 2) {
      return [
        {
          key: "descripcion",
          label: "Descripción",
          value: () => state.pendingItem.descripcion,
          setValue: (value) => store.updatePendingItem({ descripcion: value }),
        },
        {
          key: "cantidad",
          label: "Cantidad",
          value: () => String(state.pendingItem.cantidad),
          setValue: (value) =>
            store.updatePendingItem({ cantidad: Number.parseFloat(value || "0") || 0 }),
        },
        {
          key: "precio",
          label: "Precio",
          value: () => String(state.pendingItem.precio),
          setValue: (value) => store.updatePendingItem({ precio: Number.parseFloat(value || "0") || 0 }),
        },
        {
          key: "impuestos",
          label: "Impuestos %",
          value: () => String(state.pendingItem.impuestos),
          setValue: (value) =>
            store.updatePendingItem({ impuestos: Number.parseFloat(value || "0") || 0 }),
        },
        {
          key: "action-add",
          label: "Agregar ítem",
          value: () => "",
          setValue: () => undefined,
        },
        {
          key: "action-next",
          label: "Continuar al paso 3",
          value: () => "",
          setValue: () => undefined,
        },
      ];
    }

    if (state.currentStep === 3) {
      return [
        {
          key: "fecha",
          label: "Fecha (YYYY-MM-DD)",
          value: () => state.meta.fecha,
          setValue: (value) => store.updateMeta({ fecha: value }),
        },
        {
          key: "vencimiento",
          label: "Vencimiento",
          value: () => state.meta.vencimiento,
          setValue: (value) => store.updateMeta({ vencimiento: value }),
        },
        {
          key: "notas",
          label: "Notas / observaciones",
          value: () => state.meta.notas,
          setValue: (value) => store.updateMeta({ notas: value }),
        },
        {
          key: "action-next",
          label: "Ir a vista previa",
          value: () => "",
          setValue: () => undefined,
        },
      ];
    }

    return [
      {
        key: "action-confirm",
        label: "Confirmar factura",
        value: () => "",
        setValue: () => undefined,
      },
    ];
  }

  function handleAction(fieldKey: string) {
    switch (fieldKey) {
      case "action-add": {
        const added = store.addPendingItem();
        statusMessage = added ? "Ítem agregado." : "Debes escribir una descripción para agregar ítem.";
        break;
      }
      case "action-next":
        store.nextStep();
        selectedIndex = 0;
        break;
      case "action-confirm":
        store.markConfirmed();
        statusMessage = "Factura confirmada en memoria. Presiona Escape para volver.";
        break;
      default:
        break;
    }
  }

  function render() {
    const state = store.getState();
    const fields = getCurrentFields();
    const totals = store.getTotals();

    helpText.content =
      "↑/↓ mover, Enter editar/aceptar, Escape volver. En edición: escribe texto y Backspace borra.";

    const lines: string[] = [];
    lines.push(`Paso ${state.currentStep}/4`);
    lines.push("");

    if (state.currentStep === 4) {
      lines.push("Vista previa");
      lines.push(`Cliente: ${state.client.nombre} (${state.client.identificacion})`);
      lines.push(`Email: ${state.client.email}`);
      lines.push(`Fecha: ${state.meta.fecha} | Vence: ${state.meta.vencimiento}`);
      lines.push(`Notas: ${state.meta.notas || "(sin notas)"}`);
      lines.push("");
      lines.push("Ítems:");
      state.items.forEach((item, index) => {
        lines.push(
          `  ${index + 1}. ${item.descripcion} | ${item.cantidad} x ${item.precio.toFixed(2)} | IVA ${item.impuestos}%`,
        );
      });
      if (state.items.length === 0) {
        lines.push("  (sin ítems)");
      }
      lines.push("");
    } else if (state.currentStep === 2) {
      lines.push(`Ítems cargados: ${state.items.length}`);
      state.items.slice(-3).forEach((item, index) => {
        lines.push(`  ${state.items.length - 2 + index}. ${item.descripcion}`);
      });
      lines.push("");
    }

    fields.forEach((field, index) => {
      const activePointer = selectedIndex === index ? (isEditing ? "✎" : "▸") : " ";
      const value = field.value();
      if (field.key.startsWith("action-")) {
        lines.push(`${activePointer} [ ${field.label} ]`);
      } else {
        lines.push(`${activePointer} ${field.label}: ${value}`);
      }
    });

    if (state.currentStep > 1) {
      lines.push("");
      lines.push("Escape vuelve al paso anterior.");
    }

    content.content = lines.join("\n");
    summary.content = [
      "Resumen dinámico",
      `Subtotal: ${totals.subtotal.toFixed(2)}`,
      `Impuestos: ${totals.impuestos.toFixed(2)}`,
      `Total: ${totals.total.toFixed(2)}`,
    ].join("\n");
    status.content = statusMessage;
  }

  function updateFieldValue(field: EditableField, key: KeyEvent) {
    const currentValue = field.value();

    if (key.name === "backspace") {
      field.setValue(currentValue.slice(0, -1));
      return;
    }

    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      field.setValue(currentValue + key.sequence);
    }
  }

  function handleKeyDown(key: KeyEvent) {
    const fields = getCurrentFields();
    const selectedField = fields[selectedIndex];

    if (!selectedField) {
      return;
    }

    if (isEditing && !selectedField.key.startsWith("action-")) {
      if (key.name === "enter" || key.name === "return") {
        isEditing = false;
      } else if (key.name === "escape") {
        isEditing = false;
      } else {
        updateFieldValue(selectedField, key);
      }
      render();
      return;
    }

    if (key.name === "up") {
      selectedIndex = (selectedIndex - 1 + fields.length) % fields.length;
      render();
      return;
    }

    if (key.name === "down") {
      selectedIndex = (selectedIndex + 1) % fields.length;
      render();
      return;
    }

    if (key.name === "escape") {
      if (store.getState().currentStep === 1) {
        options.onExit();
      } else {
        store.previousStep();
        selectedIndex = 0;
      }
      render();
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      if (selectedField.key.startsWith("action-")) {
        handleAction(selectedField.key);
      } else {
        isEditing = true;
      }
      render();
    }
  }

  render();
  return screen;
}
