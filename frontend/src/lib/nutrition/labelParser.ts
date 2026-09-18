/**
 * Parser de etiquetas nutricionales colombianas — funcion pura.
 *
 * Sin red, sin React, sin `Date.now()`, sin estado global: recibe líneas de
 * texto (tal como las entrega un OCR on-device, ver doc `modulo-dieta.md`
 * #6.5) y devuelve los campos reconocidos con un nivel de confianza cada uno.
 * El OCR **propone**, nunca decide: todo lo que sale de aquí debe llegar a un
 * formulario editable por el usuario (regla de UX del flujo de captura).
 *
 * Decisiones de diseno que vale la pena dejar explicitas:
 *
 * - Coma decimal: en Colombia `12,5` es 12.5, no "12 mil quinientos". Si el
 *   texto trae punto Y coma ("1.234,5") asumimos formato latino: el punto es
 *   separador de miles. Si trae SOLO puntos en grupos de exactamente 3 digitos
 *   ("1.200") también se asume separador de miles (nunca vemos decimales de
 *   3 cifras en una etiqueta de nutrición). Cualquier otro punto se trata como
 *   decimal. Ver `parseDecimalNumber`.
 * - `%VD` / `%VR`: el número pegado a un simbolo `%` se descarta ANTES de
 *   buscar valores nutricionales en la línea, para que "10" en
 *   "Sodio 230 mg 10 %VD" nunca se confunda con un valor de sodio.
 * - Doble columna «por porción» / «por 100 g» **o «por 100 ml»**: el formato
 *   estandar colombiano lista primero la columna de porcion y después la de
 *   100 unidades (en ese orden). Toda la categoria liquida (leche, yogur
 *   bebible, jugos, gaseosas) declara `100 ml`, no `100 g` — tratarla como
 *   `per_100g` no revienta nada, solo deja los valores mal etiquetados (y
 *   numericamente identicos: el error es silencioso). Cuando se detecta un
 *   encabezado de doble columna se registra la unidad detectada y la base
 *   expuesta pasa a `per_100g`/`per_100ml` según corresponda (ya viene
 *   normalizada, no hay que calcular nada) y se toma el *segundo* número de
 *   cada fila. Si una fila solo trae un número (falta de OCR en una celda) se
 *   usa ese único valor con confianza baja.
 * - Ruido de OCR: se le quitan tildes de forma agresiva (NFD + remover
 *   marcas) antes de intentar reconocer nombres de campo, lo que resuelve de
 *   una sola pasada "Proteína"/"Energía" sin tilde. Para el par O/0 se
 *   corrigen ambas direcciones por separado: dentro de una corrida de digitos
 *   ("23O" -> "230") y dentro de una palabra ("PR0TEINA" -> "PROTEÍNA"),
 *   porque son errores en sentidos opuestos y conviven en la misma línea. La
 *   segunda correccion también evita que un "0" perdido en medio de una
 *   palabra ("t0tal") se lea como si fuera un valor nutricional.
 */

import { MICRONUTRIENT_ALIASES } from "./micronutrients";
import type {
  ConfidenceLevel,
  MacroFields,
  MacroKey,
  MicronutrientFields,
  MicronutrientKey,
  NutritionBase,
  ParsedField,
  ParsedLabel,
} from "./types";

const KJ_TO_KCAL = 4.184;

type Candidate = { value: number; confidence: ConfidenceLevel };

/** La base que le corresponde a la segunda columna de una tabla de doble columna. */
type DualColumnBase = Extract<NutritionBase, "per_100g" | "per_100ml">;

// ---------------------------------------------------------------------------
// Normalizacion de texto y números
// ---------------------------------------------------------------------------

/** Quita tildes/diacriticos: "Información" -> "Información". */
function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Corrige confusiones O/0 dentro de corridas numericas: "23O" -> "230",
 * "1O0" -> "100", "5,O" -> "5,0" (una "O" pegada a una coma/punto decimal
 * también cuenta como corrida numerica). Busca tramos formados solo por
 * digitos, "O"/"o" y separadores `,`/`.`, y solo toca la "O" cuando ese
 * tramo contiene al menos un digito real — así nunca se mete con una palabra
 * normal (esas se corrigen aparte, ver `fixStrayZerosInWords`).
 */
