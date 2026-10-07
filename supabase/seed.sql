-- Development seed data. Loaded by `supabase db reset`.
--
-- All dates are relative to current_date so the dashboard always shows a
-- live-looking sprint. With current_date = Oct 7 this produces:
--   Sprint 41  Sep 21 – Oct 2   COMPLETED  RC_1 1.3.0  (RELEASED)
--   Sprint 42  Oct 5  – Oct 16  ACTIVE     RC_1 1.4.0  (ON_TRACK, reports stage)
--                                          RC_2 1.5.0  (AT_RISK, automated jobs overdue)
--                                          HF_1 1.3.1  (WAITING_FOR_APPROVAL)
--   Sprint 43  Oct 19 – Oct 30  PLANNED    RC_1 1.6.0  (just identified)
--
-- Login: charbel@example.com / password123 (all seed users share the password)

-- ---------------------------------------------------------------------------
-- Users (auth.users -> profiles via trigger)
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('name', u.name), now(), now(), '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'charbel@example.com', 'Charbel'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'john@example.com',    'John'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'maya@example.com',    'Maya'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'omar@example.com',    'Omar')
) as u (id, email, name);

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.id in (
  'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004'
);

-- ---------------------------------------------------------------------------
-- Sprints
-- ---------------------------------------------------------------------------

insert into public.sprints (id, name, start_date, end_date, status) values
  ('b0000000-0000-4000-8000-000000000041', 'Sprint 41', current_date - 16, current_date - 5,  'COMPLETED'),
  ('b0000000-0000-4000-8000-000000000042', 'Sprint 42', current_date - 2,  current_date + 9,  'ACTIVE'),
  ('b0000000-0000-4000-8000-000000000043', 'Sprint 43', current_date + 12, current_date + 23, 'PLANNED');

-- ---------------------------------------------------------------------------
-- Releases (workflow tasks, reports and approval rows are created by trigger)
-- ---------------------------------------------------------------------------

insert into public.releases (id, sprint_id, name, version, description, owner_id,
                             planned_deployment_date, actual_deployment_date, created_at) values
  ('c0000000-0000-4000-8000-000000000411', 'b0000000-0000-4000-8000-000000000041',
   'RC_1', '1.3.0', 'Sprint 41 release: billing exports and audit trail.',
   'a0000000-0000-4000-8000-000000000002', current_date - 6, current_date - 6, now() - interval '17 days'),
  ('c0000000-0000-4000-8000-000000000421', 'b0000000-0000-4000-8000-000000000042',
   'RC_1', '1.4.0', 'Search revamp, faster dashboard queries, notification preferences.',
   'a0000000-0000-4000-8000-000000000002', current_date + 6, null, now() - interval '3 days'),
  ('c0000000-0000-4000-8000-000000000422', 'b0000000-0000-4000-8000-000000000042',
   'RC_2', '1.5.0', 'Payments provider migration and API rate limiting.',
   'a0000000-0000-4000-8000-000000000003', current_date + 9, null, now() - interval '2 days'),
  ('c0000000-0000-4000-8000-000000000423', 'b0000000-0000-4000-8000-000000000042',
   'HF_1', '1.3.1', 'Hotfix: session timeout regression introduced in 1.3.0.',
   'a0000000-0000-4000-8000-000000000001', current_date + 2, null, now() - interval '2 days'),
  ('c0000000-0000-4000-8000-000000000431', 'b0000000-0000-4000-8000-000000000043',
   'RC_1', '1.6.0', 'Reporting module and SSO groundwork.',
   'a0000000-0000-4000-8000-000000000004', current_date + 20, null, now());

-- ---------------------------------------------------------------------------
-- Task states: (release, step, status, planned offset, completed offset, owner)
-- Offsets are days from current_date; completed offset null = not completed.
-- ---------------------------------------------------------------------------

update public.release_tasks t
set status       = s.status::public.task_status,
    planned_date = current_date + s.planned,
    completed_at = case when s.completed is null then null
                        else (current_date + s.completed) + time '14:00' end,
    owner_id     = s.owner,
    notes        = s.notes
