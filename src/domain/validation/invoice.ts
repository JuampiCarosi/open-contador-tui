import type { InvoiceDraftState, InvoiceItemData } from "../../ui/state/invoice-draft";

export interface InvoiceValidationIssue {
  field: string;
  message: string;
  critical: boolean;
  step: number;
}

export interface InvoiceValidationResult {
  issues: InvoiceValidationIssue[];
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parts = value.split("-").map(Number);
  if (parts.length !== 3) {
    return false;
  }

  const [year, month, day] = parts;
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateItem(item: InvoiceItemData, index: number): InvoiceValidationIssue[] {
  const issues: InvoiceValidationIssue[] = [];
  const basePath = `items.${index}`;

  if (!item.descripcion.trim()) {
    issues.push({
      field: `${basePath}.descripcion`,
      message: `El ítem ${index + 1} requiere descripción.`,
      critical: true,
      step: 2,
    });
  }

  if (!(item.cantidad > 0)) {
    issues.push({
      field: `${basePath}.cantidad`,
      message: `La cantidad del ítem ${index + 1} debe ser mayor a 0.`,
      critical: true,
      step: 2,
    });
  }

  if (!(item.precio > 0)) {
    issues.push({
      field: `${basePath}.precio`,
      message: `El precio del ítem ${index + 1} debe ser mayor a 0.`,
      critical: true,
      step: 2,
    });
  }

  if (item.impuestos < 0 || item.impuestos > 100) {
    issues.push({
      field: `${basePath}.impuestos`,
      message: `El impuesto del ítem ${index + 1} debe estar entre 0 y 100.`,
      critical: true,
      step: 2,
    });
  }

  return issues;
}

export function validateInvoiceStep(draft: InvoiceDraftState, step: number): InvoiceValidationResult {
  const issues: InvoiceValidationIssue[] = [];

  if (step >= 1) {
    if (!draft.client.nombre.trim()) {
      issues.push({ field: "client.nombre", message: "El nombre del cliente es obligatorio.", critical: true, step: 1 });
    }

    if (!draft.client.identificacion.trim()) {
      issues.push({ field: "client.identificacion", message: "La identificación del cliente es obligatoria.", critical: true, step: 1 });
    }

    if (!draft.client.email.trim()) {
      issues.push({ field: "client.email", message: "El email del cliente es obligatorio.", critical: true, step: 1 });
    } else if (!isValidEmail(draft.client.email.trim())) {
      issues.push({ field: "client.email", message: "El email del cliente no tiene un formato válido.", critical: true, step: 1 });
    }
  }

  if (step >= 2) {
    if (draft.items.length === 0) {
      issues.push({ field: "items", message: "Debes agregar al menos 1 ítem.", critical: true, step: 2 });
    }

    draft.items.forEach((item, index) => {
      issues.push(...validateItem(item, index));
    });
  }

  if (step >= 3) {
    if (!isValidDate(draft.meta.fecha)) {
      issues.push({ field: "meta.fecha", message: "La fecha debe tener formato YYYY-MM-DD y ser válida.", critical: true, step: 3 });
    }

    if (!isValidDate(draft.meta.vencimiento)) {
      issues.push({ field: "meta.vencimiento", message: "El vencimiento debe tener formato YYYY-MM-DD y ser válido.", critical: true, step: 3 });
    }

    if (isValidDate(draft.meta.fecha) && isValidDate(draft.meta.vencimiento)) {
      const fecha = new Date(`${draft.meta.fecha}T00:00:00Z`);
      const vencimiento = new Date(`${draft.meta.vencimiento}T00:00:00Z`);

      if (vencimiento < fecha) {
        issues.push({
          field: "meta.vencimiento",
          message: "La fecha de vencimiento no puede ser anterior a la fecha de emisión.",
          critical: true,
          step: 3,
        });
      }
    }
  }

  return { issues };
}

export function validateInvoice(draft: InvoiceDraftState): InvoiceValidationResult {
  return validateInvoiceStep(draft, 3);
}

export function validatePendingItem(item: InvoiceItemData): InvoiceValidationResult {
  return {
    issues: validateItem(item, 0).map((issue) => ({
      ...issue,
      field: issue.field.replace("items.0", "pendingItem"),
      message: issue.message.replace("ítem 1", "ítem en edición"),
    })),
  };
}
