ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bundle boolean NOT NULL DEFAULT false;
-- statement
CREATE TABLE IF NOT EXISTS bundle_components (
 bundle_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 component_variant_id uuid NOT NULL REFERENCES product_variants(id),
 qty integer NOT NULL CHECK(qty > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(bundle_product_id, component_variant_id)
);
-- statement
CREATE INDEX IF NOT EXISTS bundle_components_variant_idx ON bundle_components(component_variant_id);
-- statement
CREATE OR REPLACE FUNCTION save_bundle_product(p_id uuid,p_payload jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE
 bid uuid:=coalesce(p_id,gen_random_uuid());
 x jsonb;
 component_count integer;
 q integer;
 vrow record;
 total_cost numeric:=0;
 retail numeric;
 pname text;
 pcode text;
 pnote text;
BEGIN
 pname:=nullif(trim(p_payload->>'name'),'');
 pcode:=nullif(trim(p_payload->>'product_code'),'');
 pnote:=nullif(trim(p_payload->>'note'),'');
 retail:=coalesce(nullif(p_payload->>'retail_price','')::numeric,0);
 IF pname IS NULL THEN RAISE EXCEPTION '請輸入組合商品名稱'; END IF;
 IF retail < 0 OR retail <> round(retail,2) THEN RAISE EXCEPTION '組合售價格式錯誤'; END IF;
 IF jsonb_typeof(p_payload->'components') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '請設定組合內容'; END IF;
 SELECT count(DISTINCT value->>'variant_id') INTO component_count FROM jsonb_array_elements(p_payload->'components');
 IF component_count < 2 OR component_count <> jsonb_array_length(p_payload->'components') THEN RAISE EXCEPTION '組合商品至少需要 2 個不同品項'; END IF;

 IF p_id IS NOT NULL AND EXISTS(SELECT 1 FROM products WHERE id=p_id AND NOT is_bundle) THEN RAISE EXCEPTION '一般商品不可直接改成組合商品'; END IF;

 INSERT INTO products(id,name,product_code,category,cost_price,wholesale_price,retail_price,note,is_active,is_bundle)
 VALUES(bid,pname,pcode,'組合',0,0,retail,pnote,true,true)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,product_code=excluded.product_code,category='組合',retail_price=excluded.retail_price,note=excluded.note,is_active=true,is_bundle=true;

 INSERT INTO product_variants(product_id,color,size,stock_qty,sku)
 VALUES(bid,'組合','SET',0,pcode)
 ON CONFLICT(product_id,color,size) DO UPDATE SET sku=excluded.sku;

 DELETE FROM bundle_components WHERE bundle_product_id=bid;
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'components') LOOP
  IF x->>'qty' IS NULL OR (x->>'qty')::numeric<>trunc((x->>'qty')::numeric) THEN RAISE EXCEPTION '組合數量必須是正整數'; END IF;
  q:=(x->>'qty')::integer;
  IF q<=0 THEN RAISE EXCEPTION '組合數量必須是正整數'; END IF;
  SELECT pv.id,p.cost_price,p.is_bundle INTO vrow FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=(x->>'variant_id')::uuid FOR SHARE OF pv,p;
  IF NOT FOUND THEN RAISE EXCEPTION '組合內有不存在的商品規格'; END IF;
  IF vrow.is_bundle THEN RAISE EXCEPTION '組合商品不可再包含另一個組合商品'; END IF;
  INSERT INTO bundle_components(bundle_product_id,component_variant_id,qty) VALUES(bid,vrow.id,q);
  total_cost:=total_cost+coalesce(vrow.cost_price,0)*q;
 END LOOP;
 UPDATE products SET cost_price=round(total_cost,2) WHERE id=bid;
 RETURN bid;
END $$;
-- statement
CREATE OR REPLACE FUNCTION ship_orders(p_ids uuid[]) RETURNS SETOF uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE oid uuid; o orders%ROWTYPE; i record; main_id uuid; available integer;
BEGIN
 IF p_ids IS NULL OR array_length(p_ids,1) IS NULL OR array_length(p_ids,1)>500 THEN RAISE EXCEPTION '訂單清單錯誤'; END IF;
 SELECT id INTO main_id FROM warehouses WHERE name='總倉' AND is_active FOR SHARE;
 IF main_id IS NULL THEN RAISE EXCEPTION '找不到總倉'; END IF;
 FOREACH oid IN ARRAY p_ids LOOP
  SELECT * INTO o FROM orders WHERE id=oid FOR UPDATE;
  IF NOT FOUND OR o.status<>'pending' THEN CONTINUE; END IF;
  IF o.sale_mode IS DISTINCT FROM 'buyout' THEN RAISE EXCEPTION '只有買斷銷貨單可由此出貨'; END IF;

  FOR i IN
   WITH expanded AS (
    SELECT CASE WHEN p.is_bundle THEN bc.component_variant_id ELSE oi.variant_id END AS variant_id,
           CASE WHEN p.is_bundle THEN oi.qty*bc.qty ELSE oi.qty END AS qty
    FROM order_items oi
    JOIN product_variants opv ON opv.id=oi.variant_id
    JOIN products p ON p.id=opv.product_id
    LEFT JOIN bundle_components bc ON p.is_bundle AND bc.bundle_product_id=p.id
    WHERE oi.order_id=oid
   )
   SELECT variant_id,sum(qty)::integer AS qty FROM expanded WHERE variant_id IS NOT NULL GROUP BY variant_id ORDER BY variant_id
  LOOP
   SELECT stock_qty INTO available FROM warehouse_inventory WHERE warehouse_id=main_id AND variant_id=i.variant_id FOR UPDATE;
   IF coalesce(available,0)<i.qty THEN RAISE EXCEPTION '總倉庫存不足，無法出貨；請檢查組合商品內的 A/B 元件庫存'; END IF;
  END LOOP;

  FOR i IN
   WITH expanded AS (
    SELECT CASE WHEN p.is_bundle THEN bc.component_variant_id ELSE oi.variant_id END AS variant_id,
           CASE WHEN p.is_bundle THEN oi.qty*bc.qty ELSE oi.qty END AS qty
    FROM order_items oi
    JOIN product_variants opv ON opv.id=oi.variant_id
    JOIN products p ON p.id=opv.product_id
    LEFT JOIN bundle_components bc ON p.is_bundle AND bc.bundle_product_id=p.id
    WHERE oi.order_id=oid
   )
   SELECT variant_id,sum(qty)::integer AS qty FROM expanded WHERE variant_id IS NOT NULL GROUP BY variant_id ORDER BY variant_id
  LOOP
   UPDATE warehouse_inventory SET stock_qty=stock_qty-i.qty,updated_at=now() WHERE warehouse_id=main_id AND variant_id=i.variant_id;
   UPDATE product_variants SET stock_qty=stock_qty-i.qty WHERE id=i.variant_id;
   INSERT INTO sales_stock_movements(order_id,variant_id,warehouse_id,qty,movement_source) VALUES(oid,i.variant_id,main_id,i.qty,'shipment');
  END LOOP;
  UPDATE orders SET status='shipped',shipped_at=now() WHERE id=oid;
  RETURN NEXT oid;
 END LOOP;
 RETURN;
END $$;
-- statement
REVOKE ALL ON FUNCTION save_bundle_product(uuid,jsonb), ship_orders(uuid[]) FROM PUBLIC;
