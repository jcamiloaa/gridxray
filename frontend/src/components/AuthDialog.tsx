import { useState, type FormEvent } from 'react'
import { auth, type User } from '../api/client'
import { Brand } from './Brand'

export function AuthDialog({ onSignedIn, onClose }: { onSignedIn: (u: User) => void; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<User>) {
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await action())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    run(() => auth.login(email, password))
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="auth-title"
        onClick={(e) => e.stopPropagation()}>
        <button className="btn-ghost dialog__close" onClick={onClose} aria-label="Close">✕</button>
        <Brand byline />
        <h2 id="auth-title" style={{ marginTop: 18 }}>Open the workspace</h2>
        <p className="muted" style={{ marginTop: 6 }}>Use the demo account to explore everything in one click.</p>
        <button className="btn-primary btn-lg" style={{ width: '100%', marginTop: 20 }} disabled={busy}
          onClick={() => run(auth.demo)}>
          Enter as demo user
        </button>
        <div className="divider">or sign in with email</div>
        <form onSubmit={submit}>
          <label>Email
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>Password
            <input type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" disabled={busy}>Sign in</button>
        </form>
      </section>
    </div>
  )
}
