import { appendFileSync } from "node:fs";
import type { Cliente, Factura, Producto, PosicionFiscal } from "../types";
import type { FacturaDraft } from "../ui/state/invoice-draft";

interface AuthPayload {
  usuario: string;
  password: string;
}

interface ApiErrorBody {
  message?: string;
  error?: string;
  errors?: Record<string, string[] | string>;
}

export class SosContadorClientError extends Error {}

function unwrapArray<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  if (response && typeof response === "object") {
    for (const val of Object.values(response)) {
      if (Array.isArray(val)) return val as T[];
    }
  }
  return [];
}

function mapParametrosToPosicionFiscal(p: Record<string, unknown>): PosicionFiscal {
  const getNum = (key: string) => {
    const v = p[key];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") return Number.parseFloat(v) || undefined;
    return undefined;
  };
  const result: PosicionFiscal = {
    ventasYND: getNum("ventas") ?? getNum("ventas_y_nd") ?? getNum("ventasYND"),
    notasCredito: getNum("notas_credito") ?? getNum("notasCredito"),
    totalVentas: getNum("total_ventas") ?? getNum("totalVentas"),
    compras: getNum("compras"),
    topeCatD: getNum("tope_cat_d") ?? getNum("topeCatD"),
    consumidoCatD: getNum("consumido_cat_d") ?? getNum("consumidoCatD"),
    remanenteFacturable: getNum("remanente_facturable") ?? getNum("remanenteFacturable"),
    topeMaxServK: getNum("tope_max_serv_k") ?? getNum("topeMaxServK"),
    consumidoMaxServK: getNum("consumido_max_serv_k") ?? getNum("consumidoMaxServK"),
    remanenteRINS: getNum("remanente_rins") ?? getNum("remanenteRINS"),
    pctComprasGastos: getNum("pct_compras_gastos") ?? getNum("pctComprasGastos"),
    remanenteComprasGastos: getNum("remanente_compras_gastos") ?? getNum("remanenteComprasGastos"),
    raw: p as Record<string, unknown>,
  };
  return result;
}

