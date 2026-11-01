export const categoryImage = id => `/assets/market/categories/${id}-v1.webp`;
export const imageCategories = ['fruit','vegetables','meat','seafood','grains','ready-meals','frozen','dairy','snacks','drinks','bakery','condiments','industrial'];
export const generatedImage = value => imageCategories.some(id => value === categoryImage(id));
export const displayImage = (value,category='fruit') => generatedImage(value)||/^\/market-media\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(value||'') ? value : categoryImage(category);