from (values
  -- Sprint 41 RC_1: fully released
  ('c0000000-0000-4000-8000-000000000411'::uuid, 'RELEASE_IDENTIFIED',  'COMPLETED', -16, -16, 'a0000000-0000-4000-8000-000000000002'::uuid, null::text),
  ('c0000000-0000-4000-8000-000000000411', 'RC_CREATION',         'COMPLETED', -14, -14, 'a0000000-0000-4000-8000-000000000004', null),
  ('c0000000-0000-4000-8000-000000000411', 'AUTOMATED_JOBS',      'COMPLETED', -13, -13, 'a0000000-0000-4000-8000-000000000004', null),
  ('c0000000-0000-4000-8000-000000000411', 'LOAD_TEST_REVIEW',    'COMPLETED', -11, -11, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000411', 'LONGEVITY_REVIEW',    'COMPLETED', -11, -10, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000411', 'HIT_REVIEW',          'COMPLETED', -10, -10, 'a0000000-0000-4000-8000-000000000001', null),
  ('c0000000-0000-4000-8000-000000000411', 'RC_EMAIL',            'COMPLETED',  -9,  -9, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000411', 'RTP_CREATION',        'COMPLETED',  -9,  -9, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000411', 'RC_ESCALATION_EMAIL', 'COMPLETED',  -8,  -8, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000411', 'APPROVAL',            'COMPLETED',  -7,  -7, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000411', 'RELEASE_EMAIL',       'COMPLETED',  -6,  -6, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000411', 'DEPLOYMENT',          'COMPLETED',  -6,  -6, 'a0000000-0000-4000-8000-000000000004', null),

  -- Sprint 42 RC_1: on track, in the reports stage (HIT review next, due +3)
  ('c0000000-0000-4000-8000-000000000421', 'RELEASE_IDENTIFIED',  'COMPLETED',  -3,  -3, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000421', 'RC_CREATION',         'COMPLETED',  -2,  -2, 'a0000000-0000-4000-8000-000000000004', null),
  ('c0000000-0000-4000-8000-000000000421', 'AUTOMATED_JOBS',      'COMPLETED',  -1,  -1, 'a0000000-0000-4000-8000-000000000004', 'All 1,284 automated tests green.'),
  ('c0000000-0000-4000-8000-000000000421', 'LOAD_TEST_REVIEW',    'COMPLETED',   1,   0, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000421', 'LONGEVITY_REVIEW',    'IN_PROGRESS', 2, null, 'a0000000-0000-4000-8000-000000000003', '72h soak running, 48h elapsed.'),
  ('c0000000-0000-4000-8000-000000000421', 'HIT_REVIEW',          'NOT_STARTED', 3, null, 'a0000000-0000-4000-8000-000000000001', null),
  ('c0000000-0000-4000-8000-000000000421', 'RC_EMAIL',            'NOT_STARTED', 3, null, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000421', 'RTP_CREATION',        'NOT_STARTED', 4, null, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000421', 'RC_ESCALATION_EMAIL', 'NOT_STARTED', 4, null, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000421', 'APPROVAL',            'NOT_STARTED', 5, null, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000421', 'RELEASE_EMAIL',       'NOT_STARTED', 6, null, 'a0000000-0000-4000-8000-000000000002', null),
  ('c0000000-0000-4000-8000-000000000421', 'DEPLOYMENT',          'NOT_STARTED', 6, null, 'a0000000-0000-4000-8000-000000000004', null),

  -- Sprint 42 RC_2: at risk, automated jobs overdue since yesterday
  ('c0000000-0000-4000-8000-000000000422', 'RELEASE_IDENTIFIED',  'COMPLETED',  -2,  -2, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000422', 'RC_CREATION',         'COMPLETED',  -2,  -1, 'a0000000-0000-4000-8000-000000000004', 'RC cut one day late: waiting on payments PR merge.'),
  ('c0000000-0000-4000-8000-000000000422', 'AUTOMATED_JOBS',      'IN_PROGRESS', -1, null, 'a0000000-0000-4000-8000-000000000004', 'Flaky payments integration suite, rerunning.'),
  ('c0000000-0000-4000-8000-000000000422', 'LOAD_TEST_REVIEW',    'NOT_STARTED', 3, null, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000422', 'LONGEVITY_REVIEW',    'NOT_STARTED', 4, null, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000422', 'HIT_REVIEW',          'NOT_STARTED', 4, null, 'a0000000-0000-4000-8000-000000000001', null),
  ('c0000000-0000-4000-8000-000000000422', 'RC_EMAIL',            'NOT_STARTED', 5, null, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000422', 'RTP_CREATION',        'NOT_STARTED', 6, null, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000422', 'RC_ESCALATION_EMAIL', 'NOT_STARTED', 6, null, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000422', 'APPROVAL',            'NOT_STARTED', 7, null, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000422', 'RELEASE_EMAIL',       'NOT_STARTED', 9, null, 'a0000000-0000-4000-8000-000000000003', null),
  ('c0000000-0000-4000-8000-000000000422', 'DEPLOYMENT',          'NOT_STARTED', 9, null, 'a0000000-0000-4000-8000-000000000004', null),

  -- Sprint 42 HF_1: everything up to escalation done, waiting for approval
  ('c0000000-0000-4000-8000-000000000423', 'RELEASE_IDENTIFIED',  'COMPLETED',  -2,  -2, 'a0000000-0000-4000-8000-000000000001', null),
  ('c0000000-0000-4000-8000-000000000423', 'RC_CREATION',         'COMPLETED',  -2,  -2, 'a0000000-0000-4000-8000-000000000004', null),
  ('c0000000-0000-4000-8000-000000000423', 'AUTOMATED_JOBS',      'COMPLETED',  -1,  -1, 'a0000000-0000-4000-8000-000000000004', null),
  ('c0000000-0000-4000-8000-000000000423', 'LOAD_TEST_REVIEW',    'SKIPPED',    -1,  null, 'a0000000-0000-4000-8000-000000000003', 'Hotfix scope: load profile unchanged.'),
  ('c0000000-0000-4000-8000-000000000423', 'LONGEVITY_REVIEW',    'SKIPPED',    -1,  null, 'a0000000-0000-4000-8000-000000000003', 'Hotfix scope: longevity not required.'),
  ('c0000000-0000-4000-8000-000000000423', 'HIT_REVIEW',          'COMPLETED',  -1,  -1, 'a0000000-0000-4000-8000-000000000001', null),
  ('c0000000-0000-4000-8000-000000000423', 'RC_EMAIL',            'COMPLETED',   0,   0, 'a0000000-0000-4000-8000-000000000001', null),
  ('c0000000-0000-4000-8000-000000000423', 'RTP_CREATION',        'COMPLETED',   0,   0, 'a0000000-0000-4000-8000-000000000001', null),
  ('c0000000-0000-4000-8000-000000000423', 'RC_ESCALATION_EMAIL', 'COMPLETED',   0,   0, 'a0000000-0000-4000-8000-000000000001', null),
  ('c0000000-0000-4000-8000-000000000423', 'APPROVAL',            'IN_PROGRESS', 1, null, 'a0000000-0000-4000-8000-000000000002', 'Escalated to release board.'),
  ('c0000000-0000-4000-8000-000000000423', 'RELEASE_EMAIL',       'NOT_STARTED', 2, null, 'a0000000-0000-4000-8000-000000000001', null),
  ('c0000000-0000-4000-8000-000000000423', 'DEPLOYMENT',          'NOT_STARTED', 2, null, 'a0000000-0000-4000-8000-000000000004', null),

  -- Sprint 43 RC_1: just identified
  ('c0000000-0000-4000-8000-000000000431', 'RELEASE_IDENTIFIED',  'COMPLETED',   0,   0, 'a0000000-0000-4000-8000-000000000004', null)
) as s (release_id, task_type, status, planned, completed, owner, notes)
where t.release_id = s.release_id
  and t.task_type = s.task_type::public.workflow_task_type;

-- ---------------------------------------------------------------------------
-- Reports: (release, type, status, result, reviewer, reviewed offset, notes)
-- ---------------------------------------------------------------------------

update public.reports r
set status      = s.status::public.task_status,
    result      = s.result::public.report_result,
    reviewer_id = s.reviewer,
    reviewed_at = case when s.reviewed is null then null
                       else (current_date + s.reviewed) + time '11:00' end,
    report_url  = s.url,
    notes       = s.notes
from (values
  ('c0000000-0000-4000-8000-000000000411'::uuid, 'LOAD_TEST', 'COMPLETED', 'PASS',    'a0000000-0000-4000-8000-000000000003'::uuid, -11, 'https://reports.example.com/load/1.3.0', null::text),
  ('c0000000-0000-4000-8000-000000000411', 'LONGEVITY',      'COMPLETED', 'WARNING', 'a0000000-0000-4000-8000-000000000003', -10, 'https://reports.example.com/longevity/1.3.0', 'Slow memory growth in worker pool; accepted, tracked separately.'),
  ('c0000000-0000-4000-8000-000000000411', 'HIT',            'COMPLETED', 'PASS',    'a0000000-0000-4000-8000-000000000001', -10, 'https://reports.example.com/hit/1.3.0', null),

  ('c0000000-0000-4000-8000-000000000421', 'LOAD_TEST',      'COMPLETED',   'PASS',         'a0000000-0000-4000-8000-000000000003', 0, 'https://reports.example.com/load/1.4.0', 'p95 latency 182ms (baseline 190ms).'),
  ('c0000000-0000-4000-8000-000000000421', 'LONGEVITY',      'IN_PROGRESS', 'NOT_REVIEWED', 'a0000000-0000-4000-8000-000000000003', null, null, null),
  ('c0000000-0000-4000-8000-000000000421', 'HIT',            'NOT_STARTED', 'NOT_REVIEWED', 'a0000000-0000-4000-8000-000000000001', null, null, null),

  ('c0000000-0000-4000-8000-000000000423', 'LOAD_TEST',      'SKIPPED',   'NOT_REVIEWED', null, null, null, 'Not required for hotfix.'),
  ('c0000000-0000-4000-8000-000000000423', 'LONGEVITY',      'SKIPPED',   'NOT_REVIEWED', null, null, null, 'Not required for hotfix.'),
  ('c0000000-0000-4000-8000-000000000423', 'HIT',            'COMPLETED', 'PASS', 'a0000000-0000-4000-8000-000000000001', -1, 'https://reports.example.com/hit/1.3.1', null)
) as s (release_id, report_type, status, result, reviewer, reviewed, url, notes)
where r.release_id = s.release_id
  and r.report_type = s.report_type::public.report_type;

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------

update public.approvals
set status = 'APPROVED', requested_at = (current_date - 8) + time '10:00',
    approved_at = (current_date - 7) + time '09:15',
    approved_by = 'a0000000-0000-4000-8000-000000000002', comments = 'Approved by release board.'
where release_id = 'c0000000-0000-4000-8000-000000000411';

update public.approvals
set requested_at = current_date + time '10:20'
where release_id = 'c0000000-0000-4000-8000-000000000423';

-- ---------------------------------------------------------------------------
-- Activity: replace trigger-generated rows (timestamped "now", no actor)
-- with a realistic, backdated history.
-- ---------------------------------------------------------------------------

delete from public.activity_log;

insert into public.activity_log (release_id, user_id, action, description, created_at)
select release_id, user_id, action, description, (current_date + day) + at
from (values
  ('c0000000-0000-4000-8000-000000000421'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid, 'release.created',     'created RC_1 (1.4.0)',           -3, time '09:00'),
  ('c0000000-0000-4000-8000-000000000421',       'a0000000-0000-4000-8000-000000000004',       'task.status_changed', 'completed RC creation',          -2, time '16:40'),
  ('c0000000-0000-4000-8000-000000000421',       'a0000000-0000-4000-8000-000000000004',       'task.status_changed', 'completed Automated jobs',       -1, time '18:05'),
  ('c0000000-0000-4000-8000-000000000421',       'a0000000-0000-4000-8000-000000000003',       'report.result_changed','reviewed the Load Test report: PASS', 0, time '09:30'),
  ('c0000000-0000-4000-8000-000000000421',       'a0000000-0000-4000-8000-000000000003',       'task.status_changed', 'started Longevity review',        0, time '09:35'),

  ('c0000000-0000-4000-8000-000000000422',       'a0000000-0000-4000-8000-000000000003',       'release.created',     'created RC_2 (1.5.0)',           -2, time '10:00'),
  ('c0000000-0000-4000-8000-000000000422',       'a0000000-0000-4000-8000-000000000004',       'task.status_changed', 'completed RC creation',          -1, time '15:20'),
  ('c0000000-0000-4000-8000-000000000422',       'a0000000-0000-4000-8000-000000000004',       'task.status_changed', 'started Automated jobs',         -1, time '15:30'),

  ('c0000000-0000-4000-8000-000000000423',       'a0000000-0000-4000-8000-000000000001',       'release.created',     'created HF_1 (1.3.1)',           -2, time '08:45'),
  ('c0000000-0000-4000-8000-000000000423',       'a0000000-0000-4000-8000-000000000001',       'report.result_changed','reviewed the HIT report: PASS', -1, time '17:10'),
  ('c0000000-0000-4000-8000-000000000423',       'a0000000-0000-4000-8000-000000000001',       'task.status_changed', 'completed RTP creation',          0, time '10:15'),
  ('c0000000-0000-4000-8000-000000000423',       'a0000000-0000-4000-8000-000000000001',       'task.status_changed', 'completed RC escalation email',   0, time '10:20'),

  ('c0000000-0000-4000-8000-000000000431',       'a0000000-0000-4000-8000-000000000004',       'release.created',     'created RC_1 (1.6.0)',            0, time '08:30')
) as a (release_id, user_id, action, description, day, at);
