create table public.service_gateway_nonces (
  nonce_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index idx_service_gateway_nonces_expiry on public.service_gateway_nonces(expires_at);

alter table public.service_gateway_nonces enable row level security;
grant select, insert, delete on public.service_gateway_nonces to service_role;

comment on table public.service_gateway_nonces is 'Short-lived hashed replay markers for signed server-to-server requests; never stores request payloads, credentials, PINs, or raw nonces.';
