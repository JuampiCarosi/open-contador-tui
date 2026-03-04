import {
  BoxRenderable,
  TextRenderable,
  type KeyEvent,
  type RenderContext,
  StyledText,
  fg,
  type TextChunk,
} from "@opentui/core";
import type { Cliente, Factura, Producto, PosicionFiscal } from "../../types";

/** Formato argentino: 1.234,56 (punto miles, coma decimales) */
function formatMonto(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMontoPad(n: number, width: number): string {
  return formatMonto(n).padStart(width);
}
import { SosContadorClient, SosContadorClientError } from "../../services/sos-contador-client";
import { calcularTotales, createEmptyDraft, draftFromFactura, type FacturaDraft } from "../state/invoice-draft";

type View = "inicio" | "nueva" | "facturas" | "facturaDetalle" | "posicionFiscal";
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
  let productos: Producto[] = [];
  let productPickerActive = false;
  let productPickerCursor = 0;
  let posicionFiscal: PosicionFiscal | null = null;
  let loadingPosicion = false;
  let emailEnviando = false;
  let facturaRecienEmitida: Factura | null = null;
  let itemEditIndex: number | null = null;
  let emailInputActive = false;
  let emailInputValue = "";
  let emailInputContext: { factura: Factura; source: "detalle" | "inicio" } | null = null;

  const inicioMenu = ["Nueva factura", "Listar facturas", "Resumen posición fiscal", "Sincronizar datos", "Salir"];

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
            itemEditIndex = null;
          },
        },
      ];
    }

    if (step === "items") {
      const editingItem = itemEditIndex != null ? draft.items[itemEditIndex] : null;
      const target = editingItem ?? draft.itemPendiente;

      if (itemEditIndex != null && editingItem) {
        return [
          [
            { key: "descripcion", label: "Descripción", value: () => editingItem.descripcion, setValue: (v: string) => (editingItem.descripcion = v) },
            { key: "cantidad", label: "Cantidad", value: () => String(editingItem.cantidad), setValue: (v: string) => (editingItem.cantidad = Number.parseFloat(v) || 0) },
            { key: "precio", label: "Precio unitario", value: () => String(editingItem.precioUnitario), setValue: (v: string) => (editingItem.precioUnitario = Number.parseFloat(v) || 0) },
            { key: "iva", label: "Alicuota IVA %", value: () => String(editingItem.alicuotaIva), setValue: (v: string) => (editingItem.alicuotaIva = Number.parseFloat(v) || 0) },
            {
              key: "guardar",
              label: "Guardar cambios",
              value: () => "",
              action: () => {
                itemEditIndex = null;
                setStatus("Cambios guardados.");
              },
            },
            {
              key: "eliminar",
              label: "Eliminar ítem",
              value: () => "",
              action: () => {
                draft.items.splice(itemEditIndex!, 1);
                itemEditIndex = null;
                setStatus("Ítem eliminado.");
              },
            },
          ],
        ].flat();
      }

      const itemFields: Field[] = draft.items.map((it, i) => ({
        key: `item${i}`,
        label: `Ítem ${i + 1}: ${it.descripcion.slice(0, 25)} | ${it.cantidad} x ${it.precioUnitario}`,
        value: () => "",
        action: () => {
          itemEditIndex = i;
          cursor = 0;
        },
      }));

      return [
        {
          key: "seleccionarProducto",
          label: "Seleccionar de inventario",
          value: () => "",
          action: async () => {
            if (productos.length === 0) {
              try {
                productos = await client.listarProductos();
              } catch {
                setStatus("No se pudo cargar inventario.");
                return;
              }
            }
            if (productos.length === 0) {
              setStatus("No hay productos en el inventario. Sincronizá o cargá productos en SOS.");
              return;
            }
            productPickerActive = true;
            productPickerCursor = 0;
          },
        },
        ...itemFields,
        {
          key: "descripcion",
          label: "Descripción",
          value: () => target.descripcion,
          setValue: (v) => (target.descripcion = v),
        },
        {
          key: "cantidad",
          label: "Cantidad",
          value: () => String(target.cantidad),
          setValue: (v) => (target.cantidad = Number.parseFloat(v) || 0),
        },
        {
          key: "precio",
          label: "Precio unitario",
          value: () => String(target.precioUnitario),
          setValue: (v) => (target.precioUnitario = Number.parseFloat(v) || 0),
        },
        {
          key: "iva",
          label: "Alicuota IVA %",
          value: () => String(target.alicuotaIva),
          setValue: (v) => (target.alicuotaIva = Number.parseFloat(v) || 0),
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
          label: "Ver vista previa",
          value: () => "",
          action: () => {
            step = "confirmar";
            cursor = 0;
          },
        },
      ];
    }

    if (step === "confirmar") {
      return [
        {
          key: "emitir",
          label: "Confirmar y emitir",
          value: () => "",
          action: async () => {
          loading = true;
          render();
          try {
            const created = await client.crearFacturaDesdeDraft(draft);
            facturaRecienEmitida = created;
            setStatus(`Factura ${created.numero} emitida correctamente. [e] Enviar por mail`);
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
        {
          key: "volver",
          label: "Volver atrás",
          value: () => "",
          action: () => {
            step = "detalle";
            cursor = 0;
          },
        },
      ];
    }

    return [];
  }

  function setStatus(message: string) {
    status.content = `› ${message}`;
  }

  async function loadPosicionFiscal() {
    loadingPosicion = true;
    posicionFiscal = null;
    render();
    try {
      posicionFiscal = await client.obtenerPosicionFiscal();
    } catch {
      posicionFiscal = null;
    } finally {
      loadingPosicion = false;
      render();
    }
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
    helper.content = facturaRecienEmitida
      ? "↑/↓ mover • Enter seleccionar • e enviar factura por mail • q salir"
      : "↑/↓ mover • Enter seleccionar • q salir";
    const chunks: TextChunk[] = [];
    if (facturaRecienEmitida) {
      chunks.push(fg("#2dd4bf")("✓ Factura "));
      chunks.push(fg("#e6edf3")(`${facturaRecienEmitida.numero}`));
      chunks.push(fg("#2dd4bf")(" emitida. "));
      chunks.push(fg("#8b949e")("[e] Enviar por mail\n\n"));
    }
    inicioMenu.forEach((item, i) => {
      const isSelected = cursor === i;
      chunks.push(isSelected ? fg("#2dd4bf")("❯ ") : fg("#8b949e")("  "));
      chunks.push(isSelected ? fg("#e6edf3")(item) : fg("#8b949e")(item));
      if (i < inicioMenu.length - 1) chunks.push(fg("#8b949e")("\n"));
    });
    body.content = new StyledText(chunks);
  }

  function renderFacturas() {
    title.content = "╭─ LISTADO DE FACTURAS ───────────────────────────────────────────────────╮";
    helper.content = "↑/↓ mover • Enter ver detalle • Esc volver";
    if (!facturas.length) {
      body.content = "No hay facturas cargadas. Usa 'Sincronizar datos' en inicio.";
      return;
    }

    const chunks: TextChunk[] = [];
    chunks.push(fg("#2dd4bf")("Seleccioná una factura para ver el detalle:\n\n"));
    facturas.forEach((f, i) => {
      const sel = i === invoiceCursor;
      const color = sel ? fg("#e6edf3") : fg("#8b949e");
      chunks.push(sel ? fg("#2dd4bf")("❯ ") : fg("#8b949e")("  "));
      chunks.push(color(`${f.numero.padEnd(14)} ${f.fechaEmision}  ${f.cliente.razonSocial.slice(0, 35).padEnd(35)} $${formatMonto(f.total)}\n`));
    });
    chunks.push(fg("#8b949e")("\n"));
    chunks.push(fg("#8b949e")(`${invoiceCursor + 1} de ${facturas.length}`));
    body.content = new StyledText(chunks);
  }

  function renderFacturaDetalle() {
    const f = facturaDetalle ?? selectedFactura();
    title.content = "╭─ DETALLE DE FACTURA ────────────────────────────────────────────────────╮";
    helper.content = "r Repetir • e Enviar por mail • Esc volver al listado";
    if (!f) {
      body.content = "No hay factura seleccionada.";
      return;
    }
    if (loadingDetalle) {
      body.content = "Cargando detalle...";
      return;
    }

    const chunks: TextChunk[] = [];
    const sep = "────────────────────────────────────────────────────────────────";
    const sep2 = "────────────────────────────────────────────────────────────────";

    chunks.push(fg("#2dd4bf")("FACTURA\n\n"));
    chunks.push(fg("#e6edf3")(`Nº ${f.numero}`));
    chunks.push(fg("#8b949e")("  ".repeat(20)));
    chunks.push(fg("#e6edf3")(`Fecha de emisión: ${f.fechaEmision}\n`));
    if (f.caeNumero || f.caeVencimiento) {
      chunks.push(fg("#2dd4bf")("CAE: "));
      chunks.push(fg("#e6edf3")(`${f.caeNumero ?? "-"}`));
      if (f.caeVencimiento) chunks.push(fg("#8b949e")(`  Vencimiento: ${f.caeVencimiento}`));
      chunks.push(fg("#e6edf3")("\n"));
    }
    chunks.push(fg("#8b949e")("\n"));

    chunks.push(fg("#2dd4bf")("CLIENTE\n"));
    chunks.push(fg("#e6edf3")(`Razón social: ${f.cliente.razonSocial}\n`));
    chunks.push(fg("#e6edf3")(`CUIT: ${f.cliente.cuit}\n`));
    if (f.cliente.direccion) chunks.push(fg("#e6edf3")(`Dirección: ${f.cliente.direccion}\n`));
    if (f.cliente.email) chunks.push(fg("#e6edf3")(`Email: ${f.cliente.email}\n`));
    chunks.push(fg("#8b949e")("\n"));

    chunks.push(fg("#2dd4bf")("DETALLE\n"));
    chunks.push(fg("#8b949e")(`${sep}\n`));
    chunks.push(fg("#8b949e")("Descripción".padEnd(32) + "Cant.".padStart(10) + "P.Unit".padStart(14) + "IVA%".padStart(6) + "Subtotal".padStart(14) + "\n"));
    chunks.push(fg("#8b949e")(`${sep2}\n`));

    f.items.forEach((it) => {
      const neto = it.cantidad * it.precioUnitario;
      const totalLinea = neto * (1 + (it.alicuotaIva || 0) / 100);
      const desc = (it.descripcion || "(sin descripción)").slice(0, 30).padEnd(32);
      chunks.push(fg("#e6edf3")(`${desc}${formatMontoPad(it.cantidad, 10)}${formatMontoPad(it.precioUnitario, 14)}${String(it.alicuotaIva ?? 21).padStart(6)}${formatMontoPad(Number.isNaN(totalLinea) ? 0 : totalLinea, 14)}\n`));
    });

    chunks.push(fg("#8b949e")(`${sep2}\n`));
    chunks.push(fg("#e6edf3")(`Subtotal neto:`.padEnd(58) + formatMontoPad(f.subtotal, 14) + "\n"));
    chunks.push(fg("#e6edf3")(`IVA:`.padEnd(58) + formatMontoPad(f.totalIva, 14) + "\n"));
    chunks.push(fg("#2dd4bf")(`TOTAL:`.padEnd(58) + formatMontoPad(f.total, 14) + "\n"));

    if (f.observaciones) {
      chunks.push(fg("#8b949e")("\nObservaciones: "));
      chunks.push(fg("#e6edf3")(`${f.observaciones}\n`));
    }

    chunks.push(fg("#2dd4bf")("\n[r] Repetir factura  [e] Enviar por mail"));
    if (emailEnviando) chunks.push(fg("#8b949e")("  (enviando...)"));

    body.content = new StyledText(chunks);
  }

  function renderPosicionFiscal() {
    title.content = "╭─ RESUMEN DE POSICIÓN FISCAL ────────────────────────────────────────────╮";
    helper.content = "Esc volver";
    if (loadingPosicion) {
      body.content = "Cargando posición fiscal...";
      return;
    }
    if (!posicionFiscal) {
      body.content =
        "No se pudo obtener el resumen. La API de SOS Contador puede no exponer este endpoint (cuit/parametros).\n\nVerificá la documentación de SOS Contador para el endpoint correcto.";
      return;
    }

    const p = posicionFiscal;
    const fmt = (n?: number) => (n != null ? n.toLocaleString("es-AR", { minimumFractionDigits: 2 }) : "-");
    const chunks: TextChunk[] = [];
    chunks.push(fg("#2dd4bf")("Últimos 365 días\n\n"));
    chunks.push(fg("#8b949e")("────────────────────────────────────────────────────────────────\n"));
    chunks.push(fg("#2dd4bf")("Ventas y ND: "));
    chunks.push(fg("#e6edf3")(`${fmt(p.ventasYND)}\n`));
    chunks.push(fg("#2dd4bf")("Notas de Crédito: "));
    chunks.push(fg("#e6edf3")(`${fmt(p.notasCredito)}\n`));
    chunks.push(fg("#2dd4bf")("Total ventas: "));
    chunks.push(fg("#e6edf3")(`${fmt(p.totalVentas)}\n`));
    chunks.push(fg("#2dd4bf")("Compras: "));
    chunks.push(fg("#e6edf3")(`${fmt(p.compras)}\n`));
    chunks.push(fg("#8b949e")("────────────────────────────────────────────────────────────────\n"));
    chunks.push(fg("#2dd4bf")("Tope Cat. D (S): "));
    chunks.push(fg("#e6edf3")(`${fmt(p.topeCatD)}\n`));
    chunks.push(fg("#2dd4bf")("Consumido %: "));
    chunks.push(fg("#e6edf3")(`${fmt(p.consumidoCatD)}%\n`));
    chunks.push(fg("#2dd4bf")("Remanente facturable: "));
    chunks.push(fg("#e6edf3")(`${fmt(p.remanenteFacturable)}\n`));
    chunks.push(fg("#8b949e")("────────────────────────────────────────────────────────────────\n"));
    chunks.push(fg("#2dd4bf")("Tope Máximo Serv (K): "));
    chunks.push(fg("#e6edf3")(`${fmt(p.topeMaxServK)}\n`));
    chunks.push(fg("#2dd4bf")("Consumido %: "));
    chunks.push(fg("#e6edf3")(`${fmt(p.consumidoMaxServK)}%\n`));
    chunks.push(fg("#2dd4bf")("Remanente para RINS: "));
    chunks.push(fg("#e6edf3")(`${fmt(p.remanenteRINS)}\n`));
    chunks.push(fg("#8b949e")("────────────────────────────────────────────────────────────────\n"));
    chunks.push(fg("#2dd4bf")("% Compras + Gastos s/Tope (40% Cat.K): "));
    chunks.push(fg("#e6edf3")(`${fmt(p.pctComprasGastos)}%\n`));
    chunks.push(fg("#2dd4bf")("Remanente compras + gastos: "));
    chunks.push(fg("#e6edf3")(`${fmt(p.remanenteComprasGastos)}\n`));

    if (p.raw && Object.keys(p.raw).length > 0 && !p.ventasYND && !p.topeCatD) {
      chunks.push(fg("#8b949e")("\n(Datos crudos de la API - estructura puede variar)\n"));
      for (const [k, v] of Object.entries(p.raw).slice(0, 15)) {
        if (v != null && typeof v !== "object") chunks.push(fg("#8b949e")(`  ${k}: ${String(v)}\n`));
      }
    }

    body.content = new StyledText(chunks);
  }

  function renderNueva() {
    const fields = getFields();
    const totals = calcularTotales(draft);

    if (step === "confirmar") {
      title.content = "╭─ VISTA PREVIA ─ Confirmar y emitir ────────────────────────────────────────╮";
      helper.content = "↑/↓ mover • Enter confirmar y emitir • Esc volver atrás";
      const sep = "────────────────────────────────────────────────────────────────";
      const chunks: TextChunk[] = [];
      chunks.push(fg("#2dd4bf")("FACTURA (borrador)\n\n"));
      chunks.push(fg("#e6edf3")(`Fecha: ${draft.fechaEmision}\n\n`));
      chunks.push(fg("#2dd4bf")("CLIENTE\n"));
      chunks.push(fg("#e6edf3")(`Razón social: ${draft.cliente.razonSocial}\n`));
      chunks.push(fg("#e6edf3")(`CUIT: ${draft.cliente.cuit}\n`));
      if (draft.cliente.email) chunks.push(fg("#e6edf3")(`Email: ${draft.cliente.email}\n`));
      chunks.push(fg("#8b949e")("\n"));
      chunks.push(fg("#2dd4bf")("DETALLE\n"));
      chunks.push(fg("#8b949e")(`${sep}\n`));
      chunks.push(fg("#8b949e")("Descripción".padEnd(32) + "Cant.".padStart(10) + "P.Unit".padStart(14) + "IVA%".padStart(6) + "Subtotal".padStart(14) + "\n"));
      chunks.push(fg("#8b949e")(`${sep}\n`));
      draft.items.forEach((it) => {
        const neto = it.cantidad * it.precioUnitario;
        const totalLinea = neto * (1 + (it.alicuotaIva || 0) / 100);
        const desc = (it.descripcion || "(sin descripción)").slice(0, 30).padEnd(32);
        chunks.push(fg("#e6edf3")(`${desc}${formatMontoPad(it.cantidad, 10)}${formatMontoPad(it.precioUnitario, 14)}${String(it.alicuotaIva ?? 21).padStart(6)}${formatMontoPad(Number.isNaN(totalLinea) ? 0 : totalLinea, 14)}\n`));
      });
      chunks.push(fg("#8b949e")(`${sep}\n`));
      chunks.push(fg("#e6edf3")(`Subtotal neto:`.padEnd(58) + formatMontoPad(totals.subtotal, 14) + "\n"));
      chunks.push(fg("#e6edf3")(`IVA:`.padEnd(58) + formatMontoPad(totals.totalIva, 14) + "\n"));
      chunks.push(fg("#2dd4bf")(`TOTAL:`.padEnd(58) + formatMontoPad(totals.total, 14) + "\n"));
      if (draft.observaciones) chunks.push(fg("#8b949e")("\nObservaciones: "), fg("#e6edf3")(`${draft.observaciones}\n`));
      const confFields = getFields();
      const confCursor = Math.min(cursor, confFields.length - 1);
      chunks.push(fg("#8b949e")("\n"));
      confFields.forEach((cf, i) => {
        const sel = i === confCursor;
        chunks.push(sel ? fg("#2dd4bf")("❯ ") : fg("#8b949e")("  "));
        chunks.push(sel ? fg("#e6edf3")(cf.label) : fg("#8b949e")(cf.label));
        chunks.push(fg("#8b949e")("\n"));
      });
      body.content = new StyledText(chunks);
      return;
    }

    title.content = `╭─ NUEVA FACTURA (${step.toUpperCase()}) ───────────────────────────────────────────╮`;
    helper.content = clientPickerActive
      ? "↑/↓ elegir cliente • Enter seleccionar • Esc cancelar"
      : productPickerActive
        ? "↑/↓ elegir producto • Enter agregar • Esc cancelar"
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
    } else if (step === "items" && productPickerActive) {
      chunks.push(fg("#2dd4bf")("\n▼ Seleccioná un producto (↑/↓ Enter para agregar, Esc cancelar):\n"));
      productos.slice(0, 12).forEach((p, i) => {
        const sel = i === productPickerCursor;
        const color = sel ? fg("#e6edf3") : fg("#8b949e");
        chunks.push(sel ? fg("#2dd4bf")("❯ ") : fg("#8b949e")("  "));
        chunks.push(color(`${(p.descripcion || p.codigo || "").slice(0, 35).padEnd(35)} $${formatMonto(p.precioUnitario)} IVA ${p.alicuotaIva}%\n`));
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
      fg("#e6edf3")(`Subtotal: ${formatMonto(totals.subtotal)}  IVA: ${formatMonto(totals.totalIva)}  Total: ${formatMonto(totals.total)}`),
    );

    if (step === "items" && draft.items.length) {
      chunks.push(fg("#8b949e")("\n\nItems actuales:\n"));
      draft.items.forEach((it, index) => {
        chunks.push(fg("#e6edf3")(`  ${index + 1}. ${it.descripcion} | ${formatMonto(it.cantidad)} x ${formatMonto(it.precioUnitario)}\n`));
      });
    }

    body.content = new StyledText(chunks);
  }

  function renderEmailInput() {
    title.content = "╭─ ENVIAR FACTURA POR MAIL ───────────────────────────────────────────────────╮";
    helper.content = "Ingresá emails separados por coma • Enter enviar • Esc cancelar";
    const chunks: TextChunk[] = [];
    chunks.push(fg("#2dd4bf")("Emails (separados por coma):\n\n"));
    chunks.push(fg("#e6edf3")(emailInputValue || "(vacío)"));
    chunks.push(fg("#8b949e")("▌"));
    if (emailEnviando) chunks.push(fg("#8b949e")("\n\nEnviando..."));
    body.content = new StyledText(chunks);
  }

  function render() {
    if (loading) {
      title.content = "Sincronizando con SOS Contador...";
      helper.content = "Esperá un momento.";
      body.content = "⏳";
      return;
    }

    if (emailInputActive) {
      renderEmailInput();
      return;
    }

    if (view === "inicio") renderInicio();
    if (view === "facturas") renderFacturas();
    if (view === "facturaDetalle") renderFacturaDetalle();
    if (view === "posicionFiscal") renderPosicionFiscal();
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
      if (key.name === "e" && facturaRecienEmitida) {
        const f = facturaRecienEmitida;
        if (f.cliente.id) {
          emailInputActive = true;
          emailInputValue = f.cliente.email ?? process.env.SOS_CONTADOR_EMAIL ?? "";
          emailInputContext = { factura: f, source: "inicio" };
        } else {
          setStatus("El cliente no tiene ID para enviar.");
        }
        render();
        return;
      }
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
        } else if (selected === "Resumen posición fiscal") {
          view = "posicionFiscal";
          void loadPosicionFiscal();
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
      } else if ((key.name === "enter" || key.name === "return") && facturas.length) {
        facturaDetalle = null;
        loadingDetalle = true;
        view = "facturaDetalle";
        void loadFacturaDetalle();
      }
      render();
      return;
    }

    if (emailInputActive) {
      if (key.name === "escape") {
        emailInputActive = false;
        emailInputContext = null;
      } else if (key.name === "enter" || key.name === "return") {
        const ctx = emailInputContext;
        if (!ctx) return;
        const emails = emailInputValue
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.length > 0 && e.includes("@"));
        if (emails.length === 0) {
          setStatus("Ingresá al menos un email válido.");
        } else if (!ctx.factura.cliente.id) {
          setStatus("El cliente no tiene ID. No se puede enviar.");
        } else {
          emailEnviando = true;
          render();
          try {
            for (const email of emails) {
              await client.enviarFacturaPorEmail(ctx.factura.id, ctx.factura.cliente.id, email);
            }
            setStatus(`Factura enviada a ${emails.join(", ")}`);
            if (ctx.source === "inicio") facturaRecienEmitida = null;
            emailInputActive = false;
            emailInputContext = null;
          } catch (err) {
            setStatus(err instanceof SosContadorClientError ? err.message : "Error al enviar email.");
          } finally {
            emailEnviando = false;
          }
        }
      } else if (key.name === "backspace") {
        emailInputValue = emailInputValue.slice(0, -1);
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        emailInputValue += key.sequence;
      }
      render();
      return;
    }

    if (view === "facturaDetalle") {
      if (key.name === "escape") {
        view = "facturas";
        facturaDetalle = null;
      } else if (key.name === "r") {
        const f = facturaDetalle ?? selectedFactura();
        if (f) {
          draft = draftFromFactura(f);
          view = "nueva";
          step = "items";
          cursor = 0;
          itemEditIndex = null;
          setStatus("Factura cargada para repetir. Editá ítems con Enter, luego emití.");
        }
      } else if (key.name === "e") {
        const f = facturaDetalle ?? selectedFactura();
        if (f && f.cliente.id) {
          emailInputActive = true;
          emailInputValue = f.cliente.email ?? process.env.SOS_CONTADOR_EMAIL ?? "";
          emailInputContext = { factura: f, source: "detalle" };
        } else {
          setStatus("El cliente debe tener ID para enviar.");
        }
      }
      render();
      return;
    }

    if (view === "posicionFiscal") {
      if (key.name === "escape") {
        view = "inicio";
        cursor = 0;
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

    if (productPickerActive && step === "items") {
      if (key.name === "escape") {
        productPickerActive = false;
      } else if (key.name === "down" && productos.length) {
        productPickerCursor = (productPickerCursor + 1) % Math.min(productos.length, 12);
      } else if (key.name === "up" && productos.length) {
        productPickerCursor = (productPickerCursor - 1 + Math.min(productos.length, 12)) % Math.min(productos.length, 12);
      } else if ((key.name === "enter" || key.name === "return") && productos[productPickerCursor]) {
        const p = productos[productPickerCursor]!;
        draft.items.push({
          descripcion: p.descripcion,
          cantidad: 1,
          precioUnitario: p.precioUnitario,
          alicuotaIva: p.alicuotaIva,
        });
        draft.itemPendiente = { descripcion: "", cantidad: 1, precioUnitario: 0, alicuotaIva: 21 };
        productPickerActive = false;
        setStatus(`Producto agregado: ${p.descripcion}`);
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
