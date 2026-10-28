/**
 * Datos del responsable para las páginas legales públicas (/legal/*).
 *
 * Vienen del entorno de build para no dejar un correo ni un nombre inventados
 * en el código. Si faltan, las páginas muestran un aviso visible en lugar del
 * dato (ver `LegalContactEmail` / `LegalOwnerName`).
 */

export const LEGAL_CONTACT_EMAIL = (import.meta.env.VITE_LEGAL_CONTACT_EMAIL as string | undefined)?.trim() ?? "";
export const LEGAL_OWNER_NAME = (import.meta.env.VITE_LEGAL_OWNER_NAME as string | undefined)?.trim() ?? "";
export const LEGAL_LAST_UPDATED = "28 de octubre de 2026";
// Versión de Términos y Política que el backend guarda con el consentimiento al crear la cuenta.
// Cámbiala junto con LEGAL_LAST_UPDATED cada vez que cambien los textos legales.
export const LEGAL_VERSION = "2026-10-28";

export const LEGAL_CONTACT_EMAIL_MISSING = "(correo de contacto no configurado)";
export const LEGAL_OWNER_NAME_MISSING = "(responsable no configurado)";

export const LEGAL_ROUTES = {
  privacy: "/legal/privacidad",
  terms: "/legal/terminos",
  deleteAccount: "/legal/eliminar-cuenta",
} as const;
