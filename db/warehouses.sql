CREATE SEQUENCE IF NOT EXISTS stock_transfer_number_seq;
-- statement
CREATE SEQUENCE IF NOT EXISTS consignment_settlement_number_seq;
-- statement
CREATE TABLE IF NOT EXISTS warehouses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL UNIQUE,
 warehouse_type text NOT NULL DEFAULT 'consignment' CHECK(warehouse_type IN ('main','consignment')),
 sort_order integer NOT NULL DEFAULT 0,
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- statement
INSERT INTO warehouses(name,warehouse_type,sort_order) VALUES
 ('總倉','main',1),('p.coast','consignment',2),('Bumper','consignment',3),('momo clothing','consignment',4)
ON CONFLICT(name) DO UPDATE SET warehouse_type=excluded.warehouse_type,sort_order=excluded.sort_order,is_active=true;
-- statement
CREATE TABLE IF NOT EXISTS warehouse_inventory (
 warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
 stock_qty integer NOT NULL DEFAULT 0 CHECK(stock_qty>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(warehouse_id,variant_id)
);
-- statement
CREATE TABLE IF NOT EXISTS stock_transfers (
 id uuid PRIMARY KEY,
 transfer_no text NOT NULL UNIQUE,
 transfer_date date NOT NULL,
 from_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 to_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 note text,
 status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','void')),
 request_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz,
 CHECK(from_warehouse_id<>to_warehouse_id)
);
-- statement
CREATE TABLE IF NOT EXISTS stock_transfer_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
 variant_id uuid NOT NULL REFERENCES product_variants(id),
 qty integer NOT NULL CHECK(qty>0),
 UNIQUE(transfer_id,variant_id)
);
-- statement
CREATE TABLE IF NOT EXISTS stock_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 movement_type text NOT NULL CHECK(movement_type IN ('initial','purchase','purchase_void','transfer','transfer_void','consignment_sale')),
 variant_id uuid NOT NULL REFERENCES product_variants(id),
 from_warehouse_id uuid REFERENCES warehouses(id),
 to_warehouse_id uuid REFERENCES warehouses(id),
 qty integer NOT NULL CHECK(qty>0),
 reference_type text,
 reference_id uuid,
 note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- statement
INSERT INTO warehouse_inventory(warehouse_id,variant_id,stock_qty)
SELECT w.id,pv.id,pv.stock_qty FROM product_variants pv CROSS JOIN warehouses w
WHERE w.name='總倉'
ON CONFLICT(warehouse_id,variant_id) DO NOTHING;
-- statement
INSERT INTO stock_movements(movement_type,variant_id,to_warehouse_id,qty,reference_type,note)
SELECT 'initial',pv.id,w.id,pv.stock_qty,'migration','既有總庫存移入總倉'
FROM product_variants pv CROSS JOIN warehouses w
WHERE w.name='總倉' AND pv.stock_qty>0
 AND NOT EXISTS(SELECT 1 FROM stock_movements m WHERE m.movement_type='initial' AND m.variant_id=pv.id AND m.to_warehouse_id=w.id);
