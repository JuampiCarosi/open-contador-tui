export interface InvoiceClientData {
  nombre: string;
  identificacion: string;
  email: string;
}

export interface InvoiceItemData {
  descripcion: string;
  cantidad: number;
  precio: number;
  impuestos: number;
}

export interface InvoiceMetaData {
  fecha: string;
  vencimiento: string;
  notas: string;
}

export interface InvoiceDraftState {
  currentStep: number;
  client: InvoiceClientData;
  items: InvoiceItemData[];
  pendingItem: InvoiceItemData;
  meta: InvoiceMetaData;
  confirmed: boolean;
}

function createEmptyItem(): InvoiceItemData {
  return {
    descripcion: "",
    cantidad: 1,
    precio: 0,
    impuestos: 0,
  };
}

export function createInvoiceDraftStore(initial?: Partial<InvoiceDraftState>) {
  const state: InvoiceDraftState = {
    currentStep: 1,
    client: {
      nombre: "",
      identificacion: "",
      email: "",
    },
    items: [],
    pendingItem: createEmptyItem(),
    meta: {
      fecha: "",
      vencimiento: "",
      notas: "",
    },
    confirmed: false,
    ...initial,
  };

  return {
    getState: () => state,
    nextStep: () => {
      state.currentStep = Math.min(4, state.currentStep + 1);
    },
    previousStep: () => {
      state.currentStep = Math.max(1, state.currentStep - 1);
    },
    setCurrentStep: (step: number) => {
      state.currentStep = Math.max(1, Math.min(4, step));
    },
    updateClient: (patch: Partial<InvoiceClientData>) => {
      state.client = { ...state.client, ...patch };
    },
    updateMeta: (patch: Partial<InvoiceMetaData>) => {
      state.meta = { ...state.meta, ...patch };
    },
    updatePendingItem: (patch: Partial<InvoiceItemData>) => {
      state.pendingItem = { ...state.pendingItem, ...patch };
    },
    addPendingItem: () => {
      if (!state.pendingItem.descripcion.trim()) {
        return false;
      }

      state.items.push({ ...state.pendingItem });
      state.pendingItem = createEmptyItem();
      return true;
    },
    removeLastItem: () => {
      state.items.pop();
    },
    markConfirmed: () => {
      state.confirmed = true;
    },
    getTotals: () => {
      const subtotal = state.items.reduce((acc, item) => acc + item.cantidad * item.precio, 0);
      const impuestos = state.items.reduce(
        (acc, item) => acc + item.cantidad * item.precio * (item.impuestos / 100),
        0,
      );

      return {
        subtotal,
        impuestos,
        total: subtotal + impuestos,
      };
    },
  };
}

export type InvoiceDraftStore = ReturnType<typeof createInvoiceDraftStore>;
