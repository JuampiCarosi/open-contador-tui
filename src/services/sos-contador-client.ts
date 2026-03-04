import type { Factura } from "../types";

export interface SosContadorClientOptions {
  baseUrl: string;
  token?: string;
}

export class SosContadorClient {
  constructor(private readonly options: SosContadorClientOptions) {}

  async listarFacturas(): Promise<Factura[]> {
    return this.request<Factura[]>("/facturas");
  }

  async obtenerFactura(id: string): Promise<Factura> {
    return this.request<Factura>(`/facturas/${id}`);
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Error consultando SOS Contador (${response.status})`);
    }

    return (await response.json()) as T;
  }
}
