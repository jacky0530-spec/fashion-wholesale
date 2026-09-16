CREATE TABLE IF NOT EXISTS sales_stock_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES orders(id),
 variant_id uuid NOT NULL REFERENCES product_variants(id),
 warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 qty integer NOT NULL CHECK(qty>0),
 movement_source text NOT NULL CHECK(movement_source IN ('shipment','custom_order')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,variant_id)
);
-- statement
CREATE INDEX IF NOT EXISTS sales_stock_movements_order_idx ON sales_stock_movements(order_id);
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
  FOR i IN SELECT variant_id,sum(qty)::integer AS qty FROM order_items WHERE order_id=oid GROUP BY variant_id ORDER BY variant_id LOOP
   SELECT stock_qty INTO available FROM warehouse_inventory WHERE warehouse_id=main_id AND variant_id=i.variant_id FOR UPDATE;
   IF coalesce(available,0)<i.qty THEN RAISE EXCEPTION '總倉庫存不足，無法出貨'; END IF;
  END LOOP;
  FOR i IN SELECT variant_id,sum(qty)::integer AS qty FROM order_items WHERE order_id=oid GROUP BY variant_id ORDER BY variant_id LOOP
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
CREATE OR REPLACE FUNCTION convert_custom_order(p_id uuid,p_mappings jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o custom_orders%ROWTYPE; i record; vid uuid; vrow record; main_id uuid; available integer; oid uuid:=gen_random_uuid(); mapped integer:=0;
BEGIN
 SELECT * INTO o FROM custom_orders WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR o.status<>'arrived' THEN RAISE EXCEPTION '只有已到貨訂購單可轉銷貨單'; END IF;
 IF o.sales_order_id IS NOT NULL THEN RETURN o.sales_order_id; END IF;
 IF jsonb_typeof(p_mappings) IS DISTINCT FROM 'array' OR jsonb_array_length(p_mappings)<>(SELECT count(*) FROM custom_order_items WHERE custom_order_id=p_id) THEN RAISE EXCEPTION '請為每個品項選擇已入庫的商品規格'; END IF;
 SELECT id INTO main_id FROM warehouses WHERE name='總倉' AND is_active FOR SHARE;
 IF main_id IS NULL THEN RAISE EXCEPTION '找不到總倉'; END IF;
 INSERT INTO orders(id,customer_id,order_date,status,payment_status,total_amount,goods_amount,paid_amount,shipped_at,note,sale_mode,discount,revision,tax_rate,net_amount,tax_amount,goods_net_amount)
 VALUES(oid,o.customer_id,current_date,'shipped',CASE WHEN o.paid_amount>=o.total_amount THEN 'paid' ELSE 'unpaid' END,o.total_amount,o.total_amount,o.paid_amount,now(),'自訂訂購單轉入 '||o.custom_order_no,'buyout',NULL,0,5,o.net_amount,o.tax_amount,o.net_amount);
 FOR i IN SELECT * FROM custom_order_items WHERE custom_order_id=p_id ORDER BY sort_order,id LOOP
  SELECT (value->>'variant_id')::uuid INTO vid FROM jsonb_array_elements(p_mappings) WHERE value->>'item_id'=i.id::text;
  IF vid IS NULL THEN RAISE EXCEPTION '有品項尚未選擇商品規格'; END IF;
  SELECT pvar.id,pvar.color,pvar.size,pvar.stock_qty,p.name,p.retail_price INTO vrow FROM product_variants pvar JOIN products p ON p.id=pvar.product_id WHERE pvar.id=vid FOR UPDATE OF pvar;
  IF NOT FOUND THEN RAISE EXCEPTION '選擇的商品規格不存在'; END IF;
  SELECT stock_qty INTO available FROM warehouse_inventory WHERE warehouse_id=main_id AND variant_id=vid FOR UPDATE;
  IF coalesce(available,0)<i.qty THEN RAISE EXCEPTION '總倉庫存不足，請先用進貨單將自訂大貨入庫'; END IF;
  UPDATE warehouse_inventory SET stock_qty=stock_qty-i.qty,updated_at=now() WHERE warehouse_id=main_id AND variant_id=vid;
  UPDATE product_variants SET stock_qty=stock_qty-i.qty WHERE id=vid;
  UPDATE custom_order_items SET variant_id=vid WHERE id=i.id;
  INSERT INTO order_items(order_id,variant_id,product_name,color,size,qty,unit_price,retail_price) VALUES(oid,vid,i.description,vrow.color,vrow.size,i.qty,i.unit_price,vrow.retail_price);
  INSERT INTO sales_stock_movements(order_id,variant_id,warehouse_id,qty,movement_source) VALUES(oid,vid,main_id,i.qty,'custom_order');
  mapped:=mapped+1;
 END LOOP;
 IF mapped<>(SELECT count(*) FROM custom_order_items WHERE custom_order_id=p_id) THEN RAISE EXCEPTION '品項對應不完整'; END IF;
 UPDATE custom_orders SET status='converted',sales_order_id=oid,updated_at=now() WHERE id=p_id;
 RETURN oid;
END $$;
-- statement
REVOKE ALL ON FUNCTION ship_orders(uuid[]) FROM PUBLIC;
