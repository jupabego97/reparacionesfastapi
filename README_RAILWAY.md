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
   - **Root Directory**: `backend` (recomendado; usa `backend/Procfile` y `backend/railway.json` con Python)
   - Alternativa: raíz del repo con Procfile raíz (`cd backend`); no uses la config Node del frontend en este servicio
   - **Build Command**: *(dejar vacío – usa Procfile)*
   - **Start Command**: *(dejar vacío – usa Procfile)*
3. **Variables** (o **Variables** en el dashboard):
   - `DATABASE_URL` → Referencia al servicio PostgreSQL (clic en el add-on y **Connect** → copia la variable)
   - `ENVIRONMENT` = `production`
   - `JWT_SECRET` = **secreto largo y aleatorio** (obligatorio). Si falta o queda el valor por defecto, la app **no arranca** en producción.
   - `ALLOWED_ORIGINS` = URL del frontend si usas **dominio custom** (ej: `https://taller.tudominio.com`). Sin barra final. Los `*.up.railway.app` / `*.railway.app` ya se permiten en producción.
   - `GEMINI_API_KEY` = *(opcional)*
   - `SOCKETIO_SAFE_MODE` = `1`
4. **Settings** → **Networking** → **Generate Domain** para obtener la URL pública del backend.
5. **Settings** → **Healthcheck Path** = `/health/live` (también va en `backend/railway.json`)

### 4. Configurar servicio Frontend

1. **+ New** → **GitHub Repo** → mismo repo `reparacionesfastapi`
2. En el servicio frontend → **Settings**:
   - **Root Directory**: `frontend`
   - **Build Command**: *(dejar vacío – usa `frontend/railway.json`)*
   - **Start Command**: *(dejar vacío – NO pongas `npx serve` a mano; el start escribe `runtime-config.js` y sirve `dist`)*
3. **Variables** (obligatorias para que carguen las tarjetas):
   - `VITE_API_URL` = URL del backend (ej: `https://<backend>.up.railway.app`)
   - Sin barra final (`/`). Se lee **al arrancar** el contenedor (no hace falta rebuild si solo cambia esta variable; sí hay que **reiniciar** el servicio frontend).
   - Márcala también como disponible en build: Vite la hornea en el bundle como respaldo.
4. **Settings** → **Networking** → **Generate Domain**

### 5. Migraciones de BD

Van en **Pre-deploy Command** (`backend/railway.json` ya lo pone: `python -m alembic upgrade head`). Nixpacks trata la línea `release:` del Procfile como un `RUN` del Dockerfile: Alembic corre **en el build**, sin el driver correcto, y el deploy falla. No añadas `release:` al Procfile.

Si el Root Directory del servicio no es `backend`:
```
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
| Backend    | JWT_SECRET       | Secreto fuerte (obligatorio en producción)                 |
| Backend    | ALLOWED_ORIGINS  | Dominio custom del frontend (opcional). `*.railway.app` ya está permitido en producción |
| Backend    | GEMINI_API_KEY   | *(opcional)*                                               |
| Backend    | SOCKETIO_SAFE_MODE | `1`                                                      |
| Frontend   | VITE_API_URL     | URL pública del backend, sin `/` final                     |

## Procfiles

- **Raíz** (backend): `web: cd backend && uvicorn app.socket_app:socket_app --host 0.0.0.0 --port $PORT`
- **frontend/Procfile**: `web: node ./scripts/start-static.mjs`

## Si el tablero no carga en Railway

1. El frontend y el backend **tienen que ser dos servicios**. Si abres la URL del backend verás `{"service":"reparaciones-api","health":"/health/live"}`, no el Kanban.
2. En el servicio frontend, `VITE_API_URL` debe ser exactamente la URL HTTPS del backend, sin `/` al final.
3. Reinicia el frontend después de cambiar `VITE_API_URL` (el start regenera `runtime-config.js`).
4. No sustituyas el Start Command por `npx serve ...`: `serve` se quedaba en `devDependencies` y `npm run build` en el start fallaba al podar Vite/tsc.
5. Si usas dominio custom, añade esa URL en `ALLOWED_ORIGINS` del backend y redespliega.
6. Si el build del backend falla con `No module named 'psycopg'`, Alembic se está ejecutando en el **build** (Procfile `release:`). Quita esa línea; las migraciones van en Pre-deploy.
