export class DolarMepClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DolarMepClientError";
  }
}

export interface DolarMepQuote {
  compra: number;
  venta: number;
  fechaActualizacion: string;
  fetchedAt: number;
  fromCache: boolean;
  isStale: boolean;
}

interface DolarApiResponse {
  compra?: unknown;
  venta?: unknown;
  fechaActualizacion?: unknown;
}

const DEFAULT_BASE_URL = "https://dolarapi.com/v1";
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_RETRIES = 1;
const DEFAULT_CACHE_TTL_MS = 300000;
const DEFAULT_MAX_AGE_MINUTES = 180;

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? String(fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class DolarMepClient {
  private readonly baseUrl = (process.env.DOLAR_MEP_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  private readonly timeoutMs = envInt("DOLAR_MEP_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  private readonly retries = envInt("DOLAR_MEP_RETRIES", DEFAULT_RETRIES);
  private readonly cacheTtlMs = envInt("DOLAR_MEP_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);
  private readonly maxAgeMinutes = envInt("DOLAR_MEP_MAX_AGE_MINUTES", DEFAULT_MAX_AGE_MINUTES);

  private cachedQuote: Omit<DolarMepQuote, "fromCache"> | null = null;

  async obtenerMep(options: { forceRefresh?: boolean } = {}): Promise<DolarMepQuote> {
    const forceRefresh = options.forceRefresh ?? false;
    const cached = this.cachedQuote;
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt <= this.cacheTtlMs) {
      return { ...cached, fromCache: true };
    }

    const payload = await this.request<DolarApiResponse>("/dolares/bolsa");
    const compra = Number(payload.compra);
    const venta = Number(payload.venta);
    const fechaActualizacion = String(payload.fechaActualizacion ?? "");

    if (!Number.isFinite(compra) || compra <= 0) {
      throw new DolarMepClientError("La cotización MEP no es válida (compra).");
    }
    if (!Number.isFinite(venta) || venta <= 0) {
      throw new DolarMepClientError("La cotización MEP no es válida (venta).");
    }
    if (!fechaActualizacion.trim()) {
      throw new DolarMepClientError("La cotización MEP no trae fecha de actualización.");
    }

    const normalized: Omit<DolarMepQuote, "fromCache"> = {
      compra,
      venta,
      fechaActualizacion,
      fetchedAt: Date.now(),
      isStale: this.isStale(fechaActualizacion),
    };
    this.cachedQuote = normalized;
    return { ...normalized, fromCache: false };
  }

  private isStale(fechaActualizacion: string): boolean {
    const timestamp = Date.parse(fechaActualizacion);
    if (!Number.isFinite(timestamp)) return true;
    return Date.now() - timestamp > this.maxAgeMinutes * 60 * 1000;
  }

  private async request<T>(path: string): Promise<T> {
    let attempt = 0;
    while (attempt <= this.retries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: "GET",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
        });
        clearTimeout(timer);

        if (!response.ok) {
          if (attempt < this.retries && (response.status >= 500 || response.status === 429)) {
            attempt += 1;
            await Bun.sleep(200 * 2 ** attempt);
            continue;
          }
          throw new DolarMepClientError(`Error ${response.status} al obtener cotización MEP.`);
        }

        return (await response.json()) as T;
      } catch (error) {
        clearTimeout(timer);
        if (attempt < this.retries) {
          attempt += 1;
          await Bun.sleep(200 * 2 ** attempt);
          continue;
        }

        if (error instanceof DolarMepClientError) throw error;
        throw new DolarMepClientError(
          `No se pudo obtener cotización MEP. ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    throw new DolarMepClientError("No se pudo obtener cotización MEP.");
  }
}
