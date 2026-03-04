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
