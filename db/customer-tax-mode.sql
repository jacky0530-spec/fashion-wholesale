ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'exclusive' CHECK(tax_mode IN ('exclusive','inclusive'));
-- statement
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'exclusive' CHECK(tax_mode IN ('exclusive','inclusive'));
-- statement
CREATE OR REPLACE FUNCTION create_dealer_order(p_customer uuid,p_note text,p_items jsonb,p_discount numeric,p_mode text,p_tax_mode text) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c customers%ROWTYPE; v record; i jsonb; n integer; price numeric; discounted_gross numeric; retail numeric; oid uuid:=gen_random_uuid(); net_total numeric:=0; tax_total numeric:=0;
BEGIN
 SELECT * INTO c FROM customers WHERE id=p_customer FOR SHARE;
 IF NOT FOUND OR c.discount IS NULL THEN RAISE EXCEPTION '請先在客戶管理設定折數'; END IF;
 IF p_discount IS DISTINCT FROM c.discount OR p_mode IS DISTINCT FROM c.sale_mode OR p_tax_mode IS DISTINCT FROM c.tax_mode THEN RAISE EXCEPTION '客戶條件已變更，請重新選擇客戶'; END IF;
 IF p_tax_mode NOT IN ('exclusive','inclusive') THEN RAISE EXCEPTION '稅金方式錯誤'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '訂單明細無效'; END IF;
 INSERT INTO orders(id,customer_id,note,sale_mode,discount,tax_mode,total_amount,goods_amount,paid_amount,tax_rate,net_amount,tax_amount,goods_net_amount)
 VALUES(oid,c.id,p_note,c.sale_mode,c.discount,c.tax_mode,0,0,0,5,0,0,0);
 FOR i IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF (i->>'qty') IS NULL OR (i->>'qty')::numeric<>trunc((i->>'qty')::numeric) THEN RAISE EXCEPTION '數量必須是正整數'; END IF;
  n:=(i->>'qty')::integer;
  IF n<1 THEN RAISE EXCEPTION '數量必須是正整數'; END IF;
  SELECT pv.*,p.name,p.retail_price INTO v FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=(i->>'variant_id')::uuid FOR SHARE OF pv,p;
  IF NOT FOUND THEN RAISE EXCEPTION '商品規格不存在'; END IF;
  retail:=v.retail_price;
  discounted_gross:=round(retail*c.discount/10,2);
  price:=CASE WHEN c.tax_mode='inclusive' THEN round(discounted_gross/1.05,2) ELSE discounted_gross END;
  IF price<0 OR (i->>'price')::numeric IS DISTINCT FROM price THEN RAISE EXCEPTION '商品價格或稅金方式已變更，請重新加入商品'; END IF;
  INSERT INTO order_items(order_id,variant_id,product_name,color,size,qty,unit_price,retail_price) VALUES(oid,v.id,v.name,v.color,v.size,n,price,retail);
  net_total:=net_total+n*price;
 END LOOP;
 tax_total:=round(net_total*0.05,2);
 UPDATE orders SET goods_net_amount=net_total,goods_amount=net_total+tax_total,net_amount=CASE WHEN c.sale_mode='consignment' THEN 0 ELSE net_total END,tax_amount=CASE WHEN c.sale_mode='consignment' THEN 0 ELSE tax_total END,total_amount=CASE WHEN c.sale_mode='consignment' THEN 0 ELSE net_total+tax_total END WHERE id=oid;
 RETURN oid;
END $$;
-- statement
CREATE OR REPLACE FUNCTION settle_warehouse_consignment(p_id uuid,p_payload jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE existing consignment_settlements%ROWTYPE; c customers%ROWTYPE; wid uuid; wtype text; x jsonb; v record; system_qty integer; counted integer; sold integer; price numeric; discounted_gross numeric; net numeric:=0; tax numeric:=0; oid uuid:=NULL; no text; item_count integer;
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
  system_qty:=v.stock_qty; sold:=system_qty-counted;
  discounted_gross:=round(v.retail_price*c.discount/10,2);
  price:=CASE WHEN c.tax_mode='inclusive' THEN round(discounted_gross/1.05,2) ELSE discounted_gross END;
  INSERT INTO consignment_settlement_items(settlement_id,variant_id,system_qty,counted_qty,sold_qty,unit_price) VALUES(p_id,v.id,system_qty,counted,sold,price);
  IF sold>0 THEN
   IF oid IS NULL THEN
    oid:=gen_random_uuid();
    INSERT INTO orders(id,customer_id,order_date,status,payment_status,total_amount,shipped_at,note,sale_mode,discount,tax_mode,goods_amount,paid_amount,revision,tax_rate,net_amount,tax_amount,goods_net_amount)
    VALUES(oid,c.id,(p_payload->>'settlement_date')::date,'shipped','unpaid',0,(p_payload->>'settlement_date')::date,'寄賣月結 '||trim(p_payload->>'warehouse')||' / '||no,'consignment',c.discount,c.tax_mode,0,0,0,5,0,0,0);
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
REVOKE ALL ON FUNCTION create_dealer_order(uuid,text,jsonb,numeric,text,text) FROM PUBLIC;
