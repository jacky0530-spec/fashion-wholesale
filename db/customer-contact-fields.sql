ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_email text;
CREATE INDEX IF NOT EXISTS customers_tax_id_idx ON customers(tax_id) WHERE tax_id IS NOT NULL AND tax_id <> '';
