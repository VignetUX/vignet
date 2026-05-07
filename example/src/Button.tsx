import type { CSSProperties } from 'react'

type Variant = 'primary' | 'danger' | 'ghost'

interface ButtonProps {
  label: string
  variant?: Variant
  disabled?: boolean
  onClick?: () => void
}

const styles: Record<Variant, CSSProperties> = {
  primary: {
    background: '#4d8fff',
    color: '#fff',
    border: 'none',
  },
  danger: {
    background: '#e53e3e',
    color: '#fff',
    border: 'none',
  },
  ghost: {
    background: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
  },
}

export function Button({ label, variant = 'primary', disabled = false, onClick }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles[variant],
        padding: '8px 20px',
        borderRadius: '6px',
        fontSize: '14px',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {label}
    </button>
  )
}
