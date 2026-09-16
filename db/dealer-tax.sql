ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK(tax_rate >= 0 AND tax_rate <= 100), ADD COLUMN IF NOT EXISTS net_amount numeric(12,2), ADD COLUMN IF NOT EXISTS tax_amount numeric(12,2), ADD COLUMN IF NOT EXISTS goods_net_amount numeric(12,2);
-- statement
ALTER TABLE customers ALTER COLUMN discount SET DEFAULT 5.5;
-- statement
CREATE OR REPLACE FUNCTION create_dealer_order(p_customer uuid,p_note text,p_items jsonb,p_discount numeric,p_mode text) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c customers%ROWTYPE; v record; i jsonb; n integer; price numeric; retail numeric; oid uuid := gen_random_uuid(); total numeric := 0;
BEGIN
 SELECT * INTO c FROM customers WHERE id=p_customer FOR SHARE;
 IF NOT FOUND OR c.discount IS NULL THEN RAISE EXCEPTION '請先在客戶管理設定經銷商折數'; END IF;
 IF p_discount IS DISTINCT FROM c.discount OR p_mode IS DISTINCT FROM c.sale_mode THEN RAISE EXCEPTION '客戶條件已變更，請重新選擇客戶'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '訂單明細無效'; END IF;
 INSERT INTO orders(id,customer_id,note,sale_mode,discount,total_amount,goods_amount,paid_amount,tax_rate,net_amount,tax_amount,goods_net_amount) VALUES(oid,c.id,p_note,c.sale_mode,c.discount,0,0,0,5,0,0,0);
 FOR i IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF (i->>'qty')::numeric <> trunc((i->>'qty')::numeric) OR (i->>'qty') IS NULL THEN RAISE EXCEPTION '數量必須是正整數'; END IF;
  n := (i->>'qty')::integer;
  IF n < 1 THEN RAISE EXCEPTION '數量必須是正整數'; END IF;
  SELECT pv.*,p.name,p.retail_price INTO v FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=(i->>'variant_id')::uuid FOR SHARE OF pv,p;
  IF NOT FOUND THEN RAISE EXCEPTION '商品規格不存在'; END IF;
  retail:=v.retail_price; price:=round(retail*c.discount/10,2);
  IF price < 0 OR (i->>'price')::numeric IS DISTINCT FROM price THEN RAISE EXCEPTION '商品價格已變更，請重新加入商品'; END IF;
  INSERT INTO order_items(order_id,variant_id,product_name,color,size,qty,unit_price,retail_price) VALUES(oid,v.id,v.name,v.color,v.size,n,price,retail);
  total:=total+n*price;
 END LOOP;
 UPDATE orders SET goods_net_amount=total,goods_amount=total+round(total*0.05,2),net_amount=CASE WHEN c.sale_mode='consignment' THEN 0 ELSE total END,tax_amount=CASE WHEN c.sale_mode='consignment' THEN 0 ELSE round(total*0.05,2) END,total_amount=CASE WHEN c.sale_mode='consignment' THEN 0 ELSE total+round(total*0.05,2) END WHERE id=oid;
 RETURN oid;
END $$;
-- statement
CREATE OR REPLACE FUNCTION settle_consignment(p_order uuid,p_revision integer,p_items jsonb) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o orders%ROWTYPE; it order_items%ROWTYPE; x jsonb; sold integer; returned integer; due numeric;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.sale_mode <> 'consignment' OR o.status <> 'shipped' THEN RAISE EXCEPTION '僅已出貨的寄賣單可登記售出'; END IF;
 IF p_revision IS DISTINCT FROM o.revision THEN RAISE EXCEPTION '單據已更新，請重新整理後再操作'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) <> (SELECT count(*) FROM order_items WHERE order_id=p_order) OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) THEN RAISE EXCEPTION '請提供完整且不重複的品項'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO it FROM order_items WHERE id=(x->>'id')::uuid AND order_id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '品項不屬於此寄賣單'; END IF;
  IF (x->>'sold_qty') IS NULL OR (x->>'returned_qty') IS NULL OR (x->>'sold_qty')::numeric <> trunc((x->>'sold_qty')::numeric) OR (x->>'returned_qty')::numeric <> trunc((x->>'returned_qty')::numeric) THEN RAISE EXCEPTION '數量必須是整數'; END IF;
  sold:=(x->>'sold_qty')::integer; returned:=(x->>'returned_qty')::integer;
  IF sold < it.sold_qty OR returned < it.returned_qty OR sold+returned > it.qty THEN RAISE EXCEPTION '累計數量不可減少，售出加退回不得超過寄放數量'; END IF;
  UPDATE order_items SET sold_qty=sold,returned_qty=returned WHERE id=it.id;
 END LOOP;
 SELECT coalesce(sum(sold_qty*unit_price),0) INTO due FROM order_items WHERE order_id=p_order;
 UPDATE orders SET net_amount=due,tax_amount=round(due*o.tax_rate/100,2),total_amount=due+round(due*o.tax_rate/100,2),revision=revision+1,payment_status=CASE WHEN due > 0 AND coalesce(paid_amount,0)>=due+round(due*o.tax_rate/100,2) THEN 'paid' ELSE 'unpaid' END WHERE id=p_order;
 INSERT INTO consignment_events(order_id,event_type,details) VALUES(p_order,'settlement',p_items);
END $$;
