/**
 * Emoji por alimento, para que cada card se reconozca de un vistazo sin leer.
 *
 * Se resuelve en dos pasos: primero por palabra clave del nombre (reglas en
 * orden, gana la primera), y si ninguna aplica, por la categoria TCAC del
 * producto. El catálogo es colombiano (TCAC 2018 - ICBF), así que las claves
 * usan los nombres locales ("ahuyama", "arepa", "patilla", "arracacha").
 */

// Casi todo el catálogo TCAC termina en ", sin sal" / ", con azucar": son notas
// de preparacion, no el alimento, y arrastrarian el match a 🧂 o 🍬.
const PREP_NOISE = /\b(sin|con) (sal|azucar)\b/g;

/** Minusculas y sin tildes: el catálogo mezcla "maiz"/"maíz" y trae ruido de OCR. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

type Rule = { emoji: string; words: string[] };

// Orden importante: lo especifico va antes que lo genérico. "Huevo de gallina"
// debe dar huevo, no pollo; "Leche de cabra" debe dar leche, no carne de cabra.
const RULES: Rule[] = [
  // Preparaciones con nombre propio que contienen una palabra genérica.
  { emoji: "🍮", words: ["arroz con leche", "arequipe", "natilla", "flan", "manjar blanco"] },

  { emoji: "🥜", words: ["mantequilla de mani", "crema de mani", "mantequilla de almendra"] },

  // Huevos.
  { emoji: "🥚", words: ["huevo", "huevos", "clara de huevo", "yema"] },

  // Lacteos.
  { emoji: "🧀", words: ["queso", "quesito", "cuajada", "requeson"] },
  { emoji: "🧈", words: ["mantequilla", "margarina", "manteca"] },
  { emoji: "🍨", words: ["helado", "paleta", "sorbete"] },
  { emoji: "🥛", words: ["leche", "kumis", "yogur", "yogurt", "lactosuero", "suero costeno"] },

  // Pescados y mariscos.
  { emoji: "🍤", words: ["camaron", "camarones", "langostino"] },
  { emoji: "🦀", words: ["cangrejo", "jaiba"] },
  { emoji: "🦞", words: ["langosta"] },
  { emoji: "🦑", words: ["calamar", "pulpo"] },
  { emoji: "🦪", words: ["almeja", "ostra", "ostion", "mejillon", "caracol", "chipichipi"] },
  {
    emoji: "🐟",
    words: [
      "pescado",
      "atun",
      "sardina",
      "salmon",
      "trucha",
      "tilapia",
      "mojarra",
      "bagre",
      "bocachico",
      "cachama",
      "capaz",
      "arenque",
      "bonito",
      "sierra",
      "pargo",
      "robalo",
      "merluza",
      "nicuro",
      "sabalo",
      "anchoa",
      "corvina",
      "lebranche",
    ],
  },

  // Carnes.
  { emoji: "🌭", words: ["salchicha", "salchichon", "chorizo", "butifarra", "mortadela", "morcilla"] },
  { emoji: "🥓", words: ["tocino", "tocineta", "chicharron", "jamon"] },
  { emoji: "🍔", words: ["hamburguesa"] },
  { emoji: "🍗", words: ["pollo", "gallina", "pechuga", "muslo", "pernil", "alas de pollo"] },
  { emoji: "🦃", words: ["pavo", "pava"] },
  {
    emoji: "🍖",
    words: [
      "cerdo",
      "lechona",
      "cordero",
      "chivo",
      "cabra",
      "conejo",
      "costilla",
      "costillas",
      "curi",
      "chiguiro",
      "armadillo",
      "babilla",
      "pato",
      "codorniz",
    ],
  },
  { emoji: "🥩", words: ["res", "ternera", "carne", "bistec", "lomo", "sobrebarriga", "punta de anca", "higado", "vaca"] },

  // Panaderia y cereales.
  { emoji: "🫓", words: ["arepa", "arepas", "tortilla", "pita"] },
  { emoji: "🍕", words: ["pizza"] },
  { emoji: "🥪", words: ["sandwich", "sanduche"] },
  { emoji: "🌮", words: ["taco", "burrito"] },
  { emoji: "🥟", words: ["empanada", "empanadas", "pastel de yuca"] },
  { emoji: "🫔", words: ["tamal", "tamales", "hallaca", "envuelto"] },
  { emoji: "🍟", words: ["papa a la francesa", "papas fritas", "papitas"] },
  { emoji: "🧇", words: ["waffle", "panqueque", "pancake"] },
  { emoji: "🍩", words: ["dona", "donut", "rosquilla", "bunuelo"] },
  { emoji: "🍪", words: ["galleta", "galletas", "wafer"] },
  { emoji: "🍰", words: ["torta", "ponque", "brownie", "pastel", "cheesecake", "postre", "milhoja"] },
  { emoji: "🍿", words: ["palomitas", "crispetas", "maiz pira"] },
  { emoji: "🍝", words: ["pasta", "espagueti", "espaguetis", "macarron", "macarrones", "fideo", "fideos", "lasana", "lasagna"] },
  { emoji: "🍚", words: ["arroz"] },
  { emoji: "🥣", words: ["avena", "cereal", "granola", "muesli", "hojuelas", "corn flakes"] },
  { emoji: "🌽", words: ["maiz", "mazorca", "choclo"] },
  {
    emoji: "🍞",
    words: ["pan", "panes", "pandebono", "pandeyuca", "almojabana", "croissant", "tostada", "mogolla", "bizcocho", "roscon"],
  },
  { emoji: "🌾", words: ["trigo", "harina", "cebada", "centeno", "quinua", "quinoa", "salvado", "germen", "sagu"] },

  // Frutas.
  { emoji: "🍌", words: ["banano", "platano", "guineo", "patacon", "bocadillo verde"] },
  { emoji: "🍎", words: ["manzana"] },
  { emoji: "🍐", words: ["pera"] },
  { emoji: "🍊", words: ["naranja", "mandarina", "tangelo"] },
  { emoji: "🍋", words: ["limon", "lima"] },
  { emoji: "🍇", words: ["uva", "uvas", "uva pasa", "pasas"] },
  { emoji: "🍓", words: ["fresa", "fresas", "frutilla"] },
  { emoji: "🫐", words: ["mora", "moras", "arandano", "frambuesa", "agraz"] },
  { emoji: "🍉", words: ["sandia", "patilla"] },
  { emoji: "🍈", words: ["melon", "papaya", "guayaba", "guanabana", "chirimoya", "badea"] },
  { emoji: "🍍", words: ["pina", "ananas"] },
  { emoji: "🥭", words: ["mango", "maracuya", "lulo", "curuba", "granadilla", "uchuva", "tomate de arbol", "zapote", "nispero", "mamey"] },
  { emoji: "🍑", words: ["durazno", "melocoton", "nectarina", "albaricoque"] },
  { emoji: "🍒", words: ["cereza", "cerezas"] },
  { emoji: "🥝", words: ["kiwi", "feijoa"] },
  { emoji: "🥥", words: ["coco"] },
  { emoji: "🥑", words: ["aguacate"] },

  // Verduras y tuberculos.
  { emoji: "🍅", words: ["tomate"] },
  { emoji: "🥕", words: ["zanahoria"] },
  { emoji: "🥦", words: ["brocoli", "coliflor"] },
  { emoji: "🥬", words: ["lechuga", "acelga", "espinaca", "repollo", "col", "kale", "berro", "coles"] },
  { emoji: "🧅", words: ["cebolla", "puerro"] },
  { emoji: "🧄", words: ["ajo"] },
  { emoji: "🥔", words: ["papa", "papas", "patata"] },
  { emoji: "🍠", words: ["yuca", "arracacha", "name", "batata", "camote", "malanga", "ibia", "cubio", "ulluco"] },
  { emoji: "🥒", words: ["pepino", "cohombro", "calabacin", "zucchini"] },
  { emoji: "🌶️", words: ["pimenton", "aji", "chile", "paprika"] },
  { emoji: "🍆", words: ["berenjena"] },
  { emoji: "🎃", words: ["ahuyama", "calabaza", "zapallo"] },
  { emoji: "🍄", words: ["champinon", "hongo", "hongos", "seta", "orellana"] },
  { emoji: "🫒", words: ["aceituna", "aceitunas", "aceite"] },
  { emoji: "🫛", words: ["arveja", "arvejas", "guisante", "habichuela", "judia", "vainita"] },

  // Leguminosas, frutos secos y semillas.
  { emoji: "🫘", words: ["frijol", "frijoles", "poroto", "garbanzo", "lenteja", "lentejas", "haba", "habas", "soya", "soja", "tofu"] },
  {
    emoji: "🥜",
    words: [
      "mani",
      "cacahuate",
      "almendra",
      "nuez",
      "nueces",
      "maranon",
      "macadamia",
      "pistacho",
      "avellana",
      "ajonjoli",
      "sesamo",
      "semilla",
      "semillas",
      "chia",
      "linaza",
      "girasol",
      "sacha inchi",
    ],
  },

  // Dulces.
  { emoji: "🍫", words: ["chocolate", "chocolatina", "cacao", "cocoa"] },
  { emoji: "🍯", words: ["miel"] },
  {
    emoji: "🍬",
    words: ["azucar", "panela", "melaza", "caramelo", "caramelos", "confite", "confites", "dulce", "bocadillo", "cocada", "mermelada", "gelatina"],
  },

  // Bebidas.
  { emoji: "☕", words: ["cafe", "tinto", "capuchino"] },
  { emoji: "🍵", words: ["te", "aromatica", "infusion", "manzanilla"] },
  { emoji: "🍺", words: ["cerveza"] },
  { emoji: "🍷", words: ["vino"] },
  { emoji: "🥃", words: ["aguardiente", "ron", "whisky", "licor", "sabajon", "guarapo", "chicha", "brandy", "vodka"] },
  { emoji: "🧃", words: ["jugo", "nectar", "limonada", "refajo"] },
  { emoji: "🥤", words: ["gaseosa", "bebida", "batido", "malteada", "smoothie", "proteína", "whey"] },
  { emoji: "💧", words: ["agua"] },

  // Preparados y condimentos.
  { emoji: "🍲", words: ["sopa", "caldo", "sancocho", "ajiaco", "mondongo", "guiso", "estofado", "crema de"] },
  { emoji: "🥗", words: ["ensalada"] },
  { emoji: "🌿", words: ["cilantro", "perejil", "albahaca", "oregano", "laurel", "hierba", "hierbabuena", "guascas", "tomillo"] },
  { emoji: "🥫", words: ["salsa", "mayonesa", "mostaza", "ketchup", "aderezo", "enlatado", "conserva", "encurtido"] },
  { emoji: "🧂", words: ["sal", "vinagre", "comino", "pimienta", "canela", "curcuma", "achiote", "clavo", "condimento", "especias"] },
];

/** Fallback por categoria del catálogo TCAC cuando el nombre no dice nada útil. */
const CATEGORY_EMOJI: Array<[string, string]> = [
  ["cereales", "🌾"],
  ["verduras", "🥬"],
  ["hortalizas", "🥬"],
  ["frutas", "🍎"],
  ["carnes", "🥩"],
  ["pescados", "🐟"],
  ["mariscos", "🐟"],
  ["leche", "🥛"],
  ["huevos", "🥚"],
  ["leguminosas", "🫘"],
  ["grasas", "🫒"],
  ["aceites", "🫒"],
  ["azucarados", "🍬"],
  ["bebidas", "🥤"],
  ["preparados", "🍲"],
  ["nativos", "🌿"],
  ["miscelaneos", "🧂"],
  ["manufacturados", "🥫"],
  ["regimenes especiales", "🥫"],
];

export const DEFAULT_FOOD_EMOJI = "🍽️";

// Una regex por regla, compilada una sola vez. Se exige frontera de palabra
// para que "pan" no matchee "panela" ni "papa" matchee "papaya".
const COMPILED: Array<{ emoji: string; re: RegExp }> = RULES.map((rule) => ({
  emoji: rule.emoji,
  re: new RegExp(`(^|[^a-z0-9])(${rule.words.map(escapeRegExp).join("|")})([^a-z0-9]|$)`),
}));

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Emoji representativo del alimento. Nunca vacio: si no hay match ni categoria
 * conocida devuelve `DEFAULT_FOOD_EMOJI`.
 */
export function foodEmoji(name: string, category?: string | null): string {
  const haystack = normalize(name || "").replace(PREP_NOISE, " ");
  if (haystack) {
    for (const rule of COMPILED) {
      if (rule.re.test(haystack)) return rule.emoji;
    }
  }

  const cat = normalize(category || "");
  if (cat) {
    for (const [key, emoji] of CATEGORY_EMOJI) {
      if (cat.includes(key)) return emoji;
    }
  }

  return DEFAULT_FOOD_EMOJI;
}
