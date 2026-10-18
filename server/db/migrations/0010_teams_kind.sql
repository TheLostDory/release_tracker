-- Microsoft Teams (a Workflows webhook) as a project integration. Enum values
-- get their own migration: they can't be used in the transaction that adds them.
alter type integration_kind add value 'TEAMS';
alter type integration_auth add value 'TEAMS';