function fixDigitsInLine(line: string): string {
  return line.replace(/[0-9Oo.,]{2,}|\d/g, (run) => (/\d/.test(run) ? run.replace(/[Oo]/g, "0") : run));
}

/**
 * Corrige el caso inverso: un "0" que en realidad era una "o" dentro de una
 * palabra (ej. "PR0TEINA" -> "PROTEÍNA", "carb0hidrat0s" -> "carbohidratos").
 * Insensible a mayusculas porque se aplica ANTES de normalizar a minusculas:
 * este resultado se reusa tanto para el matching de campos como para la
 * extraccion de números, y en esta última nos interesa conservar el resto de
 * la línea intacto.
 */
function fixStrayZerosInWords(text: string): string {
  return text
    .replace(/(?<=[a-zA-Z])0(?=[a-zA-Z])/g, "o")
    .replace(/(?<=[a-zA-Z])0\b/g, "o")
    .replace(/\b0(?=[a-zA-Z])/g, "o");
}

/** Texto listo para hacer match de nombres de campo: minusculas, sin tildes, sin espacios raros. */
function normalizeForMatch(cleanedLine: string): string {
  return stripAccents(cleanedLine).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Convierte un token numerico ya aislado ("12,5", "1.200", "1.234,5") a
 * `number`. Ver las reglas de coma/punto en el comentario del archivo.
 */
function parseDecimalNumber(rawToken: string): number | null {
  const token = rawToken.trim();
  if (!token) return null;

  const hasComma = token.includes(",");
  const hasDot = token.includes(".");
  let normalized = token;

  if (hasComma && hasDot) {
    // formato latino con miles: "1.234,5" -> 1234.5
    normalized = token.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    // separador decimal estandar colombiano: "12,5" -> 12.5
    normalized = token.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(token)) {
    // solo puntos, en grupos exactos de 3 digitos: separador de miles ("1.200" -> 1200)
    normalized = token.replace(/\./g, "");
  }
  // en cualquier otro caso (ej. "230", "12.5" con un solo grupo de decimales) el punto ya funciona como decimal en JS

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const NUMBER_RUN = /\d[\d.,]*\d|\d/g;

/**
 * Extrae los números "nutricionales" de una línea, excluyendo:
 *  - cualquier valor pegado a un `%` (ruido de %VD/%VR).
 *  - cualquier corrida de digitos pegada SIN espacio a una letra anterior,
 *    ej. el "12" de "Vitamina B12": eso es parte del nombre del campo, no un
 *    valor. Una unidad pegada DESPUÉS ("30g") si se acepta, es formato comun.
 * Devuelve los candidatos en el orden en que aparecen en la línea.
 * `lineWasAdjusted` indica si `fixDigitsInLine` tuvo que corregir una
 * confusion O/0 en esta línea; si es así, ningun valor puede salir con
 * confianza "high" porque hubo que adivinar un digito.
 */
function extractLineNumbers(cleanedLine: string, lineWasAdjusted: boolean): Candidate[] {
  const withoutPercentValues = cleanedLine.replace(/\d[\d.,]*\s*%/g, " ");
  const candidates: Candidate[] = [];
  for (const match of withoutPercentValues.matchAll(NUMBER_RUN)) {
    const index = match.index ?? 0;
    const precedingChar = index > 0 ? withoutPercentValues[index - 1] : "";
    if (/[a-zA-Z]/.test(precedingChar)) continue;
    const value = parseDecimalNumber(match[0]);
    if (value !== null) {
      candidates.push({ value, confidence: lineWasAdjusted ? "medium" : "high" });
    }
  }
  return candidates;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const CONFIDENCE_ORDER: ConfidenceLevel[] = ["high", "medium", "low"];

function downgrade(level: ConfidenceLevel, to: ConfidenceLevel): ConfidenceLevel {
  const idx = Math.max(CONFIDENCE_ORDER.indexOf(level), CONFIDENCE_ORDER.indexOf(to));
  return CONFIDENCE_ORDER[idx];
}

// ---------------------------------------------------------------------------
// Preprocesado de líneas
// ---------------------------------------------------------------------------

/**
 * El OCR a veces separa una etiqueta de su valor en dos líneas contiguas
 * (ej. "Proteína" / "8,5 g 12%VD"). Si una línea no tiene ningun digito y la
 * siguiente empieza directo con uno, se fusionan en una sola línea logica.
 *
 * Para decidir "no tiene ningun digito" hay que limpiar antes: una línea
 * como "PR0TEINA" (la "O" de "Proteína" mal leida como cero) tiene un "0"
 * literal pero NO es un número, es puro ruido de palabra. Sin esta limpieza
 * el heuristico de fusion nunca dispara para ese caso y el valor de la
 * siguiente línea queda huerfano.
 */
function mergeWrappedLines(lines: string[]): string[] {
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    const next = lines[i + 1];
    const currentHasDigit = /\d/.test(fixStrayZerosInWords(fixDigitsInLine(current)));
    if (!currentHasDigit && next !== undefined && /^\s*\d/.test(next)) {
      merged.push(`${current} ${next}`);
      i++;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Reconocimiento de encabezados
// ---------------------------------------------------------------------------

const SERVING_SIZE_HEADER = /tamano\s+(de\s+)?porcion/;
const SERVINGS_PER_CONTAINER_HEADER = /porciones\s+por\s+envase/;
// doble columna: la línea menciona "porcion" y una columna de 100 unidades.
// El ruido tipico de OCR en el número ("1O0", "10O") ya llega resuelto aquí:
// `fixDigitsInLine` corrige esa confusion O/0 antes de esta etapa. El
// espaciado irregular también ya viene colapsado por `normalizeForMatch`.
const DUAL_COLUMN_PORCION_WORD = /\bporcion\b/;
const DUAL_COLUMN_UNIT = /\b100\s*(g|ml)\b/;
const ENERGY_LINE = /\b(energia|calorias?)\b/;

// ---------------------------------------------------------------------------
// Campos de macronutrientes
// ---------------------------------------------------------------------------

const MACRO_PATTERNS: ReadonlyArray<{ key: MacroKey; regex: RegExp; label: string }> = [
  // azucares anadidos SIEMPRE antes que azucares a secas: "anadidos" contiene "azucares"
  { key: "addedSugarsG", regex: /azucares?\s+anadid/, label: "Azucares anadidos" },
  { key: "sugarsG", regex: /\bazucares?\b/, label: "Azucares" },
  { key: "fatSaturatedG", regex: /grasas?\s+saturad/, label: "Grasa saturada" },
  { key: "fatTransG", regex: /grasas?\s+trans\b/, label: "Grasas trans" },
  { key: "fatTotalG", regex: /grasas?\s+total/, label: "Grasa total" },
  { key: "cholesterolMg", regex: /colesterol/, label: "Colesterol" },
  { key: "sodiumMg", regex: /\bsodio\b/, label: "Sodio" },
  { key: "fiberG", regex: /\bfibra\b/, label: "Fibra dietaria" },
  { key: "carbsTotalG", regex: /(carbohidratos?\s+total|hidratos\s+de\s+carbono)/, label: "Carbohidratos totales" },
  { key: "proteinG", regex: /proteina/, label: "Proteína" },
];

// ---------------------------------------------------------------------------
// Energía: kJ y/o kcal en la misma línea
// ---------------------------------------------------------------------------

/**
 * Devuelve los valores de energía encontrados en la línea, ya convertidos a
 * kcal y en el orden en que aparecen (relevante para doble columna). Si la
 * línea trae kcal explicito se usa eso; solo se recurre a kJ/4.184 cuando no
 * hay ningun "kcal" en la línea.
 */
function extractEnergyCandidates(digitFixedLine: string, lineWasAdjusted: boolean): Candidate[] {
  const kcalMatches = [...digitFixedLine.matchAll(/(\d[\d.,]*)\s*k?cal\b/gi)];
  const source = kcalMatches.length > 0 ? kcalMatches : [...digitFixedLine.matchAll(/(\d[\d.,]*)\s*kj\b/gi)];
  const isKj = kcalMatches.length === 0;

  const candidates: Array<{ pos: number; candidate: Candidate }> = [];
  for (const match of source) {
    const rawValue = parseDecimalNumber(match[1]);
    if (rawValue === null) continue;
    const value = isKj ? round1(rawValue / KJ_TO_KCAL) : rawValue;
    let confidence: ConfidenceLevel = isKj ? "medium" : "high";
    if (lineWasAdjusted) confidence = downgrade(confidence, "medium");
    candidates.push({ pos: match.index ?? 0, candidate: { value, confidence } });
  }
  return candidates.sort((a, b) => a.pos - b.pos).map((c) => c.candidate);
}

// ---------------------------------------------------------------------------
// Micronutrientes
// ---------------------------------------------------------------------------

function matchMicronutrientAlias(normalizedText: string): MicronutrientKey | null {
  for (const [alias, key] of MICRONUTRIENT_ALIASES) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(normalizedText)) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Selección de columna (simple o doble)
// ---------------------------------------------------------------------------

function pickColumnValue(candidates: Candidate[], dualColumn: boolean, warnings: string[], fieldLabel: string): ParsedField | null {
  if (candidates.length === 0) return null;
  if (!dualColumn) return candidates[0];
  if (candidates.length >= 2) return candidates[1]; // orden estandar: porcion primero, 100 g después
  warnings.push(`"${fieldLabel}": se esperaban dos columnas pero solo se hallo un valor; se uso el único disponible.`);
  return { value: candidates[0].value, confidence: "low" };
}

// ---------------------------------------------------------------------------
// Normalizacion a 100 unidades (g o ml, según la base detectada)
// ---------------------------------------------------------------------------

function computeNormalizedTo100(
  macros: MacroFields,
  base: NutritionBase,
  servingSizeG: number | null,
  warnings: string[],
): MacroFields {
  if (base === "per_100g" || base === "per_100ml") {
    // ya viene normalizada (columna de 100 g o de 100 ml): no hay nada que calcular
    return { ...macros };
  }
  // base === "per_serving": solo sabemos escalar cuando la porcion esta en
  // gramos. Una porcion en ml (leche, jugo, gaseosa de columna simple) NO se
  // normaliza aquí: no hay doble columna que confirme la lectura, así que es
  // mejor no calcular nada a arriesgar un valor mal etiquetado en silencio.
  if (servingSizeG === null || servingSizeG <= 0) {
    warnings.push("No fue posible normalizar a 100 unidades: no se reconocio el tamano de porcion en gramos.");
    return {};
  }
  const factor = 100 / servingSizeG;
  const normalized: MacroFields = {};
  for (const key of Object.keys(macros) as MacroKey[]) {
    const field = macros[key];
    if (!field) continue;
    normalized[key] = {
      value: round1(field.value * factor),
      // el calculo introduce una fuente de error extra (tamano de porcion, redondeo)
      confidence: downgrade(field.confidence, "medium"),
    };
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Parser principal
// ---------------------------------------------------------------------------

export function parseNutritionLabel(lines: string[]): ParsedLabel {
  const warnings: string[] = [];
  const cleanedLines = mergeWrappedLines(lines.map((line) => line.trim()).filter((line) => line.length > 0));

  let servingSizeG: number | null = null;
  let servingSizeRaw: string | null = null;
  let servingsPerContainer: number | null = null;
  // null = no se detecto doble columna; si se detecta, guarda la base que le
  // corresponde a la SEGUNDA columna ("per_100g" o "per_100ml") según la
  // unidad que declare el encabezado.
  let dualColumnBase: DualColumnBase | null = null;

  const macros: MacroFields = {};
  const micronutrients: MicronutrientFields = {};

  for (const raw of cleanedLines) {
    const digitFixed = fixDigitsInLine(raw);
    const lineWasAdjusted = digitFixed !== raw;
    // `cleaned` corrige además los "0" que en realidad eran "o" dentro de una
    // palabra (ej. "t0tal"). Se usa tanto para el matching de campos como
    // para la extraccion de números: si no se hiciera aquí, un "0" perdido en
    // medio de una palabra se colaria como si fuera el valor nutricional.
    const cleaned = fixStrayZerosInWords(digitFixed);
    const text = normalizeForMatch(cleaned);

    let isHeaderLine = false;

    if (SERVING_SIZE_HEADER.test(text)) {
      servingSizeRaw = raw;
      const gramsMatch = cleaned.match(/(\d[\d.,]*)\s*g\b/i);
      if (gramsMatch) {
        const parsed = parseDecimalNumber(gramsMatch[1]);
        if (parsed !== null) servingSizeG = parsed;
      }
      isHeaderLine = true;
    }
    if (SERVINGS_PER_CONTAINER_HEADER.test(text)) {
      const numbers = extractLineNumbers(cleaned, lineWasAdjusted);
      if (numbers.length > 0) servingsPerContainer = Math.round(numbers[0].value);
      isHeaderLine = true;
    }
    if (DUAL_COLUMN_PORCION_WORD.test(text)) {
      const unitMatch = text.match(DUAL_COLUMN_UNIT);
      if (unitMatch) {
        dualColumnBase = unitMatch[1] === "ml" ? "per_100ml" : "per_100g";
        isHeaderLine = true;
      }
    }
    if (isHeaderLine) continue;

    const isDualColumn = dualColumnBase !== null;

    if (!macros.energyKcal && ENERGY_LINE.test(text)) {
      const candidates = extractEnergyCandidates(cleaned, lineWasAdjusted);
      const field = pickColumnValue(candidates, isDualColumn, warnings, "Energía");
      if (field) macros.energyKcal = field;
      continue;
    }

    const macroPattern = MACRO_PATTERNS.find((pattern) => pattern.regex.test(text));
    if (macroPattern) {
      if (!macros[macroPattern.key]) {
        const candidates = extractLineNumbers(cleaned, lineWasAdjusted);
        const field = pickColumnValue(candidates, isDualColumn, warnings, macroPattern.label);
        if (field) macros[macroPattern.key] = field;
      }
      continue;
    }

    const microKey = matchMicronutrientAlias(text);
    if (microKey && !micronutrients[microKey]) {
      const candidates = extractLineNumbers(cleaned, lineWasAdjusted);
      const field = pickColumnValue(candidates, isDualColumn, warnings, microKey);
      if (field) micronutrients[microKey] = field;
    }
  }

  let base: NutritionBase;
  let baseConfidence: ConfidenceLevel;
  if (dualColumnBase !== null) {
    // la segunda columna ya viene normalizada (100 g o 100 ml, según se detecto)
    base = dualColumnBase;
    baseConfidence = "high";
  } else if (servingSizeRaw !== null) {
    base = "per_serving";
    baseConfidence = "high";
  } else {
    // sin marca de doble columna ni de tamano de porcion: asumimos "por porcion"
    // porque es el formato que exige el rotulado colombiano, pero con menos certeza
    base = "per_serving";
    baseConfidence = "medium";
  }

  const normalizedTo100 = computeNormalizedTo100(macros, base, servingSizeG, warnings);

  return {
    base,
    baseConfidence,
    servingSizeG,
    servingSizeRaw,
    servingsPerContainer,
    macros,
    micronutrients,
    normalizedTo100,
    warnings,
  };
}

// Exportado para poder probar en aislamiento la regla más delicada del parser:
// la interpretacion de coma/punto decimal en cifras colombianas.
export { parseDecimalNumber };
