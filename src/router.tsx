import { createBrowserRouter, Navigate } from 'react-router'
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
      { path: '/signup', lazy: page(() => import('@/features/auth/signup-page')) },
      {
        element: <RequireAuth />,
        children: [
          // Outside the app shell: the user may not belong to any project yet.
          { path: '/invite/:token', lazy: page(() => import('@/pages/invite-page')) },
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
              { path: 'releases/:releaseId/compare', lazy: page(() => import('@/pages/release-compare-page')) },
              { path: 'calendar', lazy: page(() => import('@/pages/calendar-page')) },
              {
                path: 'settings',
                lazy: page(() => import('@/pages/settings/settings-layout')),
                children: [
                  { index: true, element: <Navigate to="project" replace /> },
                  { path: 'project', lazy: page(() => import('@/pages/settings/project-settings-page')) },
                  { path: 'account', lazy: page(() => import('@/pages/settings/account-settings-page')) },
                ],
              },
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
