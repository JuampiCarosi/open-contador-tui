import type { Factura } from "../types";
import type { InvoiceDraftState } from "../ui/state/invoice-draft";

interface SosContadorAuthPayload {
  email: string;
  password: string;
}

export interface SosContadorClientOptions {
  baseUrl?: string;
  token?: string;
  auth?: SosContadorAuthPayload;
  timeoutMs?: number;
  retries?: number;
}

export interface SosContadorCliente {
  id: string;
  nombre: string;
  identificacion: string;
  email?: string;
}

export interface SosContadorImpuesto {
  id: string;
  codigo: string;
  nombre: string;
  tasa: number;
}

export interface SosContadorProducto {
  id: string;
  codigo: string;
  nombre: string;
  precio: number;
}

export interface SosContadorInvoicePayload {
  cliente: {
    nombre: string;
    identificacion: string;
    email?: string;
  };
  fecha_emision: string;
  fecha_vencimiento?: string;
  moneda: string;
  notas?: string;
  items: Array<{
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    impuestos: Array<{
      codigo: string;
      tasa: number;
    }>;
  }>;
}

interface SosContadorApiErrorBody {
  message?: string;
  error?: string;
  errors?: Record<string, string[] | string>;
  code?: string;
}

export class SosContadorClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly details?: Record<string, string[] | string>,
  ) {
    super(message);
    this.name = "SosContadorClientError";
  }
}

export class SosContadorClient {
  private token?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly auth?: SosContadorAuthPayload;

  constructor(private readonly options: SosContadorClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.SOS_CONTADOR_BASE_URL ?? "").trim();
    if (!this.baseUrl) {
      throw new Error("Falta SOS_CONTADOR_BASE_URL para inicializar el cliente SOS Contador.");
    }

    this.token = options.token ?? process.env.SOS_CONTADOR_API_TOKEN;
    const email = process.env.SOS_CONTADOR_EMAIL;
    const password = process.env.SOS_CONTADOR_PASSWORD;
    this.auth = options.auth ?? (email && password ? { email, password } : undefined);

