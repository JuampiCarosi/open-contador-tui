# open-contador-tui

TUI de facturación para **SOS Contador** inspirada en la UX de `terminal.shop`: navegación tipo catálogo, panel principal con acciones rápidas, detalle contextual y flujo guiado para crear/repetir facturas.

## Stack

- Runtime + package manager: **Bun**
- Framework TUI: **OpenTUI** (`@opentui/core`)
- Backend: **SOS Contador API**

## Funcionalidades

- Crear factura desde terminal con wizard en 4 pasos.
- Campos contables con nombres originales: **CUIT**, **Razón social**, etc.
- Listar facturas emitidas.
- Repetir factura existente y editar antes de volver a emitir.
- Autollenado de cliente:
  - manual por acción `Autocompletar por CUIT`
  - sugerencias por historial con tecla `Tab`
- Resumen dinámico: subtotal, IVA y total.

## Uso

```bash
bun install
cp .env.example .env
bun run start
```

## Comandos

```bash
bun run dev
bun run start
bun run typecheck
```

## Variables de entorno

- `SOS_CONTADOR_BASE_URL` URL base de API (obligatoria para emitir/listar real).
- `SOS_CONTADOR_API_TOKEN` token Bearer.
- `SOS_CONTADOR_EMAIL` y `SOS_CONTADOR_PASSWORD` (alternativa para login).
- `SOS_CONTADOR_PUNTO_VENTA` punto de venta fallback para emitir cuando no hay historial (default: `1`).
- `SOS_CONTADOR_TIMEOUT_MS` timeout HTTP.
- `SOS_CONTADOR_RETRIES` reintentos.

Si no configurás `SOS_CONTADOR_BASE_URL`, la app abre igual pero no podrá sincronizar ni emitir contra API real.
