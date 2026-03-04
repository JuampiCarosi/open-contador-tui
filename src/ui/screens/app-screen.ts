import { BoxRenderable, TextRenderable, type KeyEvent, type RenderContext } from "@opentui/core";
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
  });
  root.focusable = true;

  const title = new TextRenderable(ctx, { content: "" });
  const helper = new TextRenderable(ctx, { content: "" });
  const body = new TextRenderable(ctx, { content: "", flexGrow: 1 });
  const status = new TextRenderable(ctx, { content: "" });

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
    }
  }

  function renderInicio() {
    title.content = "╭─ SOS CONTADOR TERMINAL ─ estilo terminal.shop ─────────────────────────────╮";
    helper.content = "↑/↓ mover • Enter seleccionar • q salir";
    body.content = inicioMenu
      .map((item, i) => `${cursor === i ? "❯" : " "} ${item}`)
      .join("\n");
  }

  function renderFacturas() {
    title.content = "╭─ FACTURAS EMITIDAS ──────────────────────────────────────────────────────────╮";
    helper.content = "↑/↓ navegar • Enter repetir factura editable • Esc volver";
    if (!facturas.length) {
      body.content = "No hay facturas cargadas. Usa 'Sincronizar datos' en inicio.";
      return;
    }

    const lines = facturas.slice(0, 12).map((f, i) => {
      const mark = i === invoiceCursor ? "❯" : " ";
      return `${mark} ${f.numero} | ${f.cliente.razonSocial} | ${f.cliente.cuit} | ${f.total.toFixed(2)}`;
    });

    const selected = selectedFactura();
    const detail = selected
      ? [
          "",
          "Detalle:",
          `Cliente: ${selected.cliente.razonSocial}`,
          `CUIT: ${selected.cliente.cuit}`,
          `Emisión: ${selected.fechaEmision}`,
          `Items: ${selected.items.length}`,
        ]
      : [];

    body.content = [...lines, ...detail].join("\n");
  }

  function renderNueva() {
    const fields = getFields();
    const totals = calcularTotales(draft);

    title.content = `╭─ NUEVA FACTURA (${step.toUpperCase()}) ────────────────────────────────────────╮`;
    helper.content = "↑/↓ mover • Enter editar/accionar • Esc atrás • Tab sugerencias cliente";

    const list = fields.map((f, i) => {
      const prefix = cursor === i ? (editing && f.setValue ? "✎" : "❯") : " ";
      if (f.action && !f.setValue) return `${prefix} [ ${f.label} ]`;
      return `${prefix} ${f.label}: ${f.value()}`;
    });

    if (step === "cliente" && draft.cliente.cuit) {
      const sugerencias = clientSuggestions(draft.cliente.cuit);
      if (sugerencias.length) {
        list.push("", "Clientes sugeridos:");
        sugerencias.forEach((c) => list.push(`  - ${c.cuit} | ${c.razonSocial}`));
      }
    }

    list.push(
      "",
      `Subtotal: ${totals.subtotal.toFixed(2)}  IVA: ${totals.totalIva.toFixed(2)}  Total: ${totals.total.toFixed(2)}`,
    );

    if (step === "items" && draft.items.length) {
      list.push("", "Items actuales:");
      draft.items.forEach((it, index) => {
        list.push(`  ${index + 1}. ${it.descripcion} | ${it.cantidad} x ${it.precioUnitario}`);
      });
    }

    body.content = list.join("\n");
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
      } else if (key.name === "up" && facturas.length) {
        invoiceCursor = (invoiceCursor - 1 + facturas.length) % facturas.length;
      } else if ((key.name === "enter" || key.name === "return") && selectedFactura()) {
        draft = draftFromFactura(selectedFactura()!);
        view = "nueva";
        step = "cliente";
        cursor = 0;
        setStatus(`Repitiendo factura ${selectedFactura()!.numero}. Editá antes de emitir.`);
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
      if (step === "cliente") {
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
  return root;
}
