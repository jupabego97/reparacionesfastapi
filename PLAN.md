# Plan: Fix de tarjetas apiladas + Foto en ventana nueva

## Problema 1: Flechas inaccesibles en "Listos para entregar"

### Diagnostico
- **Archivo**: `frontend/src/components/TarjetaCard.tsx` (lineas 190-228)
- **Archivo CSS**: `frontend/src/index.css` (lineas 698-706, 880-902)
- La clase `.tarjeta-card` tiene `overflow: hidden` (linea 703), lo que corta cualquier contenido que se desborde
- Las tarjetas se apilan en `.kanban-column-body` con `gap: 0.5rem` (linea 659) y scroll vertical (`overflow-y: auto`, linea 655)
- Las flechas estan dentro de `.tarjeta-footer-right` (lineas 214-227) mezcladas con WhatsApp y Editar
- **Causa raiz**: En columnas con muchas tarjetas, el footer se comprime. Los botones de flechas (44x44px cada uno) compiten por espacio con WhatsApp y Editar en el `.tarjeta-footer-right`. Cuando el contenido es mucho, la tarjeta crece y las flechas quedan ocultas o inaccesibles por el `overflow: hidden` de la tarjeta padre

### Solucion propuesta
1. **Sacar las flechas del footer** y colocarlas como una barra fija siempre visible en la parte superior derecha de cada tarjeta (overlay), con `position: absolute` y `z-index` alto
2. Hacerlas mas compactas (iconos pequenos, sin texto) para que no interfieran con el contenido
3. Usar opacity baja por defecto y mostrar completas al hacer hover sobre la tarjeta
4. Esto asegura que sin importar cuantas tarjetas haya en la columna, las flechas siempre son accesibles

### Archivos a modificar
- `frontend/src/components/TarjetaCard.tsx` — Mover las flechas fuera del footer, crear seccion overlay
- `frontend/src/index.css` — Estilos para la nueva posicion de las flechas

---

## Problema 2: Foto se abre en ventana nueva mas grande

### Diagnostico
- **Archivo**: `frontend/src/components/TarjetaCard.tsx` (lineas 186-188)
- Actualmente el `onClick` de la imagen llama `onEdit(t)`, que abre el modal de edicion completo
- El usuario quiere que al hacer clic en la foto se abra UNA VENTANA NUEVA (no un modal) con la imagen a tamano grande para identificar el equipo

### Solucion propuesta
1. Cambiar el `onClick` de `.tarjeta-thumbnail` para que abra la imagen en una **nueva pestana del navegador** usando `window.open()`
2. Abrir la URL de la imagen original (no el thumbnail) en una ventana nueva: `window.open(t.imagen_url || t.cover_thumb_url, '_blank')`
3. Esto aplica tanto para la vista normal (linea 187) como para la vista compacta (linea 71)

### Archivos a modificar
- `frontend/src/components/TarjetaCard.tsx` — Cambiar onClick de las imagenes

---

## Resumen de cambios

| Archivo | Cambio |
|---------|--------|
| `TarjetaCard.tsx` | Flechas como overlay en esquina superior + foto abre en ventana nueva |
| `index.css` | Estilos para flechas overlay (position absolute, z-index, hover) |

## Orden de ejecucion
1. Modificar `TarjetaCard.tsx`: flechas overlay + foto window.open
2. Modificar `index.css`: estilos de las flechas overlay
3. Build y verificar
4. Commit y push
