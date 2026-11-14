#!/usr/bin/env node
/**
 * Arranque de producción del frontend en Railway.
 *
 * Vite hornea VITE_API_URL en el bundle. Si la variable no estuvo disponible
 * en el build (o Railway regeneró el dominio del backend), las peticiones
 * van al origen del SPA y el tablero queda vacío. Este script escribe
 * dist/runtime-config.js con la URL de runtime antes de servir.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(frontendRoot, 'dist');

function resolveApiUrl() {
  return String(process.env.VITE_API_URL || '').trim().replace(/\/$/, '');
}

function writeRuntimeConfig() {
  if (!existsSync(distDir)) {
    console.error('No existe frontend/dist. El build de Nixpacks tiene que correr `npm run build` antes del start.');
    process.exit(1);
  }
  const apiUrl = resolveApiUrl();
  const body = `window.__API_URL = ${JSON.stringify(apiUrl)};\n`;
  writeFileSync(path.join(distDir, 'runtime-config.js'), body);
  if (!apiUrl) {
    console.warn('VITE_API_URL está vacía: el SPA llamará al mismo origen y la API fallará si backend y frontend son servicios distintos.');
  } else {
    console.log(`runtime-config.js → API ${apiUrl}`);
  }
}

function resolveServeEntry() {
  const pkgPath = require.resolve('serve/package.json', { paths: [frontendRoot] });
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.serve;
  if (!bin) {
    throw new Error('El paquete "serve" no declara bin.');
  }
  return path.join(path.dirname(pkgPath), bin);
}

writeRuntimeConfig();

const port = process.env.PORT || '3000';
const serveEntry = resolveServeEntry();
const child = spawn(
  process.execPath,
  [serveEntry, '-s', distDir, '-l', String(port), '--no-clipboard'],
  { stdio: 'inherit', cwd: frontendRoot },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
