import type { Cliente, Factura } from "../types";
import type { FacturaDraft } from "../ui/state/invoice-draft";

interface AuthPayload {
  email: string;
  password: string;
}

interface ApiErrorBody {
  message?: string;
  error?: string;
  errors?: Record<string, string[] | string>;
}

export class SosContadorClientError extends Error {}

export class SosContadorClient {
  private token?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly auth?: AuthPayload;

  constructor() {
    this.baseUrl = (process.env.SOS_CONTADOR_BASE_URL ?? "").trim();
    this.token = process.env.SOS_CONTADOR_API_TOKEN;
    const email = process.env.SOS_CONTADOR_EMAIL;
    const password = process.env.SOS_CONTADOR_PASSWORD;
    this.auth = email && password ? { email, password } : undefined;
    this.timeoutMs = Number.parseInt(process.env.SOS_CONTADOR_TIMEOUT_MS ?? "9000", 10);
    this.retries = Number.parseInt(process.env.SOS_CONTADOR_RETRIES ?? "2", 10);
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async authenticate() {
    if (this.token) return this.token;
    if (!this.baseUrl || !this.auth) {
      throw new SosContadorClientError("Falta configurar credenciales de SOS Contador.");
    }

    const resp = await this.request<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(this.auth),
      requiresAuth: false,
    });
    this.token = resp.access_token;
    return this.token;
  }

  async listarFacturas(): Promise<Factura[]> {
    if (!this.baseUrl) return [];
    return this.request<Factura[]>("/facturas", { method: "GET" });
  }

  async listarClientes(): Promise<Cliente[]> {
    if (!this.baseUrl) return [];
    const raw = await this.request<Array<Record<string, string>>>("/clientes", { method: "GET" });
    return raw.map((it) => ({
      id: it.id,
      cuit: it.cuit ?? it.identificacion ?? "",
      razonSocial: it.razon_social ?? it.razonSocial ?? it.nombre ?? "",
      email: it.email,
      direccion: it.direccion,
      telefono: it.telefono,
    }));
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

    return this.request<Factura>("/facturas", {
      method: "POST",
      body: JSON.stringify({
        cliente: {
          cuit: draft.cliente.cuit,
          razon_social: draft.cliente.razonSocial,
          email: draft.cliente.email,
          direccion: draft.cliente.direccion,
          telefono: draft.cliente.telefono,
        },
        fecha_emision: draft.fechaEmision,
        fecha_vencimiento: draft.fechaVencimiento,
        observaciones: draft.observaciones,
        items: draft.items.map((item) => ({
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_unitario: item.precioUnitario,
          alicuota_iva: item.alicuotaIva,
        })),
      }),
    });
  }

  private async request<T>(
    path: string,
    init: RequestInit & { requiresAuth?: boolean } = {},
  ): Promise<T> {
    if (init.requiresAuth !== false) await this.authenticate();

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
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
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
        throw new SosContadorClientError("No se pudo conectar a SOS Contador.");
      }
    }

    throw new SosContadorClientError("No se pudo completar la operación en SOS Contador.");
  }
}
