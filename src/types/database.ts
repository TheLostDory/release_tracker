
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_log": {
                  Row: {
                    "action": string,"created_at": string,"description": string,"id": string,"metadata": NonNullable<Json>,"project_id": string,"release_id": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"created_at"?: string,"description": string,"id"?: string,"metadata"?: NonNullable<Json>,"project_id": string,"release_id"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"created_at"?: string,"description"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"project_id"?: string,"release_id"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_log_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_log_release_id_fkey"
      columns: ["release_id"]
isOneToOne: false
      referencedRelation: "releases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_log_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"approvals": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"comments": string | null,"created_at": string,"id": string,"release_id": string,"requested_at": string | null,"status": Database["public"]['Enums']["approval_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"comments"?: string | null,"created_at"?: string,"id"?: string,"release_id": string,"requested_at"?: string | null,"status"?: Database["public"]['Enums']["approval_status"],"updated_at"?: string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"comments"?: string | null,"created_at"?: string,"id"?: string,"release_id"?: string,"requested_at"?: string | null,"status"?: Database["public"]['Enums']["approval_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "approvals_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approvals_release_id_fkey"
      columns: ["release_id"]
isOneToOne: true
      referencedRelation: "releases"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"email": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"email": string,"id": string,"name": string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"email"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"project_invitations": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"created_by": string | null,"email": string | null,"expires_at": string | null,"id": string,"project_id": string,"revoked_at": string | null,"role": Database["public"]['Enums']["project_role"],"token_hash": string | null,"use_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"expires_at"?: string | null,"id"?: string,"project_id": string,"revoked_at"?: string | null,"role": Database["public"]['Enums']["project_role"],"token_hash"?: string | null,"use_count"?: number
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"expires_at"?: string | null,"id"?: string,"project_id"?: string,"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["project_role"],"token_hash"?: string | null,"use_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_invitations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_invitations_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_members": {
                  Row: {
                    "created_at": string,"invited_by": string | null,"project_id": string,"role": Database["public"]['Enums']["project_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"invited_by"?: string | null,"project_id": string,"role": Database["public"]['Enums']["project_role"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"invited_by"?: string | null,"project_id"?: string,"role"?: Database["public"]['Enums']["project_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_members_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_members_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"enabled_steps": (Database["public"]['Enums']["workflow_task_type"])[],"id": string,"name": string,"sprints_enabled": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"enabled_steps"?: (Database["public"]['Enums']["workflow_task_type"])[],"id"?: string,"name": string,"sprints_enabled"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"enabled_steps"?: (Database["public"]['Enums']["workflow_task_type"])[],"id"?: string,"name"?: string,"sprints_enabled"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"release_tasks": {
                  Row: {
                    "blocker_reason": string | null,"completed_at": string | null,"created_at": string,"id": string,"link": string | null,"name": string,"notes": string | null,"owner_id": string | null,"planned_date": string | null,"position": number,"release_id": string,"status": Database["public"]['Enums']["task_status"],"task_type": Database["public"]['Enums']["workflow_task_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocker_reason"?: string | null,"completed_at"?: string | null,"created_at"?: string,"id"?: string,"link"?: string | null,"name": string,"notes"?: string | null,"owner_id"?: string | null,"planned_date"?: string | null,"position": number,"release_id": string,"status"?: Database["public"]['Enums']["task_status"],"task_type": Database["public"]['Enums']["workflow_task_type"],"updated_at"?: string
                  }
                  Update: {
                    "blocker_reason"?: string | null,"completed_at"?: string | null,"created_at"?: string,"id"?: string,"link"?: string | null,"name"?: string,"notes"?: string | null,"owner_id"?: string | null,"planned_date"?: string | null,"position"?: number,"release_id"?: string,"status"?: Database["public"]['Enums']["task_status"],"task_type"?: Database["public"]['Enums']["workflow_task_type"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "release_tasks_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "release_tasks_release_id_fkey"
      columns: ["release_id"]
isOneToOne: false
      referencedRelation: "releases"
      referencedColumns: ["id"]
    }
                  ]
                },"releases": {
                  Row: {
                    "actual_deployment_date": string | null,"created_at": string,"description": string | null,"id": string,"name": string,"owner_id": string | null,"planned_deployment_date": string,"project_id": string,"sprint_id": string | null,"status_override": Database["public"]['Enums']["release_status"] | null,"status_override_reason": string | null,"updated_at": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actual_deployment_date"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"name": string,"owner_id"?: string | null,"planned_deployment_date": string,"project_id": string,"sprint_id"?: string | null,"status_override"?: Database["public"]['Enums']["release_status"] | null,"status_override_reason"?: string | null,"updated_at"?: string,"version": string
                  }
                  Update: {
                    "actual_deployment_date"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"name"?: string,"owner_id"?: string | null,"planned_deployment_date"?: string,"project_id"?: string,"sprint_id"?: string | null,"status_override"?: Database["public"]['Enums']["release_status"] | null,"status_override_reason"?: string | null,"updated_at"?: string,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "releases_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "releases_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "releases_sprint_id_fkey"
      columns: ["sprint_id","project_id"]
isOneToOne: false
      referencedRelation: "sprints"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "created_at": string,"id": string,"notes": string | null,"release_id": string,"report_type": Database["public"]['Enums']["report_type"],"report_url": string | null,"result": Database["public"]['Enums']["report_result"],"reviewed_at": string | null,"reviewer_id": string | null,"status": Database["public"]['Enums']["task_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"notes"?: string | null,"release_id": string,"report_type": Database["public"]['Enums']["report_type"],"report_url"?: string | null,"result"?: Database["public"]['Enums']["report_result"],"reviewed_at"?: string | null,"reviewer_id"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"notes"?: string | null,"release_id"?: string,"report_type"?: Database["public"]['Enums']["report_type"],"report_url"?: string | null,"result"?: Database["public"]['Enums']["report_result"],"reviewed_at"?: string | null,"reviewer_id"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_release_id_fkey"
      columns: ["release_id"]
isOneToOne: false
      referencedRelation: "releases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"sprints": {
                  Row: {
                    "created_at": string,"end_date": string,"id": string,"name": string,"project_id": string,"start_date": string,"status": Database["public"]['Enums']["sprint_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"end_date": string,"id"?: string,"name": string,"project_id": string,"start_date": string,"status"?: Database["public"]['Enums']["sprint_status"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"end_date"?: string,"id"?: string,"name"?: string,"project_id"?: string,"start_date"?: string,"status"?: Database["public"]['Enums']["sprint_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sprints_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invite_link":
{ Args: { "p_token": string }; Returns: string
                           },
"create_invite_link":
{ Args: { "p_expires_in_days"?: number,"p_project": string,"p_role": Database["public"]['Enums']["project_role"] }; Returns: string
                           },
"create_project":
{ Args: { "p_description"?: string,"p_name": string,"p_sprints_enabled"?: boolean }; Returns: string
                           },
"has_app_access":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"invite_by_email":
{ Args: { "p_email": string,"p_project": string,"p_role": Database["public"]['Enums']["project_role"] }; Returns: string
                           },
"invite_link_info":
{ Args: { "p_token": string }; Returns: {
              "already_member": boolean,"project_id": string,"project_name": string,"role": Database["public"]['Enums']["project_role"]
            }[]
                           },
"is_http_url":
{ Args: { "value": string }; Returns: boolean
                           },
"log_project_event":
{ Args: { "p_action": string,"p_description": string,"p_metadata": Json,"p_project": string }; Returns: undefined
                           },
"my_colleague_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"my_project_ids":
{ Args: { "min_role"?: Database["public"]['Enums']["project_role"] }; Returns: string[]
                           },
"my_release_ids":
{ Args: { "min_role"?: Database["public"]['Enums']["project_role"] }; Returns: string[]
                           },
"project_role_of":
{ Args: { "p_project": string }; Returns: Database["public"]['Enums']["project_role"]
                           },
"remove_member":
{ Args: { "p_project": string,"p_user": string }; Returns: undefined
                           },
"report_task_type":
{ Args: { "t": Database["public"]['Enums']["report_type"] }; Returns: Database["public"]['Enums']["workflow_task_type"]
                           },
"require_project_role":
{ Args: { "min_role": Database["public"]['Enums']["project_role"],"p_project": string }; Returns: Database["public"]['Enums']["project_role"]
                           },
"revoke_invitation":
{ Args: { "p_invitation": string }; Returns: undefined
                           },
"search_releases":
{ Args: { "max_results"?: number,"q": string }; Returns: {
              "actual_deployment_date": string,"id": string,"name": string,"owner_name": string,"planned_deployment_date": string,"project_id": string,"project_name": string,"sprint_name": string,"version": string
            }[]
                           },
"set_member_role":
{ Args: { "p_project": string,"p_role": Database["public"]['Enums']["project_role"],"p_user": string }; Returns: undefined
                           }
          }
          Enums: {
            "approval_status": "PENDING"|"APPROVED"|"REJECTED","project_role": "VIEWER"|"MEMBER"|"ADMIN"|"OWNER","release_status": "ON_TRACK"|"AT_RISK"|"BLOCKED"|"WAITING_FOR_APPROVAL"|"RELEASED","report_result": "PASS"|"FAIL"|"WARNING"|"NOT_REVIEWED","report_type": "LOAD_TEST"|"LONGEVITY"|"HIT","sprint_status": "PLANNED"|"ACTIVE"|"COMPLETED","task_status": "NOT_STARTED"|"IN_PROGRESS"|"COMPLETED"|"BLOCKED"|"SKIPPED","workflow_task_type": "RELEASE_IDENTIFIED"|"RC_CREATION"|"AUTOMATED_JOBS"|"LOAD_TEST_REVIEW"|"LONGEVITY_REVIEW"|"HIT_REVIEW"|"RC_EMAIL"|"RTP_CREATION"|"RC_ESCALATION_EMAIL"|"APPROVAL"|"RELEASE_EMAIL"|"DEPLOYMENT"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "approval_status": ["PENDING", "APPROVED", "REJECTED"],"project_role": ["VIEWER", "MEMBER", "ADMIN", "OWNER"],"release_status": ["ON_TRACK", "AT_RISK", "BLOCKED", "WAITING_FOR_APPROVAL", "RELEASED"],"report_result": ["PASS", "FAIL", "WARNING", "NOT_REVIEWED"],"report_type": ["LOAD_TEST", "LONGEVITY", "HIT"],"sprint_status": ["PLANNED", "ACTIVE", "COMPLETED"],"task_status": ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED", "SKIPPED"],"workflow_task_type": ["RELEASE_IDENTIFIED", "RC_CREATION", "AUTOMATED_JOBS", "LOAD_TEST_REVIEW", "LONGEVITY_REVIEW", "HIT_REVIEW", "RC_EMAIL", "RTP_CREATION", "RC_ESCALATION_EMAIL", "APPROVAL", "RELEASE_EMAIL", "DEPLOYMENT"]
          }
        }
} as const
