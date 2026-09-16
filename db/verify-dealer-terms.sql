DO $$
DECLARE cid uuid; pid uuid; vid uuid; oid uuid; iid uuid; buyid uuid; details jsonb; actual numeric; rev integer;
BEGIN
 BEGIN
  INSERT INTO customers(name,sale_mode,discount) VALUES('verification-dealer','consignment',6.5) RETURNING id INTO cid;
  INSERT INTO products(name,retail_price,category) VALUES('verification-socks',100,'襪子') RETURNING id INTO pid;
  INSERT INTO product_variants(product_id,color,size,stock_qty) VALUES(pid,'黑色','F',100) RETURNING id INTO vid;
  details:=jsonb_build_array(jsonb_build_object('variant_id',vid,'qty',10,'price',65));
  oid:=create_dealer_order(cid,'verification',details,6.5,'consignment');
  IF (SELECT total_amount FROM orders WHERE id=oid) <> 0 OR (SELECT goods_amount FROM orders WHERE id=oid) <> 682.5 THEN RAISE EXCEPTION 'FAIL: unsold goods counted as sales'; END IF;
  SELECT id INTO iid FROM order_items WHERE order_id=oid;
  BEGIN
   PERFORM collect_order(oid,0,true);
   RAISE EXCEPTION USING ERRCODE='Z0002',MESSAGE='FAIL: allowed collecting unsold goods';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  UPDATE orders SET status='shipped' WHERE id=oid;
  PERFORM settle_consignment(oid,0,jsonb_build_array(jsonb_build_object('id',iid,'sold_qty',3,'returned_qty',2)));
  IF (SELECT total_amount FROM orders WHERE id=oid) <> 204.75 THEN RAISE EXCEPTION 'FAIL: 3 sold should owe 204.75'; END IF;
  PERFORM collect_order(oid,1,true);
  IF (SELECT paid_amount FROM orders WHERE id=oid) <> 204.75 THEN RAISE EXCEPTION 'FAIL: first payment'; END IF;
  BEGIN
   PERFORM settle_consignment(oid,1,jsonb_build_array(jsonb_build_object('id',iid,'sold_qty',4,'returned_qty',2)));
   RAISE EXCEPTION USING ERRCODE='Z0002',MESSAGE='FAIL: accepted stale revision';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  BEGIN
   PERFORM settle_consignment(oid,2,jsonb_build_array(jsonb_build_object('id',iid,'sold_qty',9,'returned_qty',2)));
   RAISE EXCEPTION USING ERRCODE='Z0002',MESSAGE='FAIL: accepted excess sold quantity';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  BEGIN
   PERFORM settle_consignment(oid,2,jsonb_build_array(jsonb_build_object('id',iid,'sold_qty',2,'returned_qty',2)));
   RAISE EXCEPTION USING ERRCODE='Z0002',MESSAGE='FAIL: allowed reducing settled sales';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  PERFORM settle_consignment(oid,2,jsonb_build_array(jsonb_build_object('id',iid,'sold_qty',5,'returned_qty',2)));
  IF (SELECT total_amount-paid_amount FROM orders WHERE id=oid) <> 136.5 OR (SELECT payment_status FROM orders WHERE id=oid) <> 'unpaid' THEN RAISE EXCEPTION 'FAIL: partial collections'; END IF;
  PERFORM collect_order(oid,3,true);
  PERFORM settle_consignment(oid,4,jsonb_build_array(jsonb_build_object('id',iid,'sold_qty',5,'returned_qty',2)));
  IF (SELECT total_amount-paid_amount FROM orders WHERE id=oid) <> 0 THEN RAISE EXCEPTION 'FAIL: cumulative resubmission charged twice'; END IF;
  UPDATE customers SET discount=7,sale_mode='buyout' WHERE id=cid;
  UPDATE products SET retail_price=200 WHERE id=pid;
  IF (SELECT unit_price FROM order_items WHERE id=iid) <> 65 OR (SELECT discount FROM orders WHERE id=oid) <> 6.5 THEN RAISE EXCEPTION 'FAIL: historical price changed'; END IF;
  details:=jsonb_build_array(jsonb_build_object('variant_id',vid,'qty',2,'price',140));
  buyid:=create_dealer_order(cid,'verification',details,7,'buyout');
  IF (SELECT total_amount FROM orders WHERE id=buyid) <> 294 THEN RAISE EXCEPTION 'FAIL: buyout discount'; END IF;
  PERFORM collect_order(buyid,0,true);
  PERFORM collect_order(buyid,1,false);
  IF (SELECT paid_amount FROM orders WHERE id=buyid) <> 0 THEN RAISE EXCEPTION 'FAIL: buyout payment cancel'; END IF;
  BEGIN
   PERFORM create_dealer_order(cid,'bad',jsonb_build_array(jsonb_build_object('variant_id',vid,'qty',2,'price',1)),7,'buyout');
   RAISE EXCEPTION USING ERRCODE='Z0002',MESSAGE='FAIL: accepted tampered price';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  IF (SELECT count(*) FROM orders WHERE customer_id=cid) <> 2 THEN RAISE EXCEPTION 'FAIL: failed order not rolled back'; END IF;
  RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE='PASS and rollback test data';
 EXCEPTION WHEN SQLSTATE 'Z0001' THEN RAISE NOTICE 'PASS: discounted pricing, consignment sales, returns, partial collections, concurrency, historical prices, rollback';
 END;
END $$;
