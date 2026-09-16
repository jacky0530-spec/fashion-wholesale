DO $$
DECLARE p uuid; v uuid; v2 uuid; doc uuid:=gen_random_uuid(); bad uuid:=gen_random_uuid(); payload jsonb; changed jsonb;
BEGIN
 BEGIN
  INSERT INTO products(name,product_code) VALUES('purchase-test','PO-TEST') RETURNING id INTO p;
  INSERT INTO product_variants(product_id,color,size,stock_qty) VALUES(p,'黑','F',5) RETURNING id INTO v;
  INSERT INTO product_variants(product_id,color,size,stock_qty) VALUES(p,'白','F',1) RETURNING id INTO v2;
  payload:=jsonb_build_object('purchase_date','2026-09-16','supplier','測試供應商','warehouse','測試倉庫','items',jsonb_build_array(jsonb_build_object('variant_id',v,'qty',10,'unit_price',20,'tax_amount',10)));
  PERFORM post_purchase(doc,payload);
  IF NOT EXISTS(SELECT 1 FROM purchases WHERE id=doc AND net_amount=200 AND tax_amount=10 AND total_amount=210 AND purchase_no LIKE 'PO-20260916-%') THEN RAISE EXCEPTION 'purchase total or number failed'; END IF;
  IF (SELECT stock_qty FROM product_variants WHERE id=v)<>15 THEN RAISE EXCEPTION 'stock increment failed'; END IF;
  PERFORM post_purchase(doc,payload);
  IF (SELECT stock_qty FROM product_variants WHERE id=v)<>15 OR (SELECT count(*) FROM purchase_items WHERE purchase_id=doc)<>1 THEN RAISE EXCEPTION 'duplicate request increased stock twice'; END IF;
  BEGIN
   PERFORM post_purchase(doc,jsonb_set(payload,'{supplier}','"changed"'));
   RAISE EXCEPTION USING ERRCODE='Z0002',MESSAGE='changed duplicate accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  BEGIN
   PERFORM post_purchase(bad,jsonb_set(payload,'{items}',jsonb_build_array(jsonb_build_object('variant_id',v,'qty',2,'unit_price',10,'tax_amount',1),jsonb_build_object('variant_id',v2,'qty',-1,'unit_price',20,'tax_amount',1))));
   RAISE EXCEPTION USING ERRCODE='Z0002',MESSAGE='negative quantity accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  IF EXISTS(SELECT 1 FROM purchases WHERE id=bad) OR (SELECT stock_qty FROM product_variants WHERE id=v)<>15 THEN RAISE EXCEPTION 'failed purchase did not roll back'; END IF;
  UPDATE product_variants SET stock_qty=3 WHERE id=v;
  BEGIN
   PERFORM void_purchase(doc);
   RAISE EXCEPTION USING ERRCODE='Z0002',MESSAGE='negative stock void accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  IF (SELECT status FROM purchases WHERE id=doc)<>'posted' THEN RAISE EXCEPTION 'failed void changed status'; END IF;
  UPDATE product_variants SET stock_qty=15 WHERE id=v;
  PERFORM void_purchase(doc);
  PERFORM void_purchase(doc);
  IF (SELECT stock_qty FROM product_variants WHERE id=v)<>5 OR (SELECT status FROM purchases WHERE id=doc)<>'void' THEN RAISE EXCEPTION 'void or idempotent void failed'; END IF;
  PERFORM post_purchase(doc,payload);
  IF (SELECT stock_qty FROM product_variants WHERE id=v)<>5 THEN RAISE EXCEPTION 'voided purchase resurrected'; END IF;
  RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE='rollback successful fixtures';
 EXCEPTION WHEN SQLSTATE 'Z0001' THEN RAISE NOTICE 'PASS: purchase numbers, amounts, stock, idempotency, transaction rollback, void protections'; END;
END $$;
