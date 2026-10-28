import { Link } from "react-router-dom";

import { LEGAL_ROUTES } from "../../lib/legal";
import LegalLayout, { LegalContactEmail, LegalOwnerName, LegalSection } from "./LegalLayout";

export default function PrivacyPolicy() {
  return (
    <LegalLayout title="Política de privacidad">
      <LegalSection title="En pocas palabras">
        <ul>
          <li>
            Usamos tus datos solo para que Alzo funcione: guardar tu entrenamiento, tu dieta y tus medidas, y
            mostrarte señales y proyecciones sobre ellos.
          </li>
          <li>No hay publicidad, no vendemos tus datos y no usamos herramientas de analítica ni de rastreo de terceros.</li>
          <li>Tus fotos de progreso y el audio de los comandos de voz no salen de tu dispositivo.</li>
          <li>
            Puedes borrar tu cuenta desde la app cuando quieras. Ver{" "}
            <Link to={LEGAL_ROUTES.deleteAccount}>cómo eliminar tu cuenta</Link>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Quién es responsable de tus datos">
        <p>
          El responsable del tratamiento de tus datos personales es <LegalOwnerName />. Puedes escribir a{" "}
          <LegalContactEmail /> para cualquier pregunta, consulta o reclamo sobre tus datos.
        </p>
        <p>
          Esta política cumple la Ley 1581 de 2012 (protección de datos personales o habeas data) y el Decreto 1377
          de 2013 (hoy incorporado en el Decreto 1074 de 2015) de Colombia.
        </p>
      </LegalSection>

      <LegalSection title="Qué datos tratamos">
        <ul>
          <li>
            <strong>Cuenta.</strong> Tu correo, tu número de celular si decides darlo y tu contraseña. De la
            contraseña solo guardamos una huella cifrada (hash): nadie puede leerla, ni siquiera nosotros.
          </li>
          <li>
            <strong>Inicio con Google o Apple.</strong> Si entras con Google, recibimos tu correo y un identificador
            de tu cuenta de Google. Si entras con Apple, recibimos un identificador de Apple, tu correo (puede ser una
            dirección de reenvío de Apple si eliges ocultar el tuyo) y, la primera vez, tu nombre si decides
            compartirlo. Nunca recibimos tu contraseña de Google ni de Apple.
          </li>
          <li>
            <strong>Perfil (opcional).</strong> Nombre visible, nombre de usuario, biografía, fecha de nacimiento,
            género y estatura, y tus preferencias (unidades, escala de esfuerzo, tema).
          </li>
          <li>
            <strong>Entrenamiento.</strong> Rutinas, sesiones (ejercicios, series, repeticiones, cargas, duración,
            esfuerzo y notas), planes y ciclos, ejercicios personalizados y si tienes una sesión en curso.
          </li>
          <li>
            <strong>Bienestar.</strong> Las calificaciones de sueño, estrés y sensaciones que registras al cerrar una
            sesión.
          </li>
          <li>
            <strong>Medidas corporales.</strong> Peso, estatura, perímetros, porcentaje de grasa y notas.
          </li>
          <li>
            <strong>Dieta.</strong> Lo que registras que comes (alimento, cantidad, hora, calorías, macronutrientes y
            micronutrientes), tus objetivos nutricionales, tus comidas guardadas y tus alimentos personales.
          </li>
          <li>
            <strong>Fotos de empaques.</strong> Si creas un alimento a partir de fotos del empaque o de la etiqueta
            nutricional, esas fotos se suben a nuestro servidor junto con el alimento. Antes de guardarlas las
            convertimos a un formato estándar, lo que borra los metadatos de la imagen, incluida la ubicación.
          </li>
          <li>
            <strong>Comandos de voz.</strong> El audio se procesa dentro de tu dispositivo y nunca se envía. Lo que sí
            se guarda con la sesión es el texto que la app reconoció de cada comando y si se aplicó o no, para que
            puedas revisar qué cambió.
          </li>
          <li>
            <strong>Señales y proyecciones.</strong> Los resultados que calcula la app a partir de tus datos y un
            registro de las proyecciones que te mostramos, que luego comparamos con lo que pasó de verdad.
          </li>
          <li>
            <strong>Relación con tu coach.</strong> Notas, reportes, invitaciones y el progreso que compartes con tu
            coach, con sus comentarios.
          </li>
          <li>
            <strong>Pagos (solo coaches, solo en la web).</strong> Los pagos del plan coach los procesa Stripe. Le
            enviamos tu correo y tu identificador interno; los datos de tu tarjeta los escribes en la página de Stripe
            y nosotros nunca los vemos. Guardamos el identificador de cliente y de suscripción de Stripe y el estado
            del pago.
          </li>
          <li>
            <strong>Registros técnicos.</strong> Como cualquier servidor web, el nuestro registra datos de cada
            petición (por ejemplo, dirección IP, fecha y ruta solicitada) para mantener la seguridad y diagnosticar
            fallos.
          </li>
        </ul>
        <p>
          <strong>Lo que no hacemos:</strong> no mostramos anuncios, no usamos identificadores de publicidad, no
          rastreamos tu actividad en otras apps o sitios, no pedimos tu ubicación ni tus contactos, y hoy Alzo no se
          conecta a Apple Salud ni a Google Fit.
        </p>
      </LegalSection>

      <LegalSection title="Datos de salud (datos sensibles)">
        <p>
          Tus medidas corporales, peso, dieta, bienestar y entrenamiento son datos relacionados con tu salud. La ley
          colombiana los considera <strong>datos sensibles</strong>, y por eso:
        </p>
        <ul>
          <li>
            No estás obligado a darlos. Tú decides qué registras; sin ellos, las funciones que dependen de esos datos
            no pueden mostrarte nada.
          </li>
          <li>
            Al registrarlos nos das tu autorización expresa para tratarlos únicamente con las finalidades de esta
            política.
          </li>
          <li>Puedes retirar esa autorización en cualquier momento borrando esos datos o tu cuenta.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Lo que se queda en tu dispositivo">
        <ul>
          <li>
            <strong>Fotos de progreso.</strong> Se guardan solo en el almacenamiento de la app en tu dispositivo. No
            se suben a ningún servidor, así que nosotros no podemos verlas ni recuperarlas. Se borran cuando las
            eliminas en la app o cuando desinstalas la app (en el navegador, al borrar los datos del sitio).
          </li>
          <li>
            <strong>Audio de voz.</strong> Lo transcribe un modelo de reconocimiento que viene dentro de la app. El
            micrófono solo se usa mientras tienes activa la captura por voz y el audio no se guarda ni se envía.
          </li>
          <li>
            <strong>Cámara.</strong> La lectura de códigos de barras y del texto de las etiquetas se hace en tu
            dispositivo con las librerías ML Kit de Google: las imágenes y el texto leído no se envían a Google.
            Según Google, estas librerías pueden enviarle datos técnicos básicos (como el modelo del dispositivo y
            métricas de funcionamiento de la librería).
          </li>
          <li>
            <strong>Copia para usar sin conexión.</strong> La app guarda en tu dispositivo tus preferencias, tus
            rutinas, borradores y las sesiones o comidas que registraste sin conexión hasta que se suben. También
            guarda tu sesión iniciada.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Para qué usamos tus datos">
        <ul>
          <li>Guardar tu registro, sincronizarlo entre tus dispositivos y mostrarte tu historial y tu progreso.</li>
          <li>
            Calcular señales y proyecciones. Son cálculos automáticos e informativos: no toman decisiones por ti.
          </li>
          <li>Mostrarte qué tan acertadas fueron las proyecciones anteriores y mejorar esos cálculos.</li>
          <li>Permitir que tu coach te acompañe, si te unes a uno.</li>
          <li>Mantener el catálogo compartido de alimentos.</li>
          <li>Cobrar el plan coach a quien lo contrate.</li>
          <li>Dar soporte, proteger la seguridad del servicio y cumplir obligaciones legales.</li>
        </ul>
        <p>No usamos tus datos para publicidad ni los vendemos.</p>
      </LegalSection>

      <LegalSection title="Con quién se comparten">
        <ul>
          <li>
            <strong>Tu coach, solo si te unes a uno.</strong> Al unirte con su código de invitación, ese coach puede
            ver tus entrenamientos, rutinas, medidas, dieta, progreso y proyecciones, ver si estás entrenando en ese
            momento, registrar datos en tu perfil (por ejemplo, medidas o comidas), dejarte notas y asignarte planes.
            Puedes salir cuando quieras en Perfil → Cuenta → Coach →
            «Salir de este coach»; desde ese momento deja de tener acceso.
          </li>
          <li>
            <strong>Otros usuarios, solo en el catálogo compartido.</strong> Si creas un alimento con código de
            barras, se agrega al catálogo compartido: su nombre, marca, valores nutricionales y las fotos del empaque
            que subas quedan visibles para todos los usuarios. No mostramos quién lo aportó. Los alimentos sin código
            de barras quedan privados en tu cuenta.
          </li>
          <li>
            <strong>Proveedores que hacen funcionar el servicio:</strong>
            <ul>
              <li>Google, para validar el inicio de sesión con Google.</li>
              <li>Apple, para validar el inicio de sesión con Apple y revocarlo cuando borras tu cuenta.</li>
              <li>Stripe, para cobrar el plan coach en la web.</li>
              <li>
                Open Food Facts, una base de datos abierta de alimentos. Cuando escaneas un código de barras que no
                está en nuestro catálogo, nuestro servidor le pregunta por ese producto enviando solo el número del
                código de barras. Open Food Facts no recibe tu nombre, tu correo ni tu dirección IP.
              </li>
              <li>
                Quien aloje nuestros servidores, si usamos un proveedor de alojamiento: solo guarda y procesa los
                datos para mantener el servicio funcionando.
              </li>
            </ul>
          </li>
          <li>
            <strong>Personal autorizado del responsable</strong>, solo cuando haga falta para dar soporte, mantener la
            seguridad o cumplir la ley.
          </li>
          <li>
            <strong>Autoridades</strong>, cuando una ley o una orden judicial nos obligue.
          </li>
        </ul>
        <p>
          Si eres coach y registras datos de una persona que no tiene cuenta en Alzo, debes tener antes su
          autorización para hacerlo.
        </p>
      </LegalSection>

      <LegalSection title="Transferencias fuera de Colombia">
        <p>
          Google, Apple, Stripe y Open Food Facts operan servidores fuera de Colombia. Los datos que cada uno recibe
          (los descritos arriba) pueden tratarse en otros países, bajo sus propias políticas de privacidad. Al usar
          esas funciones lo autorizas.
        </p>
      </LegalSection>

      <LegalSection title="Cuánto tiempo guardamos tus datos">
        <p>
          Mientras tengas tu cuenta. Si la borras, eliminamos tus datos de nuestra base de datos. Los respaldos que
          hacemos para recuperar el servicio ante fallos pueden conservar una copia hasta que se reemplacen; no se
          usan para nada más. Los registros de pago pueden conservarse el tiempo que exija la ley tributaria.
        </p>
      </LegalSection>

      <LegalSection title="Seguridad">
        <p>
          La app y el servidor se comunican por una conexión cifrada (HTTPS), cada cuenta solo puede ver sus propios
          datos (y los de sus atletas, si es coach) y las fotos de empaques se revisan y se convierten antes de
          guardarse. Ningún sistema es infalible: si detectamos un incidente que afecte tus datos, te avisaremos y
          lo reportaremos a la autoridad como exige la ley.
        </p>
      </LegalSection>

      <LegalSection title="Tus derechos">
        <p>Como titular de tus datos tienes derecho a:</p>
        <ul>
          <li>Conocer, actualizar y rectificar tus datos.</li>
          <li>Pedir prueba de la autorización que nos diste.</li>
          <li>Saber cómo hemos usado tus datos.</li>
          <li>Revocar tu autorización y pedir que borremos tus datos.</li>
          <li>Acceder gratis a tus datos.</li>
          <li>
            Presentar quejas ante la Superintendencia de Industria y Comercio (SIC), después de haber hecho tu
            consulta o reclamo ante nosotros.
          </li>
        </ul>
        <p>
          Muchas de estas cosas puedes hacerlas tú mismo en la app: editar tu perfil, corregir o borrar registros y
          eliminar tu cuenta. Para lo demás, escribe a <LegalContactEmail /> desde el correo de tu cuenta, diciendo
          qué necesitas. Respondemos las consultas en máximo 10 días hábiles y los reclamos en máximo 15 días
          hábiles; si necesitamos más tiempo te diremos por qué, y no será más de 5 días hábiles adicionales para
          consultas ni 8 para reclamos.
        </p>
      </LegalSection>

      <LegalSection title="Edad mínima">
        <p>
          Alzo es para personas de 18 años o más. No recogemos a sabiendas datos de menores de edad; si crees que un
          menor creó una cuenta, escríbenos y la eliminaremos.
        </p>
      </LegalSection>

      <LegalSection title="Permisos del dispositivo">
        <ul>
          <li>
            <strong>Cámara:</strong> para escanear códigos de barras y fotografiar etiquetas, empaques y tus fotos de
            progreso.
          </li>
          <li>
            <strong>Micrófono:</strong> para registrar series por voz, solo mientras activas la captura por voz.
          </li>
          <li>
            <strong>Fotos:</strong> para elegir una imagen que ya tengas en tu galería.
          </li>
        </ul>
        <p>Puedes negar o retirar cualquier permiso en los ajustes de tu dispositivo; la función que lo usa dejará de estar disponible.</p>
      </LegalSection>

      <LegalSection title="Cambios a esta política">
        <p>
          Esta política rige desde la fecha de actualización que aparece arriba y nuestras bases de datos estarán
          vigentes mientras el servicio funcione. Si hacemos cambios importantes, te avisaremos en la app antes de
          que apliquen. Lee también los <Link to={LEGAL_ROUTES.terms}>términos de uso</Link>.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
