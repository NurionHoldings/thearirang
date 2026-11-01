import {leaves,categoryNames,departmentFor} from './market-taxonomy.mjs';
import {retailProducts} from './market-retail.mjs';
export const categoryImage = id => `/assets/market/categories/${id}-v1.webp`;
export const imageCategories = ['fruit','vegetables','meat','seafood','grains','ready-meals','frozen','dairy','snacks','drinks','bakery','condiments','industrial'];
export const leafEntries=Object.entries(leaves).flatMap(([category,items])=>items.map(([id,name])=>({category,id,name,...retailProducts[category+'/'+id],src:`/assets/market/leaves/${category}--${id}-retail-v2.webp`})));
export const leafImage=(category,id)=>leafEntries.find(x=>x.category===category&&x.id===id)?.src||categoryImage(category);
export const generatedImage = value => imageCategories.some(id => value === categoryImage(id))||leafEntries.some(x=>x.src===value);
export const displayImage = (value,category='fruit',leaf='') => generatedImage(value)||/^\/market-media\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(value||'') ? value : leafImage(category,leaf);
export function matchingLeafImages(input={}){const words=String(input.search||'').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);return leafEntries.filter(x=>(!input.category||input.category==='all'||x.category===input.category)&&(!input.major||input.major==='all'||departmentFor(x.category)?.id===input.major)&&(!input.leaf||x.id===input.leaf)&&words.every(w=>(x.name+' '+x.title+' '+categoryNames[x.category]).toLocaleLowerCase().includes(w)));}
