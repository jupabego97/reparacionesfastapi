# Sistema de Reparaciones - FastAPI + React

Migración del sistema de reparaciones a FastAPI (backend) y React (frontend) con paridad funcional con la app original en Flask.

## Estructura

- `backend/` - API FastAPI con SQLAlchemy, Socket.IO, Gemini
- `frontend/` - SPA React con Vite, React Query, Bootstrap

## Desarrollo local

### Backend

```bash
cd backend
pip install -r requirements.txt
# Crear .env con DATABASE_URL, GEMINI_API_KEY opcionales
# Recomendado:
# JWT_SECRET=<secreto fuerte>
# ALLOW_PUBLIC_REGISTER=false
# RUNTIME_SCHEMA_MIGRATION=false
python -m alembic upgrade head   # Crear tablas
python run.py                    # o: uvicorn app.socket_app:socket_app --reload
```

Backend en http://localhost:8000

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend en http://localhost:5173 (proxy a API en 8000)

## Despliegue en Railway (3 servicios)

Backend, frontend y base de datos como servicios separados. Ver **[README_RAILWAY.md](README_RAILWAY.md)** para instrucciones detalladas.

- **Backend**: Root = `.` (usa Procfile raíz)
- **Frontend**: Root = `frontend` (usa frontend/Procfile)
- **Database**: Add PostgreSQL desde Railway

## Rollback

En caso de problemas, revertir al commit anterior del repositorio y redesplegar la app Flask original.

## Pruebas

```bash
cd backend
pytest tests/ -v
```

## Salud y observabilidad

- `GET /health` estado compuesto
- `GET /health/live` liveness
- `GET /health/ready` readiness

Errores API estandarizados:

```json
{
  "code": "string",
  "message": "string",
  "details": {},
  "request_id": "string"
}
```
