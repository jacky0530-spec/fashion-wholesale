CREATE TABLE IF NOT EXISTS products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  category        text NOT NULL DEFAULT '上衣',
  cost_price      numeric(10,2) NOT NULL DEFAULT 0,
  wholesale_price numeric(10,2) NOT NULL DEFAULT 0,
  retail_price    numeric(10,2) NOT NULL DEFAULT 0,
  image_url       text,
  note            text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. 款式變體
CREATE TABLE IF NOT EXISTS product_variants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color       text NOT NULL,
  size        text NOT NULL,
  stock_qty   integer NOT NULL DEFAULT 0,
  sku         text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. 客戶
CREATE TABLE IF NOT EXISTS customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  shop_name       text,
  line_nick       text,
  phone           text,
  address         text,
  customer_type   text NOT NULL DEFAULT 'wholesale',
  credit_limit    numeric(10,2) DEFAULT 0,
  note            text,
  joined_at       timestamptz NOT NULL DEFAULT now()
);

-- 4. 訂單主檔
CREATE TABLE IF NOT EXISTS orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id),
  order_date      timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'pending',
  payment_status  text NOT NULL DEFAULT 'unpaid',
  total_amount    numeric(10,2) NOT NULL DEFAULT 0,
  shipped_at      timestamptz,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 5. 訂單明細
CREATE TABLE IF NOT EXISTS order_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES product_variants(id),
  product_name text,
  color        text,
  size         text,
  qty          integer NOT NULL DEFAULT 1,
  unit_price   numeric(10,2) NOT NULL,
  note         text
);

-- 6. 退換貨
CREATE TABLE IF NOT EXISTS returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid REFERENCES orders(id),
  customer_id   uuid NOT NULL REFERENCES customers(id),
  product_name  text NOT NULL,
  color         text,
  size          text,
  qty           integer NOT NULL DEFAULT 1,
  return_type   text NOT NULL DEFAULT 'return',
  reason        text,
  refund_amount numeric(10,2) DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending',
  note          text,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);


CREATE UNIQUE INDEX variants_product_color_size ON product_variants(product_id,color,size);
CREATE INDEX orders_customer_idx ON orders(customer_id);
CREATE INDEX items_order_idx ON order_items(order_id);
CREATE INDEX returns_customer_idx ON returns(customer_id);
