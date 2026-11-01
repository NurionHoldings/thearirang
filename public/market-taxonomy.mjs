// Shared public taxonomy. Existing category IDs remain the middle classification.
export const departments = [
  {
    id: "fresh",
    name: "신선식품",
    note: "과일·채소·정육·수산",
    icon: "◉",
    categories: ["fruit", "vegetables", "meat", "seafood"],
  },
  {
    id: "meals",
    name: "간편한 한 끼",
    note: "간편식·밀키트·냉동",
    icon: "◒",
    categories: ["ready-meals", "frozen"],
  },
  {
    id: "daily",
    name: "아침과 간식",
    note: "유제품·베이커리·과자",
    icon: "◑",
    categories: ["dairy", "bakery", "snacks"],
  },
  {
    id: "pantry",
    name: "주방의 기본",
    note: "쌀·잡곡·음료·양념",
    icon: "▤",
    categories: ["grains", "drinks", "condiments"],
  },
];
export const categoryNames = {
  fruit: "과일",
  vegetables: "채소",
  meat: "정육·계란",
  seafood: "수산",
  dairy: "유제품",
  grains: "쌀·잡곡",
  "ready-meals": "간편식·밀키트",
  frozen: "냉동식품",
  snacks: "과자·간식",
  drinks: "생수·음료",
  bakery: "베이커리",
  condiments: "양념·소스",
};
export const leaves = {
  fruit: [
    ["apple-pear", "사과·배"],
    ["citrus", "감귤·오렌지"],
    ["berries", "딸기·베리"],
    ["tropical", "바나나·열대과일"],
    ["other-fruit", "기타 과일"],
  ],
  vegetables: [
    ["leafy", "잎채소"],
    ["root", "뿌리채소"],
    ["mushroom", "버섯"],
    ["salad", "샐러드·손질채소"],
    ["other-vegetables", "기타 채소"],
  ],
  meat: [
    ["pork", "돼지고기"],
    ["beef", "소고기"],
    ["poultry", "닭·오리"],
    ["eggs", "계란"],
  ],
  seafood: [
    ["fish", "생선"],
    ["shellfish", "해산물·조개"],
    ["dried-seafood", "건어물·해조류"],
  ],
  dairy: [
    ["milk", "우유"],
    ["yogurt", "요거트"],
    ["cheese", "치즈·버터"],
  ],
  grains: [
    ["rice", "쌀"],
    ["mixed-grains", "잡곡·콩"],
    ["powder", "가루·분말"],
  ],
  "ready-meals": [
    ["meal-kit", "밀키트"],
    ["rice-meal", "즉석밥·도시락"],
    ["soup", "국·탕·찌개"],
    ["side-dish", "반찬"],
  ],
  frozen: [
    ["dumplings", "만두"],
    ["fried", "튀김·냉동간편식"],
    ["ice-cream", "아이스크림"],
  ],
  snacks: [
    ["cookies", "과자·쿠키"],
    ["nuts", "견과류"],
    ["chocolate", "초콜릿·캔디"],
  ],
  drinks: [
    ["water", "생수"],
    ["juice", "주스·음료"],
    ["coffee-tea", "커피·차"],
  ],
  bakery: [
    ["bread", "식빵·빵"],
    ["cake", "케이크·디저트"],
    ["jam", "잼·스프레드"],
  ],
  condiments: [
    ["sauce", "소스·드레싱"],
    ["paste", "장류"],
    ["oil", "식용유·오일"],
    ["seasoning", "조미료"],
  ],
};
export const departmentFor = (category) =>
  departments.find((d) => d.categories.includes(category));
export const validLeaf = (category, leaf) =>
  leaf === "" || !!leaves[category]?.some(([id]) => id === leaf);
export const leafName = (category, leaf) =>
  leaves[category]?.find(([id]) => id === leaf)?.[1] || "";
export function normalizeBrowse(input = {}) {
  let category = categoryNames[input.category] ? input.category : "all";
  let major = departments.some((d) => d.id === input.major)
    ? input.major
    : "all";
  if (category !== "all") major = departmentFor(category).id;
  const leaf =
    category !== "all" && validLeaf(category, input.leaf) && input.leaf
      ? input.leaf
      : "";
  return {
    major,
    category,
    leaf,
    search: String(input.search || "")
      .trim()
      .slice(0, 120),
    sort: ["recommended", "price-asc", "price-desc", "name"].includes(
      input.sort,
    )
      ? input.sort
      : "recommended",
  };
}
export function filterProducts(products, input) {
  const b = normalizeBrowse(input),
    terms = b.search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const rows = products.filter(
    (p) =>
      (b.major === "all" || departmentFor(p.category)?.id === b.major) &&
      (b.category === "all" || p.category === b.category) &&
      (!b.leaf || p.subcategory === b.leaf) &&
      terms.every((t) =>
        [
          p.title,
          p.unit,
          p.origin,
          p.description,
          p.storeName,
          categoryNames[p.category],
          leafName(p.category, p.subcategory),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(t),
      ),
  );
  if (b.sort === "price-asc") rows.sort((a, b) => a.price - b.price);
  else if (b.sort === "price-desc") rows.sort((a, b) => b.price - a.price);
  else if (b.sort === "name")
    rows.sort((a, b) => a.title.localeCompare(b.title, "ko"));
  return rows;
}
