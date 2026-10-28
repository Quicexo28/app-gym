import { Link } from "react-router-dom";

import { LEGAL_ROUTES } from "../../lib/legal";
import LegalLayout, { LegalContactEmail, LegalOwnerName, LegalSection } from "./LegalLayout";

export default function Terms() {
  return (
    <LegalLayout title="Términos de uso">
      <LegalSection title="Aviso de salud">
        <p>
          <strong>
            Alzo no es un dispositivo médico y no reemplaza a tu médico, nutricionista ni a un profesional del
            ejercicio.
          </strong>{" "}
          No diagnostica, no trata ni previene enfermedades.
        </p>
        <ul>
          <li>
            Consulta con un profesional de la salud antes de empezar o cambiar tu dieta o tu entrenamiento, sobre
            todo si tienes una enfermedad, una lesión, estás en embarazo, tomas medicamentos o has tenido trastornos de
            la conducta alimentaria.
          </li>
          <li>
            La app no decide por ti: muestra señales y proyecciones con su incertidumbre. Son estimaciones que pueden
            equivocarse, no promesas de resultado. La decisión final es tuya o de tu coach.
          </li>
          <li>
            Los valores nutricionales vienen de etiquetas, de Open Food Facts o de otros usuarios y pueden tener
            errores. La lectura por cámara y por voz también puede equivocarse: revisa los datos antes de guardarlos.
          </li>
          <li>
            Si sientes dolor en el pecho, mareo, falta de aire o un dolor fuera de lo normal, detén el ejercicio y
            busca atención médica. En una emergencia en Colombia, llama al 123.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Qué es Alzo y quién lo ofrece">
        <p>
          Alzo es una herramienta para registrar tu entrenamiento, tu dieta y tus medidas, y ver señales y
          proyecciones sobre ellos. La ofrece <LegalOwnerName /> (en adelante, «nosotros»). Al crear una cuenta o usar
          la app aceptas estos términos y la <Link to={LEGAL_ROUTES.privacy}>política de privacidad</Link>. Si no estás
          de acuerdo, no uses la app.
        </p>
      </LegalSection>

      <LegalSection title="Edad mínima">
        <p>Debes tener 18 años o más para usar Alzo.</p>
      </LegalSection>

      <LegalSection title="Tu cuenta">
        <ul>
          <li>Da datos verdaderos y mantenlos al día.</li>
          <li>Cuida tu contraseña. Eres responsable de lo que se haga con tu cuenta.</li>
          <li>Cada cuenta es de una sola persona.</li>
          <li>
            Puedes eliminar tu cuenta cuando quieras. Ver{" "}
            <Link to={LEGAL_ROUTES.deleteAccount}>cómo eliminar tu cuenta</Link>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Coaches">
        <ul>
          <li>
            Los coaches son personas independientes, no empleados nuestros. No verificamos sus títulos ni su
            experiencia, y lo que te recomienden es responsabilidad de ellos.
          </li>
          <li>
            Un coach solo ve tus datos si tú te unes con su código de invitación, y puedes salir cuando quieras.
          </li>
          <li>
            Si eres coach, usa los datos de tus atletas solo para acompañarlos. Si registras a una persona que no tiene
            cuenta, debes tener antes su autorización.
          </li>
          <li>
            El plan coach se contrata en la versión web y lo cobra Stripe. Antes de pagar verás el precio y cómo se
            renueva; puedes cancelarlo desde «Gestionar pago» en la versión web.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Tu contenido">
        <ul>
          <li>
            Lo que registras sigue siendo tuyo. Nos das permiso para guardarlo y procesarlo solo para prestarte el
            servicio.
          </li>
          <li>
            Si aportas un alimento al catálogo compartido (al crearlo con código de barras), nos das permiso gratuito
            y sin exclusividad para mostrarlo a los demás usuarios, incluidas las fotos del empaque.
          </li>
          <li>
            En los alimentos, sube solo fotos de empaques y etiquetas. No subas fotos de personas, contenido que no
            sea tuyo ni nada ilegal.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Uso aceptable">
        <p>No intentes acceder a datos de otras personas, atacar o sobrecargar el servicio, ni usar la app para fines ilegales. Podemos suspender o cerrar las cuentas que lo hagan.</p>
      </LegalSection>

      <LegalSection title="Disponibilidad del servicio">
        <ul>
          <li>
            Hacemos lo posible por mantener Alzo funcionando, pero puede tener fallos o interrupciones, y podemos
            cambiar o retirar funciones.
          </li>
          <li>
            Lo que registras sin conexión se sube cuando vuelve la conexión; si desinstalas la app antes, se pierde.
          </li>
          <li>
            Las fotos de progreso solo existen en tu dispositivo: si lo pierdes, cambias de equipo o desinstalas la
            app, no podemos recuperarlas.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Responsabilidad">
        <p>
          Ofrecemos Alzo tal como está. En la medida en que la ley colombiana lo permita, no respondemos por
          decisiones de salud, dieta o entrenamiento que tomes con base en la app, ni por daños indirectos. Nada de
          esto limita los derechos que te da el Estatuto del Consumidor (Ley 1480 de 2011) ni otras normas que no se
          puedan renunciar.
        </p>
      </LegalSection>

      <LegalSection title="Cambios y ley aplicable">
        <p>
          Si cambiamos estos términos, actualizaremos la fecha de arriba y, si el cambio es importante, te avisaremos
          en la app. Estos términos se rigen por las leyes de Colombia.
        </p>
      </LegalSection>

      <LegalSection title="Contacto">
        <p>
          Escríbenos a <LegalContactEmail />.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
