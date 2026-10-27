import { useEffect, useState } from 'react'
import { auth, type User } from './api/client'
import { AuthDialog } from './components/AuthDialog'
import { LanguageProvider } from './i18n'
import { Landing } from './pages/Landing'
import { Workspace } from './pages/Workspace'

type View = 'landing' | 'workspace'

const viewFromPath = (): View => (window.location.pathname.startsWith('/app') ? 'workspace' : 'landing')

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
    window.history.pushState(null, '', v === 'workspace' ? '/app' : '/')
    setView(v)
    window.scrollTo(0, 0)
  }

  if (user === undefined) return null

  const signedIn = (u: User) => {
    setUser(u)
    setSigningIn(false)
    go('workspace')
  }

  return (
    <>
      {view === 'workspace' && user ? (
        <LanguageProvider><Workspace user={user} onHome={() => go('landing')}
          onSignOut={() => auth.logout().finally(() => { setUser(null); go('landing') })} /></LanguageProvider>
      ) : (
        <Landing user={user} onOpenWorkspace={() => go('workspace')} onSignIn={() => setSigningIn(true)} />
      )}
      {signingIn && <AuthDialog onSignedIn={signedIn} onClose={() => setSigningIn(false)} />}
    </>
  )
}