function mapVentaToFactura(v: Record<string, unknown>): Factura {
  const cab = (v.cabecera ?? v) as Record<string, unknown>;
  const id = String(cab.id ?? v.id ?? cab.idcomprobante ?? "");
  const pv = cab.puntoventa != null ? String(cab.puntoventa) : "";
  const num = cab.numero != null ? String(cab.numero) : "";
  const numero = pv && num ? `${pv.padStart(3, "0")}-${num.padStart(8, "0")}` : String(v.numero ?? num ? num : id);
  const puntoVentaFromNumero = numero.match(/^(\d{1,5})-/)?.[1];
  const puntoVenta = pv ? Number.parseInt(pv, 10) : puntoVentaFromNumero ? Number.parseInt(puntoVentaFromNumero, 10) : undefined;
  const fechaRaw = cab.fecha ?? v.fecha ?? cab.fecha_emision ?? "";
  const fechaEmision = typeof fechaRaw === "string" ? fechaRaw.slice(0, 10) : String(fechaRaw);

  const caeNumero = cab.caenumero != null ? String(cab.caenumero) : undefined;
  const caeVencimiento = cab.caevencimiento != null ? String(cab.caevencimiento) : undefined;

  const clienteRaw = (cab.cliente ?? cab) as Record<string, unknown>;
  const cliente = {
    id: clienteRaw.idclipro != null ? String(clienteRaw.idclipro) : clienteRaw.id != null ? String(clienteRaw.id) : undefined,
    cuit: String(clienteRaw.cuit ?? cab.cuit ?? clienteRaw.identificacion ?? ""),
    razonSocial: String(clienteRaw.razon_social ?? clienteRaw.razonsocial ?? cab.clipro ?? clienteRaw.clipro ?? cab.clipro ?? clienteRaw.nombre ?? ""),
    email: (clienteRaw.email ?? cab.email) != null ? String(clienteRaw.email ?? cab.email) : undefined,
    direccion: (clienteRaw.direccion ?? cab.domicilio ?? clienteRaw.domicilio) != null ? String(clienteRaw.direccion ?? cab.domicilio ?? clienteRaw.domicilio) : undefined,
    telefono: (clienteRaw.telefono ?? cab.telefono) != null ? String(clienteRaw.telefono ?? cab.telefono) : undefined,
  };

  const productosRaw = (v.productos ?? v.items ?? []) as Array<Record<string, unknown>>;
  const items = productosRaw.map((it) => {
    const cant = Number(it.cantidad ?? it.fc ?? it.c ?? it.qty ?? 1);
    const precio = Number(it.unitario ?? it.precio_unitario ?? it.fu ?? it.p ?? it.precio ?? 0);
    const monto = Number(it.monto ?? it.v ?? it.importe ?? it.montohaber ?? it.subtotal ?? cant * precio);
    const precioUnit = precio > 0 ? precio : cant > 0 ? monto / cant : monto;
    return {
      descripcion: String(it.producto ?? it.producto_impresion ?? it.descripcion ?? it.d ?? it.concepto ?? it.desc ?? it.memo ?? ""),
      cantidad: cant,
      precioUnitario: precioUnit,
      alicuotaIva: Number(it.alicuota ?? it.alicuota_iva ?? it.fa ?? it.a ?? 21),
    };
  });

  const imputaciones = (v.imputaciones ?? []) as Array<Record<string, unknown>>;
  let subtotal = Number(v.subtotal ?? v.neto ?? cab.subtotal ?? 0);
  let totalIva = Number(v.total_iva ?? v.iva ?? cab.iva ?? 0);
  let total = Number(
    v.total ??
      v.importe ??
      v.montototal ??
      v.monto ??
      v.valor ??
      v.total_comprobante ??
      cab.total ??
      cab.importe ??
      cab.monto ??
      cab.montototal ??
      0,
  );
  if (total === 0 && imputaciones.length > 0) {
    total = imputaciones.reduce((sum, i) => sum + Number(i.montohaber ?? i.montodebe ?? i.v ?? 0), 0);
  }
  if (subtotal === 0 && totalIva === 0 && items.length > 0) {
    subtotal = items.reduce((s, it) => s + it.cantidad * it.precioUnitario, 0);
    totalIva = items.reduce((s, it) => s + it.cantidad * it.precioUnitario * ((it.alicuotaIva || 0) / 100), 0);
    if (total === 0) total = subtotal + totalIva;
  }
  if (total === 0) {
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === "number" && val > 0 && (k.toLowerCase().includes("total") || k.toLowerCase().includes("importe") || k.toLowerCase().includes("monto"))) {
        total = val;
        break;
      }
    }
    if (total === 0 && typeof cab === "object" && cab !== v) {
      for (const [k, val] of Object.entries(cab)) {
        if (typeof val === "number" && val > 0 && (k.toLowerCase().includes("total") || k.toLowerCase().includes("importe") || k.toLowerCase().includes("monto"))) {
          total = val;
          break;
        }
      }
    }
  }
  return {
    id,
    numero,
    fechaEmision,
    cliente,
    items,
    subtotal,
    totalIva,
    total,
    estado: "emitida",
    puntoVenta: Number.isInteger(puntoVenta) && (puntoVenta ?? 0) > 0 ? puntoVenta : undefined,
    caeNumero,
    caeVencimiento,
  };
}

export class SosContadorClient {
  private jwt?: string;
  private jwtc?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly puntoVenta: number;
  private readonly auth?: AuthPayload;
  private readonly cuitId?: string;

