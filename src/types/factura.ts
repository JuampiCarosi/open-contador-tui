import type { Cliente } from "./cliente";
import type { Impuesto } from "./impuesto";
import type { ItemFactura } from "./item-factura";

export interface Factura {
  id: string;
  numero: string;
  fechaEmision: string;
  cliente: Cliente;
  items: ItemFactura[];
  impuestos: Impuesto[];
  subtotal: number;
  totalImpuestos: number;
  total: number;
  estado: "borrador" | "emitida" | "anulada";
}
