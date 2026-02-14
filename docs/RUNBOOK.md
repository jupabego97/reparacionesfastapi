# Runbook Operativo

## Incidente: API degradada o caída
1. Revisar `/health/live` y `/health/ready`.
2. Verificar logs por `X-Request-ID`.
3. Confirmar estado de DB y credenciales.
4. Revertir deploy si hay regresión reciente.

## Incidente: errores 401/403 masivos
1. Validar `JWT_SECRET` y `JWT_EXPIRE_MINUTES`.
2. Confirmar reloj del servidor.
3. Revisar política de registro público (`ALLOW_PUBLIC_REGISTER`).

## Incidente: latencia alta en tablero
1. Inspeccionar endpoint `/api/tarjetas?view=board`.
2. Revisar índices y plan de ejecución (`EXPLAIN ANALYZE`).
3. Verificar volumen de eventos socket y frecuencia de refetch.

## Checklist de release
- CI verde (backend + frontend).
- Migraciones Alembic aplicadas.
- Smoke test de login, tablero, crear/mover/editar tarjeta.
- Verificación de headers de seguridad en producción.
