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

## Despliegue en Railway

1. Conecta este repo a Railway: [railway.app](https://railway.app) → New Project → Deploy from GitHub → selecciona `reparacionesfastapi`
2. **Root directory**: deja vacío o usa `.` (Railway ejecutará el Procfile en la raíz)
3. **Variables de entorno** (Railway → Variables):
   - `DATABASE_URL` - PostgreSQL (Railway ofrece add-on gratuito)
   - `GEMINI_API_KEY` - opcional, para IA
   - `ENVIRONMENT=production`
   - `ALLOWED_ORIGINS` - URL del frontend (ej: `https://tu-app.up.railway.app`)
   - `SOCKETIO_SAFE_MODE=1` - recomendado para Socket.IO detrás de proxy
4. El Procfile ejecuta el backend. Para frontend: build local (`npm run build` en `frontend/`) y servir `dist/` desde el backend, o desplegar frontend aparte (Vercel/Netlify) apuntando a la API.

## Rollback

En caso de problemas, revertir al commit anterior del repositorio y redesplegar la app Flask original.

## Pruebas

```bash
cd backend
pytest tests/ -v
```
