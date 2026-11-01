-- Existing products retain an unspecified leaf; never infer a classification from a title.
ALTER TABLE market_products ADD COLUMN subcategory text NOT NULL DEFAULT '';
CREATE INDEX market_products_category_leaf ON market_products(category,subcategory) WHERE active=true AND deleted=false;
