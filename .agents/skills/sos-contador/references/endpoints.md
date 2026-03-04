# SOS Contador - Endpoints

Fuente: coleccion Postman publica `SOS Contador API` (71 requests).

## acceso (3)
- `POST /register`
- `POST /login`
- `GET /cuit/credentials/:idcuit`

## actividad (1)
- `GET /actividad/listado/:busca?`

## afip (1)
- `GET /afip/eventanilla?desde=2020-02-01&hasta=2020-03-27`

## asiento (4)
- `GET /asiento/listado/:periodo?pagina=1&registros=50`
- `GET /asiento/detalle/:id`
- `PUT /asiento/:id`
- `DELETE /asiento/:id`

## cae (1)
- `GET /cae/status/:id`

## centrocosto (4)
- `GET /centrocosto/listado`
- `POST /centrocosto`
- `PUT /centrocosto/:id`
- `DELETE /centrocosto/:id`

## cliente (4)
- `GET /cliente/listado?proveedor=true&cliente=true&pagina=1&registros=50`
- `POST /cliente`
- `PUT /cliente/:id`
- `DELETE /cliente/:id`

## cobro (4)
- `GET /cobro/listado/:periodo?pagina=1&registros=50`
- `GET /cobro/detalle/:id`
- `PUT /cobro/:id`
- `DELETE /cobro/:id`

## compra (5)
- `GET /compra/listado/:periodo?pagina=1&registros=50`
- `GET /compra/detalle/:id`
- `POST /compra/consulta`
- `PUT /compra/:id`
- `DELETE /compra/:id`

## cuentacontable (1)
- `GET /cuentacontable/listado`

## cuentacorriente (1)
- `GET /cuentacorriente/listado`

## cuit (7)
- `GET /cuit/listado`
- `GET /cuit/credentials/:idcuit`
- `GET /cuit/parametros`
- `GET /cuit/ccma`
- `GET /cuit/sct`
- `POST /cuit`
- `PUT /cuit/parametros/mobile`

## email (1)
- `POST /email/enviar`

## grupomodificador (4)
- `GET /grupomodificador/listado`
- `POST /grupomodificador`
- `PUT /grupomodificador/:id`
- `DELETE /grupomodificador/:id`

## impresion (1)
- `GET /impresion/parametros`

## indiceaniomes (1)
- `GET /indiceaniomes/listado`

## iva (1)
- `GET /iva/listado/:ejercicio?anio&mes`

## libroiva (2)
- `GET /libroivaventa/listado/:ejercicio?anio={{anio}}&mes={{mes}}`
- `GET /libroivacompra/listado/:ejercicio?anio={{anio}}&mes={{mes}}`

## mayor (1)
- `GET /mayor/listado/:ejercicio?fechadesde&fechahasta&pagina&registros&arbol`

## pago (4)
- `GET /pago/listado/:periodo?pagina=1&registros=50`
- `GET /pago/detalle/:id`
- `PUT /pago/:id`
- `DELETE /pago/:id`

## producto (4)
- `GET /producto/listado?pagina=1&registros=50`
- `POST /producto`
- `PUT /producto/:id`
- `DELETE /producto/:id`

## provincia (1)
- `GET /provincia/listado`

## puntoventa (4)
- `GET /puntoventa/listado`
- `POST /puntoventa`
- `PUT /puntoventa/:id`
- `DELETE /puntoventa/:id`

## recibo (1)
- `GET /recibo/listado/:periodo?pagina=1&registros=50`

## sumasysaldos (1)
- `GET /sumasysaldos/listado/:ejercicio?fechadesde&fechahasta`

## tipo (1)
- `GET /tipo/listado/:modulo/:busca?`

Nota: para escalas/tope de monotributo, usar `modulo=monotributo`.

## unidad (1)
- `GET /unidad/listado`

## venta (7)
- `GET /venta/listado/:modo/:periodo/:cae?pagina=1&registros=50&fecha_desde=2020-01-01&fecha_hasta=2021-04-01`
- `GET /venta/detalle/:id`
- `GET /venta/pdf/:id`
- `POST /venta/consulta?pagina=1&registros=50`
- `PUT /venta/archivar/:id`
- `PUT /venta/:id`
- `DELETE /venta/:id`