-- statement
CREATE OR REPLACE FUNCTION post_purchase(p_id uuid,p_payload jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE existing purchases%ROWTYPE; inserted uuid; x jsonb; v record; n integer; price numeric; tax numeric; net numeric:=0; taxes numeric:=0; no text; wid uuid;
BEGIN
 IF p_id IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '請加入進貨明細'; END IF;
 IF nullif(trim(p_payload->>'supplier'),'') IS NULL OR nullif(trim(p_payload->>'warehouse'),'') IS NULL OR nullif(p_payload->>'purchase_date','') IS NULL THEN RAISE EXCEPTION '請填日期、供應商及倉庫'; END IF;
 SELECT id INTO wid FROM warehouses WHERE name=trim(p_payload->>'warehouse') AND is_active FOR SHARE;
 IF wid IS NULL THEN RAISE EXCEPTION '請選擇有效倉庫'; END IF;
 no:=coalesce(nullif(trim(p_payload->>'purchase_no'),''),'PO-'||to_char((p_payload->>'purchase_date')::date,'YYYYMMDD')||'-'||lpad(nextval('purchase_number_seq')::text,6,'0'));
 INSERT INTO purchases(id,purchase_no,purchase_date,supplier,warehouse,request_payload) VALUES(p_id,no,(p_payload->>'purchase_date')::date,trim(p_payload->>'supplier'),trim(p_payload->>'warehouse'),p_payload) ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
 IF inserted IS NULL THEN
  SELECT * INTO existing FROM purchases WHERE id=p_id;
  IF existing.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION '此請求已儲存，請重新開單'; END IF;
  RETURN p_id;
 END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'variant_id' LOOP
  IF x->>'qty' IS NULL OR (x->>'qty')::numeric <> trunc((x->>'qty')::numeric) THEN RAISE EXCEPTION '數量必須為正整數'; END IF;
  n:=(x->>'qty')::integer; price:=(x->>'unit_price')::numeric; tax:=(x->>'tax_amount')::numeric;
  IF n<=0 OR price IS NULL OR tax IS NULL OR price<0 OR tax<0 OR price<>round(price,2) OR tax<>round(tax,2) THEN RAISE EXCEPTION '請填有效數量、未稅單價與稅額（最多兩位小數）'; END IF;
  SELECT pv.*,p.name,p.product_code INTO v FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=(x->>'variant_id')::uuid FOR UPDATE OF pv;
  IF NOT FOUND THEN RAISE EXCEPTION '商品規格不存在，請重新選擇'; END IF;
  INSERT INTO purchase_items(purchase_id,variant_id,product_code,product_name,color,size,qty,unit_price,tax_amount) VALUES(p_id,v.id,v.product_code,v.name,v.color,v.size,n,price,tax);
  INSERT INTO warehouse_inventory(warehouse_id,variant_id,stock_qty) VALUES(wid,v.id,n) ON CONFLICT(warehouse_id,variant_id) DO UPDATE SET stock_qty=warehouse_inventory.stock_qty+excluded.stock_qty,updated_at=now();
  UPDATE product_variants SET stock_qty=stock_qty+n WHERE id=v.id;
  INSERT INTO stock_movements(movement_type,variant_id,to_warehouse_id,qty,reference_type,reference_id,note) VALUES('purchase',v.id,wid,n,'purchase',p_id,no);
  net:=net+n*price; taxes:=taxes+tax;
 END LOOP;
 UPDATE purchases SET net_amount=net,tax_amount=taxes,total_amount=net+taxes WHERE id=p_id;
 RETURN p_id;
END $$;
-- statement
CREATE OR REPLACE FUNCTION void_purchase(p_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p purchases%ROWTYPE; i record; stock integer; wid uuid;
BEGIN
 SELECT * INTO p FROM purchases WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '找不到進貨單'; END IF;
 IF p.status='void' THEN RETURN; END IF;
 SELECT id INTO wid FROM warehouses WHERE name=p.warehouse FOR SHARE;
 IF wid IS NULL THEN RAISE EXCEPTION '此進貨單的倉庫不存在，請先處理倉庫資料'; END IF;
 FOR i IN SELECT * FROM purchase_items WHERE purchase_id=p_id ORDER BY variant_id LOOP
  SELECT stock_qty INTO stock FROM warehouse_inventory WHERE warehouse_id=wid AND variant_id=i.variant_id FOR UPDATE;
  IF stock IS NULL OR stock<i.qty THEN RAISE EXCEPTION '此倉庫庫存不足以沖回進貨單，無法作廢'; END IF;
  UPDATE warehouse_inventory SET stock_qty=stock_qty-i.qty,updated_at=now() WHERE warehouse_id=wid AND variant_id=i.variant_id;
  UPDATE product_variants SET stock_qty=stock_qty-i.qty WHERE id=i.variant_id;
  INSERT INTO stock_movements(movement_type,variant_id,from_warehouse_id,qty,reference_type,reference_id,note) VALUES('purchase_void',i.variant_id,wid,i.qty,'purchase',p_id,p.purchase_no);
 END LOOP;
 UPDATE purchases SET status='void',voided_at=now() WHERE id=p_id;
END $$;
-- statement
CREATE OR REPLACE FUNCTION post_stock_transfer(p_id uuid,p_payload jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE existing stock_transfers%ROWTYPE; inserted uuid; x jsonb; n integer; source_id uuid; target_id uuid; source_qty integer; no text;
BEGIN
 IF p_id IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '請加入調撥明細'; END IF;
 IF nullif(p_payload->>'transfer_date','') IS NULL THEN RAISE EXCEPTION '請填調撥日期'; END IF;
 SELECT id INTO source_id FROM warehouses WHERE name=trim(p_payload->>'from_warehouse') AND is_active FOR SHARE;
 SELECT id INTO target_id FROM warehouses WHERE name=trim(p_payload->>'to_warehouse') AND is_active FOR SHARE;
 IF source_id IS NULL OR target_id IS NULL OR source_id=target_id THEN RAISE EXCEPTION '請選擇不同的有效來源與目的倉庫'; END IF;
 no:=coalesce(nullif(trim(p_payload->>'transfer_no'),''),'TR-'||to_char((p_payload->>'transfer_date')::date,'YYYYMMDD')||'-'||lpad(nextval('stock_transfer_number_seq')::text,6,'0'));
 INSERT INTO stock_transfers(id,transfer_no,transfer_date,from_warehouse_id,to_warehouse_id,note,request_payload) VALUES(p_id,no,(p_payload->>'transfer_date')::date,source_id,target_id,nullif(trim(p_payload->>'note'),''),p_payload) ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
 IF inserted IS NULL THEN
  SELECT * INTO existing FROM stock_transfers WHERE id=p_id;
  IF existing.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION '此請求已儲存，請重新開單'; END IF;
  RETURN p_id;
 END IF;
 IF (SELECT count(DISTINCT value->>'variant_id') FROM jsonb_array_elements(p_payload->'items'))<>jsonb_array_length(p_payload->'items') THEN RAISE EXCEPTION '調撥明細不可重複'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'variant_id' LOOP
  IF x->>'qty' IS NULL OR (x->>'qty')::numeric<>trunc((x->>'qty')::numeric) THEN RAISE EXCEPTION '數量必須為正整數'; END IF;
  n:=(x->>'qty')::integer;
  IF n<=0 OR NOT EXISTS(SELECT 1 FROM product_variants WHERE id=(x->>'variant_id')::uuid) THEN RAISE EXCEPTION '商品規格或數量無效'; END IF;
  SELECT stock_qty INTO source_qty FROM warehouse_inventory WHERE warehouse_id=source_id AND variant_id=(x->>'variant_id')::uuid FOR UPDATE;
  IF coalesce(source_qty,0)<n THEN RAISE EXCEPTION '來源倉庫庫存不足'; END IF;
  UPDATE warehouse_inventory SET stock_qty=stock_qty-n,updated_at=now() WHERE warehouse_id=source_id AND variant_id=(x->>'variant_id')::uuid;
  INSERT INTO warehouse_inventory(warehouse_id,variant_id,stock_qty) VALUES(target_id,(x->>'variant_id')::uuid,n) ON CONFLICT(warehouse_id,variant_id) DO UPDATE SET stock_qty=warehouse_inventory.stock_qty+excluded.stock_qty,updated_at=now();
  INSERT INTO stock_transfer_items(transfer_id,variant_id,qty) VALUES(p_id,(x->>'variant_id')::uuid,n);
  INSERT INTO stock_movements(movement_type,variant_id,from_warehouse_id,to_warehouse_id,qty,reference_type,reference_id,note) VALUES('transfer',(x->>'variant_id')::uuid,source_id,target_id,n,'transfer',p_id,no);
 END LOOP;
 RETURN p_id;
END $$;
-- statement
CREATE OR REPLACE FUNCTION void_stock_transfer(p_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE t stock_transfers%ROWTYPE; i record; target_qty integer;
BEGIN
 SELECT * INTO t FROM stock_transfers WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '找不到調撥單'; END IF;
 IF t.status='void' THEN RETURN; END IF;
 FOR i IN SELECT * FROM stock_transfer_items WHERE transfer_id=p_id ORDER BY variant_id LOOP
  SELECT stock_qty INTO target_qty FROM warehouse_inventory WHERE warehouse_id=t.to_warehouse_id AND variant_id=i.variant_id FOR UPDATE;
  IF coalesce(target_qty,0)<i.qty THEN RAISE EXCEPTION '目的倉庫庫存不足以沖回此調撥單'; END IF;
  UPDATE warehouse_inventory SET stock_qty=stock_qty-i.qty,updated_at=now() WHERE warehouse_id=t.to_warehouse_id AND variant_id=i.variant_id;
  INSERT INTO warehouse_inventory(warehouse_id,variant_id,stock_qty) VALUES(t.from_warehouse_id,i.variant_id,i.qty) ON CONFLICT(warehouse_id,variant_id) DO UPDATE SET stock_qty=warehouse_inventory.stock_qty+excluded.stock_qty,updated_at=now();
  INSERT INTO stock_movements(movement_type,variant_id,from_warehouse_id,to_warehouse_id,qty,reference_type,reference_id,note) VALUES('transfer_void',i.variant_id,t.to_warehouse_id,t.from_warehouse_id,i.qty,'transfer',p_id,t.transfer_no);
 END LOOP;
 UPDATE stock_transfers SET status='void',voided_at=now() WHERE id=p_id;
END $$;
-- statement
CREATE TABLE IF NOT EXISTS consignment_settlements (
 id uuid PRIMARY KEY,
 settlement_no text NOT NULL UNIQUE,
 settlement_date date NOT NULL,
 warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 customer_id uuid NOT NULL REFERENCES customers(id),
 order_id uuid REFERENCES orders(id),
 net_amount numeric(12,2) NOT NULL DEFAULT 0,
 tax_amount numeric(12,2) NOT NULL DEFAULT 0,
 total_amount numeric(12,2) NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 request_payload jsonb NOT NULL
);
-- statement
CREATE TABLE IF NOT EXISTS consignment_settlement_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 settlement_id uuid NOT NULL REFERENCES consignment_settlements(id) ON DELETE CASCADE,
 variant_id uuid NOT NULL REFERENCES product_variants(id),
 system_qty integer NOT NULL,
 counted_qty integer NOT NULL,
 sold_qty integer NOT NULL,
 unit_price numeric(10,2) NOT NULL,
 UNIQUE(settlement_id,variant_id)
);
-- statement
CREATE OR REPLACE FUNCTION settle_warehouse_consignment(p_id uuid,p_payload jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE existing consignment_settlements%ROWTYPE; c customers%ROWTYPE; wid uuid; wtype text; x jsonb; v record; system_qty integer; counted integer; sold integer; price numeric; net numeric:=0; tax numeric:=0; oid uuid:=NULL; no text; item_count integer;
BEGIN
 IF p_id IS NULL OR nullif(p_payload->>'settlement_date','') IS NULL OR nullif(p_payload->>'warehouse','') IS NULL OR nullif(p_payload->>'customer_id','') IS NULL THEN RAISE EXCEPTION '請填月結日期、寄賣倉庫及客戶'; END IF;
 SELECT id,warehouse_type INTO wid,wtype FROM warehouses WHERE name=trim(p_payload->>'warehouse') AND is_active FOR SHARE;
 IF wid IS NULL OR wtype<>'consignment' THEN RAISE EXCEPTION '請選擇寄賣客戶倉庫'; END IF;
 SELECT * INTO c FROM customers WHERE id=(p_payload->>'customer_id')::uuid FOR SHARE;
 IF NOT FOUND OR c.sale_mode<>'consignment' OR c.discount IS NULL THEN RAISE EXCEPTION '此客戶未設定為寄賣合作'; END IF;
 IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '請輸入盤點數量'; END IF;
 SELECT count(*) INTO item_count FROM warehouse_inventory WHERE warehouse_id=wid AND stock_qty>0;
 IF jsonb_array_length(p_payload->'items')<>item_count OR (SELECT count(DISTINCT value->>'variant_id') FROM jsonb_array_elements(p_payload->'items'))<>item_count THEN RAISE EXCEPTION '請完整盤點此寄賣倉目前所有有庫存的品項'; END IF;
 no:='CS-'||to_char((p_payload->>'settlement_date')::date,'YYYYMMDD')||'-'||lpad(nextval('consignment_settlement_number_seq')::text,6,'0');
 INSERT INTO consignment_settlements(id,settlement_no,settlement_date,warehouse_id,customer_id,request_payload) VALUES(p_id,no,(p_payload->>'settlement_date')::date,wid,c.id,p_payload) ON CONFLICT(id) DO NOTHING;
 IF NOT FOUND THEN
  SELECT * INTO existing FROM consignment_settlements WHERE id=p_id;
  IF existing.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION '此月結請求已儲存，請重新開單'; END IF;
  RETURN p_id;
 END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'variant_id' LOOP
  IF x->>'counted_qty' IS NULL OR (x->>'counted_qty')::numeric<>trunc((x->>'counted_qty')::numeric) THEN RAISE EXCEPTION '盤點數量必須為整數'; END IF;
  counted:=(x->>'counted_qty')::integer;
  SELECT wi.stock_qty,pv.id,pv.color,pv.size,p.name,p.retail_price INTO v FROM warehouse_inventory wi JOIN product_variants pv ON pv.id=wi.variant_id JOIN products p ON p.id=pv.product_id WHERE wi.warehouse_id=wid AND wi.variant_id=(x->>'variant_id')::uuid FOR UPDATE OF wi,pv;
  IF NOT FOUND OR counted<0 OR counted>v.stock_qty THEN RAISE EXCEPTION '盤點數量不可小於 0 或大於系統寄放數量'; END IF;
  system_qty:=v.stock_qty; sold:=system_qty-counted; price:=round(v.retail_price*c.discount/10,2);
  INSERT INTO consignment_settlement_items(settlement_id,variant_id,system_qty,counted_qty,sold_qty,unit_price) VALUES(p_id,v.id,system_qty,counted,sold,price);
  IF sold>0 THEN
   IF oid IS NULL THEN
    oid:=gen_random_uuid();
    INSERT INTO orders(id,customer_id,order_date,status,payment_status,total_amount,shipped_at,note,sale_mode,discount,goods_amount,paid_amount,revision,tax_rate,net_amount,tax_amount,goods_net_amount)
    VALUES(oid,c.id,(p_payload->>'settlement_date')::date,'shipped','unpaid',0,(p_payload->>'settlement_date')::date,'寄賣月結 '||trim(p_payload->>'warehouse')||' / '||no,'consignment',c.discount,0,0,0,5,0,0,0);
   END IF;
   INSERT INTO order_items(order_id,variant_id,product_name,color,size,qty,unit_price,retail_price,sold_qty) VALUES(oid,v.id,v.name,v.color,v.size,sold,price,v.retail_price,sold);
   UPDATE warehouse_inventory SET stock_qty=counted,updated_at=now() WHERE warehouse_id=wid AND variant_id=v.id;
   UPDATE product_variants SET stock_qty=stock_qty-sold WHERE id=v.id;
   INSERT INTO stock_movements(movement_type,variant_id,from_warehouse_id,qty,reference_type,reference_id,note) VALUES('consignment_sale',v.id,wid,sold,'consignment_settlement',p_id,no);
   net:=net+sold*price;
  END IF;
 END LOOP;
 tax:=round(net*0.05,2);
 IF oid IS NOT NULL THEN UPDATE orders SET goods_net_amount=net,goods_amount=net+tax,net_amount=net,tax_amount=tax,total_amount=net+tax WHERE id=oid; END IF;
 UPDATE consignment_settlements SET order_id=oid,net_amount=net,tax_amount=tax,total_amount=net+tax WHERE id=p_id;
 RETURN p_id;
END $$;
-- statement
REVOKE ALL ON FUNCTION post_stock_transfer(uuid,jsonb), void_stock_transfer(uuid), settle_warehouse_consignment(uuid,jsonb) FROM PUBLIC;
