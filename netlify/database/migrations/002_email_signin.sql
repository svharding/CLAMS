CREATE TABLE login_links (
 hash text PRIMARY KEY, email text NOT NULL, browser_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 used_at timestamptz
);
CREATE INDEX login_links_email_created ON login_links(email,created_at);
