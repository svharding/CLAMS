CREATE TABLE users (
 email text PRIMARY KEY, name text NOT NULL, active boolean NOT NULL DEFAULT true,
 trained boolean NOT NULL DEFAULT false, trained_at date, training_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (hash text PRIMARY KEY, email text NOT NULL REFERENCES users(email), expires_at timestamptz NOT NULL);
CREATE TABLE settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE bookings (
 id text PRIMARY KEY, owner_email text NOT NULL REFERENCES users(email),
 status text NOT NULL CHECK(status IN ('pending','confirmed','needs-info','declined','cancelled','maintenance')),
 start_date date NOT NULL, end_date date NOT NULL, weeks integer NOT NULL CHECK(weeks BETWEEN 1 AND 52),
 rate integer NOT NULL DEFAULT 300 CHECK(rate=300), details jsonb NOT NULL,
 admin_note text NOT NULL DEFAULT '', billing_status text NOT NULL DEFAULT 'unbilled' CHECK(billing_status IN ('unbilled','billed','paid')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_date = start_date + weeks * 7)
);
CREATE INDEX booking_dates ON bookings(start_date,end_date);
-- A table lock in the application serializes all changes to reserved dates.
CREATE TABLE activity (id bigserial PRIMARY KEY, booking_id text REFERENCES bookings(id), actor text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE mail_queue (
 id bigserial PRIMARY KEY, booking_id text REFERENCES bookings(id), recipient text NOT NULL,
 subject text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'queued',
 attempts integer NOT NULL DEFAULT 0, next_attempt timestamptz NOT NULL DEFAULT now(),
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
