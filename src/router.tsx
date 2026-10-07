import { createBrowserRouter } from 'react-router'
import { RequireAuth } from '@/features/auth/require-auth'
import RouteError from '@/pages/route-error'

const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
})

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: '/login', lazy: page(() => import('@/features/auth/login-page')) },
      {
        element: <RequireAuth />,
        children: [
          {
            lazy: page(() => import('@/layouts/app-layout')),
            children: [
              {
                // Page errors render inside the shell; sidebar and top bar stay usable.
                errorElement: <RouteError inShell />,
                children: [
              { index: true, lazy: page(() => import('@/pages/dashboard-page')) },
              { path: 'sprints', lazy: page(() => import('@/pages/sprints-page')) },
              { path: 'sprints/:sprintId', lazy: page(() => import('@/pages/sprint-detail-page')) },
              { path: 'releases', lazy: page(() => import('@/pages/releases-page')) },
              { path: 'releases/:releaseId', lazy: page(() => import('@/pages/release-detail-page')) },
              { path: 'calendar', lazy: page(() => import('@/pages/calendar-page')) },
              { path: 'settings', lazy: page(() => import('@/pages/settings-page')) },
              { path: '*', lazy: page(() => import('@/pages/not-found-page')) },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
])