    this.timeoutMs = options.timeoutMs ?? Number.parseInt(process.env.SOS_CONTADOR_TIMEOUT_MS ?? "10000", 10);
    this.retries = options.retries ?? Number.parseInt(process.env.SOS_CONTADOR_RETRIES ?? "2", 10);
  }

  async authenticate(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    if (!this.auth) {
      throw new SosContadorClientError(
        "No hay credenciales configuradas. Define SOS_CONTADOR_API_TOKEN o SOS_CONTADOR_EMAIL/SOS_CONTADOR_PASSWORD.",
      );
    }

    const response = await this.request<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(this.auth),
      requiresAuth: false,
    });

    this.token = response.access_token;
    return this.token;
  }

  async listarFacturas(): Promise<Factura[]> {
    return this.request<Factura[]>("/facturas", { method: "GET" });
  }

  async obtenerFactura(id: string): Promise<Factura> {
    return this.request<Factura>(`/facturas/${id}`, { method: "GET" });
  }

  async createInvoice(payload: SosContadorInvoicePayload): Promise<Factura> {
    return this.request<Factura>("/facturas", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async createInvoiceFromDraft(draft: InvoiceDraftState): Promise<Factura> {
    const payload = mapDraftToSosContadorInvoicePayload(draft);
    return this.createInvoice(payload);
  }

  async listarClientes(): Promise<SosContadorCliente[]> {
    return this.request<SosContadorCliente[]>("/clientes", { method: "GET" });
  }

  async listarImpuestos(): Promise<SosContadorImpuesto[]> {
    return this.request<SosContadorImpuesto[]>("/impuestos", { method: "GET" });
  }

  async listarProductos(): Promise<SosContadorProducto[]> {
    return this.request<SosContadorProducto[]>("/productos", { method: "GET" });
  }

  private async request<T>(
    path: string,
    init: RequestInit & { requiresAuth?: boolean } = {},
  ): Promise<T> {
    if (init.requiresAuth !== false) {
      await this.authenticate();
    }

    const url = `${this.baseUrl}${path}`;
    let attempt = 0;

    while (attempt <= this.retries) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort("timeout"), this.timeoutMs);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
            ...(init.headers ?? {}),
          },
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const parsed = await this.parseApiError(response);

          if (this.shouldRetry(response.status, attempt)) {
            attempt += 1;
            await this.backoff(attempt);
            continue;
          }

          throw parsed;
        }

        return (await response.json()) as T;
      } catch (error) {
        clearTimeout(timeout);

        if (error instanceof SosContadorClientError) {
          throw error;
        }

        if (this.shouldRetry(undefined, attempt)) {
          attempt += 1;
          await this.backoff(attempt);
          continue;
        }

        if (error instanceof Error && error.name === "AbortError") {
          throw new SosContadorClientError(
            `La solicitud a SOS Contador excedió el tiempo límite de ${this.timeoutMs}ms.`,
          );
        }

        throw new SosContadorClientError("No se pudo conectar con SOS Contador. Verifica tu red e inténtalo de nuevo.");
      }
    }

    throw new SosContadorClientError("No fue posible completar la solicitud luego de varios reintentos.");
  }

  private shouldRetry(status: number | undefined, attempt: number): boolean {
    if (attempt >= this.retries) {
      return false;
    }

    if (status === undefined) {
      return true;
    }

    return status === 408 || status === 429 || status >= 500;
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = Math.min(250 * 2 ** attempt, 1500);
    await Bun.sleep(delay);
  }

  private async parseApiError(response: Response): Promise<SosContadorClientError> {
    let body: SosContadorApiErrorBody = {};

    try {
      body = (await response.json()) as SosContadorApiErrorBody;
    } catch {
      // Si la API no responde JSON, usamos mensaje genérico.
    }

    const message = this.normalizeErrorMessage(response.status, body);
    return new SosContadorClientError(message, response.status, body.code, body.errors);
  }

  private normalizeErrorMessage(status: number, body: SosContadorApiErrorBody): string {
    if (status === 401 || status === 403) {
      return "Credenciales inválidas o token expirado en SOS Contador.";
    }

    if (status === 402) {
      return "Tu plan actual de SOS Contador no permite esta operación (límite de plan).";
    }

    if (status === 422 && body.errors) {
      const details = Object.entries(body.errors)
        .map(([field, value]) => {
          const reason = Array.isArray(value) ? value.join(", ") : value;
          return `${field}: ${reason}`;
        })
        .join(" | ");
      return `Error de validación en factura: ${details}`;
    }

    return body.message ?? body.error ?? `Error de SOS Contador (${status}).`;
  }
}

export function mapDraftToSosContadorInvoicePayload(
  draft: Pick<InvoiceDraftState, "client" | "items" | "meta">,
): SosContadorInvoicePayload {
  return {
    cliente: {
      nombre: draft.client.nombre.trim(),
      identificacion: draft.client.identificacion.trim(),
      email: draft.client.email.trim() || undefined,
    },
    fecha_emision: normalizeDate(draft.meta.fecha),
    fecha_vencimiento: draft.meta.vencimiento.trim() ? normalizeDate(draft.meta.vencimiento) : undefined,
    moneda: "CRC",
    notas: draft.meta.notas.trim() || undefined,
    items: draft.items.map((item) => ({
      descripcion: item.descripcion.trim(),
      cantidad: Number(item.cantidad.toFixed(2)),
      precio_unitario: Number(item.precio.toFixed(2)),
      impuestos: item.impuestos > 0 ? [{ codigo: "IVA", tasa: Number(item.impuestos.toFixed(2)) }] : [],
    })),
  };
}

function normalizeDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SosContadorClientError("La fecha de emisión es obligatoria.");
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new SosContadorClientError(`Fecha inválida: "${value}". Usa formato YYYY-MM-DD.`);
  }

  return date.toISOString().slice(0, 10);
}