  constructor() {
    this.baseUrl = (process.env.SOS_CONTADOR_BASE_URL ?? "").trim();
    this.jwt = process.env.SOS_CONTADOR_API_TOKEN;
    const usuario = process.env.SOS_CONTADOR_EMAIL;
    const password = process.env.SOS_CONTADOR_PASSWORD;
    this.auth = usuario && password ? { usuario, password } : undefined;
    this.cuitId = process.env.SOS_CONTADOR_CUIT_ID;
    this.timeoutMs = Number.parseInt(process.env.SOS_CONTADOR_TIMEOUT_MS ?? "9000", 10);
    this.retries = Number.parseInt(process.env.SOS_CONTADOR_RETRIES ?? "2", 10);
    const puntoVenta = Number.parseInt(process.env.SOS_CONTADOR_PUNTO_VENTA ?? "1", 10);
    this.puntoVenta = Number.isInteger(puntoVenta) && puntoVenta > 0 ? puntoVenta : 1;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  private async authenticateUser(): Promise<string> {
    if (this.jwt) return this.jwt;
    if (!this.baseUrl || !this.auth) {
      throw new SosContadorClientError("Falta configurar credenciales de SOS Contador.");
    }

    const resp = await this.request<{ jwt: string }>("/login", {
      method: "POST",
      body: JSON.stringify(this.auth),
      authMode: "none",
    });
    this.jwt = resp.jwt;
    return this.jwt;
  }

  async authenticate() {
    if (this.jwtc) return this.jwtc;

    await this.authenticateUser();

    let idcuit = this.cuitId;
    if (!idcuit) {
      const cuits = await this.request<Array<{ id: number; cuit: string; razonsocial: string }>>(
        "/cuit/listado",
        { method: "GET", authMode: "jwt" },
      );
      const list = Array.isArray(cuits) ? cuits : unwrapArray<{ id: number }>(cuits);
      if (!list.length) {
        throw new SosContadorClientError("No se encontró ninguna CUIT asociada al usuario.");
      }
      idcuit = String(list[0]!.id);
    }

    const resp = await this.request<{ jwt: string }>(
      `/cuit/credentials/${idcuit}`,
      { method: "GET", authMode: "jwt" },
    );
    this.jwtc = resp.jwt;
    return this.jwtc;
  }

  async listarFacturas(
    modo = "T",
    periodo = "anio",
    cae = "T",
    pagina = 1,
    registros = 100,
  ): Promise<Factura[]> {
    if (!this.baseUrl) return [];
    const hoy = new Date();
    const hace2Anios = new Date(hoy);
    hace2Anios.setFullYear(hoy.getFullYear() - 2);
    const fechaDesde = hace2Anios.toISOString().slice(0, 10);
    const fechaHasta = hoy.toISOString().slice(0, 10);

    const listadoResp = await this.request<unknown>(
      `/venta/listado/${modo}/${periodo}/${cae}?pagina=${pagina}&registros=${registros}&fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}`,
      { method: "GET" },
    );
    let raw = unwrapArray<Record<string, unknown>>(listadoResp);

    if (raw.length === 0) {
      const consultaResp = await this.request<unknown>(`/venta/consulta?pagina=${pagina}&registros=${registros}`, {
        method: "POST",
        body: JSON.stringify({ fecha_desde: fechaDesde, fecha_hasta: fechaHasta }),
      });
      raw = unwrapArray<Record<string, unknown>>(consultaResp);
    }

    return raw.map((v) => mapVentaToFactura(v));
  }

  async obtenerFacturaDetalle(id: string): Promise<Factura | null> {
    if (!this.baseUrl || !id) return null;
    try {
      const resp = await this.request<Record<string, unknown>>(`/venta/detalle/${id}`, { method: "GET" });
      return mapVentaToFactura(resp);
    } catch {
      return null;
    }
  }

  async listarClientes(pagina = 1, registros = 50): Promise<Cliente[]> {
    if (!this.baseUrl) return [];
    const params = new URLSearchParams({
      proveedor: "true",
      cliente: "true",
      pagina: String(pagina),
      registros: String(registros),
    });
    const resp = await this.request<unknown>(
      `/cliente/listado?${params}`,
      { method: "GET" },
    );
    const raw = unwrapArray<Record<string, string>>(resp);
    return raw.map((it) => ({
      id: it.id,
      cuit: it.cuit ?? it.identificacion ?? "",
      razonSocial: it.razon_social ?? it.razonSocial ?? it.clipro ?? it.nombre ?? "",
      email: it.email,
      direccion: it.direccion,
      telefono: it.telefono,
    }));
  }

  async listarProductos(pagina = 1, registros = 100): Promise<Producto[]> {
    if (!this.baseUrl) return [];
    const params = new URLSearchParams({
      pagina: String(pagina),
      registros: String(registros),
    });
    const resp = await this.request<unknown>(`/producto/listado?${params}`, { method: "GET" });
    const raw = unwrapArray<Record<string, unknown>>(resp);
    return raw.map((p) => ({
      id: String(p.id ?? p.idproducto ?? ""),
      codigo: p.codigo != null ? String(p.codigo) : undefined,
      descripcion: String(p.producto ?? p.descripcion ?? p.nombre ?? ""),
      precioUnitario: Number(p.precio ?? p.unitario ?? p.precio_unitario ?? 0),
      alicuotaIva: Number(p.alicuota ?? p.alicuota_iva ?? 21),
    }));
  }

  async enviarFacturaPorEmail(comprobanteId: string, idcliente: string, email: string): Promise<{ ok: boolean; response?: unknown }> {
    if (!this.baseUrl) throw new SosContadorClientError("SOS_CONTADOR_BASE_URL no está configurado.");
    const body = { comprobantes: [comprobanteId], idcliente, email };
    const log = (msg: string) => {
      if (process.env.DEBUG_EMAIL === "1") {
        appendFileSync("debug-email.log", `${new Date().toISOString()}\n${msg}\n\n`);
      }
    };
    log(`POST /email/enviar\n${JSON.stringify(body, null, 2)}`);
    const response = await this.request<unknown>("/email/enviar", {
      method: "POST",
      body: JSON.stringify(body),
    });
    log(`Response:\n${JSON.stringify(response, null, 2)}`);
    return { ok: true, response };
  }

  async obtenerPosicionFiscal(): Promise<PosicionFiscal | null> {
    if (!this.baseUrl) return null;
    try {
      const resp = await this.request<Record<string, unknown>>("/cuit/parametros", { method: "GET" });
      return mapParametrosToPosicionFiscal(resp);
    } catch {
      return null;
    }
  }

  async buscarClientePorCuit(cuit: string): Promise<Cliente | null> {
    if (!cuit.trim()) return null;
    const clientes = await this.listarClientes();
    return clientes.find((c) => c.cuit.replace(/\D/g, "") === cuit.replace(/\D/g, "")) ?? null;
  }

  async crearFacturaDesdeDraft(draft: FacturaDraft): Promise<Factura> {
    if (!this.baseUrl) {
      throw new SosContadorClientError("SOS_CONTADOR_BASE_URL no está configurado.");
    }

    const idPath = draft.idOrigen ? `/${draft.idOrigen}` : "";

    const resp = await this.request<Record<string, unknown>>(`/venta${idPath}`, {
      method: "PUT",
      body: JSON.stringify({
        fecha: draft.fechaEmision,
        idclipro: draft.cliente.id ? Number(draft.cliente.id) : undefined,
        cuitclipro: draft.cliente.cuit,
        fcncnd: "F",
        letra: "C",
        puntoventa: draft.puntoVenta > 0 ? draft.puntoVenta : this.puntoVenta,
        obtienecae: false,
        memo: draft.observaciones,
        imputaciones: draft.items.map((item) => ({
          i: "neto",
          a: item.alicuotaIva,
          v: item.cantidad * item.precioUnitario,
        })),
        productos: draft.items.map((item) => ({
          id: 0,
          u: 7,
          fc: item.cantidad,
          fu: item.precioUnitario,
          fa: item.alicuotaIva,
        })),
      }),
    });
    const factura = mapVentaToFactura(resp);
    if (!factura.cliente.id && draft.cliente.id) factura.cliente.id = draft.cliente.id;
    if (!factura.cliente.email && draft.cliente.email) factura.cliente.email = draft.cliente.email;
    return factura;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { authMode?: "none" | "jwt" | "jwtc" } = {},
  ): Promise<T> {
    const authMode = init.authMode ?? "jwtc";
    if (authMode === "jwtc") await this.authenticate();
    else if (authMode === "jwt") await this.authenticateUser();

    const token = authMode === "jwt" ? this.jwt : authMode === "jwtc" ? this.jwtc : undefined;

    let attempt = 0;
    while (attempt <= this.retries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(init.headers ?? {}),
          },
        });
        clearTimeout(timer);

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
          const message = body.message ?? body.error ?? `Error ${response.status} al llamar SOS Contador.`;
          if (attempt < this.retries && (response.status >= 500 || response.status === 429)) {
            attempt += 1;
            await Bun.sleep(200 * 2 ** attempt);
            continue;
          }
          throw new SosContadorClientError(message);
        }

        return (await response.json()) as T;
      } catch (error) {
        clearTimeout(timer);
        if (attempt < this.retries) {
          attempt += 1;
          await Bun.sleep(200 * 2 ** attempt);
          continue;
        }
        if (error instanceof SosContadorClientError) throw error;
        console.error(error);
        throw new SosContadorClientError(
          `No se pudo conectar a SOS Contador. ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    throw new SosContadorClientError("No se pudo completar la operación en SOS Contador.");
  }
}
