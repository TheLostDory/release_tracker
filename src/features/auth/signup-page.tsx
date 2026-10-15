import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { signUp } from '@/services/auth'
import { useAuth } from './auth-context'
import { AuthCard } from './auth-card'
import { authErrorMessage, PASSWORD_MIN_LENGTH, passwordProblem } from './password-rules'

interface Errors {
  name?: string
  email?: string
  password?: string
  confirm?: string
}

export default function SignupPage() {
  const { status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') return <Navigate to={from} replace />

  function validate(): Errors {
    const next: Errors = {}
    if (!name.trim()) next.name = 'Your name is shown to teammates.'
    else if (name.trim().length > 80) next.name = 'Keep it under 80 characters.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = 'Enter a valid email address.'
    const problem = passwordProblem(password)
    if (problem) next.password = problem
    else if (confirm !== password) next.confirm = "Passwords don't match."
    return next
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setSubmitting(true)
    try {
      await signUp({ email: email.trim(), password, name: name.trim() })
      navigate(from, { replace: true })
    } catch (err) {
      setFormError(authErrorMessage(err, 'Sign-up failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const signInLink = (
    <Link to="/login" state={{ from }} className="font-medium text-foreground underline-offset-4 hover:underline">
      Sign in
    </Link>
  )

  const clear = (key: keyof Errors) => setErrors((e) => ({ ...e, [key]: undefined }))

  return (
    <AuthCard
      pageTitle="Create an account"
      title="Create an account"
      subtitle={
        from.startsWith('/invite/')
          ? "After signing up you'll come back to your invitation."
          : 'Create projects, or join one when a teammate invites you.'
      }
      footer={<>Already have an account? {signInLink}</>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Name" error={errors.name}>
          {(p) => (
            <Input {...p} autoComplete="name" autoFocus value={name} onChange={(e) => (setName(e.target.value), clear('name'))} />
          )}
        </FormField>
        <FormField label="Email" error={errors.email}>
          {(p) => (
            <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => (setEmail(e.target.value), clear('email'))} />
          )}
        </FormField>
        <FormField label="Password" error={errors.password} hint={`At least ${PASSWORD_MIN_LENGTH} characters, with letters and numbers.`}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => (setPassword(e.target.value), clear('password'))}
            />
          )}
        </FormField>
        <FormField label="Confirm password" error={errors.confirm}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => (setConfirm(e.target.value), clear('confirm'))}
            />
          )}
        </FormField>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  )
}
