# open-contador-tui

Base inicial de una TUI para SOS Contador construida con **Bun + OpenTUI**.

## Requisitos

- [Bun](https://bun.sh) >= 1.2

## Instalación

```bash
bun install
```

## Ejecutar en desarrollo

```bash
bun run dev
```

## Ejecutar en modo normal

```bash
bun run start
```

## Validación de tipos

```bash
bun run typecheck
```

## Configuración de entorno

Copia el archivo de ejemplo y completa tus credenciales:

```bash
cp .env.example .env
```

Variables disponibles:

- `SOS_CONTADOR_BASE_URL`: URL base de la API.
- `SOS_CONTADOR_API_TOKEN`: token Bearer (si ya lo tienes).
- `SOS_CONTADOR_EMAIL` y `SOS_CONTADOR_PASSWORD`: credenciales para `authenticate()` si no hay token.
- `SOS_CONTADOR_TIMEOUT_MS`: timeout por request en milisegundos.
- `SOS_CONTADOR_RETRIES`: reintentos para errores transitorios (timeouts, 429 y 5xx).

## Estructura

```txt
src/
  main.ts
  services/
    sos-contador-client.ts
  types/
    cliente.ts
    factura.ts
    impuesto.ts
    item-factura.ts
  ui/
    components/
      header.ts
    screens/
      home-screen.ts
```
