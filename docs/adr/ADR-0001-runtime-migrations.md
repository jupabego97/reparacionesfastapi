# ADR-0001: Migraciones de esquema fuera de runtime en producción

## Estado
Aceptado

## Contexto
Las migraciones automáticas en runtime incrementan riesgo de caídas durante arranque y comportamiento no determinista.

## Decisión
- Producción: no ejecutar `runtime_schema_migration` por defecto.
- Evolución de esquema solo mediante Alembic en pipeline de deploy.
- Desarrollo: `runtime_schema_migration` opcional para velocidad local.

## Consecuencias
- Mayor previsibilidad de despliegues.
- Requiere disciplina de migraciones versionadas.
