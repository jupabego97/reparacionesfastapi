/** Normaliza número para WhatsApp. Colombia (+57): si son 10 dígitos, antepone 57. */
export function toWhatsAppNumber(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10 && digits.startsWith('3')) {
    return '57' + digits
  }
  if (digits.startsWith('57') && digits.length >= 12) return digits
  if (digits.length >= 10) return digits
  return ''
}

export function toWhatsAppUrl(raw: string | null | undefined, text?: string): string | null {
  const num = toWhatsAppNumber(raw)
  if (!num) return null
  const base = `https://wa.me/${num}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}

/**
 * Abre WhatsApp de forma inteligente:
 * - En Windows: intenta abrir la app de escritorio (whatsapp://).
 *   Si la app no está instalada (la página no pierde el foco), cae en WhatsApp Web.
 * - En otros SO: abre directamente WhatsApp Web.
 */
export function openWhatsAppSmart(raw: string | null | undefined, text?: string): void {
  const num = toWhatsAppNumber(raw)
  if (!num) return

  const encoded = text ? encodeURIComponent(text) : ''
  const webUrl = encoded ? `https://wa.me/${num}?text=${encoded}` : `https://wa.me/${num}`
  const appUrl = encoded ? `whatsapp://send?phone=${num}&text=${encoded}` : `whatsapp://send?phone=${num}`

  const isWindows = /Windows/i.test(navigator.userAgent)

  if (!isWindows) {
    window.open(webUrl, '_blank', 'noopener,noreferrer')
    return
  }

  // En Windows: intentar abrir la app via deep link.
  // Si la app está instalada, el OS la lanza y el navegador pierde el foco.
  // Si no está instalada, la página sigue enfocada y abrimos WhatsApp Web como fallback.
  let appLaunched = false

  const handleBlur = () => { appLaunched = true }
  window.addEventListener('blur', handleBlur, { once: true })

  const anchor = document.createElement('a')
  anchor.href = appUrl
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)

  setTimeout(() => {
    window.removeEventListener('blur', handleBlur)
    if (!appLaunched) {
      window.open(webUrl, '_blank', 'noopener,noreferrer')
    }
  }, 500)
}
