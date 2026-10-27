import { useEffect, useState } from 'react'
import { auth, type User } from './api/client'
import { AuthDialog } from './components/AuthDialog'
import { LanguageProvider } from './i18n'
import { EvidencePage } from './pages/EvidencePage'
import { Landing } from './pages/Landing'
import { Workspace } from './pages/Workspace'

type View = 'landing' | 'workspace' | 'evidence'

const viewFromPath = (): View => {
  const path = window.location.pathname
  return path.startsWith('/app') ? 'workspace' : path.startsWith('/evidence') ? 'evidence' : 'landing'
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined) // undefined = checking session
  const [view, setView] = useState<View>(viewFromPath)
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => { auth.me().then(setUser, () => setUser(null)) }, [])
  useEffect(() => {
    const onPop = () => setView(viewFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = (v: View) => {
    window.history.pushState(null, '', v === 'workspace' ? '/app' : v === 'evidence' ? '/evidence' : '/')
    setView(v)
    window.scrollTo(0, 0)
  }

  // evidence is for signed-in users: ask to sign in instead of showing it publicly
  if (user === null && view === 'evidence' && !signingIn) {
    queueMicrotask(() => setSigningIn(true))
  }
  if (user === undefined) return null

  const signedIn = (u: User) => {
    setUser(u)
    setSigningIn(false)
    go(view === 'evidence' ? 'evidence' : 'workspace')
  }

  return (
    <>
      {view === 'evidence' && user ? (
        <LanguageProvider><EvidencePage user={user} onHome={() => go('landing')} onOpenWorkspace={() => go('workspace')}
          onSignIn={() => setSigningIn(true)} /></LanguageProvider>
      ) : view === 'workspace' && user ? (
        <LanguageProvider><Workspace user={user} onHome={() => go('landing')}
          onSignOut={() => auth.logout().finally(() => { setUser(null); go('landing') })} /></LanguageProvider>
      ) : (
        <Landing user={user} onOpenWorkspace={() => go('workspace')} onSignIn={() => setSigningIn(true)} />
      )}
      {signingIn && <AuthDialog onSignedIn={signedIn} onClose={() => setSigningIn(false)} />}
    </>
  )
}
