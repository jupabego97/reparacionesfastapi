import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import 'bootstrap/dist/css/bootstrap.min.css'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 30, refetchOnWindowFocus: false },
  },
})

// Prefetch tarjetas (light) inmediatamente para que estén listas cuando App monte
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
queryClient.prefetchQuery({
  queryKey: ['tarjetas'],
  queryFn: () => fetch(`${API_BASE}/api/tarjetas?light=1`, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error('fetch fail')
    return r.json()
  }),
  staleTime: 1000 * 30,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
