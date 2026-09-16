CREATE SEQUENCE IF NOT EXISTS purchase_number_seq;
-- statement
CREATE TABLE IF NOT EXISTS purchases (
 id uuid PRIMARY KEY, purchase_no text NOT NULL UNIQUE, purchase_date date NOT NULL,
 supplier text NOT NULL, warehouse text NOT NULL, net_amount numeric(12,2) NOT NULL DEFAULT 0,
 tax_amount numeric(12,2) NOT NULL DEFAULT 0, total_amount numeric(12,2) NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','void')),
 request_payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), voided_at timestamptz
);
-- statement
CREATE TABLE IF NOT EXISTS purchase_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purchase_id uuid NOT NULL REFERENCES purchases(id),
 variant_id uuid NOT NULL REFERENCES product_variants(id),product_code text,product_name text NOT NULL,
 color text NOT NULL,size text NOT NULL,qty integer NOT NULL CHECK(qty>0),
 unit_price numeric(10,2) NOT NULL CHECK(unit_price>=0),tax_amount numeric(12,2) NOT NULL CHECK(tax_amount>=0),
 UNIQUE(purchase_id,variant_id)
);
-- statement
CREATE OR REPLACE FUNCTION post_purchase(p_id uuid,p_payload jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE existing purchases%ROWTYPE; inserted uuid; x jsonb; v record; n integer; price numeric; tax numeric; net numeric:=0; taxes numeric:=0; no text;
BEGIN
 IF p_id IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '請加入進貨明細'; END IF;
 IF nullif(trim(p_payload->>'supplier'),'') IS NULL OR nullif(trim(p_payload->>'warehouse'),'') IS NULL OR nullif(p_payload->>'purchase_date','') IS NULL THEN RAISE EXCEPTION '請填日期、供應商及倉庫'; END IF;
 no:=coalesce(nullif(trim(p_payload->>'purchase_no'),''),'PO-'||to_char((p_payload->>'purchase_date')::date,'YYYYMMDD')||'-'||lpad(nextval('purchase_number_seq')::text,6,'0'));
 INSERT INTO purchases(id,purchase_no,purchase_date,supplier,warehouse,request_payload) VALUES(p_id,no,(p_payload->>'purchase_date')::date,trim(p_payload->>'supplier'),trim(p_payload->>'warehouse'),p_payload) ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
 IF inserted IS NULL THEN
  SELECT * INTO existing FROM purchases WHERE id=p_id;
  IF existing.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION '此請求已儲存，請重新開單'; END IF;
  RETURN p_id;
 END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'variant_id' LOOP
  IF x->>'qty' IS NULL OR (x->>'qty')::numeric <> trunc((x->>'qty')::numeric) THEN RAISE EXCEPTION '數量必須為正整數'; END IF;
  n:=(x->>'qty')::integer;price:=(x->>'unit_price')::numeric;tax:=(x->>'tax_amount')::numeric;
  IF n<=0 OR price IS NULL OR tax IS NULL OR price<0 OR tax<0 OR price <> round(price,2) OR tax <> round(tax,2) OR price::text IN ('NaN','Infinity','-Infinity') OR tax::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION '請填有效數量、未稅單價與稅額（最多兩位小數）'; END IF;
  SELECT pv.*,p.name,p.product_code INTO v FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=(x->>'variant_id')::uuid FOR UPDATE OF pv;
  IF NOT FOUND THEN RAISE EXCEPTION '商品規格不存在，請重新選擇'; END IF;
  INSERT INTO purchase_items(purchase_id,variant_id,product_code,product_name,color,size,qty,unit_price,tax_amount) VALUES(p_id,v.id,v.product_code,v.name,v.color,v.size,n,price,tax);
  UPDATE product_variants SET stock_qty=stock_qty+n WHERE id=v.id;
  net:=net+n*price;taxes:=taxes+tax;
 END LOOP;
 UPDATE purchases SET net_amount=net,tax_amount=taxes,total_amount=net+taxes WHERE id=p_id;
 RETURN p_id;
END $$;
-- statement
CREATE OR REPLACE FUNCTION void_purchase(p_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p purchases%ROWTYPE; i record; stock integer;
BEGIN
 SELECT * INTO p FROM purchases WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '找不到進貨單'; END IF;
 IF p.status='void' THEN RETURN; END IF;
 FOR i IN SELECT * FROM purchase_items WHERE purchase_id=p_id ORDER BY variant_id LOOP
  SELECT stock_qty INTO stock FROM product_variants WHERE id=i.variant_id FOR UPDATE;
  IF NOT FOUND OR stock<i.qty THEN RAISE EXCEPTION '目前庫存不足以沖回此進貨單，無法作廢'; END IF;
  UPDATE product_variants SET stock_qty=stock_qty-i.qty WHERE id=i.variant_id;
 END LOOP;
 UPDATE purchases SET status='void',voided_at=now() WHERE id=p_id;
END $$;
-- statement
REVOKE ALL ON FUNCTION post_purchase(uuid,jsonb), void_purchase(uuid) FROM PUBLIC;
