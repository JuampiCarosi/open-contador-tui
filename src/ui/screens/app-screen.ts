import {
  BoxRenderable,
  TextRenderable,
  type KeyEvent,
  type RenderContext,
  StyledText,
  bg,
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
import { DolarMepClient, DolarMepClientError } from "../../services/dolar-mep-client";
import {
  calcularTotales,
  convertUsdToArs,
  createEmptyDraft,
  draftFromFactura,
  emptyItem,
  isCotizacionStale,
  type FacturaDraft,
} from "../state/invoice-draft";

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
  const dolarMepClient = new DolarMepClient();
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
  let inputCursor = 0;
  let selectionAnchor: number | null = null;
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

  function getMayorPuntoVentaDisponible() {
    const fromFacturas = facturas
      .map((f) => f.puntoVenta)
      .filter((pv): pv is number => typeof pv === "number" && Number.isInteger(pv) && pv > 0);
    if (fromFacturas.length > 0) {
      return Math.max(...fromFacturas);
    }
    const fromEnv = Number.parseInt(process.env.SOS_CONTADOR_PUNTO_VENTA ?? "1", 10);
    return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 1;
  }

  function clampInputCursor(value: string) {
    inputCursor = Math.max(0, Math.min(inputCursor, value.length));
  }

  function setInputFocusToField(field?: Field) {
    if (!field?.setValue) {
      selectionAnchor = null;
      return;
    }
    const value = field.value();
    inputCursor = value.length;
    selectionAnchor = null;
  }

  function getSelectionRange(value: string): { start: number; end: number } | null {
    clampInputCursor(value);
    if (selectionAnchor == null) return null;
    const anchor = Math.max(0, Math.min(selectionAnchor, value.length));
    if (anchor === inputCursor) return null;
    return { start: Math.min(anchor, inputCursor), end: Math.max(anchor, inputCursor) };
  }

  function moveCursor(value: string, next: number, keepSelection: boolean) {
    const prev = inputCursor;
    inputCursor = Math.max(0, Math.min(next, value.length));
    if (keepSelection) {
      if (selectionAnchor == null) selectionAnchor = prev;
    } else {
      selectionAnchor = null;
    }
  }

  function moveWordLeft(value: string, from: number) {
    let i = Math.max(0, Math.min(from, value.length));
    while (i > 0 && /\s/.test(value[i - 1]!)) i -= 1;
    while (i > 0 && !/\s/.test(value[i - 1]!)) i -= 1;
    return i;
  }

  function moveWordRight(value: string, from: number) {
    let i = Math.max(0, Math.min(from, value.length));
    while (i < value.length && /\s/.test(value[i]!)) i += 1;
    while (i < value.length && !/\s/.test(value[i]!)) i += 1;
    return i;
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
        {
          key: "email",
          label: "Email",
          value: () => draft.cliente.email ?? "",
          setValue: (v) => (draft.cliente.email = v),
        },
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
      const target = draft.itemPendiente;
      const maxAgeMinutes = Number.parseInt(process.env.DOLAR_MEP_MAX_AGE_MINUTES ?? "180", 10);
      const maxAge = Number.isFinite(maxAgeMinutes) ? maxAgeMinutes : 180;

      const refreshCotizacionMep = async (forceRefresh = false) => {
        try {
          const quote = await dolarMepClient.obtenerMep({ forceRefresh });
          draft.cotizacionMep = {
            compra: quote.compra,
            venta: quote.venta,
            fechaActualizacion: quote.fechaActualizacion,
            fetchedAt: quote.fetchedAt,
          };
          if (quote.isStale) {
            setStatus("Cotización MEP desactualizada. Refrescá antes de usar USD.");
            return;
          }
          setStatus(`Cotización MEP ${quote.fromCache ? "cargada" : "actualizada"}: compra ${formatMonto(quote.compra)}.`);
        } catch (error) {
          const message = error instanceof DolarMepClientError ? error.message : "No se pudo obtener cotización MEP.";
          setStatus(message);
        }
      };

      const compraMep = draft.cotizacionMep?.compra;
      const itemInlineFields: Field[] = draft.items.flatMap((it, i) => {
        const precioUsd = compraMep && compraMep > 0 ? it.precioUnitario / compraMep : 0;
        return [
          {
            key: `item${i}-descripcion`,
            label: `Item ${i + 1} descripción`,
            value: () => it.descripcion,
            setValue: (v: string) => (it.descripcion = v),
          },
          {
            key: `item${i}-cantidad`,
            label: `Item ${i + 1} cantidad`,
            value: () => String(it.cantidad),
            setValue: (v: string) => (it.cantidad = Number.parseFloat(v.replace(",", ".")) || 0),
          },
          {
            key: `item${i}-precio`,
            label: `Item ${i + 1} precio (${draft.modoCargaMoneda})`,
            value: () => String(draft.modoCargaMoneda === "USD" ? precioUsd : it.precioUnitario),
            setValue: (v: string) => {
              const n = Number.parseFloat(v.replace(",", ".")) || 0;
              if (draft.modoCargaMoneda === "USD") {
                if (!compraMep || compraMep <= 0) return;
                it.precioUnitario = convertUsdToArs(n, compraMep);
                return;
              }
              it.precioUnitario = n;
            },
          },
          {
            key: `item${i}-iva`,
            label: `Item ${i + 1} IVA %`,
            value: () => String(it.alicuotaIva),
            setValue: (v: string) => (it.alicuotaIva = Number.parseFloat(v.replace(",", ".")) || 0),
          },
          {
            key: `item${i}-remove`,
            label: `Eliminar item ${i + 1}`,
            value: () => "",
            action: () => {
              draft.items.splice(i, 1);
              setStatus(`Item ${i + 1} eliminado.`);
            },
          },
        ];
      });

      return [
        {
          key: "monedaCarga",
          label: `Moneda de carga: ${draft.modoCargaMoneda}`,
          value: () => "",
          action: async () => {
            draft.modoCargaMoneda = draft.modoCargaMoneda === "ARS" ? "USD" : "ARS";
            setStatus(`Modo de carga cambiado a ${draft.modoCargaMoneda}.`);
            if (draft.modoCargaMoneda === "USD" && !draft.cotizacionMep) await refreshCotizacionMep();
          },
        },
        {
          key: "refreshMep",
          label: "Refrescar cotización MEP",
          value: () => "",
          action: async () => {
            await refreshCotizacionMep(true);
          },
        },
        ...itemInlineFields,
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
        {
          key: "nuevo-descripcion",
          label: "Nuevo ítem descripción",
          value: () => target.descripcion,
          setValue: (v) => (target.descripcion = v),
        },
        {
          key: "nuevo-cantidad",
          label: "Nuevo ítem cantidad",
          value: () => String(target.cantidad),
          setValue: (v) => (target.cantidad = Number.parseFloat(v.replace(",", ".")) || 0),
        },
        {
          key: "nuevo-precio",
          label: draft.modoCargaMoneda === "USD" ? "Nuevo ítem precio (USD)" : "Nuevo ítem precio",
          value: () => {
            if (draft.modoCargaMoneda === "USD") {
              if (!compraMep || compraMep <= 0) return "";
              return String(target.precioUnitario / compraMep);
            }
            return String(target.precioUnitario);
          },
          setValue: (v) => {
            const n = Number.parseFloat(v.replace(",", ".")) || 0;
            if (draft.modoCargaMoneda === "USD") {
              if (!compraMep || compraMep <= 0) return;
              target.precioUnitario = convertUsdToArs(n, compraMep);
              return;
            }
            target.precioUnitario = n;
          },
        },
        {
          key: "nuevo-iva",
          label: "Nuevo ítem IVA %",
          value: () => String(target.alicuotaIva),
          setValue: (v) => (target.alicuotaIva = Number.parseFloat(v.replace(",", ".")) || 0),
        },
        {
          key: "add",
          label: "Agregar ítem",
          value: () => "",
          action: () => {
            if (!target.descripcion || target.cantidad <= 0 || target.precioUnitario <= 0) {
              setStatus("Completa descripción, cantidad y precio (>0).");
              return;
            }
            if (draft.modoCargaMoneda === "USD") {
              if (!draft.cotizacionMep) {
                setStatus("Primero refrescá la cotización MEP para convertir USD.");
                return;
              }
              if (isCotizacionStale(draft.cotizacionMep.fechaActualizacion, maxAge)) {
                setStatus("La cotización MEP está desactualizada. Refrescá antes de agregar el ítem.");
                return;
              }
            }
            draft.items.push({ ...target });
            draft.itemPendiente = emptyItem();
            draft.precioUnitarioUsd = 0;
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
          key: "puntoVenta",
          label: "Punto de venta",
          value: () => String(draft.puntoVenta),
          setValue: (v) => {
            const pv = Number.parseInt(v, 10);
            draft.puntoVenta = Number.isInteger(pv) && pv > 0 ? pv : 1;
          },
        },
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
            if (!Number.isInteger(draft.puntoVenta) || draft.puntoVenta <= 0) {
              setStatus("El punto de venta debe ser un entero mayor a 0.");
              return;
            }
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
              const message =
                error instanceof SosContadorClientError ? error.message : "Error desconocido al emitir factura.";
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
      chunks.push(
        color(
          `${f.numero.padEnd(14)} ${f.fechaEmision}  ${f.cliente.razonSocial.slice(0, 35).padEnd(35)} $${formatMonto(f.total)}\n`,
        ),
      );
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
    chunks.push(
      fg("#8b949e")(
        "Descripción".padEnd(32) +
          "Cant.".padStart(10) +
          "P.Unit".padStart(14) +
          "IVA%".padStart(6) +
          "Subtotal".padStart(14) +
          "\n",
      ),
    );
    chunks.push(fg("#8b949e")(`${sep2}\n`));

    f.items.forEach((it) => {
      const neto = it.cantidad * it.precioUnitario;
      const totalLinea = neto * (1 + (it.alicuotaIva || 0) / 100);
      const desc = (it.descripcion || "(sin descripción)").slice(0, 30).padEnd(32);
      chunks.push(
        fg("#e6edf3")(
          `${desc}${formatMontoPad(it.cantidad, 10)}${formatMontoPad(it.precioUnitario, 14)}${String(it.alicuotaIva ?? 21).padStart(6)}${formatMontoPad(Number.isNaN(totalLinea) ? 0 : totalLinea, 14)}\n`,
        ),
      );
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
    const fuente = typeof p.raw?.["_fuente"] === "string" ? p.raw["_fuente"] : undefined;
    const categoria = typeof p.raw?.["_categoria_monotributo"] === "string" ? p.raw["_categoria_monotributo"] : "-";
    const origenCategoria =
      typeof p.raw?.["_categoria_monotributo_origen"] === "string" ? String(p.raw["_categoria_monotributo_origen"]) : undefined;

    chunks.push(fg("#22d3ee")("Últimos 365 días\n"));
    if (fuente === "consultas_venta_compra" || fuente === "api_parametros_mas_consultas") {
      chunks.push(fg("#94a3b8")("(Resumen combinado: API + consultas de ventas/compras/gastos)\n"));
      chunks.push(fg("#94a3b8")("(Solo se contabilizan ventas con CAE)\n\n"));
    } else {
      chunks.push(fg("#94a3b8")("\n"));
    }
    const sep = "────────────────────────────────────────────────────────────────";
    const row = (label: string, value: string, labelColor = "#22d3ee", valueColor = "#f8fafc") => {
      chunks.push(fg(labelColor)(`${label}: `));
      chunks.push(fg(valueColor)(`${value}\n`));
    };

    chunks.push(fg("#475569")(`${sep}\n`));
    row("Ventas y ND", fmt(p.ventasYND));
    row("Notas de Crédito", fmt(p.notasCredito));
    row("Total ventas", fmt(p.totalVentas), "#67e8f9", "#ffffff");
    row("Compras", fmt(p.compras));

    chunks.push(fg("#475569")(`${sep}\n`));
    row(
      "Categoría monotributo",
      origenCategoria === "estimada" ? `${String(categoria)} (estimada)` : String(categoria),
      "#f59e0b",
      "#ffffff",
    );
    row("Tope de categoría", fmt(p.topeCatD), "#f59e0b", "#ffffff");
    row("Consumido del tope", `${fmt(p.consumidoCatD)}%`, "#f59e0b", "#ffffff");
    row("Remanente hasta el tope", fmt(p.remanenteFacturable), "#f59e0b", "#ffffff");

    chunks.push(fg("#475569")(`${sep}\n`));
    row("Tope máximo monotributo", fmt(p.topeMaxServK), "#a78bfa", "#ffffff");
    row("Remanente al tope máximo", fmt(p.remanenteRINS), "#a78bfa", "#ffffff");

    chunks.push(fg("#475569")(`${sep}\n`));
    row("% Compras + Gastos s/Tope (40% Cat.K)", `${fmt(p.pctComprasGastos)}%`, "#38bdf8", "#ffffff");
    row("Remanente compras + gastos", fmt(p.remanenteComprasGastos), "#38bdf8", "#ffffff");

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
      chunks.push(fg("#e6edf3")(`Punto de venta: ${draft.puntoVenta}\n`));
      chunks.push(fg("#e6edf3")(`Fecha: ${draft.fechaEmision}\n\n`));
      chunks.push(fg("#2dd4bf")("CLIENTE\n"));
      chunks.push(fg("#e6edf3")(`Razón social: ${draft.cliente.razonSocial}\n`));
      chunks.push(fg("#e6edf3")(`CUIT: ${draft.cliente.cuit}\n`));
      if (draft.cliente.email) chunks.push(fg("#e6edf3")(`Email: ${draft.cliente.email}\n`));
      chunks.push(fg("#8b949e")("\n"));
      chunks.push(fg("#2dd4bf")("DETALLE\n"));
      chunks.push(fg("#8b949e")(`${sep}\n`));
      chunks.push(
        fg("#8b949e")(
          "Descripción".padEnd(32) +
            "Cant.".padStart(10) +
            "P.Unit".padStart(14) +
            "IVA%".padStart(6) +
            "Subtotal".padStart(14) +
            "\n",
        ),
      );
      chunks.push(fg("#8b949e")(`${sep}\n`));
      draft.items.forEach((it) => {
        const neto = it.cantidad * it.precioUnitario;
        const totalLinea = neto * (1 + (it.alicuotaIva || 0) / 100);
        const desc = (it.descripcion || "(sin descripción)").slice(0, 30).padEnd(32);
        chunks.push(
          fg("#e6edf3")(
            `${desc}${formatMontoPad(it.cantidad, 10)}${formatMontoPad(it.precioUnitario, 14)}${String(it.alicuotaIva ?? 21).padStart(6)}${formatMontoPad(Number.isNaN(totalLinea) ? 0 : totalLinea, 14)}\n`,
          ),
        );
      });
      chunks.push(fg("#8b949e")(`${sep}\n`));
      chunks.push(fg("#e6edf3")(`Subtotal neto:`.padEnd(58) + formatMontoPad(totals.subtotal, 14) + "\n"));
      chunks.push(fg("#e6edf3")(`IVA:`.padEnd(58) + formatMontoPad(totals.totalIva, 14) + "\n"));
      chunks.push(fg("#2dd4bf")(`TOTAL:`.padEnd(58) + formatMontoPad(totals.total, 14) + "\n"));
      if (draft.observaciones)
        chunks.push(fg("#8b949e")("\nObservaciones: "), fg("#e6edf3")(`${draft.observaciones}\n`));
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
        : step === "items"
          ? "↑/↓ mover • ítems editables inline • USD/ARS aplica a todos los precios"
          : "↑/↓ mover • Escribir para editar • Opt+←/→ palabra • Cmd+←/→ inicio/fin • Shift selecciona";

    const chunks: TextChunk[] = [];

    const renderInputBox = (value: string, selected: boolean) => {
      if (!selected) {
        const shown = value.length ? value : " ";
        chunks.push(fg("#a0a8b3")(`${shown}`));
        return;
      }

      clampInputCursor(value);
      const selection = getSelectionRange(value);
      const safeValue = value.length ? value : " ";
      const left = selection ? selection.start : inputCursor;
      const right = selection ? selection.end : inputCursor;
      const before = safeValue.slice(0, left);
      const mid = safeValue.slice(left, right);
      const after = safeValue.slice(right);

      if (before) chunks.push(bg("#d8dee4")(fg("#000000")(before)));
      if (selection) {
        const selectedText = mid.length ? mid : " ";
        chunks.push(bg("#7fb2ff")(fg("#000000")(selectedText)));
      } else {
        chunks.push(bg("#7fb2ff")(fg("#000000")(" ")));
      }
      if (after) chunks.push(bg("#d8dee4")(fg("#000000")(after)));
    };

    fields.forEach((f, i) => {
      if (
        step === "items" &&
        (f.key === "item0-descripcion" || f.key === "seleccionarProducto" || f.key === "next")
      ) {
        chunks.push(fg("#8b949e")("\n"));
      }
      const isSelected = cursor === i;
      const prefix = isSelected ? (f.setValue ? "✎" : "❯") : " ";
      chunks.push(isSelected ? fg("#2dd4bf")(prefix + " ") : fg("#8b949e")(prefix + " "));
      if (f.action && !f.setValue) {
        chunks.push(isSelected ? fg("#e6edf3")(`[ ${f.label} ]`) : fg("#8b949e")(`[ ${f.label} ]`));
      } else {
        chunks.push(isSelected ? fg("#e6edf3")(`${f.label}: `) : fg("#8b949e")(`${f.label}: `));
        renderInputBox(f.value(), isSelected && Boolean(f.setValue));
      }
      chunks.push(fg("#8b949e")("\n"));
    });

    if (step === "cliente" && clientPickerActive) {
      chunks.push(fg("#2dd4bf")("\n▼ Seleccioná un cliente (↑/↓ Enter para elegir, Esc cancelar):\n"));
      clientes.slice(0, 10).forEach((c, i) => {
        const sel = i === clientPickerCursor;
        chunks.push(sel ? fg("#2dd4bf")("❯ ") : fg("#8b949e")("  "));
        chunks.push(
          sel ? fg("#e6edf3")(`${c.cuit} | ${c.razonSocial}\n`) : fg("#8b949e")(`${c.cuit} | ${c.razonSocial}\n`),
        );
      });
    } else if (step === "items" && productPickerActive) {
      chunks.push(fg("#2dd4bf")("\n▼ Seleccioná un producto (↑/↓ Enter para agregar, Esc cancelar):\n"));
      productos.slice(0, 12).forEach((p, i) => {
        const sel = i === productPickerCursor;
        const color = sel ? fg("#e6edf3") : fg("#8b949e");
        chunks.push(sel ? fg("#2dd4bf")("❯ ") : fg("#8b949e")("  "));
        chunks.push(
          color(
            `${(p.descripcion || p.codigo || "").slice(0, 35).padEnd(35)} $${formatMonto(p.precioUnitario)} IVA ${p.alicuotaIva}%\n`,
          ),
        );
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
      fg("#e6edf3")(
        `Subtotal: ${formatMonto(totals.subtotal)}  IVA: ${formatMonto(totals.totalIva)}  Total: ${formatMonto(totals.total)}`,
      ),
    );

    if (step === "items") {
      chunks.push(fg("#8b949e")("\n"));
      if (draft.cotizacionMep) {
        const maxAgeMinutes = Number.parseInt(process.env.DOLAR_MEP_MAX_AGE_MINUTES ?? "180", 10);
        const stale = isCotizacionStale(
          draft.cotizacionMep.fechaActualizacion,
          Number.isFinite(maxAgeMinutes) ? maxAgeMinutes : 180,
        );
        chunks.push(
          fg(stale ? "#f59e0b" : "#2dd4bf")(
            `MEP compra: ${formatMonto(draft.cotizacionMep.compra)} (${stale ? "desactualizada" : "vigente"})`,
          ),
        );
        chunks.push(fg("#8b949e")(` • act: ${draft.cotizacionMep.fechaActualizacion}`));
      } else {
        chunks.push(fg("#8b949e")("MEP: sin cotización cargada."));
      }

      if (draft.modoCargaMoneda === "USD" && draft.itemPendiente.precioUnitario > 0 && draft.cotizacionMep) {
        const precioUsd = draft.itemPendiente.precioUnitario / draft.cotizacionMep.compra;
        chunks.push(
          fg("#8b949e")(
            `\nHelper USD: ${formatMonto(precioUsd)} x ${formatMonto(draft.cotizacionMep.compra)} = ${formatMonto(draft.itemPendiente.precioUnitario)} ARS`,
          ),
        );
      }
    }

    body.content = new StyledText(chunks);
  }

  function renderEmailInput() {
    title.content = "╭─ ENVIAR FACTURA POR MAIL ───────────────────────────────────────────────────╮";
    helper.content = "Enter enviar • Esc cancelar • Opt+←/→ palabra • Cmd+←/→ inicio/fin • Shift selecciona";
    const chunks: TextChunk[] = [];
    chunks.push(fg("#2dd4bf")("Emails (separados por coma):\n\n"));
    clampInputCursor(emailInputValue);
    const selection = getSelectionRange(emailInputValue);
    const safeValue = emailInputValue.length ? emailInputValue : " ";
    const left = selection ? selection.start : inputCursor;
    const right = selection ? selection.end : inputCursor;
    const before = safeValue.slice(0, left);
    const mid = safeValue.slice(left, right);
    const after = safeValue.slice(right);
    if (before) chunks.push(bg("#d8dee4")(fg("#000000")(before)));
    if (selection) {
      const selectedText = mid.length ? mid : " ";
      chunks.push(bg("#7fb2ff")(fg("#000000")(selectedText)));
    } else {
      chunks.push(bg("#7fb2ff")(fg("#000000")(" ")));
    }
    if (after) chunks.push(bg("#d8dee4")(fg("#000000")(after)));
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
    clampInputCursor(current);
    const selection = getSelectionRange(current);

    if (key.name === "backspace") {
      if (selection) {
        field.setValue(current.slice(0, selection.start) + current.slice(selection.end));
        inputCursor = selection.start;
      } else if (inputCursor > 0) {
        field.setValue(current.slice(0, inputCursor - 1) + current.slice(inputCursor));
        inputCursor -= 1;
      }
      selectionAnchor = null;
      return;
    }

    if (key.name === "delete") {
      if (selection) {
        field.setValue(current.slice(0, selection.start) + current.slice(selection.end));
        inputCursor = selection.start;
      } else if (inputCursor < current.length) {
        field.setValue(current.slice(0, inputCursor) + current.slice(inputCursor + 1));
      }
      selectionAnchor = null;
      return;
    }

    if (key.sequence && /^[^\r\n\t]$/.test(key.sequence) && !key.ctrl && !key.meta) {
      if (selection) {
        field.setValue(current.slice(0, selection.start) + key.sequence + current.slice(selection.end));
        inputCursor = selection.start + key.sequence.length;
      } else {
        field.setValue(current.slice(0, inputCursor) + key.sequence + current.slice(inputCursor));
        inputCursor += key.sequence.length;
      }
      selectionAnchor = null;
    }
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
          inputCursor = emailInputValue.length;
          selectionAnchor = null;
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
          draft = createEmptyDraft(getMayorPuntoVentaDisponible());
          cursor = 0;
          setInputFocusToField(getFields()[cursor]);
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
      const value = emailInputValue;
      const withShiftSelection = key.shift;

      if ((key.ctrl || key.meta) && key.name === "a") {
        selectionAnchor = 0;
        inputCursor = value.length;
        render();
        return;
      }

      if (key.name === "home") {
        moveCursor(value, 0, withShiftSelection);
        render();
        return;
      }

      if (key.name === "end") {
        moveCursor(value, value.length, withShiftSelection);
        render();
        return;
      }

      if (key.name === "left") {
        if (key.meta && !key.option) {
          moveCursor(value, 0, withShiftSelection);
        } else if (key.option) {
          moveCursor(value, moveWordLeft(value, inputCursor), withShiftSelection);
        } else {
          moveCursor(value, inputCursor - 1, withShiftSelection);
        }
        render();
        return;
      }

      if (key.name === "right") {
        if (key.meta && !key.option) {
          moveCursor(value, value.length, withShiftSelection);
        } else if (key.option) {
          moveCursor(value, moveWordRight(value, inputCursor), withShiftSelection);
        } else {
          moveCursor(value, inputCursor + 1, withShiftSelection);
        }
        render();
        return;
      }

      if (key.name === "escape") {
        emailInputActive = false;
        emailInputContext = null;
        selectionAnchor = null;
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
            const idCliente = ctx.factura.cliente.id;
            for (const email of emails) {
              await client.enviarFacturaPorEmail(ctx.factura.id, idCliente, email);
            }
            setStatus(`Factura enviada a ${emails.join(", ")}`);
            if (ctx.source === "inicio") facturaRecienEmitida = null;
            emailInputActive = false;
            emailInputContext = null;
            selectionAnchor = null;
          } catch (err) {
            setStatus(err instanceof SosContadorClientError ? err.message : "Error al enviar email.");
          } finally {
            emailEnviando = false;
          }
        }
      } else if (key.name === "backspace" || key.name === "delete") {
        clampInputCursor(emailInputValue);
        const selection = getSelectionRange(emailInputValue);
        if (selection) {
          emailInputValue = emailInputValue.slice(0, selection.start) + emailInputValue.slice(selection.end);
          inputCursor = selection.start;
        } else if (key.name === "backspace" && inputCursor > 0) {
          emailInputValue = emailInputValue.slice(0, inputCursor - 1) + emailInputValue.slice(inputCursor);
          inputCursor -= 1;
        } else if (key.name === "delete" && inputCursor < emailInputValue.length) {
          emailInputValue = emailInputValue.slice(0, inputCursor) + emailInputValue.slice(inputCursor + 1);
        }
        selectionAnchor = null;
      } else if (key.sequence && /^[^\r\n\t]$/.test(key.sequence) && !key.ctrl && !key.meta) {
        clampInputCursor(emailInputValue);
        const selection = getSelectionRange(emailInputValue);
        if (selection) {
          emailInputValue =
            emailInputValue.slice(0, selection.start) + key.sequence + emailInputValue.slice(selection.end);
          inputCursor = selection.start + key.sequence.length;
        } else {
          emailInputValue =
            emailInputValue.slice(0, inputCursor) + key.sequence + emailInputValue.slice(inputCursor);
          inputCursor += key.sequence.length;
        }
        selectionAnchor = null;
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
          setInputFocusToField(getFields()[cursor]);
          setStatus("Factura cargada para repetir. Editá ítems con Enter, luego emití.");
        }
      } else if (key.name === "e") {
        const f = facturaDetalle ?? selectedFactura();
        if (f && f.cliente.id) {
          emailInputActive = true;
          emailInputValue = f.cliente.email ?? process.env.SOS_CONTADOR_EMAIL ?? "";
          inputCursor = emailInputValue.length;
          selectionAnchor = null;
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
        productPickerCursor =
          (productPickerCursor - 1 + Math.min(productos.length, 12)) % Math.min(productos.length, 12);
      } else if ((key.name === "enter" || key.name === "return") && productos[productPickerCursor]) {
        const p = productos[productPickerCursor]!;
        draft.items.push({
          descripcion: p.descripcion,
          cantidad: 1,
          precioUnitario: p.precioUnitario,
          alicuotaIva: p.alicuotaIva,
        });
        draft.itemPendiente = emptyItem();
        draft.precioUnitarioUsd = 0;
        productPickerActive = false;
        setStatus(`Producto agregado: ${p.descripcion}`);
      }
      render();
      return;
    }

    const fields = getFields();
    const field = fields[cursor];
    if (!field) return;

    if (field.setValue) {
      const value = field.value();
      const withShiftSelection = key.shift;

      if ((key.ctrl || key.meta) && key.name === "a") {
        selectionAnchor = 0;
        inputCursor = value.length;
        render();
        return;
      }

      if (key.name === "home") {
        moveCursor(value, 0, withShiftSelection);
        render();
        return;
      }

      if (key.name === "end") {
        moveCursor(value, value.length, withShiftSelection);
        render();
        return;
      }

      if (key.name === "left") {
        if (key.meta && !key.option) {
          moveCursor(value, 0, withShiftSelection);
        } else if (key.option) {
          moveCursor(value, moveWordLeft(value, inputCursor), withShiftSelection);
        } else {
          moveCursor(value, inputCursor - 1, withShiftSelection);
        }
        render();
        return;
      }

      if (key.name === "right") {
        if (key.meta && !key.option) {
          moveCursor(value, value.length, withShiftSelection);
        } else if (key.option) {
          moveCursor(value, moveWordRight(value, inputCursor), withShiftSelection);
        } else {
          moveCursor(value, inputCursor + 1, withShiftSelection);
        }
        render();
        return;
      }
    }

    const prevCursor = cursor;
    if (key.name === "down") cursor = (cursor + 1) % fields.length;
    if (key.name === "up") cursor = (cursor - 1 + fields.length) % fields.length;
    if (cursor !== prevCursor) setInputFocusToField(fields[cursor]);

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

    if (
      field.setValue &&
      (key.name === "backspace" ||
        key.name === "delete" ||
        (key.sequence && /^[^\r\n\t]$/.test(key.sequence) && !key.ctrl && !key.meta))
    ) {
      onCharInput(field, key);
      render();
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      if (field.action) await field.action();
    }

    render();
  }

  void syncData();
  render();
  root.focus();
  return root;
}
