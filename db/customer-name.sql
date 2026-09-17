ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_name text;
CREATE INDEX IF NOT EXISTS customers_customer_name_idx ON customers(customer_name) WHERE customer_name IS NOT NULL AND customer_name <> '';
