/** Resumen de posición fiscal (últimos 365 días) */
export interface PosicionFiscal {
  ventasYND?: number;
  notasCredito?: number;
  totalVentas?: number;
  compras?: number;
  topeCatD?: number;
  consumidoCatD?: number;
  remanenteFacturable?: number;
  topeMaxServK?: number;
  consumidoMaxServK?: number;
  remanenteRINS?: number;
  pctComprasGastos?: number;
  remanenteComprasGastos?: number;
  /** Datos crudos si la API devuelve estructura distinta */
  raw?: Record<string, unknown>;
}
