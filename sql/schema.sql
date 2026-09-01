-- n8n-social-leadgen-pack :: PostgreSQL schema
--
-- Tested against PostgreSQL 14+. Run once against an empty database:
--   psql "$DATABASE_URL" -f sql/schema.sql
--
-- Design notes
--   * email_key / phone_key are the normalised match keys from logic/dedupe.js.
--     Store them, index them, and never match on the raw value.
--   * Nothing is hard-deleted. Merged leads keep their row with merged_into set,
--     so a bad merge is reversible and history survives.
--   * consent_ledger and suppression_list are the two tables that keep you out of
--     trouble. Back them up separately from the rest.

BEGIN;

-- ---------------------------------------------------------------- core people
CREATE TABLE IF NOT EXISTS leads (
    id                  BIGSERIAL PRIMARY KEY,
    email               TEXT,
    email_key           TEXT,
    phone               TEXT,
    phone_key           TEXT,
    name                TEXT,
    company             TEXT,
    domain              TEXT,
    source              TEXT,
    campaign            TEXT,
    status              TEXT NOT NULL DEFAULT 'open',
    band                TEXT,
    score               INTEGER,
    score_reasons       JSONB NOT NULL DEFAULT '[]'::jsonb,
    scored_at           TIMESTAMPTZ,
    value_usd           NUMERIC(12, 2) NOT NULL DEFAULT 0,
    consent_basis       TEXT,
    consent_recorded_at TIMESTAMPTZ,
    last_inbound_message TEXT,
    replied_at          TIMESTAMPTZ,
    first_touch         TEXT,
    last_touch          TEXT,
    touch_count         INTEGER NOT NULL DEFAULT 0,
    attribution_path    TEXT,
    first_response_at   TIMESTAMPTZ,
    last_touch_at       TIMESTAMPTZ,
    merged_into         BIGINT REFERENCES leads (id),
    merged_from         JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT leads_need_a_contact_method CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_email_key_uidx ON leads (email_key) WHERE email_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_phone_key_idx    ON leads (phone_key) WHERE phone_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_domain_idx       ON leads (lower(domain));
CREATE INDEX IF NOT EXISTS leads_created_at_idx   ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_status_touch_idx ON leads (status, last_touch_at);
CREATE INDEX IF NOT EXISTS leads_band_idx         ON leads (band);
CREATE INDEX IF NOT EXISTS leads_active_idx       ON leads (id) WHERE merged_into IS NULL;

-- ------------------------------------------------------------------- consent
-- One row per consent event. Withdrawals are recorded, never deleted: you need
-- to be able to show WHEN consent existed and when it stopped.
CREATE TABLE IF NOT EXISTS consent_ledger (
    id              BIGSERIAL PRIMARY KEY,
    lead_id         BIGINT REFERENCES leads (id),
    identifier      TEXT NOT NULL,
    identifier_type TEXT NOT NULL CHECK (identifier_type IN ('email', 'phone', 'handle')),
    basis           TEXT NOT NULL CHECK (basis IN ('consent', 'contract', 'legitimate_interest')),
    evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
    source          TEXT NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    withdrawn_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS consent_identifier_idx ON consent_ledger (identifier, recorded_at DESC);
CREATE INDEX IF NOT EXISTS consent_active_idx     ON consent_ledger (identifier) WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS consent_lead_idx       ON consent_ledger (lead_id);

-- --------------------------------------------------------------- suppression
-- The list that outranks everything. Entries are permanent by default.
CREATE TABLE IF NOT EXISTS suppression_list (
    id              BIGSERIAL PRIMARY KEY,
    identifier      TEXT NOT NULL,
    identifier_type TEXT NOT NULL CHECK (identifier_type IN ('email', 'phone', 'handle', 'domain')),
    reason          TEXT NOT NULL,
    source          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (identifier, identifier_type)
);

CREATE INDEX IF NOT EXISTS suppression_identifier_idx ON suppression_list (identifier);

-- ----------------------------------------------------------------- activity
CREATE TABLE IF NOT EXISTS touch_log (
    id          BIGSERIAL PRIMARY KEY,
    lead_id     BIGINT REFERENCES leads (id),
    workflow    TEXT NOT NULL,
    channel     TEXT NOT NULL,
    direction   TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'blocked')),
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS touch_lead_idx      ON touch_log (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS touch_recent_idx    ON touch_log (occurred_at DESC);
-- The rails count outbound sends per channel per hour. This index is what keeps
-- that check cheap once the table is large.
CREATE INDEX IF NOT EXISTS touch_rate_limit_idx ON touch_log (channel, occurred_at DESC) WHERE direction = 'outbound';

-- ---------------------------------------------------------- safety rails (16)
CREATE TABLE IF NOT EXISTS kill_switch (
    scope      TEXT PRIMARY KEY,
    enabled    BOOLEAN NOT NULL DEFAULT false,
    reason     TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO kill_switch (scope, enabled, reason)
VALUES ('global', false, 'Set enabled = true to stop every outbound action in the pack.')
ON CONFLICT (scope) DO NOTHING;

CREATE TABLE IF NOT EXISTS spend_ledger (
    id          BIGSERIAL PRIMARY KEY,
    workflow    TEXT NOT NULL,
    item        TEXT NOT NULL,
    amount_usd  NUMERIC(10, 4) NOT NULL DEFAULT 0,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS spend_today_idx ON spend_ledger (occurred_at DESC);

CREATE TABLE IF NOT EXISTS rails_decisions (
    id         BIGSERIAL PRIMARY KEY,
    workflow   TEXT NOT NULL,
    channel    TEXT,
    purpose    TEXT,
    identifier TEXT,
    allowed    BOOLEAN NOT NULL,
    code       TEXT NOT NULL,
    reason     TEXT,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rails_decisions_recent_idx ON rails_decisions (decided_at DESC);
CREATE INDEX IF NOT EXISTS rails_decisions_denied_idx ON rails_decisions (code, decided_at DESC) WHERE allowed = false;

-- -------------------------------------------------------------- enrichment (06)
CREATE TABLE IF NOT EXISTS enrichment_cache (
    domain     TEXT PRIMARY KEY,
    payload    JSONB NOT NULL,
    provider   TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enrichment_fresh_idx ON enrichment_cache (fetched_at DESC);

-- ------------------------------------------------------------------ merge (07)
CREATE TABLE IF NOT EXISTS merge_log (
    id          BIGSERIAL PRIMARY KEY,
    keep_id     BIGINT REFERENCES leads (id),
    drop_id     BIGINT REFERENCES leads (id),
    match_score NUMERIC(4, 3) NOT NULL,
    evidence    JSONB NOT NULL DEFAULT '[]'::jsonb,
    decided_by  TEXT NOT NULL CHECK (decided_by IN ('auto', 'review', 'human')),
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS merge_open_review_idx ON merge_log (created_at DESC) WHERE decided_by = 'review' AND resolved_at IS NULL;

-- ----------------------------------------------------------------- intent (08)
CREATE TABLE IF NOT EXISTS watchlist (
    id              BIGSERIAL PRIMARY KEY,
    domain          TEXT NOT NULL UNIQUE,
    company         TEXT,
    lead_id         BIGINT REFERENCES leads (id),
    active          BOOLEAN NOT NULL DEFAULT true,
    last_scanned_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS watchlist_due_idx ON watchlist (last_scanned_at NULLS FIRST) WHERE active;

CREATE TABLE IF NOT EXISTS intent_signals (
    id           BIGSERIAL PRIMARY KEY,
    domain       TEXT NOT NULL,
    signal_keys  JSONB NOT NULL DEFAULT '[]'::jsonb,
    signal_score INTEGER NOT NULL DEFAULT 0,
    detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intent_domain_idx ON intent_signals (domain, detected_at DESC);

-- --------------------------------------------------------- follow-up (09, 11)
CREATE TABLE IF NOT EXISTS followup_queue (
    id            BIGSERIAL PRIMARY KEY,
    lead_email    TEXT,
    lead_phone    TEXT,
    lead_handle   TEXT,
    channel       TEXT NOT NULL,
    template      TEXT NOT NULL,
    step          INTEGER NOT NULL DEFAULT 1,
    send_after    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at       TIMESTAMPTZ,
    cancelled_at  TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT followup_needs_a_target CHECK (lead_email IS NOT NULL OR lead_phone IS NOT NULL OR lead_handle IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS followup_due_idx   ON followup_queue (send_after) WHERE sent_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS followup_email_idx ON followup_queue (lower(lead_email));

-- ---------------------------------------------------------------- review (12)
CREATE TABLE IF NOT EXISTS jobs (
    id           BIGSERIAL PRIMARY KEY,
    lead_id      BIGINT NOT NULL REFERENCES leads (id),
    reference    TEXT,
    delivered_at TIMESTAMPTZ,
    value_usd    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jobs_delivered_idx ON jobs (delivered_at DESC);

-- The UNIQUE constraint on lead_id is the actual one-review-per-customer rule.
-- The Code node guard is a courtesy; this is the enforcement.
CREATE TABLE IF NOT EXISTS review_requests (
    id           BIGSERIAL PRIMARY KEY,
    lead_id      BIGINT NOT NULL UNIQUE REFERENCES leads (id),
    job_id       BIGINT REFERENCES jobs (id),
    channel      TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------- attribution (14, 15)
CREATE TABLE IF NOT EXISTS attribution_touches (
    id           BIGSERIAL PRIMARY KEY,
    lead_email   TEXT,
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_campaign TEXT,
    utm_content  TEXT,
    referrer     TEXT,
    channel      TEXT,
    landing_page TEXT,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS attribution_email_idx ON attribution_touches (lower(lead_email), occurred_at);

CREATE TABLE IF NOT EXISTS content_registry (
    id           BIGSERIAL PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    platform     TEXT NOT NULL,
    url          TEXT,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_performance (
    slug         TEXT NOT NULL REFERENCES content_registry (slug),
    period_end   DATE NOT NULL,
    leads        INTEGER NOT NULL DEFAULT 0,
    hot_leads    INTEGER NOT NULL DEFAULT 0,
    pipeline_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (slug, period_end)
);

COMMIT;
