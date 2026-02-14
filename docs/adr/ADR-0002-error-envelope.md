# ADR-0002: Envelope estandar de errores API

## Estado
Aceptado

## Contexto
Los errores heterogéneos dificultan observabilidad y manejo uniforme en frontend.

## Decisión
Todas las respuestas de error deben retornar:
- `code`
- `message`
- `details` (opcional)
- `request_id`

## Consecuencias
- Frontend puede parsear consistentemente errores.
- Facilita soporte con trazabilidad por `request_id`.
