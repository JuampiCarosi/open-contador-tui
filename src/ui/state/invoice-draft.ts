import type { Cliente, Factura, ItemFactura } from "../../types";

export interface FacturaDraft {
  idOrigen?: string;
  cliente: Cliente;
  fechaEmision: string;
  fechaVencimiento: string;
  observaciones: string;
  items: ItemFactura[];
  itemPendiente: ItemFactura;
}

export function emptyItem(): ItemFactura {
  return {
    descripcion: "",
    cantidad: 1,
    precioUnitario: 0,
    alicuotaIva: 21,
  };
}

export function createEmptyDraft(): FacturaDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
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
  };
}

export function draftFromFactura(factura: Factura): FacturaDraft {
  return {
    idOrigen: factura.id,
    cliente: { ...factura.cliente },
    fechaEmision: factura.fechaEmision,
    fechaVencimiento: factura.fechaVencimiento ?? factura.fechaEmision,
    observaciones: factura.observaciones ?? "",
    items: factura.items.map((item) => ({ ...item })),
    itemPendiente: emptyItem(),
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
