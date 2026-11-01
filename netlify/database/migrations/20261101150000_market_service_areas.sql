-- Initial service areas only; no fictional stores, products or stock are seeded.
INSERT INTO market_regions(id,name,province,city,district,dong,city_type,level,aliases,active) VALUES
('11111111-1111-4111-8111-111111111111','대전 동구','대전','대전','동구','','large','district','["daejeon"]',true),
('11111111-1111-4111-8111-111111111112','대전 동구 홍도동','대전','대전','동구','홍도동','large','dong','["daejeon"]',true),
('11111111-1111-4111-8111-111111111113','세종시','세종','세종','','','small','city','["sejong","sejong-si"]',true);
