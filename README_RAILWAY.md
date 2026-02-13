# Despliegue en Railway - 3 servicios

Este proyecto está preparado para desplegarse en Railway con **3 servicios separados**:

1. **Backend** - API FastAPI + Socket.IO
2. **Frontend** - SPA React (estático)
3. **Database** - PostgreSQL

## Paso a paso

### 1. Crear proyecto en Railway

1. Ve a [railway.app](https://railway.app) e inicia sesión
2. **New Project** → **Deploy from GitHub repo**
3. Selecciona el repo `reparacionesfastapi`

### 2. Añadir PostgreSQL (servicio BD)

1. En el proyecto → **+ New** → **Database** → **Add PostgreSQL**
2. Railway crea el servicio y la variable `DATABASE_URL` automáticamente

### 3. Configurar servicio Backend

1. **+ New** → **GitHub Repo** → `reparacionesfastapi` (o usa el que añadiste)
2. En el servicio backend → **Settings**:
   - **Root Directory**: vacío (usa raíz, Procfile hace `cd backend`) **o** `backend` (usa backend/Procfile)
   - **Build Command**: *(dejar vacío – usa Procfile)*
   - **Start Command**: *(dejar vacío – usa Procfile)*
3. **Variables** (o **Variables** en el dashboard):
   - `DATABASE_URL` → Referencia al servicio PostgreSQL (clic en el add-on y **Connect** → copia la variable)
   - `ENVIRONMENT` = `production`
   - `ALLOWED_ORIGINS` = URL del frontend (ej: `https://reparacionesfastapi-frontend.up.railway.app`)
   - `GEMINI_API_KEY` = *(opcional)*
   - `SOCKETIO_SAFE_MODE` = `1`
4. **Settings** → **Networking** → **Generate Domain** para obtener la URL pública del backend (ej: `https://reparacionesfastapi-backend.up.railway.app`)

### 4. Configurar servicio Frontend

1. **+ New** → **GitHub Repo** → mismo repo `reparacionesfastapi`
2. En el servicio frontend → **Settings**:
   - **Root Directory**: `frontend`
   - **Build Command**: *(dejar vacío o* `npm run build`*)*
   - **Start Command**: *(dejar vacío – usa Procfile)*
3. **Variables**:
   - `VITE_API_URL` = URL del backend (ej: `https://reparacionesfastapi-backend.up.railway.app`)
   - Importante: sin barra final (`/`)
4. **Settings** → **Networking** → **Generate Domain**

### 5. Migraciones de BD

En el **servicio backend** → **Settings** → **Deploy**:

- **Predeploy Command** (o ejecutar manualmente una vez):
  ```
  cd backend && python -m alembic upgrade head
  ```

O desde la consola del servicio backend:
```bash
cd backend && python -m alembic upgrade head
```

### 6. Orden de variables (ALLOWED_ORIGINS)

1. Despliega primero **backend** y **frontend** para tener sus URLs
2. Añade en **Backend** la variable `ALLOWED_ORIGINS` con la URL del frontend
3. En **Frontend** añade `VITE_API_URL` con la URL del backend
4. Redespliega ambos servicios para aplicar las variables

## Resumen de variables

| Servicio   | Variable         | Ejemplo                                                    |
|------------|------------------|------------------------------------------------------------|
| Backend    | DATABASE_URL     | `postgresql://...` (de add-on PostgreSQL)                  |
| Backend    | ENVIRONMENT      | `production`                                               |
| Backend    | ALLOWED_ORIGINS  | `https://reparacionesfastapi-frontend.up.railway.app`      |
| Backend    | GEMINI_API_KEY   | *(opcional)*                                               |
| Backend    | SOCKETIO_SAFE_MODE | `1`                                                      |
| Frontend   | VITE_API_URL     | `https://reparacionesfastapi-backend.up.railway.app`      |

## Procfiles

- **Raíz** (backend): `web: cd backend && uvicorn app.socket_app:socket_app --host 0.0.0.0 --port $PORT`
- **frontend/Procfile**: `web: npm run build && npx serve -s dist -l $PORT`
