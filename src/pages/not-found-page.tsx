import { Link } from 'react-router'
import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={FileQuestion}
      title="Page not found"
      action={
        <Button asChild size="sm" variant="outline">
          <Link to="/">Back to dashboard</Link>
        </Button>
      }
    />
  )
}
