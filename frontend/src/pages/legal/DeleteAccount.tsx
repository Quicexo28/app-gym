import { Link } from "react-router-dom";

import { LEGAL_ROUTES } from "../../lib/legal";
import LegalLayout, { LegalContactEmail, LegalSection } from "./LegalLayout";

const DELETE_REQUEST_SUBJECT = "Eliminar mi cuenta de Alzo";

export default function DeleteAccount() {
  return (
    <LegalLayout title="Eliminar tu cuenta de Alzo">
      <LegalSection title="Antes de empezar">
        <ul>
          <li>
            <strong>Fotos de progreso:</strong> solo están en tu dispositivo y no se borran con la cuenta. Si quieres
            borrarlas, hazlo antes en Perfil → Progreso → Fotos → «Borrar todas», o desinstala la app (en el navegador,
            borra los datos del sitio).
          </li>
          <li>
            <strong>Si eres coach con el plan activo:</strong> al borrar la cuenta le pedimos a Stripe que cancele tu
            suscripción. Si quieres asegurarte, cancélala antes en la versión web, en Invitaciones y cupo → «Gestionar
            pago».
          </li>
          <li>Borrar la cuenta no se puede deshacer.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Desde la app">
        <ol>
          <li>Inicia sesión.</li>
          <li>Ve a Perfil → Ajustes.</li>
          <li>Abre «Zona peligrosa» y toca «Eliminar mi cuenta».</li>
          <li>
            Escribe exactamente <strong>ELIMINAR CUENTA</strong> y confirma.
          </li>
        </ol>
        <p>La cuenta se borra en ese momento y se cierra tu sesión.</p>
      </LegalSection>

      <LegalSection title="Sin la app">
        <p>
          Escribe a <LegalContactEmail subject={DELETE_REQUEST_SUBJECT} /> con el asunto «{DELETE_REQUEST_SUBJECT}»,
          desde el correo con el que creaste la cuenta. Si ya no tienes acceso a ese correo, dinos el correo o el
          celular de la cuenta y te pediremos una forma de confirmar que es tuya. La borraremos en máximo 15 días
          hábiles y te avisaremos cuando esté hecho.
        </p>
      </LegalSection>

      <LegalSection title="Qué se borra">
        <ul>
          <li>Tu cuenta: correo, celular, contraseña y el vínculo con Google o Apple (a Apple le pedimos revocarlo).</li>
          <li>Tu perfil y tus preferencias.</li>
          <li>Tus entrenamientos, rutinas, planes, ejercicios personalizados y datos de bienestar.</li>
          <li>Tus medidas corporales.</li>
          <li>Tu dieta: comidas registradas, objetivos, comidas guardadas y alimentos personales con sus fotos.</li>
          <li>Las señales, proyecciones y registros de proyecciones calculados con tus datos.</li>
          <li>Tu relación con tu coach o tus atletas, las notas y el progreso compartido.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Qué no se borra">
        <ul>
          <li>
            Lo que está guardado solo en tu dispositivo (fotos de progreso, preferencias y copias para usar sin
            conexión) hasta que lo borres tú o desinstales la app.
          </li>
          <li>
            Los alimentos que aportaste al catálogo compartido (los creados con código de barras): se quedan para los
            demás usuarios, sin ningún dato que te identifique.
          </li>
          <li>
            Los registros de pago que la ley tributaria nos obligue a conservar, y los que Stripe guarde por su
            cuenta.
          </li>
          <li>
            Las copias en respaldos de la base de datos, que se borran cuando esos respaldos se reemplazan. No se usan
            para nada distinto a recuperar el servicio ante fallos.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Borrar solo algunos datos">
        <p>
          Sin cerrar tu cuenta puedes borrar comidas, alimentos personales, comidas guardadas, rutinas, ejercicios
          personalizados y fotos de progreso desde la app. Para borrar otros datos, escribe a <LegalContactEmail />.
          Más detalles en la <Link to={LEGAL_ROUTES.privacy}>política de privacidad</Link>.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
