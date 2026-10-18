-- GitHub (github.com or GitHub Enterprise) as a project integration. Enum
-- values get their own migration: they can't be used in the transaction that
-- adds them.
alter type integration_kind add value 'GITHUB';
alter type integration_auth add value 'GITHUB';
