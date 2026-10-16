import { api } from '@/lib/api'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** What the answer was based on: tracker releases (in-app links) and Jira items. */
export interface ChatSource {
  kind: 'release' | 'jira_issue' | 'jira_version'
  label: string
  url: string
}

export interface ChatAnswer {
  answer: string
  sources: ChatSource[]
}

export const assistantApi = {
  config: () => api.get<{ enabled: boolean }>('/chat/config'),
  ask: (projectId: string, messages: ChatMessage[]) => api.post<ChatAnswer>(`/projects/${projectId}/chat`, { messages }),
}
