# Parser stock fixtures (T60 measurement)

Raw Woo Store API / Shopify `products.json` bodies with in-stock + out-of-stock rows.
T58 ships them as the golden vara; T60 wires `parse_woo_store_api` /
`parse_shopify_suggest_or_products` against these files (and variant dedupe on
`tuning/iphone-15.json` + `tuning/perfume.json` `variantGroup` / `inStock` fields).

⊥ change ranking metrics until T60 lands — optional fields are ignored by T58 replay.
