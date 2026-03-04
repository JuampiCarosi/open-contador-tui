---
name: sos-contador
description: Skill para integrar y operar la API de SOS Contador desde agentes. Incluye autenticacion JWT, patrones de uso y catalogo de endpoints.
metadata:
  references: endpoints
---

# SOS Contador API Skill

Skill para trabajar con la API de SOS Contador usando la coleccion oficial de Postman.

## Cuando usar esta skill

Usa esta skill cuando el usuario pida:

- Integrar con SOS Contador
- Consumir endpoints de facturacion, compras, ventas, clientes, CUIT o AFIP
- Armar scripts/servicios que llamen la API de `api.sos-contador.com`
- Validar parametros, path params o queries de endpoints de esta API

## Fuente oficial y forma recomendada

La fuente principal es la documentacion de Postman publicada en:

- `https://documenter.getpostman.com/view/1566360/SWTD6vnC?version=latest`

Para agentes, la forma mas robusta no es parsear el HTML de la pagina, sino consumir el JSON interno de Documenter:

- `https://documenter.gw.postman.com/api/collections/1566360/SWTD6vnC?environment=1566360-d786fc26-392b-4893-8d0b-264b20de265d&segregateAuth=true&versionTag=latest`

Esto permite actualizar endpoints de forma automatica.

## Base URL y autenticacion

- Base URL: `https://api.sos-contador.com/api-comunidad`
- Esquema de auth para casi todos los endpoints: `Authorization: Bearer <JWT_TOKEN>`

Flujo recomendado:

1. Login usuario con `POST /login` (o `POST /register` + `POST /login`)
2. Guardar token JWT de la respuesta
3. Enviar `Authorization: Bearer <token>` en cada request autenticado
4. Si el endpoint requiere CUIT/contexto, resolverlo con rutas de `cuit/*`

## Notas de schema (importante)

- En la coleccion actual, el campo `categoria` aparece explicitamente en el payload de `POST /cuit`.
- La API publica no documenta un endpoint dedicado para leer la categoria actual de monotributo de la CUIT.
- En algunos tenants puede venir en lecturas de `cuit/*` como campo extra; en otros no.
- No asumir que `/cuit/listado` incluira `categoria` siempre.
- Para topes de monotributo usar `GET /tipo/listado/monotributo/` (usa `version` + `montoanual_max`).
- Hay payloads de ejemplo con muchos campos en `null` (por ejemplo `PUT /cuit/parametros/mobile`), por lo que el agente no debe asumir que esos `null` sean obligatorios ni permanentes.

## Reglas operativas para agentes

1. Siempre confirmar credenciales/secretos via variables de entorno; no hardcodear.
2. Si falta un path param (`:id`, `:periodo`, `:ejercicio`, etc.), pedir solo ese dato.
3. Para listados, respetar paginacion (`pagina`, `registros`) si existe.
4. Mantener `Content-Type: application/json` en requests con body.
5. Manejar expiracion de token: relogin y reintento unico.

## Implementacion sugerida

- Crear cliente HTTP con:
  - `baseURL = https://api.sos-contador.com/api-comunidad`
  - interceptor para inyectar bearer token
  - helper para reemplazar parametros `:id`, `:periodo`, etc.
- Encapsular por modulo (`venta`, `compra`, `cliente`, `cuit`, ...).

## Referencias

- Catalogo de endpoints: `./references/endpoints.md`
