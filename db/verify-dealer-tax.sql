DO $$
DECLARE c uuid; p uuid; v uuid; o uuid; item uuid; old_o uuid; old_item uuid;
BEGIN
 BEGIN
  INSERT INTO customers(name,sale_mode) VALUES('tax-verification','buyout') RETURNING id INTO c;
  IF (SELECT discount FROM customers WHERE id=c) <> 5.5 THEN RAISE EXCEPTION 'buyout default discount'; END IF;
  INSERT INTO products(name,retail_price) VALUES('tax-verification',100) RETURNING id INTO p;
  INSERT INTO product_variants(product_id,color,size) VALUES(p,'黑','F') RETURNING id INTO v;
  o:=create_dealer_order(c,'test',jsonb_build_array(jsonb_build_object('variant_id',v,'qty',1,'price',55)),5.5,'buyout');
  IF NOT EXISTS(SELECT 1 FROM orders WHERE id=o AND net_amount=55 AND tax_amount=2.75 AND total_amount=57.75 AND goods_amount=57.75 AND tax_rate=5) THEN RAISE EXCEPTION 'buyout 55 + 5%% failed'; END IF;
  UPDATE customers SET sale_mode='consignment',discount=6 WHERE id=c;
  o:=create_dealer_order(c,'test',jsonb_build_array(jsonb_build_object('variant_id',v,'qty',10,'price',60)),6,'consignment');
  IF NOT EXISTS(SELECT 1 FROM orders WHERE id=o AND net_amount=0 AND tax_amount=0 AND total_amount=0 AND goods_amount=630) THEN RAISE EXCEPTION 'unsold consignment tax charged'; END IF;
  UPDATE orders SET status='shipped' WHERE id=o;
  SELECT id INTO item FROM order_items WHERE order_id=o;
  PERFORM settle_consignment(o,0,jsonb_build_array(jsonb_build_object('id',item,'sold_qty',3,'returned_qty',2)));
  IF NOT EXISTS(SELECT 1 FROM orders WHERE id=o AND net_amount=180 AND tax_amount=9 AND total_amount=189) THEN RAISE EXCEPTION 'first sell-through tax failed'; END IF;
  PERFORM collect_order(o,1,true);
  PERFORM settle_consignment(o,2,jsonb_build_array(jsonb_build_object('id',item,'sold_qty',5,'returned_qty',2)));
  IF NOT EXISTS(SELECT 1 FROM orders WHERE id=o AND net_amount=300 AND tax_amount=15 AND total_amount=315 AND paid_amount=189 AND total_amount-paid_amount=126) THEN RAISE EXCEPTION 'partial collection tax failed'; END IF;
  -- Simulate a pre-tax deployment consignment; later sales must preserve its zero rate.
  INSERT INTO orders(customer_id,sale_mode,status,total_amount,paid_amount,goods_amount) VALUES(c,'consignment','shipped',0,0,600) RETURNING id INTO old_o;
  INSERT INTO order_items(order_id,variant_id,qty,unit_price) VALUES(old_o,v,10,60) RETURNING id INTO old_item;
  PERFORM settle_consignment(old_o,0,jsonb_build_array(jsonb_build_object('id',old_item,'sold_qty',1,'returned_qty',0)));
  IF NOT EXISTS(SELECT 1 FROM orders WHERE id=old_o AND total_amount=60 AND tax_amount=0 AND tax_rate=0) THEN RAISE EXCEPTION 'legacy order retroactively taxed'; END IF;
  RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE='rollback verified fixtures';
 EXCEPTION WHEN SQLSTATE 'Z0001' THEN RAISE NOTICE 'PASS: buyout default, 55%% and 60%% net prices, tax, partial collection, legacy'; END;
END $$;
