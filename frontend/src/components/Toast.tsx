import { useEffect, useRef } from 'react'

interface Props {
  message: string
  type: 'success' | 'warning' | 'info'
  onClose: () => void
}

export function Toast({ message, type, onClose }: Props) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const t = setTimeout(() => onCloseRef.current(), 4000)
    return () => clearTimeout(t)
  }, [message, type])

  const bg = type === 'success' ? 'bg-success' : type === 'warning' ? 'bg-warning' : 'bg-info'
  return (
    <div
      className={`position-fixed bottom-0 end-0 m-3 p-3 rounded shadow ${bg} text-white`}
      role="alert"
    >
      {message}
    </div>
  )
}
