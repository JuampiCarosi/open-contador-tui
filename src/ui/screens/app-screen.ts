import {
  BoxRenderable,
  TextRenderable,
  type KeyEvent,
  type RenderContext,
  StyledText,
  fg,
  type TextChunk,
} from "@opentui/core";
import type { Cliente, Factura } from "../../types";
import { SosContadorClient, SosContadorClientError } from "../../services/sos-contador-client";
import { calcularTotales, createEmptyDraft, draftFromFactura, type FacturaDraft } from "../state/invoice-draft";

type View = "inicio" | "nueva" | "facturas";
type Step = "cliente" | "items" | "detalle" | "confirmar";

interface Field {
  key: string;
  label: string;
  value: () => string;
  setValue?: (v: string) => void;
  action?: () => Promise<void> | void;
}

export function createAppScreen(ctx: RenderContext): BoxRenderable {
  const client = new SosContadorClient();
  const root = new BoxRenderable(ctx, {
    width: "100%",
    height: "100%",
    padding: 1,
    flexDirection: "column",
    onKeyDown: (key) => void onKeyDown(key),
    backgroundColor: "#0d1117",
    border: false,
  });
  root.focusable = true;

  const title = new TextRenderable(ctx, { content: "", fg: "#2dd4bf" });
  const helper = new TextRenderable(ctx, { content: "", fg: "#8b949e" });
  const body = new TextRenderable(ctx, { content: "", flexGrow: 1, fg: "#e6edf3" });
  const status = new TextRenderable(ctx, { content: "", fg: "#8b949e" });

  root.add(title);
  root.add(helper);
  root.add(body);
  root.add(status);

  let view: View = "inicio";
  let step: Step = "cliente";
  let cursor = 0;
  let editing = false;
  let draft: FacturaDraft = createEmptyDraft();
  let facturas: Factura[] = [];
  let clientes: Cliente[] = [];
  let invoiceCursor = 0;
  let loading = false;
  let clientPickerActive = false;
  let clientPickerCursor = 0;
  let facturaDetalle: Factura | null = null;
  let loadingDetalle = false;

  const inicioMenu = ["Nueva factura", "Listar facturas", "Sincronizar datos", "Salir"];

  function selectedFactura(): Factura | undefined {
    return facturas[invoiceCursor];
  }

  function clientSuggestions(cuit: string) {
    const normalized = cuit.replace(/\D/g, "");
    return clientes
      .filter((c) => c.cuit.includes(normalized) || c.razonSocial.toLowerCase().includes(cuit.toLowerCase()))
      .slice(0, 4);
  }

  function getFields(): Field[] {
    if (view !== "nueva") return [];

    if (step === "cliente") {
      return [
        {
          key: "seleccionarCliente",
          label: "Seleccionar de lista de clientes",
          value: () => "",
          action: () => {
            if (clientes.length === 0) {
              setStatus("No hay clientes. Sincronizá primero.");
              return;
            }
            clientPickerActive = true;
            clientPickerCursor = 0;
          },
        },
        { key: "cuit", label: "CUIT", value: () => draft.cliente.cuit, setValue: (v) => (draft.cliente.cuit = v) },
        {
          key: "razonSocial",
          label: "Razón social",
          value: () => draft.cliente.razonSocial,
          setValue: (v) => (draft.cliente.razonSocial = v),
        },
        { key: "email", label: "Email", value: () => draft.cliente.email ?? "", setValue: (v) => (draft.cliente.email = v) },
        {
          key: "direccion",
          label: "Dirección",
          value: () => draft.cliente.direccion ?? "",
          setValue: (v) => (draft.cliente.direccion = v),
        },
        {
          key: "autocompletar",
          label: "Autocompletar por CUIT",
          value: () => "",
          action: async () => {
            const result = await client.buscarClientePorCuit(draft.cliente.cuit);
            if (!result) {
              setStatus("No se encontró cliente para ese CUIT.");
              return;
            }
            draft.cliente = { ...draft.cliente, ...result };
            setStatus("Cliente autocompletado desde historial/API.");
          },
        },
        {
          key: "next",
          label: "Continuar a ítems",
          value: () => "",
          action: () => {
            if (!draft.cliente.cuit || !draft.cliente.razonSocial) {
              setStatus("CUIT y Razón social son obligatorios.");
              return;
            }
            step = "items";
            cursor = 0;
          },
        },
      ];
    }

    if (step === "items") {
      return [
        {
          key: "descripcion",
          label: "Descripción",
          value: () => draft.itemPendiente.descripcion,
          setValue: (v) => (draft.itemPendiente.descripcion = v),
        },
        {
          key: "cantidad",
          label: "Cantidad",
          value: () => String(draft.itemPendiente.cantidad),
          setValue: (v) => (draft.itemPendiente.cantidad = Number.parseFloat(v) || 0),
        },
        {
          key: "precio",
          label: "Precio unitario",
          value: () => String(draft.itemPendiente.precioUnitario),
          setValue: (v) => (draft.itemPendiente.precioUnitario = Number.parseFloat(v) || 0),
        },
        {
          key: "iva",
          label: "Alicuota IVA %",
          value: () => String(draft.itemPendiente.alicuotaIva),
          setValue: (v) => (draft.itemPendiente.alicuotaIva = Number.parseFloat(v) || 0),
        },
        {
          key: "add",
          label: "Agregar ítem",
          value: () => "",
          action: () => {
            if (!draft.itemPendiente.descripcion || draft.itemPendiente.cantidad <= 0 || draft.itemPendiente.precioUnitario <= 0) {
              setStatus("Completa descripción, cantidad y precio (>0).");
              return;
            }
            draft.items.push({ ...draft.itemPendiente });
            draft.itemPendiente = { descripcion: "", cantidad: 1, precioUnitario: 0, alicuotaIva: 21 };
            setStatus("Ítem agregado.");
          },
        },
        {
          key: "next",
          label: "Continuar a detalle",
          value: () => "",
          action: () => {
            if (!draft.items.length) {
              setStatus("Agrega al menos un ítem.");
              return;
            }
            step = "detalle";
            cursor = 0;
          },
        },
      ];
    }

    if (step === "detalle") {
      return [
        {
          key: "fechaEmision",
          label: "Fecha emisión",
          value: () => draft.fechaEmision,
          setValue: (v) => (draft.fechaEmision = v),
        },
        {
          key: "fechaVencimiento",
          label: "Fecha vencimiento",
          value: () => draft.fechaVencimiento,
          setValue: (v) => (draft.fechaVencimiento = v),
        },
        {
          key: "observaciones",
          label: "Observaciones",
          value: () => draft.observaciones,
          setValue: (v) => (draft.observaciones = v),
        },
        {
          key: "next",
          label: "Vista previa y emitir",
          value: () => "",
          action: () => {
            step = "confirmar";
            cursor = 0;
          },
        },
      ];
    }

    return [
      {
        key: "emitir",
        label: "Emitir factura",
        value: () => "",
        action: async () => {
          loading = true;
          render();
          try {
            const created = await client.crearFacturaDesdeDraft(draft);
            setStatus(`Factura ${created.numero} emitida correctamente.`);
            draft = createEmptyDraft();
            step = "cliente";
            view = "inicio";
          } catch (error) {
            const message = error instanceof SosContadorClientError ? error.message : "Error desconocido al emitir factura.";
            setStatus(message);
          } finally {
            loading = false;
          }
        },
      },
    ];
  }

  function setStatus(message: string) {
    status.content = `› ${message}`;
  }

  async function loadFacturaDetalle() {
    const sel = selectedFactura();
    if (!sel) return;
    loadingDetalle = true;
    facturaDetalle = null;
    render();
    try {
      facturaDetalle = (await client.obtenerFacturaDetalle(sel.id)) ?? sel;
    } catch {
      facturaDetalle = sel;
    } finally {
      loadingDetalle = false;
      render();
    }
  }

  async function syncData() {
    loading = true;
    render();
    try {
      [facturas, clientes] = await Promise.all([client.listarFacturas(), client.listarClientes()]);
      setStatus(`Sincronizado: ${facturas.length} facturas y ${clientes.length} clientes.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo sincronizar.";
      setStatus(message);
    } finally {
      loading = false;
      render();
    }
  }

  function renderInicio() {
    title.content = "╭─ SOS CONTADOR TERMINAL ───────────────────────────────────────────────────╮";
    helper.content = "↑/↓ mover • Enter seleccionar • q salir";
    const chunks: TextChunk[] = [];
    inicioMenu.forEach((item, i) => {
      const isSelected = cursor === i;
      chunks.push(isSelected ? fg("#2dd4bf")("❯ ") : fg("#8b949e")("  "));
      chunks.push(isSelected ? fg("#e6edf3")(item) : fg("#8b949e")(item));
      if (i < inicioMenu.length - 1) chunks.push(fg("#8b949e")("\n"));
    });
    body.content = new StyledText(chunks);
  }

  function renderFacturas() {
    title.content = "╭─ FACTURA (consulta) ──────────────────────────────────────────────────────╮";
    helper.content = "↑/↓ cambiar factura • Esc volver";
    if (!facturas.length) {
      body.content = "No hay facturas cargadas. Usa 'Sincronizar datos' en inicio.";
      return;
    }

    const f = facturaDetalle ?? selectedFactura();
    if (loadingDetalle || !f) {
      body.content = loadingDetalle ? "Cargando detalle de la factura..." : "Seleccionando factura...";
      return;
    }

    const chunks: TextChunk[] = [];
    const sep = "────────────────────────────────────────────────────────────────";
    const sep2 = "────────────────────────────────────────────────────────────────";

    chunks.push(fg("#2dd4bf")("FACTURA\n\n"));
    chunks.push(fg("#e6edf3")(`Nº ${f.numero}`));
    chunks.push(fg("#8b949e")("  ".repeat(20)));
    chunks.push(fg("#e6edf3")(`Fecha de emisión: ${f.fechaEmision}\n\n`));

    chunks.push(fg("#2dd4bf")("CLIENTE\n"));
    chunks.push(fg("#e6edf3")(`Razón social: ${f.cliente.razonSocial}\n`));
    chunks.push(fg("#e6edf3")(`CUIT: ${f.cliente.cuit}\n`));
    if (f.cliente.direccion) chunks.push(fg("#e6edf3")(`Dirección: ${f.cliente.direccion}\n`));
    if (f.cliente.email) chunks.push(fg("#e6edf3")(`Email: ${f.cliente.email}\n`));
    chunks.push(fg("#8b949e")("\n"));

    chunks.push(fg("#2dd4bf")("DETALLE\n"));
    chunks.push(fg("#8b949e")(`${sep}\n`));
    chunks.push(fg("#8b949e")("Descripción".padEnd(32) + "Cant.".padStart(8) + "P.Unit".padStart(12) + "IVA%".padStart(6) + "Subtotal".padStart(12) + "\n"));
    chunks.push(fg("#8b949e")(`${sep2}\n`));

    f.items.forEach((it) => {
      const neto = it.cantidad * it.precioUnitario;
      const totalLinea = neto * (1 + (it.alicuotaIva || 0) / 100);
      const desc = (it.descripcion || "(sin descripción)").slice(0, 30).padEnd(32);
      const cant = it.cantidad.toFixed(2).padStart(8);
      const pUnit = it.precioUnitario.toFixed(2).padStart(12);
      const iva = (it.alicuotaIva ?? 21).toFixed(0).padStart(6);
      const sub = (Number.isNaN(totalLinea) ? 0 : totalLinea).toFixed(2).padStart(12);
      chunks.push(fg("#e6edf3")(`${desc}${cant}${pUnit}${iva}${sub}\n`));
    });

    chunks.push(fg("#8b949e")(`${sep2}\n`));
    chunks.push(fg("#e6edf3")(`Subtotal neto:`.padEnd(58) + f.subtotal.toFixed(2).padStart(12) + "\n"));
    chunks.push(fg("#e6edf3")(`IVA:`.padEnd(58) + f.totalIva.toFixed(2).padStart(12) + "\n"));
    chunks.push(fg("#2dd4bf")(`TOTAL:`.padEnd(58) + f.total.toFixed(2).padStart(12) + "\n"));

    if (f.observaciones) {
      chunks.push(fg("#8b949e")("\nObservaciones: "));
      chunks.push(fg("#e6edf3")(`${f.observaciones}\n`));
    }

    chunks.push(fg("#8b949e")(`\nFactura ${invoiceCursor + 1} de ${facturas.length}`));

    body.content = new StyledText(chunks);
  }

  function renderNueva() {
    const fields = getFields();
    const totals = calcularTotales(draft);

    title.content = `╭─ NUEVA FACTURA (${step.toUpperCase()}) ───────────────────────────────────────────╮`;
    helper.content = clientPickerActive
      ? "↑/↓ elegir cliente • Enter seleccionar • Esc cancelar"
      : "↑/↓ mover • Enter editar/accionar • Esc atrás • Tab sugerencias cliente";

    const chunks: TextChunk[] = [];
    fields.forEach((f, i) => {
      const isSelected = cursor === i;
      const prefix = isSelected ? (editing && f.setValue ? "✎" : "❯") : " ";
      chunks.push(isSelected ? fg("#2dd4bf")(prefix + " ") : fg("#8b949e")(prefix + " "));
      if (f.action && !f.setValue) {
        chunks.push(isSelected ? fg("#e6edf3")(`[ ${f.label} ]`) : fg("#8b949e")(`[ ${f.label} ]`));
      } else {
        chunks.push(isSelected ? fg("#e6edf3")(`${f.label}: ${f.value()}`) : fg("#8b949e")(`${f.label}: ${f.value()}`));
      }
      chunks.push(fg("#8b949e")("\n"));
    });

    if (step === "cliente" && clientPickerActive) {
      chunks.push(fg("#2dd4bf")("\n▼ Seleccioná un cliente (↑/↓ Enter para elegir, Esc cancelar):\n"));
      clientes.slice(0, 10).forEach((c, i) => {
        const sel = i === clientPickerCursor;
        chunks.push(sel ? fg("#2dd4bf")("❯ ") : fg("#8b949e")("  "));
        chunks.push(sel ? fg("#e6edf3")(`${c.cuit} | ${c.razonSocial}\n`) : fg("#8b949e")(`${c.cuit} | ${c.razonSocial}\n`));
      });
    } else if (step === "cliente" && draft.cliente.cuit) {
      const sugerencias = clientSuggestions(draft.cliente.cuit);
      if (sugerencias.length) {
        chunks.push(fg("#8b949e")("\nClientes sugeridos (Tab para autocompletar):\n"));
        sugerencias.forEach((c) => chunks.push(fg("#e6edf3")(`  - ${c.cuit} | ${c.razonSocial}\n`)));
      }
    }

    chunks.push(
      fg("#8b949e")("\n"),
      fg("#e6edf3")(`Subtotal: ${totals.subtotal.toFixed(2)}  IVA: ${totals.totalIva.toFixed(2)}  Total: ${totals.total.toFixed(2)}`),
    );

    if (step === "items" && draft.items.length) {
      chunks.push(fg("#8b949e")("\n\nItems actuales:\n"));
      draft.items.forEach((it, index) => {
        chunks.push(fg("#e6edf3")(`  ${index + 1}. ${it.descripcion} | ${it.cantidad} x ${it.precioUnitario}\n`));
      });
    }

    body.content = new StyledText(chunks);
  }

  function render() {
    if (loading) {
      title.content = "Sincronizando con SOS Contador...";
      helper.content = "Esperá un momento.";
      body.content = "⏳";
      return;
    }

    if (view === "inicio") renderInicio();
    if (view === "facturas") renderFacturas();
    if (view === "nueva") renderNueva();
  }

  function onCharInput(field: Field, key: KeyEvent) {
    if (!field.setValue) return;
    const current = field.value();
    if (key.name === "backspace") field.setValue(current.slice(0, -1));
    else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) field.setValue(current + key.sequence);
  }

  async function onKeyDown(key: KeyEvent) {
    if (key.name === "q") {
      process.exit(0);
    }

    if (view === "inicio") {
      if (key.name === "down") cursor = (cursor + 1) % inicioMenu.length;
      if (key.name === "up") cursor = (cursor - 1 + inicioMenu.length) % inicioMenu.length;
      if (key.name === "enter" || key.name === "return") {
        const selected = inicioMenu[cursor];
        if (selected === "Nueva factura") {
          view = "nueva";
          step = "cliente";
          draft = createEmptyDraft();
          cursor = 0;
        } else if (selected === "Listar facturas") {
          view = "facturas";
          invoiceCursor = 0;
          facturaDetalle = null;
          void loadFacturaDetalle();
        } else if (selected === "Sincronizar datos") {
          await syncData();
        } else {
          process.exit(0);
        }
      }
      render();
      return;
    }

    if (view === "facturas") {
      if (key.name === "escape") {
        view = "inicio";
        cursor = 0;
      } else if (key.name === "down" && facturas.length) {
        invoiceCursor = (invoiceCursor + 1) % facturas.length;
        void loadFacturaDetalle();
      } else if (key.name === "up" && facturas.length) {
        invoiceCursor = (invoiceCursor - 1 + facturas.length) % facturas.length;
        void loadFacturaDetalle();
      }
      render();
      return;
    }

    if (clientPickerActive && step === "cliente") {
      if (key.name === "escape") {
        clientPickerActive = false;
      } else if (key.name === "down" && clientes.length) {
        clientPickerCursor = (clientPickerCursor + 1) % Math.min(clientes.length, 10);
      } else if (key.name === "up" && clientes.length) {
        clientPickerCursor = (clientPickerCursor - 1 + Math.min(clientes.length, 10)) % Math.min(clientes.length, 10);
      } else if ((key.name === "enter" || key.name === "return") && clientes[clientPickerCursor]) {
        draft.cliente = { ...clientes[clientPickerCursor]! };
        clientPickerActive = false;
        setStatus(`Cliente seleccionado: ${draft.cliente.razonSocial}`);
      }
      render();
      return;
    }

    const fields = getFields();
    const field = fields[cursor];
    if (!field) return;

    if (editing && field.setValue) {
      if (key.name === "enter" || key.name === "return" || key.name === "escape") editing = false;
      else onCharInput(field, key);
      render();
      return;
    }

    if (key.name === "down") cursor = (cursor + 1) % fields.length;
    if (key.name === "up") cursor = (cursor - 1 + fields.length) % fields.length;

    if (key.name === "escape") {
      if (clientPickerActive) {
        clientPickerActive = false;
      } else if (step === "cliente") {
        view = "inicio";
        cursor = 0;
      } else if (step === "items") {
        step = "cliente";
        cursor = 0;
      } else if (step === "detalle") {
        step = "items";
        cursor = 0;
      } else {
        step = "detalle";
        cursor = 0;
      }
    }

    if (key.name === "tab" && step === "cliente") {
      const suggestion = clientSuggestions(draft.cliente.cuit)[0];
      if (suggestion) {
        draft.cliente = { ...draft.cliente, ...suggestion };
        setStatus("Cliente autocompletado por sugerencia de historial.");
      }
    }

    if (key.name === "enter" || key.name === "return") {
      if (field.setValue && !field.action) editing = true;
      if (field.action) await field.action();
    }

    render();
  }

  void syncData();
  render();
  root.focus();
  return root;
}
