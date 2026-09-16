CREATE SEQUENCE IF NOT EXISTS custom_order_number_seq;
-- statement
CREATE TABLE IF NOT EXISTS custom_orders (
 id uuid PRIMARY KEY,
 custom_order_no text NOT NULL UNIQUE,
 customer_id uuid NOT NULL REFERENCES customers(id),
 order_date date NOT NULL,
 expected_delivery_date date,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','deposit_paid','production','arrived','converted','completed','cancelled')),
 payment_status text NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','partial','paid')),
 deposit_required numeric(12,2) NOT NULL DEFAULT 0 CHECK(deposit_required>=0),
 net_amount numeric(12,2) NOT NULL DEFAULT 0,
 tax_amount numeric(12,2) NOT NULL DEFAULT 0,
 total_amount numeric(12,2) NOT NULL DEFAULT 0,
 paid_amount numeric(12,2) NOT NULL DEFAULT 0,
 sales_order_id uuid REFERENCES orders(id),
 note text,
 request_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement
CREATE TABLE IF NOT EXISTS custom_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 custom_order_id uuid NOT NULL REFERENCES custom_orders(id) ON DELETE CASCADE,
 description text NOT NULL,
 specification text,
 qty integer NOT NULL CHECK(qty>0),
 unit_price numeric(10,2) NOT NULL CHECK(unit_price>=0),
 variant_id uuid REFERENCES product_variants(id),
 sort_order integer NOT NULL DEFAULT 0
);
-- statement
CREATE TABLE IF NOT EXISTS custom_order_payments (
 id uuid PRIMARY KEY,
 custom_order_id uuid NOT NULL REFERENCES custom_orders(id) ON DELETE CASCADE,
 payment_date date NOT NULL,
 payment_type text NOT NULL CHECK(payment_type IN ('deposit','balance','other')),
 amount numeric(12,2) NOT NULL CHECK(amount>0),
 note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- statement
CREATE INDEX IF NOT EXISTS custom_orders_customer_idx ON custom_orders(customer_id);
-- statement
CREATE INDEX IF NOT EXISTS custom_order_payments_order_idx ON custom_order_payments(custom_order_id);
-- statement
CREATE OR REPLACE FUNCTION create_custom_order(p_id uuid,p_payload jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE existing custom_orders%ROWTYPE; inserted uuid; x jsonb; c_id uuid; n integer; price numeric; net numeric:=0; tax numeric; total numeric; dep numeric; no text; idx integer:=0;
BEGIN
 IF p_id IS NULL OR nullif(p_payload->>'customer_id','') IS NULL OR nullif(p_payload->>'order_date','') IS NULL THEN RAISE EXCEPTION '請選擇客戶並填訂購日期'; END IF;
 c_id:=(p_payload->>'customer_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM customers WHERE id=c_id) THEN RAISE EXCEPTION '客戶不存在'; END IF;
 IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '請加入訂購品項'; END IF;
 dep:=coalesce(nullif(p_payload->>'deposit_required','')::numeric,0);
 IF dep<0 OR dep<>round(dep,2) THEN RAISE EXCEPTION '訂金金額格式錯誤'; END IF;
 no:=coalesce(nullif(trim(p_payload->>'custom_order_no'),''),'CO-'||to_char((p_payload->>'order_date')::date,'YYYYMMDD')||'-'||lpad(nextval('custom_order_number_seq')::text,6,'0'));
 INSERT INTO custom_orders(id,custom_order_no,customer_id,order_date,expected_delivery_date,deposit_required,note,request_payload)
 VALUES(p_id,no,c_id,(p_payload->>'order_date')::date,nullif(p_payload->>'expected_delivery_date','')::date,dep,nullif(trim(p_payload->>'note'),''),p_payload)
 ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
 IF inserted IS NULL THEN
  SELECT * INTO existing FROM custom_orders WHERE id=p_id;
  IF existing.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION '此訂購單請求已儲存，請重新開單'; END IF;
  RETURN p_id;
 END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
  idx:=idx+1;
  IF nullif(trim(x->>'description'),'') IS NULL OR x->>'qty' IS NULL OR x->>'unit_price' IS NULL OR (x->>'qty')::numeric<>trunc((x->>'qty')::numeric) THEN RAISE EXCEPTION '請填品名、正整數數量與未稅單價'; END IF;
  n:=(x->>'qty')::integer; price:=(x->>'unit_price')::numeric;
  IF n<=0 OR price<0 OR price<>round(price,2) THEN RAISE EXCEPTION '數量或單價格式錯誤'; END IF;
  INSERT INTO custom_order_items(custom_order_id,description,specification,qty,unit_price,sort_order) VALUES(p_id,trim(x->>'description'),nullif(trim(x->>'specification'),''),n,price,idx);
  net:=net+n*price;
 END LOOP;
 tax:=round(net*0.05,2); total:=net+tax;
 IF dep>total THEN RAISE EXCEPTION '訂金應收不可高於含稅總額'; END IF;
 UPDATE custom_orders SET net_amount=net,tax_amount=tax,total_amount=total WHERE id=p_id;
 RETURN p_id;
END $$;
-- statement
CREATE OR REPLACE FUNCTION set_custom_order_status(p_id uuid,p_status text) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o custom_orders%ROWTYPE;
BEGIN
 SELECT * INTO o FROM custom_orders WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '找不到訂購單'; END IF;
 IF o.status IN ('completed','cancelled') THEN RAISE EXCEPTION '已完成或取消的訂購單不可變更狀態'; END IF;
 IF p_status='confirmed' AND o.status='draft' THEN NULL;
 ELSIF p_status='production' AND o.status IN ('confirmed','deposit_paid') THEN
  IF o.deposit_required>0 AND o.paid_amount<o.deposit_required THEN RAISE EXCEPTION '訂金尚未收足，不能進入生產'; END IF;
 ELSIF p_status='arrived' AND o.status='production' THEN NULL;
 ELSIF p_status='completed' AND o.status='converted' THEN
  IF o.paid_amount<o.total_amount THEN RAISE EXCEPTION '尾款尚未收足，不能完成訂購單'; END IF;
 ELSIF p_status='cancelled' AND o.status IN ('draft','confirmed','deposit_paid','production','arrived') THEN NULL;
 ELSE RAISE EXCEPTION '目前狀態不能變更為指定狀態';
 END IF;
 UPDATE custom_orders SET status=p_status,updated_at=now() WHERE id=p_id;
END $$;
-- statement
CREATE OR REPLACE FUNCTION record_custom_order_payment(p_order uuid,p_payment uuid,p_payload jsonb) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o custom_orders%ROWTYPE; amount numeric; ptype text; total_paid numeric;
BEGIN
 SELECT * INTO o FROM custom_orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.status='cancelled' THEN RAISE EXCEPTION '找不到可收款的訂購單'; END IF;
 IF nullif(p_payload->>'payment_date','') IS NULL THEN RAISE EXCEPTION '請填付款日期'; END IF;
 ptype:=p_payload->>'payment_type'; amount:=(p_payload->>'amount')::numeric;
 IF ptype NOT IN ('deposit','balance','other') OR amount<=0 OR amount<>round(amount,2) THEN RAISE EXCEPTION '付款資料格式錯誤'; END IF;
 INSERT INTO custom_order_payments(id,custom_order_id,payment_date,payment_type,amount,note)
 VALUES(p_payment,p_order,(p_payload->>'payment_date')::date,ptype,amount,nullif(trim(p_payload->>'note'),'')) ON CONFLICT(id) DO NOTHING;
 SELECT coalesce(sum(p.amount),0) INTO total_paid FROM custom_order_payments p WHERE p.custom_order_id=p_order;
 IF total_paid>o.total_amount THEN RAISE EXCEPTION '累計收款不可超過訂購單總額'; END IF;
 UPDATE custom_orders SET paid_amount=total_paid,
  payment_status=CASE WHEN total_paid<=0 THEN 'unpaid' WHEN total_paid>=total_amount THEN 'paid' ELSE 'partial' END,
  status=CASE WHEN status IN ('draft','confirmed') AND total_paid>=deposit_required AND deposit_required>0 THEN 'deposit_paid' ELSE status END,
  updated_at=now() WHERE id=p_order;
 IF o.sales_order_id IS NOT NULL THEN
  UPDATE orders SET paid_amount=total_paid,payment_status=CASE WHEN total_paid>=total_amount THEN 'paid' ELSE 'unpaid' END,revision=revision+1 WHERE id=o.sales_order_id;
 END IF;
END $$;
-- statement
CREATE OR REPLACE FUNCTION convert_custom_order(p_id uuid,p_mappings jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o custom_orders%ROWTYPE; i record; x jsonb; vid uuid; pv record; main_id uuid; available integer; oid uuid:=gen_random_uuid(); mapped integer:=0;
BEGIN
 SELECT * INTO o FROM custom_orders WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR o.status<>'arrived' THEN RAISE EXCEPTION '只有已到貨訂購單可轉銷貨單'; END IF;
 IF o.sales_order_id IS NOT NULL THEN RETURN o.sales_order_id; END IF;
 IF jsonb_typeof(p_mappings) IS DISTINCT FROM 'array' OR jsonb_array_length(p_mappings)<>(SELECT count(*) FROM custom_order_items WHERE custom_order_id=p_id) THEN RAISE EXCEPTION '請為每個品項選擇已入庫的商品規格'; END IF;
 SELECT id INTO main_id FROM warehouses WHERE name='總倉' FOR SHARE;
 IF main_id IS NULL THEN RAISE EXCEPTION '找不到總倉'; END IF;
 INSERT INTO orders(id,customer_id,order_date,status,payment_status,total_amount,goods_amount,paid_amount,note,sale_mode,discount,revision,tax_rate,net_amount,tax_amount,goods_net_amount)
 VALUES(oid,o.customer_id,now(),'pending',CASE WHEN o.paid_amount>=o.total_amount THEN 'paid' ELSE 'unpaid' END,o.total_amount,o.total_amount,o.paid_amount,'自訂訂購單轉入 '||o.custom_order_no,'buyout',NULL,0,5,o.net_amount,o.tax_amount,o.net_amount);
 FOR i IN SELECT * FROM custom_order_items WHERE custom_order_id=p_id ORDER BY sort_order,id LOOP
  SELECT (value->>'variant_id')::uuid INTO vid FROM jsonb_array_elements(p_mappings) WHERE value->>'item_id'=i.id::text;
  IF vid IS NULL THEN RAISE EXCEPTION '有品項尚未選擇商品規格'; END IF;
  SELECT pv.id,pv.color,pv.size,pv.stock_qty,p.name,p.retail_price INTO pv FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=vid FOR UPDATE OF pv;
  IF NOT FOUND THEN RAISE EXCEPTION '選擇的商品規格不存在'; END IF;
  SELECT stock_qty INTO available FROM warehouse_inventory WHERE warehouse_id=main_id AND variant_id=vid FOR UPDATE;
  IF coalesce(available,0)<i.qty THEN RAISE EXCEPTION '總倉庫存不足，請先用進貨單將自訂大貨入庫'; END IF;
  UPDATE warehouse_inventory SET stock_qty=stock_qty-i.qty,updated_at=now() WHERE warehouse_id=main_id AND variant_id=vid;
  UPDATE product_variants SET stock_qty=stock_qty-i.qty WHERE id=vid;
  UPDATE custom_order_items SET variant_id=vid WHERE id=i.id;
  INSERT INTO order_items(order_id,variant_id,product_name,color,size,qty,unit_price,retail_price) VALUES(oid,vid,i.description,pv.color,pv.size,i.qty,i.unit_price,pv.retail_price);
  mapped:=mapped+1;
 END LOOP;
 IF mapped<>(SELECT count(*) FROM custom_order_items WHERE custom_order_id=p_id) THEN RAISE EXCEPTION '品項對應不完整'; END IF;
 UPDATE custom_orders SET status='converted',sales_order_id=oid,updated_at=now() WHERE id=p_id;
 RETURN oid;
END $$;
-- statement
REVOKE ALL ON FUNCTION create_custom_order(uuid,jsonb), set_custom_order_status(uuid,text), record_custom_order_payment(uuid,uuid,jsonb), convert_custom_order(uuid,jsonb) FROM PUBLIC;
