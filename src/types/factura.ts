import type { Cliente } from "./cliente";
import type { ItemFactura } from "./item-factura";

export interface Factura {
  id: string;
  numero: string;
  fechaEmision: string;
  fechaVencimiento?: string;
  cliente: Cliente;
  items: ItemFactura[];
  observaciones?: string;
  subtotal: number;
  totalIva: number;
  total: number;
  estado: "borrador" | "emitida" | "anulada";
  /** CAE número (Código de Autorización Electrónico) */
  caeNumero?: string;
  /** CAE vencimiento */
  caeVencimiento?: string;
}
