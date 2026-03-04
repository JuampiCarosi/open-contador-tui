import type { Cliente, Factura, ItemFactura } from "../../types";

export type MonedaCarga = "ARS" | "USD";

export interface CotizacionMep {
  compra: number;
  venta: number;
  fechaActualizacion: string;
  fetchedAt: number;
}

export interface FacturaDraft {
  idOrigen?: string;
  puntoVenta: number;
  cliente: Cliente;
  fechaEmision: string;
  fechaVencimiento: string;
  observaciones: string;
  items: ItemFactura[];
  itemPendiente: ItemFactura;
  modoCargaMoneda: MonedaCarga;
  precioUnitarioUsd: number;
  cotizacionMep?: CotizacionMep;
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function convertUsdToArs(precioUnitarioUsd: number, cotizacionCompra: number): number {
  return roundMoney(precioUnitarioUsd * cotizacionCompra);
}

export function isCotizacionStale(fechaActualizacion: string, maxAgeMinutes: number): boolean {
  const parsed = Date.parse(fechaActualizacion);
  if (!Number.isFinite(parsed)) return true;
  const ageMs = Date.now() - parsed;
  return ageMs > maxAgeMinutes * 60 * 1000;
}

export function emptyItem(): ItemFactura {
  return {
    descripcion: "",
    cantidad: 1,
    precioUnitario: 0,
    alicuotaIva: 21,
  };
}

export function createEmptyDraft(puntoVenta = 1): FacturaDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    puntoVenta,
    cliente: {
      cuit: "",
      razonSocial: "",
      email: "",
      direccion: "",
      telefono: "",
    },
    fechaEmision: today,
    fechaVencimiento: today,
    observaciones: "",
    items: [],
    itemPendiente: emptyItem(),
    modoCargaMoneda: "ARS",
    precioUnitarioUsd: 0,
  };
}

export function draftFromFactura(factura: Factura): FacturaDraft {
  return {
    idOrigen: factura.id,
    puntoVenta: factura.puntoVenta ?? 1,
    cliente: { ...factura.cliente },
    fechaEmision: factura.fechaEmision,
    fechaVencimiento: factura.fechaVencimiento ?? factura.fechaEmision,
    observaciones: factura.observaciones ?? "",
    items: factura.items.map((item) => ({ ...item })),
    itemPendiente: emptyItem(),
    modoCargaMoneda: "ARS",
    precioUnitarioUsd: 0,
  };
}

export function calcularTotales(draft: FacturaDraft) {
  const subtotal = draft.items.reduce((acc, item) => acc + item.cantidad * item.precioUnitario, 0);
  const totalIva = draft.items.reduce(
    (acc, item) => acc + item.cantidad * item.precioUnitario * (item.alicuotaIva / 100),
    0,
  );

  return {
    subtotal,
    totalIva,
    total: subtotal + totalIva,
  };
}
