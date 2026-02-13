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

export function toWhatsAppUrl(raw: string | null | undefined): string | null {
  const num = toWhatsAppNumber(raw)
  return num ? `https://wa.me/${num}` : null
}
